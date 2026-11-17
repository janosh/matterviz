import { display_idx } from '#lib/labels.js'
import type { Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { AnyStructure, Pbc, Site } from '#lib/structure/index.js'
import { numeric_sites } from '#lib/structure/site.js'

export const NO_PBC: Pbc = [false, false, false]

// Purely geometric fixed-radius / k-nearest neighbor lists with periodic images over a binned
// image cloud. The single neighbor-search primitive: RDF, coordination, bond angles, structure
// identification and bond perception (electroneg_ratio in bonding.ts) layer their filters on it.
//
// Layout: neighbors of center `idx` occupy slots [offsets[idx], offsets[idx + 1]), sorted by
// ascending distance unless the query opted out. For slot `slot`: `neighbors[slot]` is the
// partner's site index, `images[3*slot..]` the integer lattice shift applied to the partner
// (so its position is `sites[neighbors[slot]].xyz + images · lattice`), `deltas[3*slot..]` that
// shifted position minus the center's and `distances[slot]` its norm. Both ends of a pair
// are listed (from each center once), a site's own periodic images count as neighbors,
// and only the unshifted self is excluded. Coincident sites (distance 0) are reported, not
// dropped: they are in range, and hiding them would mask duplicate-site input.
export type NeighborList = {
  n_centers: number
  cutoff: number // radius actually searched (for `k` queries: the final grown radius)
  offsets: Int32Array
  neighbors: Int32Array
  images: Int32Array
  deltas: Float64Array
  distances: Float64Array
}

export type NeighborQueryOptions = (
  | {
      cutoff: number
      // Sort each center's block by distance (default true). Callers that filter every
      // contact anyway (bond perception) skip it: on a 10k-atom cell the sort is a third of
      // the query. `k` queries are always sorted, they take the prefix of each block.
      sorted?: boolean
    }
  | { k: number }
) & {
  // Defaults to the lattice's own pbc (see lattice_pbc_or_throw); molecules are never periodic.
  pbc?: Pbc
}

// Refuse to materialize an image cloud (base sites + periodic images within `cutoff` of the
// cell) bigger than this: a cutoff of many cell lengths on a large cell is almost always a
// unit mix-up. The check counts the images that will actually be built, not a 27x bound, so
// a 15 A cutoff on a 160k-atom / 120 A box (~312k positions) passes.
const MAX_IMAGE_CLOUD = 4_000_000
// The image cloud bounds the search space, not the result: a 64k-atom cell at the RDF's 15 A
// default holds ~40M pairs (2.6 GB of lists), a large-cell k query can grow its radius into
// the same. Refuse past this many stored pairs (~1.2 GB peak) instead of exhausting memory on
// the main thread; a 10k-atom MD frame at 15 A is ~3M pairs.
export const MAX_NEIGHBOR_PAIRS = 10_000_000
// Large supercells get a budget proportional to their size: band-filtered bond searches store
// up to ~10 pairs per site and skinned BondSearch lists ~12 (13 metal, ionic and covalent
// lattices, with and without 0.15 A noise), a unit mix-up hundreds; ~32 B per imageless pair.
export const MAX_PAIRS_PER_SITE = 16
// The dense grid holds at most this many bins per cloud position; sparser clouds (a tiny
// cutoff on a far-flung cluster) get bins wider than `cutoff`, which stays correct since a
// neighbor is then still within the 27 surrounding bins.
const MAX_BINS_PER_POSITION = 2

// Amortized doubling, never past `cap` (so a capped buffer fills exactly to its budget)
export const grow = <Buffer extends Float64Array | Int32Array>(
  buffer: Buffer,
  needed: number,
  cap = Infinity,
): Buffer => {
  if (needed <= buffer.length) return buffer
  const BufferType = buffer.constructor as new (length: number) => Buffer
  const next = new BufferType(Math.min(cap, Math.max(needed, buffer.length * 2)))
  next.set(buffer)
  return next
}

// Forward offsets for cutoff-wide bins (13 neighbors) and half-width bins (62).
// Each unordered pair of bins is searched once; own-bin pairs use increasing slots.
type BinOffset = [...Vec3, opposite_mask: number]
const FORWARD_BIN_OFFSETS: BinOffset[] = []
const FINE_BIN_OFFSETS: BinOffset[] = []
for (let delta_x = -2; delta_x <= 2; delta_x++) {
  for (let delta_y = -2; delta_y <= 2; delta_y++) {
    for (let delta_z = -2; delta_z <= 2; delta_z++) {
      if (delta_x * 25 + delta_y * 5 + delta_z <= 0) continue
      const offset: BinOffset = [delta_x, delta_y, delta_z, 0]
      FINE_BIN_OFFSETS.push(offset)
      if (Math.max(Math.abs(delta_x), Math.abs(delta_y), Math.abs(delta_z)) <= 1)
        FORWARD_BIN_OFFSETS.push(offset)
    }
  }
}

// Each mask uses the original 13 neighbors first, then matching nonadjacent bins.
// Lower/upper edge bits are paired for x, y, then z; the fourth offset field selects
// the opposite edges that must be occupied in the destination bin.
const BOUNDARY_BIN_OFFSETS = Array.from({ length: 64 }, () => [...FORWARD_BIN_OFFSETS])
for (const [delta_x, delta_y, delta_z] of FINE_BIN_OFFSETS) {
  const delta: Vec3 = [delta_x, delta_y, delta_z]
  const facing = delta.reduce(
    (bits, step, axis) =>
      bits | (Math.abs(step) === 2 ? 1 << (2 * axis + (step > 0 ? 1 : 0)) : 0),
    0,
  )
  if (!facing) continue
  const offset: BinOffset = [...delta, ((facing & 21) << 1) | ((facing & 42) >> 1)]
  for (const [mask, offsets] of BOUNDARY_BIN_OFFSETS.entries()) {
    if ((mask & facing) === facing) offsets.push(offset)
  }
}

// Keep coarse bin assignments unchanged so existing contacts retain their discovery order.
// Only pairs within the rounding error of facing edges can cross two cutoff-wide bins.
function coarse_boundary_masks(
  cloud_pos: Float64Array,
  bin_of: Int32Array,
  widths: Vec3,
  shape: Vec3,
  mins: Vec3,
  maxs: Vec3,
  cutoff: number,
): Uint8Array | undefined {
  if (shape.every((count) => count < 3)) return undefined
  const masks = new Uint8Array(shape[0] * shape[1] * shape[2])
  let upper_boundary = false
  for (let axis = 0; axis < 3; axis++) {
    if (shape[axis] < 3) continue
    const tolerance = (4 * Number.EPSILON * (maxs[axis] - mins[axis] + cutoff)) / widths[axis]
    const lower = 1 << (2 * axis)
    const upper = lower << 1
    for (let slot = 0; slot < bin_of.length; slot++) {
      const frac = (cloud_pos[slot * 3 + axis] - mins[axis]) / widths[axis]
      const remainder = frac - Math.floor(frac)
      if (remainder <= tolerance) masks[bin_of[slot]] |= lower
      if (1 - remainder <= tolerance) {
        masks[bin_of[slot]] |= upper
        upper_boundary = true
      }
    }
  }
  return upper_boundary ? masks : undefined
}

type NeighborDistanceVisitor = (center: number, neighbor: number, distance: number) => void

// Where to read site positions: a trajectory frame's numeric columns when it has them (read
// inline by hot loops, sparing millions of accessor calls), its site objects otherwise
export const site_positions = (
  structure: AnyStructure,
): { sites: Site[]; n_sites: number; coordinates?: Float64Array; stride: number } => {
  const columns = numeric_sites.get(structure)
  const sites = columns ? [] : structure.sites
  return {
    sites,
    n_sites: columns?.length ?? sites.length,
    coordinates: columns?.coordinates,
    stride: columns?.stride ?? 0,
  }
}

// Per-element-pair distance band: a pair of sites with interned element ids (e_a, e_b) is kept
// only while !(dist > hi[e_a * n_elem + e_b] || dist < lo[...]). Tables must be symmetric,
// the sweep visits each pair in whichever orientation its bins give.
export type PairBand = {
  elem_ids: Int32Array
  n_elem: number
  lo: Float64Array
  hi: Float64Array
}

type CutoffQuery = {
  pbc?: Pbc
  sorted?: boolean
  // List each site pair once, from its lower site index; a site's own image pair (shift s and
  // -s) only under the canonical s. Halves the lists bond perception reads.
  unique_pairs?: boolean
  // Fill `images`/`deltas` (default: unless unique_pairs); bond candidates need neither
  image_geometry?: boolean
  // Drop pairs outside their element pair's band during the sweep, before any storage
  band?: PairBand
}

export const bounding_box = (
  pos: Float64Array,
  n_points: number,
): [mins: Vec3, maxs: Vec3] => {
  const mins: Vec3 = [Infinity, Infinity, Infinity]
  const maxs: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let point = 0; point < n_points; point++) {
    for (let axis = 0; axis < 3; axis++) {
      const coord = pos[point * 3 + axis]
      if (coord < mins[axis]) mins[axis] = coord
      if (coord > maxs[axis]) maxs[axis] = coord
    }
  }
  return [mins, maxs]
}
const bins_along = (span: number, width: number) => Math.floor(span / width) + 1

// Dense bins over a bounding box, filled by counting sort so bin `bin` is the contiguous slice
// bin_items[bin_start[bin]..bin_start[bin + 1]) in ascending point order. `widths` doubles in
// place along the most-binned axis until at most MAX_BINS_PER_POSITION bins per point remain.
// A cloud with one far-flung atom (an MD blow-up) spans ~10 A in two axes and 1e9+ A in the
// third: widening that axis alone keeps the cluster spread over the other two instead of
// collapsing it into a single O(n^2) bin, as one shared width (cubic bins) would. An isotropic
// sparse cloud ends within 2x of the ideal width, which holds under 0.5 atoms per cutoff-bin.
export function bin_points(
  pos: Float64Array,
  n_points: number,
  [mins, maxs]: Vec3[],
  widths: Vec3,
) {
  const spans = mins.map((min, axis) => maxs[axis] - min)
  const n_axis = spans.map((span, axis) => bins_along(span, widths[axis])) as Vec3
  while (n_axis[0] * n_axis[1] * n_axis[2] > MAX_BINS_PER_POSITION * n_points + 1) {
    const widest = n_axis.indexOf(Math.max(...n_axis))
    widths[widest] *= 2
    n_axis[widest] = bins_along(spans[widest], widths[widest])
  }
  const [n_x, n_y, n_z] = n_axis
  const bin_of = new Int32Array(n_points)
  const bin_start = new Int32Array(n_x * n_y * n_z + 1)
  for (let point = 0; point < n_points; point++) {
    const idx_x = Math.floor((pos[point * 3] - mins[0]) / widths[0])
    const idx_y = Math.floor((pos[point * 3 + 1] - mins[1]) / widths[1])
    const idx_z = Math.floor((pos[point * 3 + 2] - mins[2]) / widths[2])
    bin_of[point] = idx_x + n_x * (idx_y + n_y * idx_z)
    bin_start[bin_of[point] + 1]++
  }
  for (let bin = 1; bin < bin_start.length; bin++) bin_start[bin] += bin_start[bin - 1]
  const bin_items = new Int32Array(n_points)
  const cursor = bin_start.slice(0, -1)
  for (let point = 0; point < n_points; point++) bin_items[cursor[bin_of[point]]++] = point
  return { n_axis, bin_of, bin_start, bin_items }
}

// Fixed-radius query. Base positions are wrapped into the cell on periodic axes (a
// trajectory frame may sit far outside it) and only images that can reach within `cutoff`
// of the cell are generated, so the cloud grows with the boundary shell, not 27x. Image
// shifts are reported relative to the ORIGINAL (unwrapped) coordinates.
export function neighbor_query_cutoff(
  structure: AnyStructure,
  cutoff: number,
  query: CutoffQuery,
): NeighborList
export function neighbor_query_cutoff(
  structure: AnyStructure,
  cutoff: number,
  query: Pick<CutoffQuery, 'pbc'>,
  visit: NeighborDistanceVisitor,
): void
export function neighbor_query_cutoff(
  structure: AnyStructure,
  cutoff: number,
  {
    pbc: pbc_override,
    sorted = false,
    unique_pairs = false,
    image_geometry = !unique_pairs,
    band,
  }: CutoffQuery,
  visit?: NeighborDistanceVisitor,
): NeighborList | void {
  const { sites, n_sites, coordinates, stride } = site_positions(structure)
  if (!(cutoff > 0) || !Number.isFinite(cutoff)) {
    throw new Error(`neighbor_query: cutoff must be a positive finite number, got ${cutoff}`)
  }
  const cutoff_sq = cutoff * cutoff
  const normal_cutoff =
    Number.isFinite(cutoff_sq) && cutoff_sq >= Number.MIN_VALUE / Number.EPSILON
  const lattice = `lattice` in structure ? structure.lattice.matrix : null
  const pbc = lattice_pbc_or_throw(structure, pbc_override)

  // Cloud = wrapped base sites (first n_sites slots, index-aligned) + periodic images.
  // cloud_src maps a cloud slot to its site; cloud_shift holds the integer lattice shift
  // from that site's ORIGINAL position (wrap + replica shift).
  let n_cloud = n_sites
  let cloud_pos: Float64Array = new Float64Array(n_sites * 3)
  let cloud_src: Int32Array = new Int32Array(n_sites)
  let cloud_shift: Int32Array = new Int32Array(n_sites * 3)
  for (let idx = 0; idx < n_sites; idx++) {
    const coord_x = coordinates ? coordinates[idx * stride] : sites[idx].xyz[0]
    const coord_y = coordinates ? coordinates[idx * stride + 1] : sites[idx].xyz[1]
    const coord_z = coordinates ? coordinates[idx * stride + 2] : sites[idx].xyz[2]
    if (!(Number.isFinite(coord_x) && Number.isFinite(coord_y) && Number.isFinite(coord_z))) {
      // oxlint-disable-next-line unicorn/prefer-type-error -- a NaN/Infinity coordinate is a bad value, not a bad type
      throw new Error(
        `neighbor_query: site ${display_idx(idx)} has a non-finite position (${coord_x}, ${coord_y}, ${coord_z})`,
      )
    }
    cloud_pos[idx * 3] = coord_x
    cloud_pos[idx * 3 + 1] = coord_y
    cloud_pos[idx * 3 + 2] = coord_z
    cloud_src[idx] = idx
  }
  if (lattice && pbc.some(Boolean)) {
    const heights = math.cell_heights(lattice)
    if (pbc.some((flag, axis) => flag && !(heights[axis] > 0 && heights[axis] < Infinity))) {
      throw new Error(
        `neighbor_query: periodic lattice is degenerate (cell heights ${heights.join(`, `)} A)`,
      )
    }
    const [
      [axis_x, axis_y, axis_z],
      [basis_x, basis_y, basis_z],
      [center_x, center_y, center_z],
    ] = lattice
    const cart_to_frac = math.create_cart_to_frac(lattice)
    // An image shifted by s along a periodic axis can reach the cell only if frac + s lands
    // within pad = cutoff / height of [0, 1]
    const pad: Vec3 = [0, 0, 0]
    const max_shift: Vec3 = [0, 0, 0]
    for (let axis = 0; axis < 3; axis++) {
      if (!pbc[axis]) continue
      pad[axis] = cutoff / heights[axis]
      max_shift[axis] = Math.ceil(pad[axis])
    }
    const in_reach = (frac: number, shift: number, axis: number): boolean =>
      !pbc[axis] || (frac + shift >= -pad[axis] && frac + shift <= 1 + pad[axis])
    // Wrapped fractional coords of every site plus the integer wrap shift applied, and per
    // axis the contiguous range [shift_lo, shift_hi] of image shifts in reach (0 always is:
    // the wrapped coordinate sits inside the cell)
    const frac = new Float64Array(n_sites * 3)
    const wrap = new Int32Array(n_sites * 3)
    const shift_lo = new Int32Array(n_sites * 3)
    const shift_hi = new Int32Array(n_sites * 3)
    const xyz: Vec3 = [0, 0, 0]
    const site_frac: Vec3 = [0, 0, 0]
    // exact image count = product over axes of the shifts in reach, minus the site itself
    let n_images = 0
    for (let idx = 0; idx < n_sites; idx++) {
      for (let axis = 0; axis < 3; axis++) xyz[axis] = cloud_pos[idx * 3 + axis]
      cart_to_frac(xyz, site_frac)
      let n_site_images = 1
      for (let axis = 0; axis < 3; axis++) {
        const offset = idx * 3 + axis
        wrap[offset] = pbc[axis] ? -Math.floor(site_frac[axis]) : 0
        frac[offset] = site_frac[axis] + wrap[offset]
        let lower = -max_shift[axis]
        let upper = max_shift[axis]
        while (lower < 0 && !in_reach(frac[offset], lower, axis)) lower++
        while (upper > 0 && !in_reach(frac[offset], upper, axis)) upper--
        shift_lo[offset] = lower
        shift_hi[offset] = upper
        n_site_images *= upper - lower + 1
      }
      n_images += n_site_images - 1
    }
    if (n_sites + n_images > MAX_IMAGE_CLOUD) {
      throw new Error(
        `neighbor_query: cutoff ${cutoff} A reaches ${max_shift.join(`, `)} cells along a, b, c ` +
          `(cell heights ${heights.map((val) => val.toFixed(2)).join(`, `)} A) and needs ` +
          `${n_images} periodic images of ${n_sites} sites; refusing to build more than ` +
          `${MAX_IMAGE_CLOUD} positions, a cutoff this far past the cell is almost always a ` +
          `unit mix-up`,
      )
    }
    n_cloud = n_sites + n_images
    cloud_pos = grow(cloud_pos, n_cloud * 3)
    cloud_src = grow(cloud_src, n_cloud)
    cloud_shift = grow(cloud_shift, n_cloud * 3)
    let slot = 0
    const push_cloud = (idx: number, shift_a: number, shift_b: number, shift_c: number) => {
      const face_a = frac[idx * 3] + shift_a
      const face_b = frac[idx * 3 + 1] + shift_b
      const face_c = frac[idx * 3 + 2] + shift_c
      cloud_pos[slot * 3] = face_a * axis_x + face_b * basis_x + face_c * center_x
      cloud_pos[slot * 3 + 1] = face_a * axis_y + face_b * basis_y + face_c * center_y
      cloud_pos[slot * 3 + 2] = face_a * axis_z + face_b * basis_z + face_c * center_z
      cloud_src[slot] = idx
      cloud_shift[slot * 3] = wrap[idx * 3] + shift_a
      cloud_shift[slot * 3 + 1] = wrap[idx * 3 + 1] + shift_b
      cloud_shift[slot * 3 + 2] = wrap[idx * 3 + 2] + shift_c
      slot++
    }
    // Base slots first so cloud index === site index for the centers
    for (let idx = 0; idx < n_sites; idx++) push_cloud(idx, 0, 0, 0)
    for (let idx = 0; idx < n_sites; idx++) {
      const offset = idx * 3
      for (let shift_a = shift_lo[offset]; shift_a <= shift_hi[offset]; shift_a++) {
        for (let shift_b = shift_lo[offset + 1]; shift_b <= shift_hi[offset + 1]; shift_b++) {
          for (
            let shift_c = shift_lo[offset + 2];
            shift_c <= shift_hi[offset + 2];
            shift_c++
          ) {
            if (shift_a === 0 && shift_b === 0 && shift_c === 0) continue
            push_cloud(idx, shift_a, shift_b, shift_c)
          }
        }
      }
    }
  }

  if (n_cloud === 0) {
    if (visit) return
    return {
      n_centers: 0,
      cutoff,
      offsets: new Int32Array(1),
      neighbors: new Int32Array(0),
      images: new Int32Array(0),
      deltas: new Float64Array(0),
      distances: new Float64Array(0),
    }
  }

  // Bins over the cloud (ascending slot within a bin, so base sites precede images). The
  // selected forward stencil spans at least the cutoff along every axis.
  const bounds = bounding_box(cloud_pos, n_cloud)
  const [mins, maxs] = bounds
  // Dense RDF queries spend most of their time rejecting pairs outside the cutoff.
  // Finer bins reduce these candidates; sparse clouds and small cells keep cheap setup.
  const coarse = mins.map((min, axis) => bins_along(maxs[axis] - min, cutoff))
  const fine_bins =
    Boolean(visit) &&
    n_sites >= 2000 &&
    normal_cutoff &&
    n_cloud / (coarse[0] * coarse[1] * coarse[2]) >= 32
  // Subtracting the origin and dividing into bins each round both endpoints. Fine bins include
  // their span-scaled errors and the rounded distance comparison, so a cutoff pair cannot
  // straddle three half-width bins. Distance and cutoff arithmetic is unchanged.
  const bin = mins.map((min, axis) =>
    fine_bins ? cutoff / 2 + 4 * Number.EPSILON * (maxs[axis] - min + cutoff) : cutoff,
  ) as Vec3
  const forward_offsets = fine_bins ? FINE_BIN_OFFSETS : FORWARD_BIN_OFFSETS
  const { n_axis, bin_of, bin_start, bin_items } = bin_points(cloud_pos, n_cloud, bounds, bin)
  const [n_x, n_y, n_z] = n_axis
  const n_bins = n_x * n_y * n_z
  const boundary_masks =
    !fine_bins && normal_cutoff
      ? coarse_boundary_masks(cloud_pos, bin_of, bin, n_axis, mins, maxs, cutoff)
      : undefined
  // Counting sort keeps base sites before images. Remember their boundary in each bin so
  // image centers scan only base endpoints, without testing the boundary for every pair.
  const bin_base_end = bin_start.slice(0, n_bins)
  for (let slot = 0; slot < n_sites; slot++) bin_base_end[bin_of[slot]]++
  const item_of = new Int32Array(visit ? 0 : n_cloud)
  if (!visit) for (let item = 0; item < n_cloud; item++) item_of[bin_items[item]] = item

  // Whether `partner` is listed under base slot `center` (see CutoffQuery.unique_pairs)
  const listed = (center: number, partner: number): boolean => {
    if (center >= n_sites || !unique_pairs) return center < n_sites
    const partner_site = cloud_src[partner]
    if (partner_site !== center) return partner_site > center
    for (let axis = 0; axis < 3; axis++) {
      const shift = cloud_shift[partner * 3 + axis] - cloud_shift[center * 3 + axis]
      if (shift !== 0) return shift > 0
    }
    return false
  }

  // Pair sweep: every pair within cutoff once, from the lexicographically lower bin (own bin:
  // the lower slot), skipping image-image pairs (images are never centers) and image-only bins'
  // ranges without base endpoints. Streaming histograms reuse a bin's ranges for all its slots.
  // Materialized lists keep slot discovery order, which bond consumers rely on for geometric
  // dedup and hull construction. Pairs are stored once (struct of arrays) and counted towards
  // each base endpoint; the per-center lists are assembled from them below.
  let pair_a: Int32Array = new Int32Array(visit ? 0 : Math.max(256, n_sites * 8))
  let pair_b: Int32Array = new Int32Array(pair_a.length)
  let pair_dist_sq: Float64Array = new Float64Array(pair_a.length)
  const offsets = new Int32Array(n_sites + 1) // per-center counts until the prefix sum below
  let n_pairs = 0
  const max_pairs = Math.max(MAX_NEIGHBOR_PAIRS, MAX_PAIRS_PER_SITE * n_sites)
  // Scan own bin first (starting just past the slot itself), then forward neighbors.
  const range_count = (boundary_masks ? FINE_BIN_OFFSETS : forward_offsets).length + 1
  // Each range stores its start, end, and end of base (non-image) positions.
  const scratch_ranges = new Int32Array(range_count * 3)
  // Reuse ranges when materialized queries revisit a bin in site discovery order.
  const ranges_by_bin = Array.from<Int32Array | undefined>({ length: visit ? 0 : n_bins })
  const n_groups = visit ? n_bins : n_cloud
  for (let group_idx = 0; group_idx < n_groups; group_idx++) {
    const bin_idx = visit ? group_idx : bin_of[group_idx]
    const bin_first = bin_start[bin_idx]
    const bin_end = bin_start[bin_idx + 1]
    if (bin_first === bin_end) continue
    const images_only = bin_base_end[bin_idx] === bin_first
    let ranges = ranges_by_bin[bin_idx]
    if (!ranges) {
      const idx_x = bin_idx % n_x
      const idx_y = Math.floor(bin_idx / n_x) % n_y
      const idx_z = Math.floor(bin_idx / (n_x * n_y))
      let range_size = 3
      scratch_ranges[1] = bin_end
      scratch_ranges[2] = bin_base_end[bin_idx]
      const bin_mask = boundary_masks?.[bin_idx] ?? 0
      const bin_offsets = bin_mask ? BOUNDARY_BIN_OFFSETS[bin_mask] : forward_offsets
      for (const [delta_x, delta_y, delta_z, opposite] of bin_offsets) {
        const neighbor_x = idx_x + delta_x
        const neighbor_y = idx_y + delta_y
        const neighbor_z = idx_z + delta_z
        if (
          neighbor_x < 0 ||
          neighbor_x >= n_x ||
          neighbor_y < 0 ||
          neighbor_y >= n_y ||
          neighbor_z < 0 ||
          neighbor_z >= n_z
        )
          continue
        const other = neighbor_x + n_x * (neighbor_y + n_y * neighbor_z)
        if (opposite && ((boundary_masks?.[other] ?? 0) & opposite) !== opposite) continue
        if (
          bin_start[other] === bin_start[other + 1] ||
          (images_only && bin_base_end[other] === bin_start[other])
        )
          continue
        scratch_ranges[range_size++] = bin_start[other]
        scratch_ranges[range_size++] = bin_start[other + 1]
        scratch_ranges[range_size++] = bin_base_end[other]
      }
      ranges = scratch_ranges.subarray(0, range_size)
      if (!visit && bin_end - bin_first > 1) {
        ranges = ranges.slice()
        ranges_by_bin[bin_idx] = ranges
      }
    }
    if (images_only && ranges.length === 3) continue
    const center_first = visit ? bin_first : item_of[group_idx]
    const center_end = visit ? bin_end : center_first + 1
    for (let center_item = center_first; center_item < center_end; center_item++) {
      const slot_a = bin_items[center_item]
      const pos_x = cloud_pos[slot_a * 3]
      const pos_y = cloud_pos[slot_a * 3 + 1]
      const pos_z = cloud_pos[slot_a * 3 + 2]
      const stop_at_images = slot_a >= n_sites
      for (let range = stop_at_images ? 3 : 0; range < ranges.length; range += 3) {
        const item_start = range === 0 ? center_item + 1 : ranges[range]
        const item_end = ranges[range + (stop_at_images ? 2 : 1)]
        for (let item = item_start; item < item_end; item++) {
          const slot_b = bin_items[item]
          const delta_x = cloud_pos[slot_b * 3] - pos_x
          const delta_y = cloud_pos[slot_b * 3 + 1] - pos_y
          const delta_z = cloud_pos[slot_b * 3 + 2] - pos_z
          const dist_sq = delta_x * delta_x + delta_y * delta_y + delta_z * delta_z
          if (dist_sq > cutoff_sq) continue
          // Histogram consumers need neither directed lists nor image/displacement buffers.
          // Keep the exact distance arithmetic while streaming each base endpoint once.
          if (visit) {
            const distance = Math.sqrt(dist_sq)
            if (slot_a < n_sites) visit(slot_a, cloud_src[slot_b], distance)
            if (slot_b < n_sites) visit(slot_b, cloud_src[slot_a], distance)
            continue
          }
          if (band) {
            // Same sqrt as the stored distance below, so consumers re-testing the band on
            // `distances` see exactly the pairs kept here
            const distance = Math.sqrt(dist_sq)
            const { elem_ids, n_elem } = band
            const pair = elem_ids[cloud_src[slot_a]] * n_elem + elem_ids[cloud_src[slot_b]]
            if (distance > band.hi[pair] || distance < band.lo[pair]) continue
          }
          if (n_pairs === pair_a.length) {
            if (n_pairs >= max_pairs) {
              throw new Error(
                `neighbor_query: more than ${max_pairs.toLocaleString()} pairs within ` +
                  `${cutoff} A of ${n_sites} sites; the neighbor lists would not fit in memory, ` +
                  `lower the cutoff or the site count`,
              )
            }
            pair_a = grow(pair_a, n_pairs + 1, max_pairs)
            pair_b = grow(pair_b, n_pairs + 1, max_pairs)
            pair_dist_sq = grow(pair_dist_sq, n_pairs + 1, max_pairs)
          }
          pair_a[n_pairs] = slot_a
          pair_b[n_pairs] = slot_b
          pair_dist_sq[n_pairs] = dist_sq
          if (listed(slot_a, slot_b)) offsets[slot_a + 1]++
          if (listed(slot_b, slot_a)) offsets[slot_b + 1]++
          n_pairs++
        }
      }
    }
  }
  if (visit) return

  // Scatter each pair to its base endpoint(s) as a directed entry (2*pair for endpoint a,
  // 2*pair + 1 for endpoint b), then sort every center's block by distance (ties by partner
  // slot, so the order is deterministic) and emit the partner as seen from that center. The
  // displacement is recomputed from the cloud positions rather than stored per pair: it is
  // the same subtraction either way, and not carrying 24 B per pair through the sweep is
  // what keeps the hot loop's working set small.
  for (let center = 0; center < n_sites; center++) offsets[center + 1] += offsets[center]
  const total = offsets[n_sites]
  const entry_at = new Int32Array(total)
  const center_cursor = offsets.slice(0, n_sites)
  for (let pair = 0; pair < n_pairs; pair++) {
    const slot_a = pair_a[pair]
    const slot_b = pair_b[pair]
    if (listed(slot_a, slot_b)) entry_at[center_cursor[slot_a]++] = pair * 2
    if (listed(slot_b, slot_a)) entry_at[center_cursor[slot_b]++] = pair * 2 + 1
  }
  const neighbors = new Int32Array(total)
  const images = new Int32Array(image_geometry ? total * 3 : 0)
  const deltas = new Float64Array(image_geometry ? total * 3 : 0)
  const distances = new Float64Array(total)
  // per-block scratch: sort keys copied out so the insertion sort touches contiguous memory
  let block_partner: Int32Array = new Int32Array(256)
  let block_dist_sq: Float64Array = new Float64Array(256)
  let block_perm: Int32Array = new Int32Array(256)
  for (let center = 0; center < n_sites; center++) {
    const start = offsets[center]
    const count = offsets[center + 1] - start
    if (count > block_partner.length) {
      block_partner = grow(block_partner, count)
      block_dist_sq = grow(block_dist_sq, count)
      block_perm = grow(block_perm, count)
    }
    for (let rank = 0; rank < count; rank++) {
      const entry = entry_at[start + rank]
      block_partner[rank] = entry & 1 ? pair_a[entry >> 1] : pair_b[entry >> 1]
      block_dist_sq[rank] = pair_dist_sq[entry >> 1]
      block_perm[rank] = rank
    }
    // Unsorted blocks keep sweep order (deterministic, not by distance). Insertion sort for
    // the usual handful of neighbors, comparator sort for wide cutoffs.
    if (sorted && count <= 64) {
      for (let idx = 1; idx < count; idx++) {
        const rank = block_perm[idx]
        const dist_sq = block_dist_sq[rank]
        const partner = block_partner[rank]
        let pos = idx - 1
        while (pos >= 0) {
          const prev = block_perm[pos]
          const prev_dist_sq = block_dist_sq[prev]
          if (
            prev_dist_sq < dist_sq ||
            (prev_dist_sq === dist_sq && block_partner[prev] < partner)
          )
            break
          block_perm[pos + 1] = prev
          pos--
        }
        block_perm[pos + 1] = rank
      }
    } else if (sorted) {
      block_perm
        .subarray(0, count)
        .sort(
          (rank_a, rank_b) =>
            block_dist_sq[rank_a] - block_dist_sq[rank_b] ||
            block_partner[rank_a] - block_partner[rank_b],
        )
    }
    const center_shift_a = cloud_shift[center * 3]
    const center_shift_b = cloud_shift[center * 3 + 1]
    const center_shift_c = cloud_shift[center * 3 + 2]
    const center_x = cloud_pos[center * 3]
    const center_y = cloud_pos[center * 3 + 1]
    const center_z = cloud_pos[center * 3 + 2]
    for (let idx = 0; idx < count; idx++) {
      const rank = block_perm[idx]
      const partner = block_partner[rank]
      const out = start + idx
      neighbors[out] = cloud_src[partner]
      distances[out] = Math.sqrt(block_dist_sq[rank])
      if (!image_geometry) continue
      // image = partner's total shift - center's wrap shift, so that
      // sites[partner].xyz + image·L - sites[center].xyz === delta
      images[out * 3] = cloud_shift[partner * 3] - center_shift_a
      images[out * 3 + 1] = cloud_shift[partner * 3 + 1] - center_shift_b
      images[out * 3 + 2] = cloud_shift[partner * 3 + 2] - center_shift_c
      deltas[out * 3] = cloud_pos[partner * 3] - center_x
      deltas[out * 3 + 1] = cloud_pos[partner * 3 + 1] - center_y
      deltas[out * 3 + 2] = cloud_pos[partner * 3 + 2] - center_z
    }
  }
  return { n_centers: n_sites, cutoff, offsets, neighbors, images, deltas, distances }
}

// Search bounds of the k-nearest query. The seed radius comes from the mean volume per atom;
// the radius stops growing at `max_cutoff`: a few cell heights for a crystal (whose images
// are endless), the bounding-box diagonal for a finite cluster, within which every pair of
// its sites lies, so each site can always reach its n - 1 partners. The cube root of the box
// volume fell short of that on an elongated cluster (a 100 A chain of 3 atoms: 9 A). A planar
// or linear cluster has a zero-thickness box; 1 A per axis keeps its volume finite.
const k_search_bounds = (
  structure: AnyStructure,
  order: number,
  pbc: Pbc,
): { total_volume: number; max_cutoff: number } => {
  const coords = new Float64Array(structure.sites.flatMap(({ xyz }) => xyz))
  const [mins, maxs] = bounding_box(coords, structure.sites.length)
  const extents = [0, 1, 2].map((axis) => Math.max(maxs[axis] - mins[axis], 1))
  // A pair at opposite box corners spans the diagonal exactly, and its distance can round
  // 1 ulp above hypot(extents); the margin keeps that pair inside the last pass's radius
  const span = Math.hypot(...extents) * (1 + 1e-9)
  if (!(`lattice` in structure))
    return { total_volume: extents[0] * extents[1] * extents[2], max_cutoff: span }
  const { volume, matrix } = structure.lattice
  const periodic = matrix.filter((_, axis) => pbc[axis]).map((vec) => Math.hypot(...vec))
  // A site's own images along periodic axis a sit at |a|, 2|a|, ..., so ceil(k / 2) |a| holds
  // k of them wherever the other sites are (non-periodic coordinates are not wrapped into the
  // cell). Without periodic axes the sites are a finite cluster bounded by their box diagonal.
  const reach = periodic.length
    ? Math.ceil(order / 2) * Math.min(...periodic) * (1 + 1e-9)
    : span
  return {
    total_volume: volume,
    max_cutoff: Math.max(4 * Math.max(...math.cell_heights(matrix)), reach),
  }
}

// The periodic axes an analysis should bond across when the caller gives none: the lattice's
// own pbc. LatticeType.pbc is required, so a crystal without it is malformed input (hand-built
// props); falling through to a finite pass would silently under-count every coordination
// number and angle, so it throws instead.
export function lattice_pbc_or_throw(structure: AnyStructure, override?: Pbc): Pbc {
  if (override) return override
  if (!(`lattice` in structure)) return NO_PBC
  const { pbc } = structure.lattice
  if (!math.is_pbc(pbc)) {
    throw new Error(
      `lattice.pbc must be a [boolean, boolean, boolean], got ${JSON.stringify(pbc)}`,
    )
  }
  return pbc
}

// Visit each directed neighbor without retaining pair records or constructing result
// arrays. Repeated periodic images are separate visits, including a site's own images.
// This lets histograms process large cutoffs with memory proportional to the image cloud.
export function visit_neighbor_distances(
  structure: AnyStructure,
  { cutoff, pbc }: { cutoff: number; pbc?: Pbc },
  visit: NeighborDistanceVisitor,
): void {
  neighbor_query_cutoff(structure, cutoff, { pbc }, visit)
}

// Geometric neighbor query with periodic images.
//   neighbor_query(structure, { cutoff })  every neighbor within `cutoff` A
//   neighbor_query(structure, { k })       the k nearest of each site (fewer only when the
//                                          whole system holds fewer, e.g. a small molecule)
// The k search seeds a radius from the number density and grows it 1.4x per pass until no
// center is short of k or the radius exceeds a few cell heights / the cluster diameter.
export function neighbor_query(
  structure: AnyStructure,
  options: NeighborQueryOptions,
): NeighborList {
  if (`cutoff` in options) {
    const { cutoff, pbc, sorted = true } = options
    return neighbor_query_cutoff(structure, cutoff, { pbc, sorted })
  }
  const { k: order, pbc } = options
  if (!Number.isInteger(order) || order < 1) {
    throw new Error(`neighbor_query: k must be a positive integer, got ${order}`)
  }
  const n_sites = structure.sites.length
  if (n_sites === 0) return neighbor_query_cutoff(structure, 1, { pbc, sorted: true })
  const { total_volume, max_cutoff } = k_search_bounds(
    structure,
    order,
    lattice_pbc_or_throw(structure, pbc),
  )
  const atom_volume = total_volume / n_sites
  // radius of the sphere holding k+1 atoms at the mean density, widened 30% so the first
  // pass usually suffices even for an anisotropic first shell
  let cutoff = 1.3 * ((3 * (order + 1) * atom_volume) / (4 * Math.PI)) ** (1 / 3)
  for (;;) {
    const list = neighbor_query_cutoff(structure, cutoff, { pbc, sorted: true })
    let short = false
    for (let center = 0; center < n_sites && !short; center++) {
      short = list.offsets[center + 1] - list.offsets[center] < order
    }
    if (short && cutoff < max_cutoff) {
      cutoff = Math.min(cutoff * 1.4, max_cutoff)
      continue
    }
    // keep the k nearest per center (prefix of each sorted block)
    const offsets = new Int32Array(n_sites + 1)
    for (let center = 0; center < n_sites; center++) {
      const count = list.offsets[center + 1] - list.offsets[center]
      offsets[center + 1] = offsets[center] + Math.min(order, count)
    }
    const total = offsets[n_sites]
    const neighbors = new Int32Array(total)
    const images = new Int32Array(total * 3)
    const deltas = new Float64Array(total * 3)
    const distances = new Float64Array(total)
    for (let center = 0; center < n_sites; center++) {
      const src = list.offsets[center]
      const dst = offsets[center]
      const count = offsets[center + 1] - dst
      neighbors.set(list.neighbors.subarray(src, src + count), dst)
      images.set(list.images.subarray(src * 3, (src + count) * 3), dst * 3)
      deltas.set(list.deltas.subarray(src * 3, (src + count) * 3), dst * 3)
      distances.set(list.distances.subarray(src, src + count), dst)
    }
    return { n_centers: n_sites, cutoff, offsets, neighbors, images, deltas, distances }
  }
}

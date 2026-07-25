import type { Matrix3x3, Vec3 } from '$lib/math'
import { calc_lattice_params, create_lattice_converters, pbc_dist } from '$lib/math'
import type { Crystal, Site } from '$lib/structure'
import type { Pbc } from '$lib/structure/pbc'
import type { RdfOptions, RdfPattern } from './index'

const get_occu = (site: Crystal[`sites`][number], elem: string | undefined) =>
  elem ? (site.species.find((spec) => spec.element === elem)?.occu ?? 0) : 1
const has_species = (site: Crystal[`sites`][number], elem: string | undefined) =>
  !elem || site.species.some((spec) => spec.element === elem)
const sum_occu = (sites: Crystal[`sites`], elem: string | undefined) =>
  sites.reduce((sum, site) => sum + get_occu(site, elem), 0)

// Symmetric ± lattice images on expanded PBC axes. Extents use reciprocal-axis norms
// with search radius cutoff + cell diagonal (length-based ceil undercounts skewed cells).
function build_rdf_neighbor_sites(
  structure: Crystal,
  pbc: Pbc,
  cutoff: number,
  auto_expand: boolean,
): { sites: Site[]; dist_pbc: Pbc; dist_lattice: Matrix3x3 } {
  const dist_lattice = structure.lattice.matrix
  if (!auto_expand) return { sites: structure.sites, dist_pbc: pbc, dist_lattice }

  const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = dist_lattice
  let cell_diag = 0
  for (let bits = 0; bits < 8; bits++) {
    const [ua, ub, uc] = [bits & 1, (bits >> 1) & 1, (bits >> 2) & 1]
    cell_diag = Math.max(
      cell_diag,
      Math.hypot(
        ua * ax + ub * bx + uc * cx,
        ua * ay + ub * by + uc * cy,
        ua * az + ub * bz + uc * cz,
      ),
    )
  }
  const { reciprocal_axis_norms } = create_lattice_converters(dist_lattice)
  const search_radius = cutoff + cell_diag
  const extents = ([0, 1, 2] as const).map((axis) =>
    pbc[axis]
      ? Math.max(0, Math.ceil(search_radius * reciprocal_axis_norms[axis] - 1e-12))
      : 0,
  ) as Vec3

  if (extents.every((extent) => extent === 0)) {
    return { sites: structure.sites, dist_pbc: pbc, dist_lattice }
  }

  const sites: Site[] = []
  for (let ia = -extents[0]; ia <= extents[0]; ia++) {
    for (let ib = -extents[1]; ib <= extents[1]; ib++) {
      for (let ic = -extents[2]; ic <= extents[2]; ic++) {
        const tx = ia * ax + ib * bx + ic * cx
        const ty = ia * ay + ib * by + ic * cy
        const tz = ia * az + ib * bz + ic * cz
        for (const site of structure.sites) {
          sites.push({ ...site, xyz: [site.xyz[0] + tx, site.xyz[1] + ty, site.xyz[2] + tz] })
        }
      }
    }
  }

  const dist_pbc: Pbc = [
    pbc[0] && extents[0] === 0,
    pbc[1] && extents[1] === 0,
    pbc[2] && extents[2] === 0,
  ]
  return { sites, dist_pbc, dist_lattice }
}

type NeighborCloud = ReturnType<typeof build_rdf_neighbor_sites>

// Shared validation + expansion. The cloud depends only on the structure, pbc, cutoff and
// auto_expand — never on the species pair — so all-pair callers build it once.
function prepare_rdf(structure: Crystal, options: RdfOptions) {
  const { cutoff = 15, n_bins = 75, auto_expand = true } = options
  const pbc = options.pbc ?? structure.lattice?.pbc ?? [true, true, true]
  if (cutoff <= 0 || n_bins <= 0) throw new Error(`cutoff and n_bins must be positive`)
  if (!structure.lattice?.matrix) {
    throw new Error(`Crystal must have a lattice for RDF calculation`)
  }
  return {
    cutoff,
    n_bins,
    cloud: build_rdf_neighbor_sites(structure, pbc, cutoff, auto_expand),
  }
}

// Below this many neighbors the bookkeeping costs more than the pairs it skips.
const CELL_LIST_MIN_NEIGHBORS = 512
// Guard against a huge sparse grid when the cloud spans far more than the cutoff.
const CELL_LIST_MAX_CELLS = 2_000_000

// Bin distances into `g_r`, weighting each pair by the product of its occupancies.
// The image cloud spans cutoff + cell diagonal, so at typical cell sizes the overwhelming
// majority of images sit outside the cutoff. Bucketing neighbors into cutoff-sized cells lets
// each center scan only the 27 cells around it instead of measuring every image. Collapsing
// the grid to one cell degenerates to a brute-force scan, which is how small inputs and
// pathologically sparse clouds are handled without a second copy of the loop.
// Euclidean only: the PBC path needs minimum-image distances, which don't correspond to raw
// coordinates — but that path only runs when no cloud was built, so it stays small.
function accumulate_pairs(
  centers: Site[],
  center_occu: Float64Array,
  neighbors: Site[],
  neighbor_occu: Float64Array,
  cutoff: number,
  bin_size: number,
  n_bins: number,
  g_r: number[],
): void {
  const count = neighbors.length
  const pos_x = new Float64Array(count)
  const pos_y = new Float64Array(count)
  const pos_z = new Float64Array(count)
  let [min_x, min_y, min_z] = [Infinity, Infinity, Infinity]
  let [max_x, max_y, max_z] = [-Infinity, -Infinity, -Infinity]
  for (let idx = 0; idx < count; idx++) {
    const [nx, ny, nz] = neighbors[idx].xyz
    pos_x[idx] = nx
    pos_y[idx] = ny
    pos_z[idx] = nz
    if (nx < min_x) min_x = nx
    if (ny < min_y) min_y = ny
    if (nz < min_z) min_z = nz
    if (nx > max_x) max_x = nx
    if (ny > max_y) max_y = ny
    if (nz > max_z) max_z = nz
  }

  const cutoff_sq = cutoff * cutoff
  const add_pair = (dist_sq: number, weight: number): void => {
    if (dist_sq <= 0 || dist_sq >= cutoff_sq) return
    g_r[Math.min(Math.floor(Math.sqrt(dist_sq) / bin_size), n_bins - 1)] += weight
  }

  const span = (min: number, max: number) => Math.max(1, Math.floor((max - min) / cutoff) + 1)
  const spans = [span(min_x, max_x), span(min_y, max_y), span(min_z, max_z)]
  const skip_grid =
    count < CELL_LIST_MIN_NEIGHBORS || spans[0] * spans[1] * spans[2] > CELL_LIST_MAX_CELLS
  const [dim_x, dim_y, dim_z] = skip_grid ? [1, 1, 1] : spans
  const n_cells = dim_x * dim_y * dim_z

  // With dim 1 on an axis this always yields 0, so the single-cell case scans everything.
  const axis_bin = (value: number, min: number, dim: number): number =>
    Math.min(dim - 1, Math.max(0, Math.floor((value - min) / cutoff)))

  // Counting sort neighbors into cells: cell_start holds each cell's slice of `order`.
  const cell_start = new Int32Array(n_cells + 1)
  const cell_of = new Int32Array(count)
  for (let idx = 0; idx < count; idx++) {
    const cell =
      (axis_bin(pos_z[idx], min_z, dim_z) * dim_y + axis_bin(pos_y[idx], min_y, dim_y)) *
        dim_x +
      axis_bin(pos_x[idx], min_x, dim_x)
    cell_of[idx] = cell
    cell_start[cell + 1]++
  }
  for (let cell = 0; cell < n_cells; cell++) cell_start[cell + 1] += cell_start[cell]
  const cursor = cell_start.slice(0, n_cells)
  const order = new Int32Array(count)
  for (let idx = 0; idx < count; idx++) order[cursor[cell_of[idx]]++] = idx

  for (let ci = 0; ci < centers.length; ci++) {
    const [cx, cy, cz] = centers[ci].xyz
    const center_weight = center_occu[ci]
    const bin_x = axis_bin(cx, min_x, dim_x)
    const bin_y = axis_bin(cy, min_y, dim_y)
    const bin_z = axis_bin(cz, min_z, dim_z)
    for (let iz = Math.max(0, bin_z - 1); iz <= Math.min(dim_z - 1, bin_z + 1); iz++) {
      for (let iy = Math.max(0, bin_y - 1); iy <= Math.min(dim_y - 1, bin_y + 1); iy++) {
        const row = (iz * dim_y + iy) * dim_x
        const from = cell_start[row + Math.max(0, bin_x - 1)]
        const to = cell_start[row + Math.min(dim_x - 1, bin_x + 1) + 1]
        for (let slot = from; slot < to; slot++) {
          const ni = order[slot]
          const dx = cx - pos_x[ni]
          const dy = cy - pos_y[ni]
          const dz = cz - pos_z[ni]
          add_pair(dx * dx + dy * dy + dz * dz, center_weight * neighbor_occu[ni])
        }
      }
    }
  }
}

function rdf_from_cloud(
  structure: Crystal,
  cloud: NeighborCloud,
  cutoff: number,
  n_bins: number,
  center_species: string | undefined,
  neighbor_species: string | undefined,
): RdfPattern {
  const { sites: neighbor_sites, dist_pbc, dist_lattice } = cloud
  const bin_size = cutoff / n_bins
  const r = Array.from({ length: n_bins }, (_, idx) => (idx + 0.5) * bin_size)
  const g_r = Array(n_bins).fill(0)

  // Centers stay in the original cell; neighbor_sites may include periodic images
  const centers = structure.sites.filter((site) => has_species(site, center_species))
  const neighbors = neighbor_sites.filter((site) => has_species(site, neighbor_species))
  // Normalization density uses the original cell (not the image cloud)
  const norm_neighbors = structure.sites.filter((site) => has_species(site, neighbor_species))

  const element_pair =
    center_species && neighbor_species
      ? ([center_species, neighbor_species] as [string, string])
      : undefined
  if (centers.length === 0 || neighbors.length === 0) return { r, g_r, element_pair }

  // Resolve occupancies once: get_occu scans a site's species list, which is far too costly
  // to repeat inside a loop running over every center-neighbor pair.
  const center_occu = Float64Array.from(centers, (site) => get_occu(site, center_species))
  const neighbor_occu = Float64Array.from(neighbors, (s) => get_occu(s, neighbor_species))

  if (dist_pbc.some(Boolean)) {
    const converters = create_lattice_converters(dist_lattice)
    for (let ci = 0; ci < centers.length; ci++) {
      for (let ni = 0; ni < neighbors.length; ni++) {
        const dist = pbc_dist(
          centers[ci].xyz,
          neighbors[ni].xyz,
          dist_lattice,
          converters,
          dist_pbc,
        )
        if (dist > 0 && dist < cutoff) {
          g_r[Math.min(Math.floor(dist / bin_size), n_bins - 1)] +=
            center_occu[ci] * neighbor_occu[ni]
        }
      }
    }
  } else {
    accumulate_pairs(
      centers,
      center_occu,
      neighbors,
      neighbor_occu,
      cutoff,
      bin_size,
      n_bins,
      g_r,
    )
  }

  // Ideal-gas normalization with original-cell density. Do not subtract self-pairs:
  // dist > 0 already drops the true self term, while periodic images of the same atom
  // are valid neighbors (critical for 1-atom cells).
  const center_weight = sum_occu(centers, center_species)
  const neighbor_weight = sum_occu(norm_neighbors, neighbor_species)
  const volume = calc_lattice_params(structure.lattice.matrix).volume
  if (center_weight > 0 && neighbor_weight > 0 && volume > 0) {
    for (let idx = 0; idx < n_bins; idx++) {
      g_r[idx] /=
        center_weight * neighbor_weight * ((4 * Math.PI * r[idx] ** 2 * bin_size) / volume)
    }
  }

  return { r, g_r, element_pair }
}

// Calculate radial distribution function
export function calculate_rdf(structure: Crystal, options: RdfOptions = {}): RdfPattern {
  const { cutoff, n_bins, cloud } = prepare_rdf(structure, options)
  return rdf_from_cloud(
    structure,
    cloud,
    cutoff,
    n_bins,
    options.center_species,
    options.neighbor_species,
  )
}

// Calculate RDF for all element pairs
export function calculate_all_pair_rdfs(
  structure: Crystal,
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> = {},
): RdfPattern[] {
  // Collect all unique elements across all species (supports mixed occupancy)
  const elems = [
    ...new Set(structure.sites.flatMap((site) => site.species.map((spec) => spec.element))),
  ].toSorted()

  // Expand once and reuse: the image cloud is species-independent, so rebuilding it per
  // element pair repeated the most expensive step O(pairs) times for identical output.
  const { cutoff, n_bins, cloud } = prepare_rdf(structure, options)

  return elems.flatMap((el1, idx1) =>
    elems.slice(idx1).map((el2) => rdf_from_cloud(structure, cloud, cutoff, n_bins, el1, el2)),
  )
}

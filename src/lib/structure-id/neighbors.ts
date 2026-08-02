// PBC-aware fixed-radius and k-nearest neighbor queries for structure identification.
//
// Why this is not built on $lib/structure/bonding or $lib/structure/pbc:
//   - compute_bonds() returns CHEMICALLY filtered bonds (electronegativity difference, covalent
//     radii ratio, metal/cation penalties). CNA and CSP need a purely geometric fixed-radius or
//     k-nearest query; a strength-thresholded bond list would silently drop the second bcc shell
//     and the metal-metal contacts CNA lives on.
//   - bonding.ts's setup_spatial_grid()/collect_candidates() are module-private, emit a half-shell
//     candidate list for pair enumeration (not per-center neighbor lists), carry no delta vectors
//     and no periodic images.
//   - get_pbc_image_sites() is close but not sufficient, and where it fails it fails silently.
//     Measured against a true periodic 14-nearest query on 3x3x3 supercells: fcc Cu and bcc Fe
//     come out exact (0/108 and 0/54 atoms wrong), but bcc Cs (a = 6.141 Å against a 2.44 Å
//     covalent radius, so its 2*r_cov + 0.7 = 5.58 Å completion reach cannot span the 6.141 Å
//     second shell) gets 19/54 atoms wrong by up to 2.54 Å, and an unwrapped trajectory frame
//     gets 76/108 wrong because is_scattered_trajectory() returns zero images once >10% of atoms
//     sit outside the cell. A trajectory viewer is exactly where the latter case lives.
//     It also appends images as ordinary sites, so every consumer has to thread a center_count
//     through to avoid classifying the images themselves.
// pack_cell_key IS reused from bonding.ts so both grids quantize positions identically.
import type { Matrix3x3, Vec3 } from '$lib/math'
import { cell_heights, create_lattice_converters, frac_cutoff_per_axis } from '$lib/math'
import type { AnyStructure, Pbc } from '$lib/structure'
import { pack_cell_key } from '$lib/structure/bonding'

// pack_cell_key is exact only for grid coordinates in [-512, 511] (see bonding.ts). Keys outside
// that window alias onto other cells and silently corrupt the neighbor list, so the range is
// checked rather than trusted.
const MAX_GRID_COORD = 511
const MIN_GRID_COORD = -512

const make_fail =
  (fn_name: string) =>
  (message: string): never => {
    throw new Error(`${fn_name}: ${message}`)
  }

// Per-center neighbor lists in flat buffers. Neighbors of center `center_idx` occupy
// [offsets[center_idx], offsets[center_idx + 1]) and are sorted by ascending distance, so
// `k nearest` is a prefix slice. `deltas` holds neighbor_pos - center_pos (3 per neighbor,
// same slot ordering as `distances`), already carrying the periodic image shift.
export interface NeighborList {
  offsets: Int32Array
  deltas: Float64Array
  distances: Float64Array
  n_centers: number
  cutoff: number
}

export const neighbor_count = (list: NeighborList, center_idx: number): number =>
  list.offsets[center_idx + 1] - list.offsets[center_idx]

// Base + periodic image positions as one flat [x, y, z, ...] buffer. Only atoms within `cutoff`
// of a periodic face get an image, so a 10k-atom supercell grows by its boundary shell rather
// than by the 27x a full replication would cost.
function build_positions_with_images(
  sites: AnyStructure[`sites`],
  lattice: Matrix3x3 | null,
  pbc: Pbc,
  cutoff: number,
  fail: (message: string) => never,
): Float64Array {
  const n_sites = sites.length
  if (!lattice || !pbc.some(Boolean)) {
    const positions = new Float64Array(n_sites * 3)
    for (const [idx, { xyz }] of sites.entries()) positions.set(xyz, idx * 3)
    return positions
  }

  const { cart_to_frac, frac_to_cart } = create_lattice_converters(lattice)
  // Wrap into the cell first: a trajectory frame may hold coordinates far outside it, and the
  // image shifts below are only meaningful relative to a wrapped base position. Only periodic
  // axes are wrapped — folding a slab's free axis would teleport an atom sitting just below
  // the cell to the opposite surface.
  const wrapped_frac: Vec3[] = sites.map(({ xyz }) => {
    const frac = cart_to_frac(xyz)
    return frac.map((coord, axis) => (pbc[axis] ? coord - Math.floor(coord) : coord)) as Vec3
  })

  const pad = frac_cutoff_per_axis(lattice, cutoff)
  const max_shift = pad.map((axis_pad, axis) => (pbc[axis] ? Math.ceil(axis_pad) : 0))
  const n_replicas = max_shift.reduce((product, shift) => product * (2 * shift + 1), 1)
  // A cutoff many cell lengths wide means the caller passed a cutoff that doesn't match the
  // structure (or a degenerate cell); replicating blind would exhaust memory instead of saying so.
  if (n_replicas > 343) {
    fail(
      `cutoff ${cutoff} Å reaches ${max_shift.join(`, `)} cells along a, b, c for a cell of ` +
        `heights ${pad.map((axis_pad) => (cutoff / axis_pad).toFixed(2)).join(`, `)} Å; ` +
        `refusing to build ${n_replicas} replicas of ${n_sites} atoms`,
    )
  }

  const coords: number[] = []
  for (const frac of wrapped_frac) coords.push(...frac_to_cart(frac))
  for (const frac of wrapped_frac) {
    for (let shift_a = -max_shift[0]; shift_a <= max_shift[0]; shift_a++) {
      for (let shift_b = -max_shift[1]; shift_b <= max_shift[1]; shift_b++) {
        for (let shift_c = -max_shift[2]; shift_c <= max_shift[2]; shift_c++) {
          if (shift_a === 0 && shift_b === 0 && shift_c === 0) continue
          const shifted: Vec3 = [frac[0] + shift_a, frac[1] + shift_b, frac[2] + shift_c]
          // Keep only images that can reach into the cell: everything else is dead weight in
          // the grid. `pad` is the cutoff expressed as a fractional per-axis reach. The test
          // runs on periodic axes only — those are the ones whose base coordinates were wrapped
          // into [0, 1), so [-pad, 1+pad] describes where the atoms actually are. A free axis
          // is never shifted and its coordinates are unbounded, so testing it would throw away
          // the in-plane images of every atom lying outside the cell along that axis (a slab
          // translated along its free direction lost its bottom layer's neighbors this way).
          if (
            shifted.some(
              (coord, axis) => pbc[axis] && (coord < -pad[axis] || coord > 1 + pad[axis]),
            )
          )
            continue
          coords.push(...frac_to_cart(shifted))
        }
      }
    }
  }
  return Float64Array.from(coords)
}

// Neighbors of every site within `cutoff`, sorted by ascending distance.
export function build_neighbor_list(
  structure: AnyStructure,
  { cutoff, pbc }: { cutoff: number; pbc?: Pbc },
): NeighborList {
  const fail = make_fail(`build_neighbor_list`)
  const { sites } = structure
  const n_centers = sites.length
  if (n_centers === 0) fail(`structure has no sites`)
  if (!(cutoff > 0) || !Number.isFinite(cutoff)) {
    fail(`cutoff must be a positive finite number, got ${cutoff}`)
  }

  const lattice = `lattice` in structure ? structure.lattice.matrix : null
  const effective_pbc = pbc ??
    (`lattice` in structure ? structure.lattice.pbc : null) ?? [true, true, true]
  const positions = build_positions_with_images(sites, lattice, effective_pbc, cutoff, fail)
  const n_positions = positions.length / 3

  // Cubic bins of one cutoff, so a neighbor can only sit in the 27 cells around the center's.
  const grid = new Map<number, number[]>()
  for (let idx = 0; idx < n_positions; idx++) {
    const cell_x = Math.floor(positions[idx * 3] / cutoff)
    const cell_y = Math.floor(positions[idx * 3 + 1] / cutoff)
    const cell_z = Math.floor(positions[idx * 3 + 2] / cutoff)
    if (
      Math.min(cell_x, cell_y, cell_z) < MIN_GRID_COORD + 1 ||
      Math.max(cell_x, cell_y, cell_z) > MAX_GRID_COORD - 1
    ) {
      fail(
        `grid coordinate (${cell_x}, ${cell_y}, ${cell_z}) for position ` +
          `(${positions[idx * 3].toFixed(2)}, ${positions[idx * 3 + 1].toFixed(2)}, ` +
          `${positions[idx * 3 + 2].toFixed(2)}) Å at cutoff ${cutoff} Å leaves the ` +
          `[${MIN_GRID_COORD + 1}, ${MAX_GRID_COORD - 1}] window pack_cell_key encodes ` +
          `exactly; the structure spans more than ~1000 cutoffs per axis`,
      )
    }
    const key = pack_cell_key(cell_x, cell_y, cell_z)
    const cell = grid.get(key)
    if (cell) cell.push(idx)
    else grid.set(key, [idx])
  }

  const cutoff_sq = cutoff * cutoff
  const offsets = new Int32Array(n_centers + 1)
  let distance_buffer = new Float64Array(Math.max(16, n_centers))
  let delta_buffer = new Float64Array(distance_buffer.length * 3)
  let total_neighbors = 0
  const ensure_capacity = (required_count: number): void => {
    if (required_count <= distance_buffer.length) return
    let next_capacity = distance_buffer.length
    while (next_capacity < required_count) next_capacity *= 2
    const next_distances = new Float64Array(next_capacity)
    const next_deltas = new Float64Array(next_capacity * 3)
    next_distances.set(distance_buffer)
    next_deltas.set(delta_buffer)
    distance_buffer = next_distances
    delta_buffer = next_deltas
  }
  // Length-reset per center rather than reallocated. Array.sort needs the distance and its
  // delta to travel together, so these stay objects; at ~50 candidates per center the
  // allocation is well below the cost of the distance loop that fills them.
  const found: { distance: number; delta: Vec3 }[] = []

  for (let center_idx = 0; center_idx < n_centers; center_idx++) {
    found.length = 0
    const [center_x, center_y, center_z] = [
      positions[center_idx * 3],
      positions[center_idx * 3 + 1],
      positions[center_idx * 3 + 2],
    ]
    const base_x = Math.floor(center_x / cutoff)
    const base_y = Math.floor(center_y / cutoff)
    const base_z = Math.floor(center_z / cutoff)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = grid.get(pack_cell_key(base_x + dx, base_y + dy, base_z + dz))
          if (!cell) continue
          for (const other_idx of cell) {
            if (other_idx === center_idx) continue
            const delta_x = positions[other_idx * 3] - center_x
            const delta_y = positions[other_idx * 3 + 1] - center_y
            const delta_z = positions[other_idx * 3 + 2] - center_z
            const dist_sq = delta_x * delta_x + delta_y * delta_y + delta_z * delta_z
            // dist_sq === 0 means a second site at exactly the center's coordinates. A
            // periodic image can never land there (it is at least one cell height away), so
            // this is a duplicate site in the input. It is dropped rather than admitted as a
            // zero-length bond vector, which would corrupt every CNA triplet it takes part in.
            if (dist_sq > cutoff_sq || dist_sq === 0) continue
            found.push({ distance: Math.sqrt(dist_sq), delta: [delta_x, delta_y, delta_z] })
          }
        }
      }
    }
    // a-CNA and CSP both consume a distance-ordered prefix, so sorting here is not optional
    found.sort((left, right) => left.distance - right.distance)
    ensure_capacity(total_neighbors + found.length)
    for (const { distance, delta } of found) {
      distance_buffer[total_neighbors] = distance
      delta_buffer.set(delta, total_neighbors * 3)
      total_neighbors++
    }
    offsets[center_idx + 1] = total_neighbors
  }

  return {
    offsets,
    deltas: delta_buffer.subarray(0, total_neighbors * 3),
    distances: distance_buffer.subarray(0, total_neighbors),
    n_centers,
    cutoff,
  }
}

// Number density estimate used to seed the k-nearest cutoff search
const estimate_atom_volume = (structure: AnyStructure): number => {
  if (`lattice` in structure) return structure.lattice.volume / structure.sites.length
  const mins: Vec3 = [Infinity, Infinity, Infinity]
  const maxs: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const { xyz } of structure.sites) {
    for (let axis = 0; axis < 3; axis++) {
      if (xyz[axis] < mins[axis]) mins[axis] = xyz[axis]
      if (xyz[axis] > maxs[axis]) maxs[axis] = xyz[axis]
    }
  }
  // A flat or linear cluster has a zero-thickness box; 1 Å keeps the seed finite and the
  // growth loop below widens it anyway.
  const extents = maxs.map((max_val, axis) => Math.max(max_val - mins[axis], 1))
  return (extents[0] * extents[1] * extents[2]) / structure.sites.length
}

// Neighbor list guaranteed to contain the `k` nearest neighbors of every site that HAS k
// neighbors. The cutoff is seeded from the number density and grown until no center is short
// of k, or until it exceeds the system extent (genuinely under-coordinated surface atoms).
// Returns the list plus how many centers still fell short, so callers report rather than guess.
export function find_k_nearest(
  structure: AnyStructure,
  k_neighbors: number,
  { pbc }: { pbc?: Pbc } = {},
): { list: NeighborList; n_undercoordinated: number } {
  const fail = make_fail(`find_k_nearest`)
  if (!Number.isInteger(k_neighbors) || k_neighbors < 1) {
    fail(`k_neighbors must be a positive integer, got ${k_neighbors}`)
  }
  const atom_volume = estimate_atom_volume(structure)
  // Radius of the sphere that holds k+1 atoms at the mean density, widened by 30% so the
  // first attempt usually suffices even for an anisotropic first shell.
  let cutoff = 1.3 * ((3 * (k_neighbors + 1) * atom_volume) / (4 * Math.PI)) ** (1 / 3)
  // Ceiling: past this, growing further only re-finds the same atoms. For a periodic cell it
  // is a few cell heights; for a cluster it is the bounding-box diagonal.
  const max_cutoff =
    `lattice` in structure
      ? 4 * Math.max(...cell_heights(structure.lattice.matrix))
      : 2 * (atom_volume * structure.sites.length) ** (1 / 3)

  for (;;) {
    const list = build_neighbor_list(structure, { cutoff, pbc })
    let n_undercoordinated = 0
    for (let center_idx = 0; center_idx < list.n_centers; center_idx++) {
      if (neighbor_count(list, center_idx) < k_neighbors) n_undercoordinated++
    }
    if (n_undercoordinated === 0 || cutoff >= max_cutoff) {
      return { list, n_undercoordinated }
    }
    // 1.4x per step: enough to converge in a couple of passes, small enough that the final
    // cutoff (and therefore the candidate count per center) stays close to what's needed.
    cutoff = Math.min(cutoff * 1.4, max_cutoff)
  }
}

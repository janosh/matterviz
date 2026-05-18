// Bonding algorithms for structure visualization

import { element_data } from '$lib/element'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type {
  AnyStructure,
  BondOrder,
  BondPair,
  Site,
  StructureBond,
} from '$lib/structure'

type SpatialGrid = Map<string, number[]>

const element_lookup = new Map(element_data.map((el) => [el.symbol, el]))
const covalent_radii: Map<string, number> = new Map(
  element_data
    .filter((el) => el.covalent_radius !== null)
    .map((el) => [el.symbol, el.covalent_radius as number]),
)

export const normalize_bond_indices = (
  idx_1: number,
  idx_2: number,
): [number, number] => idx_1 < idx_2 ? [idx_1, idx_2] : [idx_2, idx_1]

const is_zero_cell_shift = (cell_shift: Vec3 | undefined): boolean =>
  cell_shift === undefined || cell_shift.every((val) => val === 0)

const format_cell_shift = (cell_shift: Vec3 | undefined): string => {
  if (cell_shift === undefined || is_zero_cell_shift(cell_shift)) return ``
  return `@${cell_shift.join(`,`)}`
}

const negate_cell_shift = (cell_shift: Vec3): Vec3 =>
  cell_shift.map((val) => val === 0 ? 0 : -val) as Vec3

const with_cell_shift = (cell_shift: Vec3 | undefined) =>
  cell_shift === undefined ? {} : { cell_shift }

export const normalize_structure_bond = (
  site_idx_1: number,
  site_idx_2: number,
  order: BondOrder,
  cell_shift?: Vec3,
): StructureBond => {
  const normalized_shift = is_zero_cell_shift(cell_shift)
    ? undefined
    : cell_shift
  if (site_idx_1 < site_idx_2) return {
    site_idx_1,
    site_idx_2,
    order,
    ...with_cell_shift(normalized_shift),
  }
  return {
    site_idx_1: site_idx_2,
    site_idx_2: site_idx_1,
    order,
    ...with_cell_shift(
      normalized_shift === undefined ? undefined : negate_cell_shift(normalized_shift),
    ),
  }
}

export const get_bond_key = (
  idx_1: number,
  idx_2: number,
  cell_shift?: Vec3,
): string => {
  const normalized = normalize_structure_bond(idx_1, idx_2, 1, cell_shift)
  return `${normalized.site_idx_1}-${normalized.site_idx_2}${
    format_cell_shift(normalized.cell_shift)
  }`
}

const is_record = (value: unknown): value is Record<string, unknown> =>
  typeof value === `object` && value !== null

export function normalize_bond_order(order: unknown): BondOrder | null {
  if (order === `aromatic`) return order
  if (order === 1 || order === 1.5 || order === 2 || order === 3) return order
  return null
}

function normalize_cell_shift(cell_shift: unknown): Vec3 | undefined | null {
  if (cell_shift === undefined) return undefined
  if (!Array.isArray(cell_shift) || cell_shift.length !== 3) return null
  if (cell_shift.some((val) => typeof val !== `number` || !Number.isInteger(val))) {
    return null
  }
  return cell_shift as Vec3
}

function lattice_translation(structure: AnyStructure, cell_shift: Vec3 | undefined): Vec3 {
  if (cell_shift === undefined || is_zero_cell_shift(cell_shift)) return [0, 0, 0]
  if (!(`lattice` in structure)) {
    throw new Error(`Explicit bond cell_shift requires a crystal lattice`)
  }
  const [shift_a, shift_b, shift_c] = cell_shift
  const [vec_a, vec_b, vec_c] = structure.lattice.matrix
  return math.add(
    math.scale(vec_a, shift_a),
    math.scale(vec_b, shift_b),
    math.scale(vec_c, shift_c),
  )
}

export function get_explicit_bond_metadata(
  structure: AnyStructure,
): StructureBond[] {
  const raw_bonds = structure.properties?.bonds
  if (raw_bonds === undefined) return []
  if (!Array.isArray(raw_bonds)) {
    console.warn(`Ignoring structure.properties.bonds because it is not an array`)
    return []
  }

  const explicit_bonds = new Map<string, StructureBond>()
  for (const [entry_idx, raw_bond] of raw_bonds.entries()) {
    if (!is_record(raw_bond)) {
      console.warn(`Ignoring invalid explicit bond at index ${entry_idx}: expected object`)
      continue
    }
    const { order } = raw_bond
    const site_idx_1 = raw_bond.site_idx_1
    const site_idx_2 = raw_bond.site_idx_2
    if (
      typeof site_idx_1 !== `number` ||
      typeof site_idx_2 !== `number` ||
      !Number.isInteger(site_idx_1) ||
      !Number.isInteger(site_idx_2)
    ) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: site indices must be integers`,
      )
      continue
    }
    if (
      site_idx_1 < 0 ||
      site_idx_2 < 0 ||
      site_idx_1 >= structure.sites.length ||
      site_idx_2 >= structure.sites.length
    ) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: site indices ${
          site_idx_1
        }, ${site_idx_2} are out of range for ${structure.sites.length} sites`,
      )
      continue
    }
    if (site_idx_1 === site_idx_2) {
      console.warn(`Ignoring invalid explicit bond at index ${entry_idx}: endpoints match`)
      continue
    }
    const bond_order = normalize_bond_order(order)
    if (bond_order === null) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: unsupported order ${
          String(order)
        }`,
      )
      continue
    }
    const cell_shift = normalize_cell_shift(raw_bond.cell_shift)
    if (cell_shift === null) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: cell_shift must be three integers`,
      )
      continue
    }
    if (
      cell_shift !== undefined &&
      !is_zero_cell_shift(cell_shift) &&
      !(`lattice` in structure)
    ) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: cell_shift requires a crystal lattice`,
      )
      continue
    }

    const key = get_bond_key(site_idx_1, site_idx_2, cell_shift)
    if (explicit_bonds.has(key)) {
      console.warn(
        `Duplicate explicit bond definition at index ${entry_idx} for site indices ${
          site_idx_1
        }, ${site_idx_2} with order ${bond_order}; will overwrite the previous entry`,
      )
    }
    explicit_bonds.set(
      key,
      normalize_structure_bond(site_idx_1, site_idx_2, bond_order, cell_shift),
    )
  }
  return [...explicit_bonds.values()]
}

export function apply_explicit_bond_metadata(
  structure: AnyStructure,
  bonds: BondPair[],
): BondPair[] {
  const explicit_bonds = get_explicit_bond_metadata(structure)
  if (explicit_bonds.length === 0) return bonds

  const explicit_by_key = new Map(
    explicit_bonds.map((bond) => [
      get_bond_key(bond.site_idx_1, bond.site_idx_2),
      bond,
    ]),
  )
  const merged = bonds.map((bond) => {
    const key = get_bond_key(bond.site_idx_1, bond.site_idx_2)
    const explicit = explicit_by_key.get(key)
    if (!explicit) return bond
    explicit_by_key.delete(key)
    return { ...bond, bond_order: explicit.order }
  })

  for (const { site_idx_1, site_idx_2, order, cell_shift } of explicit_by_key.values()) {
    const pos_1 = structure.sites[site_idx_1].xyz
    const pos_2 = math.add(
      structure.sites[site_idx_2].xyz,
      lattice_translation(structure, cell_shift),
    )
    merged.push({
      pos_1,
      pos_2,
      site_idx_1,
      site_idx_2,
      bond_length: math.euclidean_dist(pos_1, pos_2),
      strength: 1,
      bond_order: order,
      cell_shift,
      transform_matrix: compute_bond_transform(pos_1, pos_2),
    })
  }

  return merged
}

export function scale_and_offset_bond_matrix(
  transform_matrix: Float32Array,
  offset: number,
  radius_scale: number,
): Float32Array {
  const matrix = new Float32Array(transform_matrix)
  // Column-major 4x4 layout: 0-2 are the right vector, 8-10 are the forward
  // vector. Scale orientation columns for cylinder radius, not translation.
  for (const matrix_idx of [0, 1, 2, 8, 9, 10]) {
    matrix[matrix_idx] *= radius_scale
  }

  const right_len = Math.hypot(matrix[0], matrix[1], matrix[2]) || 1
  const offset_dir: Vec3 = [
    matrix[0] / right_len,
    matrix[1] / right_len,
    matrix[2] / right_len,
  ]
  matrix[12] += offset_dir[0] * offset
  matrix[13] += offset_dir[1] * offset
  matrix[14] += offset_dir[2] * offset
  return matrix
}

export function get_bond_render_matrices(
  bond: BondPair,
  bond_thickness: number,
): Float32Array[] {
  const order = bond.bond_order ?? 1
  const gap = bond_thickness * 1.8
  const offsets_and_scales: [number, number][] =
    order === 2
      ? [[-gap / 2, 0.65], [gap / 2, 0.65]]
      : order === 3
      ? [[-gap, 0.55], [0, 0.55], [gap, 0.55]]
      : order === 1.5 || order === `aromatic`
      ? [[-gap / 2, 0.75], [gap / 2, 0.4]]
      : []
  return offsets_and_scales.length === 0
    ? [bond.transform_matrix]
    : offsets_and_scales.map(([offset, radius_scale]) =>
      scale_and_offset_bond_matrix(bond.transform_matrix, offset, radius_scale)
    )
}

// Get the species with highest occupancy from a site.
const get_majority_species = (site: Site) =>
  (site.species ?? []).reduce(
    (max_species, species) => (species.occu > max_species.occu ? species : max_species),
    site.species?.[0] ?? { element: ``, occu: -1 },
  )

// Helper to extract numeric index from site properties
function get_orig_idx(site: Site, fallback: number): number {
  const props = site.properties
  if (!props) return fallback

  const raw = props.orig_unit_cell_idx ?? props.orig_site_idx
  if (raw === undefined) return fallback

  const num = Number(raw)
  return Number.isFinite(num) ? num : fallback
}

// Compute 4x4 transformation matrix for bond cylinder between two positions.
// Uses Y-up, right-handed coordinate system convention for Three.js compatibility.
export function compute_bond_transform(pos_1: Vec3, pos_2: Vec3): Float32Array {
  const [dx, dy, dz] = math.subtract(pos_2, pos_1)
  const height = Math.hypot(dx, dy, dz)

  if (height < 1e-10) {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  }

  const [dir_x, dir_y, dir_z] = [dx / height, dy / height, dz / height]
  let [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [0, 0, 0, 0, 0, 0, 0, 0, 0]

  // Special case: bond pointing straight up (+Y)
  if (Math.abs(dir_y - 1.0) < 1e-10) {
    ;[m00, m01, m02, m10, m11, m12, m20, m21, m22] = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  } else if (Math.abs(dir_y + 1.0) < 1e-10) {
    // Special case: bond pointing straight down (-Y)
    ;[m00, m01, m02, m10, m11, m12, m20, m21, m22] = [1, 0, 0, 0, -1, 0, 0, 0, 1]
  } else {
    // General case: construct orthonormal basis (right, dir, up)
    // Right vector: perpendicular to dir in XZ plane
    const [rx, rz] = [-dir_z, dir_x]
    const r_len = Math.hypot(rx, rz)
    const [right_x, right_z] = [rx / r_len, rz / r_len]
    // Up vector: cross product of dir and right
    const [up_x, up_y, up_z] = [
      dir_y * right_z,
      dir_z * right_x - dir_x * right_z,
      -dir_y * right_x,
    ]
    ;[m00, m01, m02, m10, m11, m12, m20, m21, m22] = [
      right_x,
      dir_x,
      up_x,
      0,
      dir_y,
      up_y,
      right_z,
      dir_z,
      up_z,
    ]
  }

  // Position at midpoint between the two atoms
  const [px, py, pz] = [
    (pos_1[0] + pos_2[0]) / 2,
    (pos_1[1] + pos_2[1]) / 2,
    (pos_1[2] + pos_2[2]) / 2,
  ]

  return new Float32Array([
    // Return flattened column-major 4x4 matrix for Three.js
    m00,
    m10,
    m20,
    0,
    m01 * height,
    m11 * height,
    m21 * height,
    0,
    m02,
    m12,
    m22,
    0,
    px,
    py,
    pz,
    1,
  ])
}

// Build spatial grid by dividing 3D space into cubic cells.
function build_spatial_grid(sites: Site[], cell_size: number): SpatialGrid {
  const grid: SpatialGrid = new Map()
  for (let idx = 0; idx < sites.length; idx++) {
    const [x, y, z] = sites[idx].xyz.map((coord) => Math.floor(coord / cell_size))
    const key = `${x},${y},${z}`
    const cell = grid.get(key)
    if (cell) cell.push(idx)
    else grid.set(key, [idx])
  }
  return grid
}

// Get all site indices in 3x3x3 cube of cells around position.
function get_neighbors_from_grid(pos: Vec3, grid: SpatialGrid, cell_size: number): number[] {
  const [cx, cy, cz] = [
    Math.floor(pos[0] / cell_size),
    Math.floor(pos[1] / cell_size),
    Math.floor(pos[2] / cell_size),
  ]
  const neighbors: number[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = grid.get(`${cx + dx},${cy + dy},${cz + dz}`)
        if (cell) neighbors.push(...cell)
      }
    }
  }
  return neighbors
}

// Setup spatial decomposition for structures with >50 atoms.
function setup_spatial_grid(sites: Site[], cutoff: number) {
  const use_grid = sites.length > 50
  return use_grid ? { grid: build_spatial_grid(sites, cutoff), cell_size: cutoff } : null
}

// Get candidate neighbor indices using spatial grid or all sites.
const get_candidates = (
  pos: Vec3,
  sites: Site[],
  spatial: ReturnType<typeof setup_spatial_grid>,
): number[] =>
  spatial
    ? get_neighbors_from_grid(pos, spatial.grid, spatial.cell_size)
    : Array.from({ length: sites.length }, (_, idx) => idx)

export const BONDING_STRATEGIES = { electroneg_ratio, solid_angle } as const
export type BondingStrategy = keyof typeof BONDING_STRATEGIES
export type BondingAlgo = (typeof BONDING_STRATEGIES)[BondingStrategy]

// Electronegativity-based bonding with chemical preferences.
// This algorithm considers electronegativity differences between atoms, metal/nonmetal
// properties, and distance to determine bond strength. Bonds are only created if the
// computed strength exceeds the strength_threshold parameter (default: 0.3).
export function electroneg_ratio(
  structure: AnyStructure,
  {
    electronegativity_threshold = 1.7, // Max electronegativity difference for bonding
    max_distance_ratio = 2.0, // Max distance as multiple of sum of covalent radii
    min_bond_dist = 0.4, // Minimum bond distance in Angstroms
    metal_metal_penalty = 0.7, // Strength penalty for metal-metal bonds
    metal_nonmetal_bonus = 1.5, // Strength bonus for metal-nonmetal bonds
    similar_electronegativity_bonus = 1.2, // Bonus for similar electronegativity
    same_species_penalty = 0.5, // Penalty for bonds between same element
    strength_threshold = 0.3, // Minimum bond strength to include in results
  } = {},
): BondPair[] {
  const { sites } = structure
  if (sites.length < 2) return []

  const bonds: BondPair[] = []
  const min_dist_sq = min_bond_dist ** 2
  const closest = new Map<number, number>()

  const props = sites.map((site) => {
    const majority = get_majority_species(site)
    const elem = majority.element
    const data = element_lookup.get(elem)
    return {
      element: elem,
      electroneg: data?.electronegativity ?? 2.0,
      is_metal: data?.metal ?? false,
      is_nonmetal: data?.nonmetal ?? false,
      radius: elem ? covalent_radii.get(elem) : undefined,
    }
  })

  let max_radius = 0
  for (const radius of covalent_radii.values()) {
    if (radius > max_radius) max_radius = radius
  }
  const max_cutoff = max_radius * 2 * max_distance_ratio
  const spatial = setup_spatial_grid(sites, max_cutoff)

  // Two-pass approach to ensure symmetry between original and image atoms:
  // 1. Collect all potential bonds and determine closest neighbor distance for each unique atom (orig_idx)
  // 2. Filter bonds based on penalties using the fully populated closest distances

  interface PotentialBond {
    site_idx_1: number
    site_idx_2: number
    dist: number
    expected_dist: number
    base_strength: number
    orig_idx_a: number
    orig_idx_b: number
  }

  const potential_bonds: PotentialBond[] = []

  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const [x1, y1, z1] = sites[idx_a].xyz
    const props_a = props[idx_a]

    for (const idx_b of get_candidates(sites[idx_a].xyz, sites, spatial)) {
      if (idx_b <= idx_a) continue

      const [x2, y2, z2] = sites[idx_b].xyz
      const props_b = props[idx_b]

      const [dx, dy, dz] = [x2 - x1, y2 - y1, z2 - z1]
      const dist_sq = dx * dx + dy * dy + dz * dz
      const dist = Math.sqrt(dist_sq)

      if (dist_sq < min_dist_sq || !props_a.radius || !props_b.radius) continue

      const expected = props_a.radius + props_b.radius
      if (dist > expected * max_distance_ratio) continue

      const electroneg_diff = Math.abs(props_a.electroneg - props_b.electroneg)
      const electroneg_balance = electroneg_diff / (props_a.electroneg + props_b.electroneg)

      let bond_strength = 1.0
      if (props_a.is_metal && props_b.is_metal) {
        bond_strength *= metal_metal_penalty
      } else if (
        (props_a.is_metal && props_b.is_nonmetal) ||
        (props_a.is_nonmetal && props_b.is_metal)
      ) {
        bond_strength *= metal_nonmetal_bonus
        if (electroneg_diff > electronegativity_threshold) bond_strength *= 1.3
      } else if (electroneg_diff < 0.5) {
        bond_strength *= similar_electronegativity_bonus
      }

      const dist_weight = Math.exp(-((dist / expected - 1) ** 2) / 0.18)
      const electroneg_weight = 1.0 - 0.3 * electroneg_balance
      let strength = bond_strength * dist_weight * electroneg_weight

      if (props_a.element === props_b.element) strength *= same_species_penalty

      // If raw strength is already too low, we can skip early
      // (penalty will only reduce it further)
      if (strength <= strength_threshold) continue

      // Use helper logic to handle both supercell and image atoms with robust normalization
      const orig_idx_a = get_orig_idx(sites[idx_a], idx_a)
      const orig_idx_b = get_orig_idx(sites[idx_b], idx_b)

      // Update closest known normalized distance (dist / expected) for original atoms
      // Normalized distance handles atoms of different sizes better than raw distance
      // (e.g. C-H is short but C-C is longer; we don't want C-H to penalize C-C just because H is small)
      const norm_dist = dist / expected
      const closest_dist_a = closest.get(orig_idx_a) ?? Infinity
      if (norm_dist < closest_dist_a) closest.set(orig_idx_a, norm_dist)

      const closest_dist_b = closest.get(orig_idx_b) ?? Infinity
      if (norm_dist < closest_dist_b) closest.set(orig_idx_b, norm_dist)

      potential_bonds.push({
        site_idx_1: idx_a,
        site_idx_2: idx_b,
        dist,
        expected_dist: expected,
        base_strength: strength,
        orig_idx_a,
        orig_idx_b,
      })
    }
  }

  // Second pass: Apply penalties and filter
  for (const bond of potential_bonds) {
    const {
      site_idx_1,
      site_idx_2,
      dist,
      expected_dist,
      base_strength,
      orig_idx_a,
      orig_idx_b,
    } = bond

    const closest_dist_a = closest.get(orig_idx_a) ?? Infinity
    const closest_dist_b = closest.get(orig_idx_b) ?? Infinity
    const norm_dist = dist / expected_dist

    let strength = base_strength

    // Apply penalty if this bond is much longer (relative to radii) than the closest known bond
    if (norm_dist > closest_dist_a) {
      strength *= Math.exp(-(norm_dist / closest_dist_a - 1) / 0.5)
    }
    if (orig_idx_b !== orig_idx_a && norm_dist > closest_dist_b) {
      strength *= Math.exp(-(norm_dist / closest_dist_b - 1) / 0.5)
    }

    if (strength > strength_threshold) {
      bonds.push({
        pos_1: sites[site_idx_1].xyz,
        pos_2: sites[site_idx_2].xyz,
        site_idx_1,
        site_idx_2,
        bond_length: dist,
        strength,
        transform_matrix: compute_bond_transform(sites[site_idx_1].xyz, sites[site_idx_2].xyz),
      })
    }
  }

  return apply_explicit_bond_metadata(structure, bonds)
}

// Solid angle-based bonding using geometric proximity heuristics.
// Inspired by Voronoi tessellation without having to actually compute Voronoi cells.
// This algorithm computes bond strength based on the solid angle subtended by atoms
// and their distance penalty. Bonds are only created if the computed strength exceeds
// the strength_threshold parameter.
export function solid_angle(
  structure: AnyStructure,
  {
    min_solid_angle = 0.01,
    min_face_area = 0.05,
    max_distance = 5.0,
    min_bond_dist = 0.4,
    strength_threshold = 0.05,
  } = {},
): BondPair[] {
  const { sites } = structure
  if (sites.length < 2) return []

  const bonds: BondPair[] = []
  const min_dist_sq = min_bond_dist ** 2
  const max_dist_sq = max_distance ** 2
  const spatial = setup_spatial_grid(sites, max_distance)

  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const [x1, y1, z1] = sites[idx_a].xyz
    const majority_a = get_majority_species(sites[idx_a])
    const radius_a = majority_a.element ? covalent_radii.get(majority_a.element) : undefined

    for (const idx_b of get_candidates(sites[idx_a].xyz, sites, spatial)) {
      if (idx_b <= idx_a) continue

      const [x2, y2, z2] = sites[idx_b].xyz
      const majority_b = get_majority_species(sites[idx_b])
      const radius_b = majority_b.element ? covalent_radii.get(majority_b.element) : undefined

      const [dx, dy, dz] = [x2 - x1, y2 - y1, z2 - z1]
      const dist_sq = dx * dx + dy * dy + dz * dz
      const dist = Math.sqrt(dist_sq)

      if (dist_sq < min_dist_sq || dist_sq > max_dist_sq || !radius_a || !radius_b) {
        continue
      }

      const avg_radius = (radius_a + radius_b) / 2.0
      const face_area = Math.PI * avg_radius * avg_radius
      const bond_solid_angle = face_area / dist_sq

      if (bond_solid_angle < min_solid_angle || face_area < min_face_area) continue

      const dist_penalty = Math.exp(-((dist / (radius_a + radius_b) - 1) ** 2) / 0.4)
      const angle_strength = Math.min(bond_solid_angle / (4.0 * Math.PI), 1.0)
      const strength = angle_strength * dist_penalty

      if (strength > strength_threshold) {
        bonds.push({
          pos_1: sites[idx_a].xyz,
          pos_2: sites[idx_b].xyz,
          site_idx_1: idx_a,
          site_idx_2: idx_b,
          bond_length: dist,
          strength,
          transform_matrix: compute_bond_transform(sites[idx_a].xyz, sites[idx_b].xyz),
        })
      }
    }
  }
  return apply_explicit_bond_metadata(structure, bonds)
}

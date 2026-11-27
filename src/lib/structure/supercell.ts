// Supercell generation utilities for Crystal
import type { Matrix3x3, Vec3 } from '#lib/math'
import * as math from '#lib/math'
import type { Crystal, Site, StructureBond } from './index'
import { wrap_frac_coord } from './pbc'
import {
  get_explicit_bond_metadata,
  normalize_structure_bond,
  shift_bonds_for_moved_sites,
} from './bonding'

const AXES = [0, 1, 2] as const

// A supercell as a diagonal scaling ("2x2x2", "2", 2, [2, 2, 2]) or an integer matrix M
// (rows: the new lattice vectors in units of the old ones, new_lattice = M · lattice, as in
// pymatgen's Structure.make_supercell). Strings spell a matrix as 9 integers, row by row:
// "1 1 0, -1 1 0, 0 0 1".
export type SupercellScaling = string | number | Vec3 | Matrix3x3

const is_matrix3x3 = (value: unknown): value is Matrix3x3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((row) => Array.isArray(row) && row.length === 3)

export const diagonal_matrix = (factors: Vec3): Matrix3x3 =>
  AXES.map((row) => AXES.map((col) => (row === col ? factors[row] : 0))) as Matrix3x3

// The integer supercell matrix of any SupercellScaling form. Diagonal forms need positive
// factors; a matrix may hold any integers but must be invertible (|det| copies of each site).
const MAX_SUPERCELL_ENTRY = 100_000
export function parse_supercell_matrix(scaling: SupercellScaling): Matrix3x3 {
  const tokens = typeof scaling === `string` ? scaling.trim().split(/[\s,;]+/) : []
  let matrix: Matrix3x3
  if (is_matrix3x3(scaling)) matrix = scaling
  else if (tokens.length === 9) {
    if (!tokens.every((token) => /^-?\d+$/.test(token)))
      throw new Error(`Invalid supercell matrix: ${scaling}`)
    const values = tokens.map(Number)
    matrix = [values.slice(0, 3), values.slice(3, 6), values.slice(6)] as Matrix3x3
  } else matrix = diagonal_matrix(parse_supercell_scaling_factors(scaling))
  if (matrix.flat().some((val) => !Number.isInteger(val)))
    throw new Error(`Supercell matrix entries must be integers: ${JSON.stringify(matrix)}`)
  // |entries| <= 1e5 keep the det's six triple products, and so det itself, below 2^53: exact
  if (matrix.flat().some((val) => Math.abs(val) > MAX_SUPERCELL_ENTRY))
    throw new Error(
      `Supercell matrix entries must be at most ${MAX_SUPERCELL_ENTRY} in magnitude: ${JSON.stringify(matrix)}`,
    )
  if (math.det_3x3(matrix) === 0)
    throw new Error(`Supercell matrix is singular (det 0): ${JSON.stringify(matrix)}`)
  return matrix
}

// The positive [a, b, c] repeats of a diagonal supercell matrix, null for any other matrix
export const diagonal_scaling = (matrix: Matrix3x3): Vec3 | null =>
  matrix.every((row, row_idx) =>
    row.every((val, col_idx) => (row_idx === col_idx ? val > 0 : val === 0)),
  )
    ? [matrix[0][0], matrix[1][1], matrix[2][2]]
    : null

// [a, b, c] repeats of a diagonal supercell (phonon supercells and other per-axis tilings);
// throws for a matrix that is not diagonal with positive entries
export function parse_supercell_scaling(scaling: SupercellScaling): Vec3 {
  const factors = diagonal_scaling(parse_supercell_matrix(scaling))
  if (!factors) throw new Error(`Supercell scaling must be diagonal here, got: ${scaling}`)
  return factors
}

// "2x2x2", "2×2×2", "2,2,2", "2 2 2", a lone "2", 2 or [2, 2, 2]. Only plain digit runs
// count, so scientific notation, hex, signs and fractions never reach Number(). Empty parts
// fail too ("3x" ≠ 3x3x3).
function parse_supercell_scaling_factors(scaling: string | number | Vec3): Vec3 {
  const parts =
    typeof scaling === `string`
      ? scaling
          .trim()
          .toLowerCase()
          .split(/\s*[x×,]\s*|\s+/)
      : [scaling].flat().map(String)
  const values = parts.map(Number)
  if (
    (parts.length !== 1 && parts.length !== 3) ||
    !parts.every((part) => /^\d+$/.test(part)) ||
    values.some((val) => val <= 0)
  )
    throw new Error(`Invalid supercell scaling (1 or 3 positive integers): ${scaling}`)
  return parts.length === 1 ? [values[0], values[0], values[0]] : (values as Vec3)
}

// The |det M| integer lattice translations t (in old-lattice units) inside the supercell M · L,
// i.e. with t · M^-1 in [0, 1)^3, c slowest and a fastest. `to_frac` maps a row vector x in
// old-lattice units to x · M^-1 as integer numerators (x · det M^-1, det M^-1 being an integer
// matrix) over det, so membership and floors of integer vectors are exact.
const MAX_TRANSLATION_BOX = 2 ** 20 // ~0.1 s to scan
export function supercell_translations(matrix: Matrix3x3): {
  translations: Vec3[]
  det: number
  to_frac: (vec: Vec3) => Vec3
} {
  const det = Math.round(math.det_3x3(matrix))
  const numerators = math
    .transpose_3x3(math.inverse_3x3(matrix))
    .map((col) => col.map((val) => Math.round(val * det))) as Matrix3x3
  const to_frac = (vec: Vec3): Vec3 =>
    math.mul_3x3_vec3(numerators, vec).map((numerator) => numerator / det) as Vec3
  // bounding box of the supercell's corners, each a sum of a subset of M's rows
  const [lower, upper] = [Math.min, Math.max].map((pick) =>
    AXES.map((axis) => matrix.reduce((sum, row) => sum + pick(0, row[axis]), 0)),
  )
  // the box holds every translation but can dwarf |det| ([[1, n, n], [0, 1, n], [0, 0, 1]]
  // has det 1 in a 2n²-cell box), so a box past the work cap is refused before scanning it
  const n_box = AXES.reduce((prod: number, axis) => prod * (upper[axis] - lower[axis] + 1), 1)
  if (n_box > Math.max(MAX_TRANSLATION_BOX, 8 * Math.abs(det)))
    throw new Error(
      `Supercell matrix ${JSON.stringify(matrix)} spans a bounding box of ${n_box.toLocaleString()} cells for ${Math.abs(det)} copies, too skewed to tile`,
    )
  const translations: Vec3[] = []
  for (let t_c = lower[2]; t_c <= upper[2]; t_c++)
    for (let t_b = lower[1]; t_b <= upper[1]; t_b++)
      for (let t_a = lower[0]; t_a <= upper[0]; t_a++) {
        const translation: Vec3 = [t_a, t_b, t_c]
        if (to_frac(translation).every((coord) => coord >= 0 && coord < 1))
          translations.push(translation)
      }
  return { translations, det, to_frac }
}

// Integer cell offsets of a [scale_x, scale_y, scale_z] supercell, x fastest then y then z:
// the same flat order make_supercell tiles sites in
export const generate_lattice_points = (scaling_factors: Vec3): Vec3[] =>
  supercell_translations(diagonal_matrix(scaling_factors)).translations

// Whole unit cells per axis of a (possibly fractional or zero) tiling, at least one each
export const whole_tile_counts = (tiling: Vec3): Vec3 =>
  tiling.map((count) => Math.max(1, Math.floor(count))) as Vec3

// Unique [start indices, axis, span] grid edges, excluding the origin cell drawn separately.
// Above max_edges, draw only the block outline to bound instance count.
export function supercell_grid_edges(
  tiling: Vec3,
  max_edges = 6000,
): [Vec3, number, number][] {
  const counts = whole_tile_counts(tiling)
  if (counts.every((count) => count === 1)) return []
  const axes = [0, 1, 2]
  const [count_a, count_b, count_c] = counts
  const grid_size =
    count_a * (count_b + 1) * (count_c + 1) +
    count_b * (count_a + 1) * (count_c + 1) +
    count_c * (count_a + 1) * (count_b + 1)
  const edges: [Vec3, number, number][] = []
  for (const axis of axes) {
    const [side_1, side_2] = axes.filter((idx) => idx !== axis)
    if (grid_size > max_edges) {
      // block outline: 4 edges spanning the full axis
      for (const [step_1, step_2] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const start: Vec3 = [0, 0, 0]
        start[side_1] = step_1 * counts[side_1]
        start[side_2] = step_2 * counts[side_2]
        // Trim every overlap with the origin cell, including thin blocks.
        const from_origin = start[side_1] <= 1 && start[side_2] <= 1
        if (from_origin && counts[axis] === 1) continue
        if (from_origin) start[axis] = 1
        edges.push([start, axis, counts[axis] - (from_origin ? 1 : 0)])
      }
      continue
    }
    for (let along = 0; along < counts[axis]; along++) {
      for (let step_1 = 0; step_1 <= counts[side_1]; step_1++) {
        for (let step_2 = 0; step_2 <= counts[side_2]; step_2++) {
          if (along === 0 && step_1 <= 1 && step_2 <= 1) continue // origin cell edge
          const start: Vec3 = [0, 0, 0]
          start[axis] = along
          start[side_1] = step_1
          start[side_2] = step_2
          edges.push([start, axis, 1])
        }
      }
    }
  }
  return edges
}

// Site objects cost a few hundred bytes each; past this a typed "100x100x100" would hang the
// tab on allocation alone, and nothing downstream (rendering, bonding) could use the result
const MAX_SUPERCELL_SITES = 1_000_000

const check_site_cap = (n_sites: number, n_copies: number, name: string): void => {
  const n_total = n_sites * n_copies
  if (n_total > MAX_SUPERCELL_SITES)
    throw new Error(
      `Supercell ${name} of ${n_sites} sites would hold ${n_total.toLocaleString()} sites (limit ${MAX_SUPERCELL_SITES.toLocaleString()})`,
    )
}

// Identical for every copy of a base site, so built once and shared: copies share their base
// site's `species` array the same way
const shared_site_metadata = (sites: Site[]) =>
  sites.map((site, site_idx) => ({
    properties: { ...site.properties },
    provenance: { ...site.provenance, unit_cell_idx: site_idx },
  }))

// Tile a Crystal by `scaling`, folding fractional coordinates back into the supercell unless
// `to_unit_cell` is false
export function make_supercell(
  structure: Crystal,
  scaling: SupercellScaling,
  to_unit_cell = true,
): Crystal {
  const matrix = parse_supercell_matrix(scaling)
  const supercell_scaling = diagonal_scaling(matrix)
  if (!supercell_scaling) return make_matrix_supercell(structure, matrix, to_unit_cell)
  const [scale_x, scale_y, scale_z] = supercell_scaling
  const total_cells = scale_x * scale_y * scale_z
  if (total_cells === 1) return structure
  check_site_cap(structure.sites.length, total_cells, supercell_scaling.join(`x`))

  const { sites, lattice } = structure
  const n_sites = sites.length
  const new_sites: Site[] = Array(n_sites * total_cells)
  const to_cart = math.create_frac_to_cart(lattice.matrix)
  let write_idx = 0

  // wrap_frac_coord rounds via toFixed, which costs more than the rest of the loop body.
  // A coordinate only depends on its own axis' cell index, so precomputing per axis runs
  // it n_sites * (scale_x + scale_y + scale_z) times instead of 3 * n_sites * total_cells.
  // frac_shift is how far the wrap moved each coordinate in ORIGINAL lattice vectors, nonzero
  // only for input `abc` outside [0,1). It is applied to `xyz` too, so `abc` readers (PBC
  // images, symmetry) and `xyz` readers (rendering, bonding) agree on where the atom is.
  const { pbc } = lattice
  const wrapped_frac: Float64Array[] = []
  const frac_shift: Float64Array[] = []
  let any_frac_shift = false
  for (const [axis, scale] of supercell_scaling.entries()) {
    const coords = new Float64Array(n_sites * scale)
    const shifts = new Float64Array(n_sites * scale)
    for (let cell_idx = 0; cell_idx < scale; cell_idx++) {
      for (let site_idx = 0; site_idx < n_sites; site_idx++) {
        const flat_idx = cell_idx * n_sites + site_idx
        const coord = (sites[site_idx].abc[axis] + cell_idx) / scale
        // aperiodic axes (a slab's vacuum direction) stay unwrapped, as in wrap_to_unit_cell
        const wrapped = to_unit_cell && pbc[axis] ? wrap_frac_coord(coord) : coord
        coords[flat_idx] = wrapped
        shifts[flat_idx] = (wrapped - coord) * scale
        if (shifts[flat_idx] !== 0) any_frac_shift = true
      }
    }
    wrapped_frac.push(coords)
    frac_shift.push(shifts)
  }

  const site_metadata = shared_site_metadata(sites)
  const needs_label_separator = supercell_scaling.some((scale) => scale > 10)
  // per supercell site, its wrap in supercell-lattice vectors (the unit of bond cell_shift)
  const site_shifts: (Vec3 | undefined)[] = []

  // Loop order: k, j, i to match typical pymatgen/standard ordering
  for (let depth_index = 0; depth_index < scale_z; depth_index++) {
    for (let col_index = 0; col_index < scale_y; col_index++) {
      for (let row_index = 0; row_index < scale_x; row_index++) {
        // Bare `_${i}${j}${k}` suffixes stop being injective once an index reaches two digits
        // ((1,10,0) and (11,0,0) both give "_1100"), so separate them when any axis can
        const label_suffix = needs_label_separator
          ? `_${row_index}_${col_index}_${depth_index}`
          : `_${row_index}${col_index}${depth_index}`

        const offset = to_cart([row_index, col_index, depth_index])
        for (let site_idx = 0; site_idx < n_sites; site_idx++) {
          const site = sites[site_idx]
          const wrap_offset: Vec3 = [0, 0, 0]
          if (any_frac_shift) {
            const frac_wrap: Vec3 = [
              frac_shift[0][row_index * n_sites + site_idx],
              frac_shift[1][col_index * n_sites + site_idx],
              frac_shift[2][depth_index * n_sites + site_idx],
            ]
            to_cart(frac_wrap, wrap_offset)
            const shift = frac_wrap.map((val, axis) =>
              Math.round(val / supercell_scaling[axis]),
            ) as Vec3
            if (shift.some(Boolean)) site_shifts[write_idx] = shift
          }

          new_sites[write_idx++] = {
            species: site.species,
            xyz: [
              site.xyz[0] + offset[0] + wrap_offset[0],
              site.xyz[1] + offset[1] + wrap_offset[1],
              site.xyz[2] + offset[2] + wrap_offset[2],
            ],
            abc: [
              wrapped_frac[0][row_index * n_sites + site_idx],
              wrapped_frac[1][col_index * n_sites + site_idx],
              wrapped_frac[2][depth_index * n_sites + site_idx],
            ],
            label: `${site.label}${label_suffix}`,
            ...site_metadata[site_idx],
          }
        }
      }
    }
  }
  const new_matrix = math.scale_lattice_matrix(lattice.matrix, supercell_scaling)
  return assemble_supercell(structure, matrix, new_matrix, new_sites, site_shifts)
}

// Whether a typed supercell (diagonal or 9-integer matrix) parses
export function is_valid_supercell_input(input: string): boolean {
  try {
    parse_supercell_matrix(input)
    return true
  } catch {
    return false
  }
}

// Supercell M · L of a non-diagonal integer matrix: every site once per lattice translation
// inside it, fractional coordinates in the new cell (wrapped into [0, 1) on periodic axes
// unless `to_unit_cell` is false), Cartesian ones moved by the same whole lattice vectors.
// A non-periodic axis (a slab's vacuum direction) can only be kept as is: the matrix must
// leave it out of the other axes.
function make_matrix_supercell(
  structure: Crystal,
  matrix: Matrix3x3,
  to_unit_cell: boolean,
): Crystal {
  const { pbc, matrix: lattice } = structure.lattice
  for (const axis of AXES) {
    const mixes_axis = AXES.some(
      (other) =>
        matrix[axis][other] !== Number(other === axis) ||
        matrix[other][axis] !== Number(other === axis),
    )
    if (!pbc[axis] && mixes_axis)
      throw new Error(
        `Supercell matrix ${JSON.stringify(matrix)} mixes non-periodic axis ${`abc`[axis]} with the others`,
      )
  }
  const { sites } = structure
  // |det M| copies, known before enumerating them, so an oversized matrix fails at once
  const n_copies = Math.abs(Math.round(math.det_3x3(matrix)))
  check_site_cap(sites.length, n_copies, JSON.stringify(matrix))
  const layout = supercell_translations(matrix)
  const { translations, to_frac } = layout
  const new_matrix = math.dot(matrix, lattice) // rows of M · L: the new lattice vectors
  const to_old_cart = math.create_frac_to_cart(lattice)
  const to_new_cart = math.create_frac_to_cart(new_matrix)
  const site_metadata = shared_site_metadata(sites)
  const new_sites: Site[] = []
  // per supercell site, its wrap in supercell-lattice vectors (the unit of bond cell_shift)
  const site_shifts: (Vec3 | undefined)[] = []
  for (const [t_idx, translation] of translations.entries()) {
    const offset = to_old_cart(translation)
    for (const [site_idx, site] of sites.entries()) {
      const raw = to_frac(math.add(site.abc, translation))
      const abc = raw.map((coord, axis) =>
        to_unit_cell && pbc[axis] ? wrap_frac_coord(coord) : coord,
      ) as Vec3
      const shift = abc.map((coord, axis) => Math.round(coord - raw[axis])) as Vec3
      if (shift.some(Boolean)) site_shifts[new_sites.length] = shift
      new_sites.push({
        species: site.species,
        xyz: math.add(site.xyz, offset, to_new_cart(shift)),
        abc,
        label: `${site.label}_${t_idx}`,
        ...site_metadata[site_idx],
      })
    }
  }
  return assemble_supercell(structure, matrix, new_matrix, new_sites, site_shifts, layout)
}

// The explicit bonds the unit cell draws (an out-of-range index rejected there would be offset
// into range by the tiling and bond atoms of a neighbouring cell), once per translation t of
// the supercell `matrix`. A bond i -> j + S from the copy at t ends at j's copy at t + S, which
// is the in-cell translation t' plus whole supercell vectors K: t + S = t' + K · M
function replicate_bonds(
  structure: Crystal,
  matrix: Matrix3x3,
  { translations, to_frac }: ReturnType<typeof supercell_translations>,
): StructureBond[] {
  const n_sites = structure.sites.length
  const bonds = get_explicit_bond_metadata(structure)
  const translation_idx = new Map(translations.map((vec, idx) => [vec.join(`,`), idx]))
  return translations.flatMap((translation, t_idx) =>
    bonds.map(({ site_idx_1, site_idx_2, order, cell_shift = [0, 0, 0] }) => {
      const target = math.add(translation, cell_shift)
      const supercell_shift = to_frac(target).map(Math.floor) as Vec3
      const in_cell = target.map(
        (coord, axis) =>
          coord -
          supercell_shift.reduce((sum, shift, row) => sum + shift * matrix[row][axis], 0),
      )
      const target_idx = translation_idx.get(in_cell.join(`,`))
      if (target_idx === undefined)
        throw new Error(`Bond target ${in_cell} not in supercell ${JSON.stringify(matrix)}`)
      return normalize_structure_bond(
        site_idx_1 + t_idx * n_sites,
        site_idx_2 + target_idx * n_sites,
        order,
        supercell_shift,
      )
    }),
  )
}

// The supercell of `matrix` holding `sites` in lattice `new_matrix`: charge times the number
// of copies, explicit bonds replicated and shifted with their sites' wraps (`site_shifts`)
function assemble_supercell(
  structure: Crystal,
  matrix: Matrix3x3,
  new_matrix: Matrix3x3,
  sites: Site[],
  site_shifts: (Vec3 | undefined)[],
  // the general path's own, else enumerated here only when there are bonds to replicate
  layout?: ReturnType<typeof supercell_translations>,
): Crystal {
  const n_copies = Math.abs(Math.round(math.det_3x3(matrix)))
  return {
    ...structure,
    lattice: {
      ...structure.lattice,
      matrix: new_matrix,
      ...math.compute_lattice_params(new_matrix),
    },
    sites,
    properties:
      structure.properties?.bonds === undefined
        ? structure.properties
        : {
            ...structure.properties,
            bonds: shift_bonds_for_moved_sites(
              replicate_bonds(structure, matrix, layout ?? supercell_translations(matrix)),
              (site_idx) => site_shifts[site_idx],
            ),
          },
    charge: structure.charge ? structure.charge * n_copies : structure.charge,
  }
}

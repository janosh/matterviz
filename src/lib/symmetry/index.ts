import { ATOMIC_NUMBER_TO_SYMBOL, SYMBOL_TO_ATOMIC_NUMBER } from '$lib/composition/parse'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { DEFAULTS } from '$lib/settings'
import type { AnyStructure, Crystal } from '$lib/structure'
import { merge_split_partial_sites } from '$lib/structure/partial-occupancy'
import type { MoyoCell, MoyoDataset } from '@spglib/moyo-wasm'
import init, { analyze_cell } from '@spglib/moyo-wasm'
import moyo_wasm_url from '@spglib/moyo-wasm/moyo_wasm_bg.wasm?url'
import { mat3_from_flat_col_major } from './symmetry-elements'

export * from './cell-transform'
export * from './spacegroups'
export * from './symmetry-elements'
export { default as SymmetryElementControls } from './SymmetryElementControls.svelte'
export { default as SymmetryElements } from './SymmetryElements.svelte'
export { default as SymmetryStats } from './SymmetryStats.svelte'
export { default as WyckoffTable } from './WyckoffTable.svelte'

// Keys are standard crystallographic symbols (P, I, F, A, B, C, R)
export const BRAVAIS_LATTICES = {
  P: `Primitive`,
  I: `Body-centered`,
  F: `Face-centered`,
  A: `A-face centered`,
  B: `B-face centered`,
  C: `C-face centered`,
  R: `Rhombohedral`,
} as const

export type BravaisLattice = (typeof BRAVAIS_LATTICES)[keyof typeof BRAVAIS_LATTICES]

export type SymmetrySettings = {
  symprec: number
  algo: `Moyo` | `Spglib`
}
export const default_sym_settings = {
  symprec: DEFAULTS.symmetry.symprec,
  algo: DEFAULTS.symmetry.algo,
} as const satisfies SymmetrySettings

export type WyckoffPos = {
  wyckoff: string
  elem: string
  abc: Vec3
  site_indices?: number[]
  // Site symmetry symbol of the orbit (e.g. "m-3m", "4mm"), when available from moyo
  site_symmetry?: string
}
export type SymmetryDataset = MoyoDataset & {
  // Legacy one-to-one standardized-index mapping.
  orig_indices?: number[]
  // Mapping from standardized-cell site index to original structure site indices.
  orig_site_indices_by_std_idx?: number[][]
  // The merged cell that was fed to moyo's analyze_cell. IMPORTANT: moyo's per-site
  // arrays (wyckoffs, orbits, site_symmetry_symbols) index THIS cell, not std_cell.
  input_cell?: Pick<MoyoCell, `positions` | `numbers`>
  // Mapping from moyo input-cell site index to original structure site indices
  // (one input site -> many originals for merged disordered sites).
  orig_site_indices_by_input_idx?: number[][]
}

let initialized = false
const OCCUPANCY_EPS = 1e-8
const to_unit = (value: number) => value - Math.floor(value)
const near_zero = (value: number) => Math.min(value, 1 - value)
const near_half = (value: number) => Math.abs(value - 0.5)
const symmetry_position_key = (pos: Vec3) =>
  pos.map((coord) => to_unit(coord).toFixed(8)).join(`,`)

const is_near_integer_vec = (vec: Vec3, tol: number) =>
  vec.every((coord) => Math.abs(coord - Math.round(coord)) < tol)

// Wrap fractional coordinates into [0, 1), snapping values within 1e-9 of 1 back to 0
const wrap_frac = (pos: Vec3): Vec3 =>
  pos.map((coord) => {
    const wrapped = coord - Math.floor(coord)
    return wrapped > 1 - 1e-9 ? 0 : wrapped
  }) as Vec3

// Build a mapper from input-cell to standardized-cell fractional coordinates.
// moyo's (std_linear P, std_origin_shift p) follow the ITA convention for the
// transformation from the input cell to the standardized cell: x_std = P⁻¹ (x_input − p).
// Returns null if std_linear is absent or singular.
function make_frac_coord_mapper(
  linear_flat: readonly number[] | undefined,
  origin_shift: readonly number[] | undefined,
): {
  to_std: (pos: Vec3) => Vec3
  linear: Matrix3x3
  linear_inv: Matrix3x3
  shift: Vec3
} | null {
  if (linear_flat?.length !== 9) return null
  try {
    const linear = mat3_from_flat_col_major(linear_flat)
    const linear_inv = math.matrix_inverse_3x3(linear)
    const shift = (origin_shift ?? [0, 0, 0]) as Vec3
    const to_std = (pos: Vec3): Vec3 =>
      math.mat3x3_vec3_multiply(linear_inv, math.subtract(pos, shift))
    return { to_std, linear, linear_inv, shift }
  } catch {
    return null
  }
}

export async function ensure_moyo_wasm_ready(wasm_url?: string) {
  if (initialized) return

  // Use provided URL (e.g. from VSCode webview data), otherwise use Vite-bundled URL
  const url = wasm_url ?? moyo_wasm_url

  await init({ module_or_path: url })
  initialized = true
}

function get_site_atomic_number(site: Crystal[`sites`][number], site_idx: number): number {
  const occupancy_by_element = new Map<keyof typeof SYMBOL_TO_ATOMIC_NUMBER, number>()
  for (const { element, occu } of site.species) {
    if (occu <= OCCUPANCY_EPS) continue
    occupancy_by_element.set(element, (occupancy_by_element.get(element) ?? 0) + occu)
  }

  let selected_element: (typeof site.species)[number][`element`] | undefined =
    site.species[0]?.element
  let best_occupancy = -Infinity
  occupancy_by_element.forEach((occupancy, element) => {
    if (
      occupancy > best_occupancy ||
      (occupancy === best_occupancy && element.localeCompare(selected_element ?? ``) < 0)
    ) {
      selected_element = element
      best_occupancy = occupancy
    }
  })

  if (selected_element === undefined) {
    throw new Error(`Unknown element at site ${site_idx}: ${selected_element}`)
  }
  const atomic_number = SYMBOL_TO_ATOMIC_NUMBER[selected_element]
  if (atomic_number === undefined) {
    throw new Error(`Unknown element at site ${site_idx}: ${selected_element}`)
  }
  return atomic_number
}

function build_moyo_input_cell(structure: Crystal): Pick<MoyoCell, `positions` | `numbers`> & {
  orig_site_indices_by_input_idx: number[][]
} {
  const merged_render_sites = merge_split_partial_sites(structure.sites)
  return {
    positions: merged_render_sites.map(({ site }) => site.abc),
    numbers: merged_render_sites.map(({ site, site_idx }) =>
      get_site_atomic_number(site, site_idx),
    ),
    orig_site_indices_by_input_idx: merged_render_sites.map(
      ({ source_site_indices }) => source_site_indices,
    ),
  }
}

function build_moyo_cell(structure: Crystal, positions: Vec3[], numbers: number[]): MoyoCell {
  // nalgebra Matrix3 deserializes as a flat list in COLUMN-MAJOR of the internal basis B
  // Internal B = transpose(row-basis RB). column-major(B) == row-major(RB).
  // So supply row-major of the pymatgen lattice.matrix (RB).
  const [v_a, v_b, v_c] = structure.lattice.matrix
  return {
    lattice: { basis: [...v_a, ...v_b, ...v_c] },
    positions,
    numbers,
  }
}

export function to_cell_json(structure: Crystal): string {
  const { positions, numbers } = build_moyo_input_cell(structure)
  return JSON.stringify(build_moyo_cell(structure, positions as Vec3[], numbers))
}

const fractional_sq_dist = (pos_1: Vec3, pos_2: Vec3): number =>
  (pos_1[0] - pos_2[0] - Math.round(pos_1[0] - pos_2[0])) ** 2 +
  (pos_1[1] - pos_2[1] - Math.round(pos_1[1] - pos_2[1])) ** 2 +
  (pos_1[2] - pos_2[2] - Math.round(pos_1[2] - pos_2[2])) ** 2

// Map each standardized-cell site to the input-cell site it descends from, then to
// original structure indices. When moyo's (std_linear, std_origin_shift) transform is
// provided, std positions are first mapped into the input frame via x_in = P·x_std + p
// (the std and input cells use DIFFERENT bases in general, so comparing raw fractional
// coordinates across them is meaningless). Matches account for crystal translations of
// both lattices: a difference d is a translation if d ∈ ℤ³ (input lattice) or P⁻¹d ∈ ℤ³
// (standardized lattice expressed in the input frame).
export const map_std_to_orig_site_indices = (
  std_positions: Vec3[],
  std_numbers: number[],
  input_positions: Vec3[],
  input_numbers: number[],
  orig_site_indices_by_input_idx: number[][],
  transform?: {
    std_linear: readonly number[]
    std_origin_shift: readonly number[]
  },
  tol = 1e-4,
): number[][] => {
  const mapper = make_frac_coord_mapper(transform?.std_linear, transform?.std_origin_shift)

  return std_positions.map((std_pos, std_idx) => {
    // Predicted input-frame position of this std site: x_in = P·x_std + p
    const pred = mapper
      ? math.add(math.mat3x3_vec3_multiply(mapper.linear, std_pos), mapper.shift)
      : std_pos
    const std_number = std_numbers[std_idx]
    let nearest_input_idx = -1
    let nearest_sq_dist = Infinity
    for (let input_idx = 0; input_idx < input_positions.length; input_idx += 1) {
      if (input_numbers[input_idx] !== std_number) continue
      const delta = math.subtract(pred, input_positions[input_idx])
      // Exact match modulo a translation of the standardized lattice
      const is_std_translation =
        mapper && is_near_integer_vec(math.mat3x3_vec3_multiply(mapper.linear_inv, delta), tol)
      const sq_dist = is_std_translation
        ? 0
        : fractional_sq_dist(pred, input_positions[input_idx])
      if (sq_dist < nearest_sq_dist) {
        nearest_sq_dist = sq_dist
        nearest_input_idx = input_idx
      }
    }

    if (nearest_input_idx === -1) return []
    return orig_site_indices_by_input_idx[nearest_input_idx] ?? []
  })
}

export async function analyze_structure_symmetry(
  struct_or_mol: AnyStructure,
  settings: Partial<SymmetrySettings>,
): Promise<SymmetryDataset> {
  await ensure_moyo_wasm_ready()
  if (!(`lattice` in struct_or_mol)) {
    throw new Error(`Symmetry analysis requires a periodic structure with a lattice`)
  }
  const moyo_input_cell = build_moyo_input_cell(struct_or_mol)
  const cell_json = JSON.stringify(
    build_moyo_cell(
      struct_or_mol,
      moyo_input_cell.positions as Vec3[],
      moyo_input_cell.numbers,
    ) satisfies MoyoCell,
  )
  const { symprec, algo } = { ...default_sym_settings, ...settings }
  // Map "Moyo" to "Standard" for moyo-wasm
  const moyo_algo = algo === `Moyo` ? `Standard` : algo
  const sym_data = analyze_cell(cell_json, symprec, moyo_algo)
  const orig_site_indices_by_std_idx = map_std_to_orig_site_indices(
    sym_data.std_cell.positions as Vec3[],
    sym_data.std_cell.numbers,
    moyo_input_cell.positions as Vec3[],
    moyo_input_cell.numbers,
    moyo_input_cell.orig_site_indices_by_input_idx,
    { std_linear: sym_data.std_linear, std_origin_shift: sym_data.std_origin_shift },
    Math.max(1e-5, symprec * 10),
  )
  return {
    ...sym_data,
    orig_site_indices_by_std_idx,
    input_cell: {
      positions: moyo_input_cell.positions,
      numbers: moyo_input_cell.numbers,
    },
    orig_site_indices_by_input_idx: moyo_input_cell.orig_site_indices_by_input_idx,
  }
}

// Helper function to score coordinate simplicity for Wyckoff table
export function simplicity_score(vec: number[]): number {
  const [ax, ay, az] = vec?.map(to_unit) ?? []
  return (
    near_zero(ax) +
    near_zero(ay) +
    near_zero(az) +
    0.5 * (near_half(ax) + near_half(ay) + near_half(az))
  )
}

// Pick the representative coordinate with the lowest simplicity score (ties keep first)
const simplest_position = (positions: Vec3[]): Vec3 =>
  positions.reduce((best, pos) =>
    simplicity_score(pos) < simplicity_score(best) ? pos : best,
  )

// Build Wyckoff rows from moyo's input-cell orbits. moyo's per-site arrays (wyckoffs,
// orbits, site_symmetry_symbols) are indexed by INPUT cell sites — NOT std_cell sites —
// so rows must be derived by grouping input sites into crystallographic orbits.
// Multiplicity in the conventional cell is the orbit size scaled by the std/input cell
// size ratio (e.g. a 1-atom primitive FCC input has orbit size 1 but multiplicity 4).
function wyckoff_rows_from_input_orbits(sym_data: SymmetryDataset): WyckoffPos[] | null {
  const {
    input_cell,
    orbits,
    wyckoffs,
    site_symmetry_symbols,
    std_cell,
    orig_site_indices_by_input_idx,
  } = sym_data
  const n_input = input_cell?.positions.length ?? 0
  if (!input_cell || n_input === 0) return null
  if (orbits?.length !== n_input || wyckoffs?.length !== n_input) return null
  const mapper = make_frac_coord_mapper(sym_data.std_linear, sym_data.std_origin_shift)
  if (!mapper) return null

  // Group input-cell sites by crystallographic orbit (keyed by orbit representative).
  // Distinct orbits sharing the same Wyckoff letter and element stay separate rows.
  const orbit_members = new Map<number, number[]>()
  orbits.forEach((rep, idx) => {
    const members = orbit_members.get(rep) ?? []
    members.push(idx)
    orbit_members.set(rep, members)
  })

  const n_std = std_cell?.positions.length ?? n_input
  return [...orbit_members.entries()].map(([rep, members]) => {
    const letter = /[a-z]+$/.exec(wyckoffs[rep] ?? ``)?.[0] ?? ``
    const elem = ATOMIC_NUMBER_TO_SYMBOL[input_cell.numbers[rep]] ?? `?`
    const multiplicity = Math.round((members.length * n_std) / n_input)

    // Representative coordinate in the standardized frame, simplest first
    const best_pos = simplest_position(
      members.map((idx) => wrap_frac(mapper.to_std(input_cell.positions[idx] as Vec3))),
    )

    const orig_site_indices = members.flatMap(
      (idx) => orig_site_indices_by_input_idx?.[idx] ?? [idx],
    )
    const site_symmetry = site_symmetry_symbols?.[rep]
    return {
      wyckoff: letter ? `${multiplicity}${letter}` : `${multiplicity}`,
      elem,
      abc: best_pos,
      site_indices: [...new Set(orig_site_indices)].sort((idx_a, idx_b) => idx_a - idx_b),
      ...(site_symmetry ? { site_symmetry } : {}),
    }
  })
}

const sort_wyckoff_rows = (rows: WyckoffPos[]): WyckoffPos[] => {
  rows.sort((w1, w2) => {
    const [w1_mult, w2_mult] = [parseInt(w1.wyckoff, 10), parseInt(w2.wyckoff, 10)]
    if (w1_mult !== w2_mult) return w1_mult - w2_mult
    return w1.wyckoff.localeCompare(w2.wyckoff)
  })
  return rows
}

// Generate Wyckoff table rows from symmetry data
export function wyckoff_positions_from_moyo(sym_data: SymmetryDataset | null): WyckoffPos[] {
  if (!sym_data) return []

  // Preferred path: group input-cell sites by orbit (correct for any input cell setting)
  const orbit_rows = wyckoff_rows_from_input_orbits(sym_data)
  if (orbit_rows) return sort_wyckoff_rows(orbit_rows)

  // Legacy fallback for datasets without input-cell info: assumes wyckoffs is aligned
  // with std_cell site order (only valid when the input cell matches the std cell)
  const { positions, numbers } = sym_data.std_cell
  const { wyckoffs, orig_indices, orig_site_indices_by_std_idx } = sym_data

  // Group sites by letter-element combination and track all indices
  const groups = new Map<
    string,
    {
      letter: string
      elem: string
      indices: number[]
      positions: Vec3[]
    }
  >()

  // Process all atoms in the standardized cell. Note: moyo's wyckoffs array indexes the
  // INPUT cell, so it may be shorter than std_cell (e.g. primitive input, conventional
  // std_cell) — that's why the orbit-based path above is preferred whenever possible.
  for (let idx = 0; idx < numbers.length; idx++) {
    // Use wyckoff letter if available, otherwise mark as non-symmetric
    const full = idx < wyckoffs.length ? wyckoffs[idx] : null
    const letter = full?.match(/[a-z]+$/)?.[0] ?? full ?? ``
    const atomic_num = numbers[idx]
    const elem = ATOMIC_NUMBER_TO_SYMBOL[atomic_num] ?? `?`
    const position = positions[idx]

    const key = letter ? `${letter}|${elem}` : `nosym|${elem}|${idx}`
    const group = groups.get(key) ?? { letter, elem, indices: [], positions: [] }
    group.indices.push(idx)
    group.positions.push(position)
    groups.set(key, group)
  }

  const rows = Array.from(groups.values()).map(
    ({ letter, elem, indices, positions: group_positions }) => {
      const best_pos = simplest_position(group_positions)

      // Map standardized cell indices back to original structure indices
      const orig_site_indices = orig_site_indices_by_std_idx
        ? indices.flatMap((std_idx) => orig_site_indices_by_std_idx[std_idx] ?? [])
        : orig_indices
          ? indices.map((std_idx) => orig_indices[std_idx]).filter((idx) => idx !== undefined)
          : indices

      const wyckoff = letter ? `${indices.length}${letter}` : `1`
      return {
        wyckoff,
        elem,
        abc: best_pos,
        site_indices: [...new Set(orig_site_indices)].sort((idx_a, idx_b) => idx_a - idx_b),
      }
    },
  )

  return sort_wyckoff_rows(rows)
}

// Apply symmetry operations to find all equivalent positions for a given fractional coordinate
export function apply_symmetry_operations(
  position: Vec3,
  operations: MoyoDataset[`operations`],
  _tolerance = 1e-6,
): Vec3[] {
  const seen = new Set<string>()

  return operations
    .map(({ rotation, translation }) => {
      // new_pos = W·position + t; moyo serializes W COLUMN-major: W[dim][j] = rotation[dim + 3j]
      const new_pos: Vec3 = [0, 1, 2].map(
        (dim) =>
          rotation[dim] * position[0] +
          rotation[dim + 3] * position[1] +
          rotation[dim + 6] * position[2] +
          translation[dim],
      ) as Vec3
      return new_pos.map(to_unit) as Vec3
    })
    .filter((pos) => {
      const pos_key = symmetry_position_key(pos)
      if (seen.has(pos_key)) return false
      seen.add(pos_key)
      return true
    })
}

// A candidate coordinate frame the displayed structure may derive from
type DisplayFrame = {
  // Lattice (rows = basis vectors) of the frame's cell
  lattice: Matrix3x3
  // Map a position from the ORIGINAL (input) frame into this frame's fractional coords
  map_equiv: (pos: Vec3) => Vec3
  // Linear part P of the input→frame transformation: a fractional difference d in this
  // frame is an input-lattice translation iff P·d ∈ ℤ³ (null means frame == input frame)
  input_translation_check: Matrix3x3 | null
}

// Build candidate frames for the displayed structure: original, conventional (moyo
// std_cell), and primitive (moyo prim_std_cell). The displayed structure's fractional
// coordinates only match symmetry-equivalent positions when expressed in the same frame.
function candidate_display_frames(
  orig_structure: Crystal,
  sym_data: MoyoDataset,
): DisplayFrame[] {
  const frames: DisplayFrame[] = [
    {
      lattice: orig_structure.lattice.matrix,
      map_equiv: (pos) => pos,
      input_translation_check: null,
    },
  ]
  const cells = [
    { cell: sym_data.std_cell, linear: sym_data.std_linear, shift: sym_data.std_origin_shift },
    {
      cell: sym_data.prim_std_cell,
      linear: sym_data.prim_std_linear,
      shift: sym_data.prim_std_origin_shift,
    },
  ]
  for (const { cell, linear, shift } of cells) {
    const basis = cell?.lattice?.basis
    const mapper = make_frac_coord_mapper(linear, shift)
    if (basis?.length !== 9 || !mapper) continue
    frames.push({
      lattice: [
        [basis[0], basis[1], basis[2]],
        [basis[3], basis[4], basis[5]],
        [basis[6], basis[7], basis[8]],
      ],
      map_equiv: mapper.to_std,
      input_translation_check: mapper.linear,
    })
  }
  return frames
}

// Spatial hash over wrapped fractional coordinates for tolerance-based, mod-1 position
// lookups. Cell size is chosen ≥ tolerance so probing the ±1 neighbor cells (with
// wraparound) covers every point within tolerance of the query.
class WrappedPositionIndex {
  private readonly buckets = new Map<string, number[]>()
  private readonly coords: Vec3[]
  private readonly n_cells: number

  constructor(
    positions: Vec3[],
    private readonly tolerance: number,
  ) {
    this.n_cells = Math.min(64, Math.max(1, Math.floor(1 / Math.max(tolerance, 1e-9))))
    this.coords = positions
    positions.forEach((pos, idx) => {
      const key = this.cell_key(pos, 0, 0, 0)
      const bucket = this.buckets.get(key)
      if (bucket) bucket.push(idx)
      else this.buckets.set(key, [idx])
    })
  }

  private cell_key(pos: Vec3, dx: number, dy: number, dz: number): string {
    const n = this.n_cells
    const cell = (coord: number, offset: number) => {
      const wrapped = coord - Math.floor(coord)
      return (((Math.floor(wrapped * n) + offset) % n) + n) % n
    }
    return `${cell(pos[0], dx)},${cell(pos[1], dy)},${cell(pos[2], dz)}`
  }

  // Indices of stored positions within `tolerance` of `query` modulo ℤ³
  query(query: Vec3, out: Set<number>): void {
    const tol = this.tolerance
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.buckets.get(this.cell_key(query, dx, dy, dz))
          if (!bucket) continue
          for (const idx of bucket) {
            const pos = this.coords[idx]
            const d0 = pos[0] - query[0]
            const d1 = pos[1] - query[1]
            const d2 = pos[2] - query[2]
            if (
              Math.abs(d0 - Math.round(d0)) < tol &&
              Math.abs(d1 - Math.round(d1)) < tol &&
              Math.abs(d2 - Math.round(d2)) < tol
            )
              out.add(idx)
          }
        }
      }
    }
  }
}

// Map Wyckoff positions to all equivalent atoms in the displayed structure (including
// image atoms). Handles displayed structures in the original frame as well as
// conventional/primitive cell transforms and integer supercells of any of those: the
// displayed lattice L_disp is matched against each candidate frame's lattice L_F via
// S = L_disp·L_F⁻¹ (S must be near-integer), displayed coords are converted into the
// frame via x_F = x_disp·S, and matches allow crystal translations of both the frame
// lattice (d ∈ ℤ³) and the input lattice (P·d ∈ ℤ³). Matching uses spatial hashing:
// O(N_disp + N_orig·N_ops) instead of O(N_orig·N_disp·N_ops).
export function map_wyckoff_to_all_atoms(
  wyckoff_positions: WyckoffPos[],
  displayed_structure: Crystal,
  orig_structure: Crystal,
  sym_data: MoyoDataset | null,
  tolerance = 1e-5,
): WyckoffPos[] {
  if (!sym_data?.operations || !displayed_structure.sites || !orig_structure.sites) {
    return wyckoff_positions
  }

  const map_in_frame = (frame: DisplayFrame): WyckoffPos[] | null => {
    // Supercell factor S = L_disp·L_F⁻¹ must be a near-integer matrix with |det| ≥ 1
    let scaling: Matrix3x3
    try {
      scaling = math.dot(
        displayed_structure.lattice.matrix,
        math.matrix_inverse_3x3(frame.lattice),
      ) as Matrix3x3
    } catch {
      return null
    }
    const is_integer_scaling = scaling.every((row) =>
      row.every((val) => Math.abs(val - Math.round(val)) < tolerance),
    )
    if (!is_integer_scaling || Math.abs(math.det_3x3(scaling)) < 0.99) return null

    // Displayed site coords expressed in frame-F fractional coordinates: x_F = x_disp·S
    const scaling_transpose = math.transpose_3x3_matrix(scaling)
    const displayed_frame_coords = displayed_structure.sites.map((site) =>
      math.mat3x3_vec3_multiply(scaling_transpose, site.abc),
    )
    const displayed_elements = displayed_structure.sites.map(
      (site) => site.species[0]?.element,
    )

    // Spatial hashes: one over the frame coords directly (matches d ∈ ℤ³), and one over
    // P·x_F (matches input-lattice translations: d ∈ P⁻¹ℤ³ ⟺ P·d ∈ ℤ³)
    const direct_index = new WrappedPositionIndex(displayed_frame_coords, tolerance)
    const check = frame.input_translation_check
    const check_index = check
      ? new WrappedPositionIndex(
          displayed_frame_coords.map((pos) => math.mat3x3_vec3_multiply(check, pos)),
          tolerance,
        )
      : null

    let any_matched = false
    const rows = wyckoff_positions.map((wyckoff_pos) => {
      // Union the symmetry orbits of all original sites in this row, grouped by element.
      // Sites whose (wrapped) position already appears in the accumulated orbit are
      // skipped — orbit members generate identical orbits, so rows with many sites of
      // one orbit (e.g. supercells) only pay for one full operation sweep
      const equiv_by_element = new Map<string | undefined, Map<string, Vec3>>()
      for (const orig_idx of wyckoff_pos.site_indices ?? []) {
        if (orig_idx >= orig_structure.sites.length) continue
        const { abc: orig_abc, species } = orig_structure.sites[orig_idx]
        const element = species[0]?.element
        const equivalents = equiv_by_element.get(element) ?? new Map<string, Vec3>()
        equiv_by_element.set(element, equivalents)
        const member_key = symmetry_position_key(
          frame.map_equiv(orig_abc.map(to_unit) as Vec3),
        )
        if (equivalents.has(member_key)) continue
        for (const equiv_pos of apply_symmetry_operations(orig_abc, sym_data.operations)) {
          const frame_pos = frame.map_equiv(equiv_pos)
          const key = symmetry_position_key(frame_pos)
          if (!equivalents.has(key)) equivalents.set(key, frame_pos)
        }
      }

      const matched = new Set<number>()
      for (const [element, equivalents] of equiv_by_element) {
        const candidates = new Set<number>()
        for (const equiv_pos of equivalents.values()) {
          direct_index.query(equiv_pos, candidates)
          if (check && check_index) {
            check_index.query(math.mat3x3_vec3_multiply(check, equiv_pos), candidates)
          }
        }
        for (const display_idx of candidates) {
          if (displayed_elements[display_idx] === element) matched.add(display_idx)
        }
      }

      if (matched.size > 0) any_matched = true
      return { ...wyckoff_pos, site_indices: [...matched].sort((a, b) => a - b) }
    })
    return any_matched || displayed_structure.sites.length === 0 ? rows : null
  }

  // Try frames in order; accept the first whose lattice fits AND that matches any site
  // (lattices can coincide across frames while origins differ, so a lattice match alone
  // is not conclusive)
  for (const frame of candidate_display_frames(orig_structure, sym_data)) {
    const rows = map_in_frame(frame)
    if (rows) return rows
  }
  // No frame fits — site indices into the displayed structure cannot be determined
  return wyckoff_positions.map((pos) => ({ ...pos, site_indices: [] }))
}

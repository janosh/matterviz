// Wyckoff rows of an analyzed structure: grouping moyo's input-cell orbits into table rows,
// joining them against moyo's space-group database (ITA representative coordinates, site
// symmetry) and mapping rows onto the sites of a displayed (transformed/supercell) structure.
import { element_from_atomic_number } from '$lib/element/helpers'
import { superscript_digits } from '$lib/labels'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal } from '$lib/structure'
import { wrap_frac_coord, wrap_to_unit_cell } from '$lib/structure/pbc'
import type { MoyoDataset, MoyoWyckoffPosition } from '@spglib/moyo-wasm'
import type { SymmetryDataset } from './analyze'
import { mat3_from_flat_col_major } from './symmetry-elements'

export type WyckoffPos = {
  wyckoff: string
  elem: string
  abc: Vec3
  site_indices: number[]
  // Site symmetry symbol of the orbit (e.g. "m-3m", "4mm"), when available from moyo
  site_symmetry?: string
  // ITA representative coordinate triplet (e.g. "x,1/4,0") from the space-group
  // Wyckoff database, attached by enrich_wyckoff_rows
  coordinates?: string
}

// Dedup key of a wrapped position at 8 decimals. wrap_to_unit_cell only snaps within 1e-10 of
// 1, so a coordinate just below that rounds up to 1e8 and is folded back onto 0 by the modulo
// to key like its lattice-equivalent partner at 0.
const position_key = (pos: Vec3) =>
  wrap_to_unit_cell(pos)
    .map((coord) => Math.round(coord * 1e8) % 1e8)
    .join(`,`)

// Mapper from input-cell to standardized-cell fractional coordinates. moyo's (std_linear P,
// std_origin_shift p) follow the ITA convention for the transformation from the input cell
// to the standardized cell: x_std = P⁻¹ (x_input − p). Null when P is absent (a dataset
// without standardization); a singular P is a moyo bug and throws from matrix_inverse_3x3.
function frac_coord_mapper(
  linear_flat: readonly number[] | undefined,
  origin_shift: readonly number[] | undefined,
): { to_std: (pos: Vec3) => Vec3; linear: Matrix3x3 } | null {
  if (linear_flat?.length !== 9) return null
  const linear = mat3_from_flat_col_major(linear_flat)
  const linear_inv = math.matrix_inverse_3x3(linear)
  const shift = (origin_shift ?? [0, 0, 0]) as Vec3
  const to_std = (pos: Vec3): Vec3 =>
    math.mat3x3_vec3_multiply(linear_inv, math.subtract(pos, shift))
  return { to_std, linear }
}

// Lower is simpler: per coordinate u ∈ [0, 1), the distance to the nearest of 0, 1/2 and 1.
// The previous `min(u, 1 − u) + ½|u − ½|` reduces to ¼ + ½·min(u, 1 − u), which made u = 1/2
// the WORST-scoring value so a generic 0.30 beat a special 0.50.
const simplicity_score = (pos: Vec3): number =>
  pos.reduce((sum, coord) => {
    const unit = wrap_frac_coord(coord)
    return sum + Math.min(unit, Math.abs(unit - 0.5), 1 - unit)
  }, 0)

// moyo echoes back the atomic numbers it was handed, so anything off the table means the two
// disagree about the cell — name it rather than printing a `?` row the user cannot act on
const element_symbol_of = (atomic_number: number): string => {
  const symbol = element_from_atomic_number(atomic_number)
  if (!symbol) {
    throw new Error(`moyo input cell has atomic number ${atomic_number}, not a known element`)
  }
  return symbol
}

// Wyckoff letter from a `4a`-style multiplicity+letter label. Uppercase `A` is moyo's
// encoding of ITA's 27th letter alpha (general position of Pmmm-like groups).
export const wyckoff_letter = (wyckoff: string): string =>
  /[a-zA-Z]+$/.exec(wyckoff)?.[0] ?? ``

// Numeric multiplicity prefix of a Wyckoff label like `4a`; rows built here always carry one
const wyckoff_multiplicity = (label: string): number => Number(/^\d+/.exec(label)?.[0])

// Wyckoff table rows from moyo's input-cell orbits. moyo's per-site arrays (wyckoffs, orbits,
// site_symmetry_symbols) index the INPUT cell — not std_cell — so rows are built by grouping
// input sites into crystallographic orbits. Multiplicity in the conventional cell is the orbit
// size scaled by the std/input cell size ratio (a 1-atom primitive fcc input has orbit size 1
// but multiplicity 4). Rows sort by ascending multiplicity, then Wyckoff label. Returns []
// without symmetry data, for a plain MoyoDataset that never went through analyze_structure
// (no input_cell; this runs inside $derived, so it must not throw), without a
// standardization (no std_linear) or when the per-site arrays do not match the input cell.
export function wyckoff_positions_from_moyo(
  sym_data: SymmetryDataset | MoyoDataset | null,
): WyckoffPos[] {
  if (!sym_data || !(`input_cell` in sym_data)) return []
  const {
    input_cell,
    orig_site_indices_by_input_idx,
    orbits,
    wyckoffs,
    site_symmetry_symbols,
    std_cell,
  } = sym_data
  const n_input = input_cell.positions.length
  if (n_input === 0 || orbits?.length !== n_input || wyckoffs?.length !== n_input) return []
  const mapper = frac_coord_mapper(sym_data.std_linear, sym_data.std_origin_shift)
  if (!mapper) return []

  // Group input-cell sites by orbit representative; distinct orbits sharing a Wyckoff letter
  // and element stay separate rows
  const orbit_members = new Map<number, number[]>()
  orbits.forEach((rep, idx) => {
    const members = orbit_members.get(rep) ?? []
    members.push(idx)
    orbit_members.set(rep, members)
  })

  const n_std = std_cell?.positions.length ?? n_input
  const rows = [...orbit_members.entries()].map(([rep, members]) => {
    const letter = wyckoff_letter(wyckoffs[rep] ?? ``)
    const multiplicity = Math.round((members.length * n_std) / n_input)
    // Representative coordinate in the standardized frame, simplest first. Symmetry-equivalent
    // members (x,y,z vs y,x,z) tie up to float noise, so ties are broken by member order rather
    // than by whichever rounding happened to land lower.
    const abc = members
      .map((idx) => wrap_to_unit_cell(mapper.to_std(input_cell.positions[idx])))
      .reduce((best, pos) =>
        simplicity_score(pos) < simplicity_score(best) - 1e-9 ? pos : best,
      )
    const site_indices = [
      ...new Set(members.flatMap((idx) => orig_site_indices_by_input_idx[idx])),
    ].toSorted((idx_a, idx_b) => idx_a - idx_b)
    const site_symmetry = site_symmetry_symbols?.[rep]
    return {
      wyckoff: `${multiplicity}${letter}`,
      elem: element_symbol_of(input_cell.numbers[rep]),
      abc,
      site_indices,
      ...(site_symmetry ? { site_symmetry } : {}),
    }
  })
  return rows.toSorted(
    (row_1, row_2) =>
      wyckoff_multiplicity(row_1.wyckoff) - wyckoff_multiplicity(row_2.wyckoff) ||
      row_1.wyckoff.localeCompare(row_2.wyckoff),
  )
}

// Attach the space-group database entry (ITA representative coordinates, site-symmetry
// fallback) to each occupied Wyckoff row, matched by letter. Rows whose letter has no
// database entry (or an empty database) pass through unchanged.
export function enrich_wyckoff_rows(
  rows: WyckoffPos[],
  db_positions: MoyoWyckoffPosition[],
): WyckoffPos[] {
  if (db_positions.length === 0) return rows
  const db_by_letter = new Map(db_positions.map((pos) => [pos.letter, pos]))
  return rows.map((row) => {
    const entry = db_by_letter.get(wyckoff_letter(row.wyckoff))
    if (!entry) return row
    const site_symmetry = row.site_symmetry ?? entry.site_symmetry
    return { ...row, coordinates: entry.coordinates, site_symmetry }
  })
}

// Rank `A` (ITA's alpha, the letter AFTER z) above all lowercase letters
const letter_rank = (letter: string): number => letter.charCodeAt(0) + (letter < `a` ? 64 : 0)

// Wyckoff sequence of the occupied orbits: letters in descending alphabetical order
// (general position first, ICSD convention), each with a superscript count when more
// than one orbit occupies that letter — e.g. cubic perovskite (Pm-3m): `c b a`.
export function wyckoff_sequence(rows: WyckoffPos[]): string {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const letter = wyckoff_letter(row.wyckoff)
    if (letter) counts.set(letter, (counts.get(letter) ?? 0) + 1)
  }
  return [...counts.entries()]
    .toSorted(([letter_1], [letter_2]) => letter_rank(letter_2) - letter_rank(letter_1))
    .map(([letter, count]) =>
      count > 1 ? `${letter}${superscript_digits(String(count))}` : letter,
    )
    .join(` `)
}

// Internal degrees of freedom of the structure: free fractional coordinates (distinct x/y/z
// variables in the ITA triplet: `x,y,z` → 3, `1/4,1/4,z` → 1, `x,2x,1/2` → 1) summed over
// occupied Wyckoff orbits. Requires every row to carry ITA coordinates (see
// enrich_wyckoff_rows); returns null for empty rows or when any row lacks coordinates so
// callers can hide the stat instead of showing a wrong number.
export function count_structure_free_params(rows: WyckoffPos[]): number | null {
  if (rows.length === 0) return null
  let total = 0
  for (const row of rows) {
    if (row.coordinates === undefined) return null
    total += new Set(row.coordinates.match(/[xyz]/g)).size
  }
  return total
}

// All distinct symmetry-equivalent positions (mod 1) of a fractional coordinate
export function apply_symmetry_operations(
  position: Vec3,
  operations: MoyoDataset[`operations`],
): Vec3[] {
  const seen = new Set<string>()
  return operations
    .map(({ rotation, translation }) => {
      // new_pos = W·position + t, with W decoded from moyo's COLUMN-major flat 9-array
      const rotated = math.mat3x3_vec3_multiply(mat3_from_flat_col_major(rotation), position)
      return wrap_to_unit_cell(rotated.map((val, dim) => val + translation[dim]) as Vec3)
    })
    .filter((pos) => {
      const pos_key = position_key(pos)
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

// Candidate frames for the displayed structure: original, conventional (moyo std_cell) and
// primitive (moyo prim_std_cell). The displayed structure's fractional coordinates only match
// symmetry-equivalent positions when expressed in the same frame.
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
    const mapper = frac_coord_mapper(linear, shift)
    if (basis?.length !== 9 || !mapper) continue
    // basis is row-major (each row a lattice vector); same reshape as moyo_cell_to_structure
    frames.push({
      lattice: math.vec9_to_mat3x3([...basis]),
      map_equiv: mapper.to_std,
      input_translation_check: mapper.linear,
    })
  }
  return frames
}

// Spatial hash over wrapped fractional coordinates for tolerance-based, mod-1 position
// lookups. Cell size is chosen ≥ tolerance so probing the ±1 neighbor cells (with
// wraparound) covers every point within tolerance of the query. An optional `transform`
// is applied to the stored coordinates and to every query alike.
class WrappedPositionIndex {
  private readonly buckets = new Map<string, number[]>()
  private readonly n_cells: number
  private readonly coords: Vec3[]

  constructor(
    coords: Vec3[],
    private readonly tolerance: number,
    private readonly transform?: (pos: Vec3) => Vec3,
  ) {
    this.coords = transform ? coords.map(transform) : coords
    this.n_cells = math.clamp(Math.floor(1 / Math.max(tolerance, 1e-9)), 1, 64)
    this.coords.forEach((pos, idx) => {
      const key = this.cell_key(pos, 0, 0, 0)
      const bucket = this.buckets.get(key)
      if (bucket) bucket.push(idx)
      else this.buckets.set(key, [idx])
    })
  }

  private cell_key(pos: Vec3, dx: number, dy: number, dz: number): string {
    const n_cells = this.n_cells
    const cell = (coord: number, offset: number) => {
      const wrapped = coord - Math.floor(coord)
      return (((Math.floor(wrapped * n_cells) + offset) % n_cells) + n_cells) % n_cells
    }
    return `${cell(pos[0], dx)},${cell(pos[1], dy)},${cell(pos[2], dz)}`
  }

  // Indices of stored positions within `tolerance` of `query` modulo ℤ³
  query(raw_query: Vec3, out: Set<number>): void {
    const query = this.transform ? this.transform(raw_query) : raw_query
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
  if (!sym_data?.operations) return wyckoff_positions

  const map_in_frame = (frame: DisplayFrame): WyckoffPos[] | null => {
    // Supercell factor S = L_disp·L_F⁻¹ must be a near-integer matrix with |det| ≥ 1. A
    // degenerate frame lattice (zero-volume cell) fits nothing.
    if (Math.abs(math.det_3x3(frame.lattice)) < 1e-12) return null
    const scaling = math.dot(
      displayed_structure.lattice.matrix,
      math.matrix_inverse_3x3(frame.lattice),
    )
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
    const check_index =
      check &&
      new WrappedPositionIndex(displayed_frame_coords, tolerance, (pos) =>
        math.mat3x3_vec3_multiply(check, pos),
      )

    let any_matched = false
    const rows = wyckoff_positions.map((wyckoff_pos) => {
      // Union the symmetry orbits of all original sites in this row, grouped by element.
      // Sites whose (wrapped) position already appears in the accumulated orbit are
      // skipped — orbit members generate identical orbits, so rows with many sites of
      // one orbit (e.g. supercells) only pay for one full operation sweep
      const equiv_by_element = new Map<string | undefined, Map<string, Vec3>>()
      for (const orig_idx of wyckoff_pos.site_indices) {
        if (orig_idx >= orig_structure.sites.length) continue
        const { abc: orig_abc, species } = orig_structure.sites[orig_idx]
        const element = species[0]?.element
        const equivalents = equiv_by_element.get(element) ?? new Map<string, Vec3>()
        equiv_by_element.set(element, equivalents)
        const member_key = position_key(frame.map_equiv(wrap_to_unit_cell(orig_abc)))
        if (equivalents.has(member_key)) continue
        for (const equiv_pos of apply_symmetry_operations(orig_abc, sym_data.operations)) {
          const frame_pos = frame.map_equiv(equiv_pos)
          const key = position_key(frame_pos)
          if (!equivalents.has(key)) equivalents.set(key, frame_pos)
        }
      }

      const matched = new Set<number>()
      for (const [element, equivalents] of equiv_by_element) {
        const candidates = new Set<number>()
        for (const equiv_pos of equivalents.values()) {
          direct_index.query(equiv_pos, candidates)
          check_index?.query(equiv_pos, candidates)
        }
        for (const display_idx of candidates) {
          if (displayed_elements[display_idx] === element) matched.add(display_idx)
        }
      }

      if (matched.size > 0) any_matched = true
      return {
        ...wyckoff_pos,
        site_indices: [...matched].toSorted((idx_a, idx_b) => idx_a - idx_b),
      }
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

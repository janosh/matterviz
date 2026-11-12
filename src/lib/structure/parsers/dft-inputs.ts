// Plain-text DFT inputs that list a cell and atoms in Cartesian or fractional coordinates:
// FHI-aims `geometry.in` and Quantum ESPRESSO `pw.x` input files.
import { BOHR_TO_ANGSTROM } from '#lib/constants.js'
import type { ElementSymbol } from '#lib/element/index.js'
import * as math from '#lib/math.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { wrap_to_unit_cell } from '#lib/structure/pbc.js'
import { make_site } from '#lib/structure/site.js'
import {
  element_from_candidates,
  leading_letters,
  matrix3x3_from_rows,
  parse_element_symbol,
  parse_float_token,
  parsed_result,
  vec3_from_values,
} from './shared'

// [element, coords, is fractional, movable]: the last holds per-Cartesian-axis relaxation
// flags, unset when free
type ParsedAtom = [ElementSymbol, math.Vec3, boolean, [boolean, boolean, boolean]?]

// Structure from atoms in fractional or Cartesian (Å) coordinates and three `cell` rows (Å),
// or none for a molecule. In a cell, fractional coordinates wrap into [0, 1) and xyz is
// recomputed from them, as in parse_poscar (a cell without volume throws).
function build_structure(atoms: ParsedAtom[], cell: number[][], format: string): AnyStructure {
  if (atoms.length === 0) throw new Error(`${format} has no atoms`)
  const lattice_matrix = cell.length ? matrix3x3_from_rows(cell, `${format} lattice`) : null
  const frac_to_cart = lattice_matrix && math.create_frac_to_cart(lattice_matrix)
  const cart_to_frac = lattice_matrix && math.create_cart_to_frac(lattice_matrix)
  const sites = atoms.map(([element, coords, fractional, movable], idx) => {
    const label = `${element}${idx + 1}`
    // aims and QE constrain Cartesian axes, not POSCAR's lattice vectors: exports convert
    const properties = movable
      ? { selective_dynamics: movable, constraint_basis: `cartesian` }
      : {}
    if (frac_to_cart && cart_to_frac) {
      const abc = wrap_to_unit_cell(fractional ? coords : cart_to_frac(coords))
      return make_site(element, abc, frac_to_cart(abc), label, properties)
    }
    if (fractional) throw new Error(`${format} has fractional atoms but no lattice`)
    return make_site(element, [0, 0, 0], coords, label, properties)
  })
  return parsed_result(sites, [], lattice_matrix)
}

// The first three tokens as numbers (further ones are flags or a species)
const numbers = (tokens: readonly string[], context: string): math.Vec3 =>
  vec3_from_values(tokens.slice(0, 3).map(parse_float_token), context)

// === FHI-aims geometry.in ===
// An `atom`/`atom_frac` row: three numbers and a species. Lowercase only (aims keywords are
// case-sensitive), which keeps PDB `ATOM` out. Horizontal whitespace only, see is_lammps_data_content.
export const is_aims_content = (content: string): boolean =>
  /^[ \t]*atom(?:_frac)?(?:[ \t]+[-+]?\.?\d[\w.+-]*){3}[ \t]+[A-Z]/m.test(content)

// `lattice_vector x y z` rows (Å; three for a crystal, none for a molecule), `atom x y z species`
// (Cartesian Å), `atom_frac a b c species`, `#` comments. Species are element symbols, optionally
// suffixed (`Si_light`). `constrain_relaxation` (`.true.` or an axis `x`/`y`/`z`) fixes the atom
// above it (`.false.` nothing). Other keywords are skipped, except `empty` and `pseudocore`
// sites (no atoms): errors.
export function parse_aims(content: string): AnyStructure {
  const lattice_rows: math.Vec3[] = []
  const atoms: ParsedAtom[] = []
  let last_atom: ParsedAtom | undefined // unset after a lattice_vector, whose constraints are no site's
  for (const [line_idx, line] of content.split(/\r?\n/).entries()) {
    const [keyword, ...args] = line.split(`#`)[0].trim().split(/\s+/)
    const where = `geometry.in line ${line_idx + 1}`
    if (keyword === `lattice_vector`) {
      lattice_rows.push(numbers(args, where))
      last_atom = undefined
    } else if (keyword === `atom` || keyword === `atom_frac`) {
      const element = parse_element_symbol(args[3] ?? ``, where)
      last_atom = [element, numbers(args, where), keyword === `atom_frac`]
      atoms.push(last_atom)
    } else if (keyword === `constrain_relaxation` && last_atom) {
      const fixed = args[0]?.toLowerCase() ?? ``
      if (![`.true.`, `.false.`, `x`, `y`, `z`].includes(fixed))
        throw new Error(
          `${where}: constrain_relaxation takes .true., .false., x, y or z, not '${fixed}'`,
        )
      const free = last_atom[3] ?? [true, true, true]
      const still_free = (axis: string, idx: number): boolean =>
        free[idx] && fixed !== axis && fixed !== `.true.`
      if (fixed !== `.false.`)
        last_atom[3] = [still_free(`x`, 0), still_free(`y`, 1), still_free(`z`, 2)]
    } else if (keyword === `empty` || keyword === `pseudocore`)
      throw new Error(`${where}: unsupported keyword '${keyword}'`)
  }
  return build_structure(atoms, lattice_rows, `geometry.in`)
}

// === Quantum ESPRESSO pw.x input ===
export const is_qe_content = (content: string): boolean =>
  /^[ \t]*&system\b/im.test(content) && /^[ \t]*ATOMIC_POSITIONS\b/im.test(content)

// Lattice rows in units of alat per ibrav (INPUT_PW's `ibrav` table); rows 2 and 3 of the
// cells with free b/a (8) and c/a (4, 6, 8) are scaled by those ratios
// oxfmt-ignore
const QE_BRAVAIS: Record<number, math.Matrix3x3> = {
  1: math.IDENTITY_3X3, 6: math.IDENTITY_3X3, 8: math.IDENTITY_3X3, // simple cubic, tetragonal, orthorhombic
  2: [[-0.5, 0, 0.5], [0, 0.5, 0.5], [-0.5, 0.5, 0]], // fcc
  3: [[0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, -0.5, 0.5]], // bcc
  4: [[1, 0, 0], [-0.5, Math.sqrt(3) / 2, 0], [0, 0, 1]], // hexagonal
}

// A card's lowercased unit option (`{alat}`, `(alat)` or `alat`) and its `n_rows` rows of tokens
function qe_card(lines: readonly string[], name: string, n_rows: number) {
  const header_idx = lines.findIndex((line) => line.toUpperCase().startsWith(name))
  const rows = lines.slice(header_idx + 1, header_idx + 1 + n_rows)
  if (header_idx === -1 || rows.length !== n_rows)
    throw new Error(`pw.x ${name} card needs ${n_rows} rows`)
  const unit = lines[header_idx].slice(name.length).replaceAll(/[{}()\s]/g, ``)
  return { unit: unit.toLowerCase(), rows: rows.map((row) => row.split(/\s+/)) }
}

// The cell from &SYSTEM (`ibrav` in QE_BRAVAIS with `celldm(i)` in Bohr or `A`, `B`, `C` in Å) or,
// for ibrav = 0, from `CELL_PARAMETERS {alat|bohr|angstrom}`; `nat` atoms from `ATOMIC_POSITIONS
// {alat|bohr|angstrom|crystal}`, labelled by an element symbol plus an optional tag (`Fe1`,
// `O_h`). Card units must be written out (pw.x's implicit ones are deprecated).
export function parse_qe(content: string): AnyStructure {
  // `!` and `#` start comments, blank lines carry nothing, &SYSTEM runs to the next `/`
  const text = content.replaceAll(/[!#].*/g, ``)
  const lines = text.trim().split(/\s*\n\s*/)
  const namelist = text.split(/&system\b/i)[1]?.split(`/`)[0]
  if (namelist === undefined) throw new Error(`pw.x input has no &SYSTEM namelist`)
  // numeric `key = value` pairs, keys lowercased without blanks (`celldm(1)`, `a`)
  const system = new Map<string, number>()
  for (const [pair] of namelist.matchAll(/[a-z_]\w*(?:\(\s*\d+\s*\))?\s*=\s*[^,\s]+/gi)) {
    const [key, value] = pair.replaceAll(/\s/g, ``).split(`=`)
    system.set(key.toLowerCase(), parse_float_token(value))
  }
  const required = (key: string): number => {
    const value = system.get(key) ?? NaN
    if (Number.isFinite(value)) return value
    throw new Error(`pw.x &SYSTEM needs a numeric ${key}`)
  }
  // alat (Å): celldm(1) in Bohr or A in Å, else the first vector of a cell in Bohr or Å
  const celldm_1 = system.get(`celldm(1)`)
  if (celldm_1 !== undefined && system.has(`a`))
    throw new Error(`pw.x input sets both celldm(1) and A; the lattice parameter is ambiguous`)
  let alat = celldm_1 === undefined ? system.get(`a`) : celldm_1 * BOHR_TO_ANGSTROM
  const unit_scale = (unit: string, card: string): number => {
    if (unit === `angstrom`) return 1
    if (unit === `bohr`) return BOHR_TO_ANGSTROM
    if (unit === `alat` && alat !== undefined && alat > 0) return alat
    throw new Error(`pw.x ${card} unit '${unit}' is not angstrom, bohr or a defined alat`)
  }
  const ibrav = required(`ibrav`)
  const bravais = QE_BRAVAIS[ibrav]
  if (ibrav !== 0 && !bravais)
    throw new Error(`pw.x ibrav = ${ibrav} is unsupported, use ibrav = 0 and CELL_PARAMETERS`)
  let lattice_rows: number[][]
  if (bravais) {
    const length_a = unit_scale(`alat`, `ibrav = ${ibrav}`)
    // b and c (Å): celldm(2) and celldm(3) are b/a and c/a; B and C are lengths in Å
    const length = (celldm_idx: number, key: string): number =>
      celldm_1 === undefined ? required(key) : length_a * required(`celldm(${celldm_idx})`)
    const length_b = ibrav === 8 ? length(2, `b`) : length_a
    const length_c = ibrav > 3 ? length(3, `c`) : length_a
    lattice_rows = math.scale_lattice_matrix(bravais, [length_a, length_b, length_c])
  } else {
    const cell = qe_card(lines, `CELL_PARAMETERS`, 3)
    const scale = unit_scale(cell.unit, `CELL_PARAMETERS`)
    lattice_rows = cell.rows.map((row) => row.map((token) => parse_float_token(token) * scale))
    alat ??= Math.hypot(...lattice_rows[0])
  }
  const positions = qe_card(lines, `ATOMIC_POSITIONS`, required(`nat`))
  const fractional = positions.unit === `crystal`
  const scale = fractional ? 1 : unit_scale(positions.unit, `ATOMIC_POSITIONS`)
  // optional trailing if_pos flags: 0 fixes that coordinate
  const atoms = positions.rows.map(([label, ...coords], idx): ParsedAtom => {
    const where = `pw.x ATOMIC_POSITIONS row ${idx + 1}`
    const if_pos = coords.slice(3)
    if (![0, 3].includes(if_pos.length) || if_pos.some((flag) => !/^[01]$/.test(flag)))
      throw new Error(
        `${where}: expected 3 coordinates and no or 3 if_pos flags (0 or 1), got '${coords.join(` `)}'`,
      )
    const [free_x, free_y, free_z] = if_pos.map((flag) => flag === `1`)
    return [
      element_from_candidates([leading_letters(label)], idx),
      math.scale(numbers(coords, where), scale),
      fractional,
      if_pos.length ? [free_x, free_y, free_z] : undefined,
    ]
  })
  return build_structure(atoms, lattice_rows, `pw.x input`)
}

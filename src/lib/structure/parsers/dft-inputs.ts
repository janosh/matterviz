// Plain-text DFT inputs that list a cell and atoms in Cartesian or fractional coordinates:
// FHI-aims `geometry.in` and Quantum ESPRESSO `pw.x` input files.
import { BOHR_TO_ANGSTROM } from '#lib/constants.js'
import type { ElementSymbol } from '#lib/element/index.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { AnyStructure, Crystal, Site } from '#lib/structure/index.js'
import { wrap_to_unit_cell } from '#lib/structure/pbc.js'
import { make_site } from '#lib/structure/site.js'
import {
  element_from_candidates,
  leading_letters,
  make_lattice,
  parse_element_symbol,
  parse_float_token,
  vec3_from_values,
} from './shared'

type ParsedAtom = { element: ElementSymbol; coords: Vec3; fractional: boolean }

// Crystal from atoms given in fractional or Cartesian (Å) coordinates. Fractional
// coordinates wrap into [0, 1) and xyz is recomputed from them, as in parse_poscar. A cell
// without volume has no fractional frame and is an error.
function periodic_structure(
  atoms: readonly ParsedAtom[],
  lattice_matrix: Matrix3x3,
  format: string,
): Crystal {
  if (!(Math.abs(math.det_3x3(lattice_matrix)) > math.EPS))
    throw new Error(`${format}: lattice ${JSON.stringify(lattice_matrix)} has no volume`)
  const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
  const cart_to_frac = math.create_cart_to_frac(lattice_matrix)
  const sites = atoms.map(({ element, coords, fractional }, idx) => {
    const abc = wrap_to_unit_cell(fractional ? coords : cart_to_frac(coords))
    return make_site(element, abc, frac_to_cart(abc), `${element}${idx + 1}`)
  })
  return { sites, lattice: make_lattice(lattice_matrix) }
}

const numbers = (tokens: readonly string[], context: string): Vec3 =>
  vec3_from_values(tokens.map(parse_float_token), context)

// === FHI-aims geometry.in ===

// Keywords that leave the geometry as written: per-atom settings of the preceding atom
// (moments, charges, constraints, velocities) and run settings
// oxfmt-ignore
const AIMS_SKIPPED_KEYWORDS = new Set([
  `initial_moment`, `initial_charge`, `constrain_relaxation`, `constraint_region`, `velocity`,
  `magnetic_response`, `magnetic_moment`, `nuclear_constant`, `isotope`, `calculate_friction`,
  `symmetry_n_params`, `symmetry_params`, `symmetry_lv`, `symmetry_frac`, `trust_radius`,
  `hessian_block`, `hessian_block_lv`, `hessian_block_lv_atom`, `hessian_file`,
  `verbatim_writeout`, `homogeneous_field`, `multipole`, `esp_constraint`, `set_vacuum_level`,
])

// An `atom`/`atom_frac` row: three numbers and a species. Lowercase only (aims keywords are
// case-sensitive), which also keeps PDB `ATOM` records out. Horizontal whitespace only, see
// is_lammps_data_content.
export const is_aims_content = (content: string): boolean =>
  /^[ \t]*atom(?:_frac)?(?:[ \t]+[-+]?\.?\d[\w.+-]*){3}[ \t]+[A-Z]/m.test(content)

export const aims_has_lattice = (content: string): boolean =>
  /^[ \t]*lattice_vector[ \t]/m.test(content)

// FHI-aims geometry.in: `lattice_vector x y z` rows (Å; three for a crystal, none for a
// molecule), `atom x y z species` (Cartesian Å) and `atom_frac a b c species` (fractional),
// `#` comments. Species are element symbols, optionally suffixed (`Si_light`). Sites that
// are no atoms (`empty`, `pseudocore`) and unknown keywords are errors.
export function parse_aims(content: string): AnyStructure {
  const lattice_rows: Vec3[] = []
  const atoms: ParsedAtom[] = []
  for (const [line_idx, raw_line] of content.split(/\r?\n/).entries()) {
    const [keyword, ...args] = raw_line.split(`#`)[0].trim().split(/\s+/)
    if (!keyword || AIMS_SKIPPED_KEYWORDS.has(keyword)) continue
    const where = `geometry.in line ${line_idx + 1}`
    if (keyword === `lattice_vector`)
      lattice_rows.push(numbers(args, `${where} lattice_vector`))
    else if (keyword === `atom` || keyword === `atom_frac`) {
      if (args.length !== 4)
        throw new Error(
          `${where}: expected '${keyword} x y z species', got '${raw_line.trim()}'`,
        )
      atoms.push({
        element: parse_element_symbol(args[3], where),
        coords: numbers(args.slice(0, 3), `${where} ${keyword}`),
        fractional: keyword === `atom_frac`,
      })
    } else throw new Error(`${where}: unsupported keyword '${keyword}'`)
  }
  if (atoms.length === 0) throw new Error(`geometry.in has no atom or atom_frac rows`)
  if (lattice_rows.length === 3) {
    const [vec_a, vec_b, vec_c] = lattice_rows
    return periodic_structure(atoms, [vec_a, vec_b, vec_c], `geometry.in`)
  }
  if (lattice_rows.length > 0)
    throw new Error(
      `geometry.in has ${lattice_rows.length} lattice_vector rows, expected 0 (molecule) or 3`,
    )
  const sites = atoms.map(({ element, coords, fractional }, idx): Site => {
    if (fractional)
      throw new Error(`geometry.in has atom_frac rows but no lattice_vector rows`)
    return make_site(element, [0, 0, 0], coords, `${element}${idx + 1}`)
  })
  return { sites }
}

// === Quantum ESPRESSO pw.x input ===

// Horizontal whitespace only, see is_lammps_data_content
export const is_qe_content = (content: string): boolean =>
  /^[ \t]*&system\b/im.test(content) && /^[ \t]*ATOMIC_POSITIONS\b/im.test(content)

// Lattice rows in units of alat for the Bravais lattices whose axes are fixed by ibrav and
// c/a, b/a alone (pw.x's latgen conventions); `ratio_b` = celldm(2), `ratio_c` = celldm(3)
const QE_BRAVAIS: Record<number, (ratio_b: number, ratio_c: number) => Matrix3x3> = {
  1: () => [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ], // simple cubic
  2: () => [
    [-0.5, 0, 0.5],
    [0, 0.5, 0.5],
    [-0.5, 0.5, 0],
  ], // fcc
  3: () => [
    [0.5, 0.5, 0.5],
    [-0.5, 0.5, 0.5],
    [-0.5, -0.5, 0.5],
  ], // bcc
  4: (_ratio_b, ratio_c) => [
    [1, 0, 0],
    [-0.5, Math.sqrt(3) / 2, 0],
    [0, 0, ratio_c],
  ], // hexagonal
  6: (_ratio_b, ratio_c) => [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, ratio_c],
  ], // simple tetragonal
  8: (ratio_b, ratio_c) => [
    [1, 0, 0],
    [0, ratio_b, 0],
    [0, 0, ratio_c],
  ], // simple orthorhombic
}

// `key = value` pairs of the &SYSTEM namelist (it runs to the next `/`), keys lowercased
// (`celldm(1)`, `a`, `cosab`)
function qe_system_namelist(text: string): Map<string, string> {
  const body = /&system\b(?<body>[^/]*)\//i.exec(text)?.groups?.body
  if (body === undefined) throw new Error(`pw.x input has no complete &SYSTEM namelist`)
  const pairs = body.matchAll(/(?<key>[a-z_]\w*(?:\(\s*\d+\s*\))?)\s*=\s*(?<value>[^,\n]+)/gi)
  return new Map(
    Array.from(pairs, ({ groups }) => [
      (groups?.key ?? ``).toLowerCase().replaceAll(/\s/g, ``),
      (groups?.value ?? ``).trim(),
    ]),
  )
}

// A card's unit option (`{alat}`, `(alat)` or bare `alat`, lowercased) and its first
// `n_rows` data rows as tokens
function qe_card(lines: readonly string[], name: string, n_rows: number) {
  const header_idx = lines.findIndex((line) => line.toUpperCase().startsWith(name))
  if (header_idx === -1) return null
  const unit = lines[header_idx]
    .slice(name.length)
    .replaceAll(/[{}()\s]/g, ``)
    .toLowerCase()
  const rows = lines.slice(header_idx + 1, header_idx + 1 + n_rows)
  if (rows.length < n_rows)
    throw new Error(`pw.x ${name} has ${rows.length} rows, expected ${n_rows}`)
  return { unit, rows: rows.map((row) => row.split(/\s+/)) }
}

// Quantum ESPRESSO pw.x input: the cell from the &SYSTEM namelist (`ibrav` with
// `celldm(i)` in Bohr or `A`, `B`, `C` in Å) or, for ibrav = 0, from
// `CELL_PARAMETERS {alat|bohr|angstrom}`; `nat` atoms from
// `ATOMIC_POSITIONS {alat|bohr|angstrom|crystal}`. Species labels are an element symbol
// plus an optional tag (`Fe1`, `O_h`). alat is celldm(1) or A, else the length of the
// first vector of a cell written in Bohr or Å. Card units must be written out (pw.x's
// implicit ones are deprecated), and of ibrav != 0 only the lattices in QE_BRAVAIS are built.
export function parse_qe(content: string): Crystal {
  // `!` and `#` start comments; blank lines carry nothing
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.split(/[!#]/)[0].trim())
    .filter(Boolean)
  const system = qe_system_namelist(lines.join(`\n`))
  const number_of = (key: string): number | undefined =>
    system.has(key) ? parse_float_token(system.get(key)) : undefined
  const required = (key: string): number => {
    const value = number_of(key)
    if (value === undefined || !Number.isFinite(value))
      throw new Error(`pw.x &SYSTEM needs a numeric ${key}, got '${system.get(key)}'`)
    return value
  }
  const [ibrav, nat] = [required(`ibrav`), required(`nat`)]
  if (!Number.isInteger(nat) || nat < 1)
    throw new Error(`pw.x &SYSTEM nat must be a positive integer, got ${nat}`)

  // alat (Å): celldm(1) in Bohr or A in Å, else (below) the first vector of a cell written
  // in Bohr or Å. Required only where something is in alat units.
  const celldm_1 = number_of(`celldm(1)`)
  if (celldm_1 !== undefined && system.has(`a`))
    throw new Error(`pw.x &SYSTEM sets both celldm(1) and A`)
  let alat = celldm_1 === undefined ? number_of(`a`) : celldm_1 * BOHR_TO_ANGSTROM
  const unit_scale = (unit: string, card: string): number => {
    if (unit === `angstrom`) return 1
    if (unit === `bohr`) return BOHR_TO_ANGSTROM
    if (unit !== `alat`)
      throw new Error(
        `pw.x ${card} needs explicit units alat, bohr or angstrom${card === `ATOMIC_POSITIONS` ? ` or crystal` : ``}, got '${unit}'`,
      )
    if (!(alat !== undefined && alat > 0))
      throw new Error(`pw.x ${card} is in alat units but &SYSTEM sets neither celldm(1) nor A`)
    return alat
  }

  let lattice_matrix: Matrix3x3
  if (ibrav === 0) {
    const cell = qe_card(lines, `CELL_PARAMETERS`, 3)
    if (!cell) throw new Error(`pw.x input with ibrav = 0 has no CELL_PARAMETERS card`)
    // as pw.x: a cell in absolute units leaves no role for a second lattice parameter
    if (cell.unit !== `alat` && alat !== undefined)
      throw new Error(
        `pw.x lattice parameter specified twice: celldm(1) or A in &SYSTEM and CELL_PARAMETERS in '${cell.unit}'`,
      )
    const scale = unit_scale(cell.unit, `CELL_PARAMETERS`)
    const [vec_a, vec_b, vec_c] = cell.rows.map((row, idx) =>
      math.scale(numbers(row, `pw.x CELL_PARAMETERS row ${idx + 1}`), scale),
    )
    lattice_matrix = [vec_a, vec_b, vec_c]
    alat ??= Math.hypot(...vec_a)
  } else {
    const bravais = QE_BRAVAIS[ibrav]
    if (!bravais)
      throw new Error(
        `pw.x ibrav = ${ibrav} is not supported (only ${Object.keys(QE_BRAVAIS).join(`, `)}); ` +
          `write the cell as ibrav = 0 with CELL_PARAMETERS`,
      )
    const scale = unit_scale(`alat`, `ibrav = ${ibrav}`)
    // b/a and c/a: celldm(2), celldm(3), or B/A, C/A when the cell is given in Å
    const ratio = (celldm_key: string, length_key: string): number =>
      celldm_1 === undefined ? required(length_key) / scale : required(celldm_key)
    const rows = bravais(
      ibrav === 8 ? ratio(`celldm(2)`, `b`) : 1,
      [4, 6, 8].includes(ibrav) ? ratio(`celldm(3)`, `c`) : 1,
    )
    const [vec_a, vec_b, vec_c] = rows.map((row) => math.scale(row, scale))
    lattice_matrix = [vec_a, vec_b, vec_c]
  }

  const positions = qe_card(lines, `ATOMIC_POSITIONS`, nat)
  if (!positions) throw new Error(`pw.x input has no ATOMIC_POSITIONS card`)
  const fractional = positions.unit === `crystal`
  const scale = fractional ? 1 : unit_scale(positions.unit, `ATOMIC_POSITIONS`)
  const atoms = positions.rows.map(([label, ...coords], idx): ParsedAtom => {
    const where = `pw.x ATOMIC_POSITIONS row ${idx + 1}`
    return {
      element: element_from_candidates([leading_letters(label)], idx),
      // any further columns are the if_pos relaxation flags
      coords: math.scale(numbers(coords.slice(0, 3), where), scale),
      fractional,
    }
  })
  return periodic_structure(atoms, lattice_matrix, `pw.x input`)
}

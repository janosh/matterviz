// Parsers for LOBSTER bonding analysis output: COHPCAR/COOPCAR/COBICAR.lobster (energy-resolved
// crystal orbital Hamilton/overlap populations and bond indices per atom pair) and
// ICOHPLIST/ICOOPLIST/ICOBILIST.lobster (their integrals up to the Fermi level) and
// DOSCAR.lobster (total and projected DOS), plus the mapping from integrated values onto a
// structure's bonds.
// Layouts follow pymatgen.io.lobster.outputs (Cohpcar, Icohplist, Doscar) and the LOBSTER manual.
import type { Vec3 } from '#lib/math.js'
import type { AnyStructure, BondPair } from '#lib/structure/index.js'
import { bond_at, type BondData } from '#lib/structure/bond-rendering.js'
import { is_structure_file } from '#lib/structure/format-detect.js'
import { parse_structure_file } from '#lib/structure/parse.js'
import { get_orig_site_idx, get_site } from '#lib/structure/site.js'
import type { ElectronicDos } from './types'

// COHP: Hamilton-weighted populations (eV), negative where bonding. COOP: overlap-weighted
// (dimensionless), positive where bonding. COBI: bond index (dimensionless), positive bonding.
export const LOBSTER_KINDS = [`COHP`, `COOP`, `COBI`] as const
export type LobsterKind = (typeof LOBSTER_KINDS)[number]

// `down` only for spin-polarized runs
export type SpinChannels<Value> = { up: Value; down?: Value }

// One atom of a LOBSTER pair such as `Fe8`: atoms are numbered 1-based across the whole
// POSCAR, so `site_idx` (0-based) indexes the structure LOBSTER ran on
export interface LobsterAtom {
  label: string // e.g. `Fe8`, without orbital
  element: string
  site_idx: number
}

// Per energy, in the file's sign convention (see LobsterKind); COHP in eV, else dimensionless.
// Typed arrays: compact, and never deep-proxied when a caller keeps the data in $state.
export interface CohpCurves {
  values: SpinChannels<Float64Array>
  integrated: SpinChannels<Float64Array> // running integral over energy
}

// Orbitals of an orbital-resolved pair, e.g. [`2p_y`, `6s`]
export type OrbitalPair = [string, string]

export interface CohpBond extends CohpCurves {
  // ICOHPLIST's label for the pair: LOBSTER's `No.<n>` counts orbital lines too, so pairs are
  // renumbered 1, 2, ... over pair-total lines only (as pymatgen does)
  label: string
  atoms: [LobsterAtom, LobsterAtom]
  length: number // Å
  // orbital-resolved curves (LOBSTER's `orbitalwise`), empty without; `key` is orbital_key's
  orbitals: (CohpCurves & { key: string; orbitals: OrbitalPair })[]
}

export interface CohpData {
  kind: LobsterKind
  spin_polarized: boolean
  // eV relative to the Fermi level: LOBSTER writes E - E_F, so E_F sits at 0
  energies: Float64Array
  efermi: number // eV, absolute Fermi energy from the COHPCAR header
  average: CohpCurves // LOBSTER's average over all pairs
  bonds: CohpBond[]
}

export interface IcohpEntry {
  label: string // matches CohpBond.label of the same pair
  atoms: [LobsterAtom, LobsterAtom]
  length: number // Å
  // lattice translation of the second atom's image relative to the first (LOBSTER >= 3);
  // null in LOBSTER 2 lists, which have none
  translation: Vec3 | null
  value: SpinChannels<number> // integral up to E_F per spin, file sign convention
  orbitals: { orbitals: OrbitalPair; value: SpinChannels<number> }[] // orbital-resolved rows
}

export interface IcohpList {
  kind: LobsterKind
  spin_polarized: boolean
  entries: IcohpEntry[] // pair totals in file order, their orbital rows in `orbitals`
}

// Bonding is positive after multiplying by this: -COHP, +COOP, +COBI
export const bonding_sign = (kind: LobsterKind): 1 | -1 => (kind === `COHP` ? -1 : 1)

// Bonding-positive integral of a pair over both spins: -ICOHP, ICOOP, ICOBI (a spin-restricted
// run already counts both spins in `up`)
export const bonding_strength = ({ value }: Pick<IcohpEntry, `value`>, kind: LobsterKind) =>
  bonding_sign(kind) * (value.up + (value.down ?? 0))

// Cohp series key of a pair's orbital-resolved curve, e.g. `1:2p_y-6s`
export const orbital_key = (label: string, [orbital_1, orbital_2]: OrbitalPair) =>
  `${label}:${orbital_1}-${orbital_2}`

// Signed name of a plotted quantity: -COHP (eV), COOP, COBI and their integrals, all positive
// where bonding
export const lobster_quantity_label = (kind: LobsterKind, integrated: boolean): string =>
  `${kind === `COHP` ? `−` : ``}${integrated ? `I` : ``}${kind}${kind === `COHP` ? ` (eV)` : ``}`

// What a LOBSTER file name holds: COHPCAR.lobster -> { kind: COHP, list: false },
// ICOOPLIST.lobster.gz -> { kind: COOP, list: true }, null for other files (LCFO and
// multi-center NcICOBILIST files included, whose layouts differ)
export function lobster_file(filename: string): { kind: LobsterKind; list: boolean } | null {
  const name = filename.split(/[\\/]/).pop() ?? filename
  const groups =
    /^(?<prefix>I?)(?<kind>COHP|COOP|COBI)(?<suffix>CAR|LIST)\.lobster(?:\.(?:gz|bz2|xz|zst))?$/i.exec(
      name,
    )?.groups
  if (!groups) return null
  const kind = LOBSTER_KINDS.find((candidate) => candidate === groups.kind.toUpperCase())
  const list = groups.suffix.toUpperCase() === `LIST`
  // a CAR has no I prefix, a LIST always has one
  return kind && list === Boolean(groups.prefix) ? { kind, list } : null
}

const parse_atom = (text: string, context: string): LobsterAtom => {
  const groups = /^(?<element>[A-Z][a-z]?)(?<number>\d+)$/.exec(text)?.groups
  if (!groups) throw new Error(`Invalid LOBSTER atom "${text}" in ${context}`)
  return { label: text, element: groups.element, site_idx: Number(groups.number) - 1 }
}

const parse_numbers = (tokens: readonly string[], context: string): number[] =>
  tokens.map((token) => {
    const value = Number(token)
    if (!Number.isFinite(value)) throw new TypeError(`Non-numeric "${token}" in ${context}`)
    return value
  })
const tokens_of = (line: string): string[] => line.trim().split(/\s+/)

// Exact divisors for decimals of up to 15 digits (Clinger's fast path: the digits as an integer
// and the power of ten are both exact doubles, so their quotient is correctly rounded)
const POWERS_OF_TEN = Array.from({ length: 16 }, (_, exp) => 10 ** exp)
// Read `n_rows` rows of `n_cols` whitespace-separated numbers from lines[start] on into
// columns[col_idx][row_idx], from char codes without splitting rows into strings (2.7x faster on
// a 22 MB COHPCAR). Tokens off the fast path (exponents, over 15 digits, junk) go through Number.
function read_rows(
  lines: string[],
  start: number,
  n_rows: number,
  n_cols: number,
  name: string,
) {
  const columns = Array.from({ length: n_cols }, () => new Float64Array(n_rows))
  for (let row_idx = 0; row_idx < n_rows; row_idx++) {
    const line = lines[start + row_idx] ?? ``
    const context = `${name} line ${start + row_idx + 1}`
    let pos = 0 // charCodeAt past the end is NaN, which ends every scan
    let col_idx = 0
    while (pos < line.length) {
      if (line.charCodeAt(pos) <= 32) {
        pos++
        continue
      }
      const token_start = pos
      const negative = line.charCodeAt(pos) === 45 // -
      if (negative || line.charCodeAt(pos) === 43) pos++ // +
      let mantissa = 0
      let n_digits = 0
      let n_decimals = -1 // digits after the point, -1 before it
      for (
        let code = line.charCodeAt(pos);
        code === 46 ? n_decimals < 0 : code >= 48 && code <= 57;
      ) {
        if (code === 46) n_decimals = 0
        else {
          mantissa = mantissa * 10 + code - 48
          n_digits++
          if (n_decimals >= 0) n_decimals++
        }
        code = line.charCodeAt(++pos)
      }
      let value = (negative ? -mantissa : mantissa) / POWERS_OF_TEN[Math.max(n_decimals, 0)]
      if (line.charCodeAt(pos) > 32 || n_digits === 0 || n_digits > 15) {
        while (line.charCodeAt(pos) > 32) pos++
        value = parse_numbers([line.slice(token_start, pos)], context)[0]
      }
      if (col_idx < n_cols) columns[col_idx][row_idx] = value
      col_idx++
    }
    if (col_idx !== n_cols)
      throw new Error(`${context}: expected ${n_cols} values, got ${col_idx}`)
  }
  return columns
}

// `No.3:Fe8->Fe7(2.49)`, orbital-resolved `No.3:Fe8[3s]->Fe7[4s](2.49)`
const PAIR_LINE_RE =
  /^No\.\d+:(?<atom_1>[A-Za-z]+\d+)(?:\[(?<orbital_1>[^\]]+)\])?->(?<atom_2>[A-Za-z]+\d+)(?:\[(?<orbital_2>[^\]]+)\])?\((?<length>[^)]+)\)$/

// Parse COHPCAR.lobster, COOPCAR.lobster or COBICAR.lobster (two-center). `kind` names the
// quantity, which the file doesn't state (lobster_file reads it from the name).
// Layout: a title line; `n_columns n_spins n_energies e_min e_max e_fermi` (n_columns counts
// the average); `Average`; one line per pair total or orbital pair; then n_energies rows of
// `energy` followed, per spin, by value and integral of the average and each line's pair.
// Orbital-resolved lines follow their pair's total and go into its `orbitals`.
export function parse_cohpcar(text: string, kind: LobsterKind): CohpData {
  const name = `${kind}CAR`
  const lines = text.split(/\r?\n/)
  while (lines.length > 0 && lines.at(-1)?.trim() === ``) lines.pop()
  if (lines.length < 4) throw new Error(`${name} too short: ${lines.length} lines`)
  const header = parse_numbers(tokens_of(lines[1]), `${name} header`)
  const [n_columns, n_spins, n_energies, , , efermi] = header
  const counts_ok =
    Number.isInteger(n_columns) && n_columns >= 1 && Number.isInteger(n_energies)
  if (header.length < 6 || ![1, 2].includes(n_spins) || !counts_ok)
    throw new Error(`${name}: invalid header "${lines[1].trim()}"`)
  if (lines[2].trim().toLowerCase() !== `average`)
    throw new Error(
      (lines[2].match(/->/g) ?? []).length > 1
        ? `${name}: multi-center bond indices are not supported`
        : `${name} line 3 should read "Average", got "${lines[2].trim()}"`,
    )
  const data_start = 2 + n_columns // title, header, Average, then n_columns - 1 pair lines
  if (lines.length - data_start !== n_energies)
    throw new Error(
      `${name} header declares ${n_energies} energies, file has ${lines.length - data_start} rows`,
    )

  // column-major: columns[col_idx][energy_idx]
  const columns = read_rows(lines, data_start, n_energies, 1 + 2 * n_columns * n_spins, name)
  // curves of column pair `pair_idx` (0 = average) per spin: value, then its integral
  const curves = (pair_idx: number): CohpCurves => {
    const column = (spin_idx: number, offset: 0 | 1) =>
      columns[1 + 2 * (spin_idx * n_columns + pair_idx) + offset]
    return {
      values: { up: column(0, 0), ...(n_spins === 2 && { down: column(1, 0) }) },
      integrated: { up: column(0, 1), ...(n_spins === 2 && { down: column(1, 1) }) },
    }
  }

  const bonds: CohpBond[] = []
  for (let line_idx = 3; line_idx < data_start; line_idx++) {
    const line = lines[line_idx].trim()
    const context = `${name} line ${line_idx + 1}`
    const groups = PAIR_LINE_RE.exec(line)?.groups
    if (!groups) throw new Error(`${context}: invalid pair line "${line}"`)
    const { atom_1, atom_2, orbital_1, orbital_2, length } = groups
    const bond = bonds.at(-1)
    if (orbital_1 && orbital_2) {
      // LOBSTER < 2.2 wrote orbital lines without pair totals
      if (bond?.atoms[0].label !== atom_1 || bond.atoms[1].label !== atom_2)
        throw new Error(`${context}: orbital pair "${line}" doesn't follow its pair's total`)
      const orbitals: OrbitalPair = [orbital_1, orbital_2]
      const key = orbital_key(bond.label, orbitals)
      bond.orbitals.push({ key, orbitals, ...curves(line_idx - 2) })
      continue
    }
    bonds.push({
      label: String(bonds.length + 1),
      atoms: [parse_atom(atom_1, context), parse_atom(atom_2, context)],
      length: parse_numbers([length], context)[0],
      orbitals: [],
      ...curves(line_idx - 2),
    })
  }
  return {
    kind,
    energies: columns[0],
    efermi,
    spin_polarized: n_spins === 2,
    average: curves(0),
    bonds,
  }
}

// Parse ICOHPLIST.lobster, ICOOPLIST.lobster or ICOBILIST.lobster (two-center lists). `kind` as
// for parse_cohpcar. Rows by column count, one header line or two above each block:
// - 6 (LOBSTER 2): label, atoms, distance, value, multiplicity; spin 2 in a second block
// - 8 (LOBSTER 3-5.0): label, atoms, distance, translation, value; spin 2 in a second block
// - 9 (LOBSTER >= 5.1): label, atoms, distance, translation, spin-1 value, spin-2 value
// Orbital-resolved rows (atoms with their orbital, `Fe8_3d_xy`) follow their pair's total and go
// into its `orbitals`.
export function parse_icohplist(text: string, kind: LobsterKind): IcohpList {
  const name = `I${kind}LIST`
  const blocks: { tokens: string[]; context: string }[][] = []
  let in_header = false
  for (const [line_idx, raw_line] of text.split(/\r?\n/).entries()) {
    if (!raw_line.trim()) continue
    const tokens = tokens_of(raw_line)
    // header lines (lines not starting with an integer label) open a block
    if (!/^\d+$/.test(tokens[0])) {
      if (!in_header) blocks.push([])
      in_header = true
      continue
    }
    if (blocks.length === 0) blocks.push([])
    in_header = false
    blocks.at(-1)?.push({ tokens, context: `${name} line ${line_idx + 1}` })
  }
  const filled = blocks.filter((block) => block.length > 0)
  const [rows = [], down_rows] = filled
  if (rows.length === 0) throw new Error(`${name} has no entries`)
  if (filled.length > 2)
    throw new Error(`${name} has ${filled.length} blocks, expected 1 or 2`)
  const n_tokens = rows[0].tokens.length
  if (![6, 8, 9].includes(n_tokens))
    throw new Error(`${name}: rows with ${n_tokens} columns, expected 6, 8 or 9`)
  if (n_tokens === 9 && down_rows) throw new Error(`${name}: 9-column rows in two blocks`)
  if (down_rows && down_rows.length !== rows.length)
    throw new Error(
      `${name}: spin 1 has ${rows.length} entries, spin 2 has ${down_rows.length}`,
    )
  const value_col = n_tokens === 6 ? 4 : 7
  const pair_of = (tokens: string[]) => tokens.slice(0, 3).join(` `)

  const entries: IcohpEntry[] = []
  for (const [row_idx, { tokens, context }] of rows.entries()) {
    if (tokens.length !== n_tokens)
      throw new Error(`${context}: ${tokens.length} columns, the first row has ${n_tokens}`)
    const [label, atom_1, atom_2] = tokens
    const numbers = parse_numbers(tokens.slice(3), context)
    let down: number | undefined
    if (n_tokens === 9) down = numbers[5]
    else if (down_rows) {
      const down_row = down_rows[row_idx]
      if (pair_of(down_row.tokens) !== pair_of(tokens))
        throw new Error(
          `${down_row.context} (spin 2: ${pair_of(down_row.tokens)}) doesn't match ${context} (${pair_of(tokens)})`,
        )
      down = parse_numbers([down_row.tokens[value_col]], down_row.context)[0]
    }
    const value = { up: numbers[value_col - 3], ...(down !== undefined && { down }) }
    // `O5_2p_y`: atom, then orbital
    const [[atom_label_1, orbital_1], [atom_label_2, orbital_2]] = [atom_1, atom_2].map(
      (atom) => atom.split(/_(?<orbital>.*)/),
    )
    if (orbital_1 && orbital_2) {
      const entry = entries.at(-1)
      const atoms = entry?.atoms.map((atom) => atom.label).join(` `)
      if (entry?.label !== label || atoms !== `${atom_label_1} ${atom_label_2}`)
        throw new Error(`${context}: orbital row doesn't follow its pair's total`)
      entry.orbitals.push({ orbitals: [orbital_1, orbital_2], value })
      continue
    }
    entries.push({
      label,
      atoms: [parse_atom(atom_1, context), parse_atom(atom_2, context)],
      length: numbers[0],
      translation: n_tokens === 6 ? null : [numbers[1], numbers[2], numbers[3]],
      value,
      orbitals: [],
    })
  }
  return { kind, spin_polarized: Boolean(down_rows) || n_tokens === 9, entries }
}

// Vector from a pair's first atom to its second's image (by the pair's translation) in
// `unit_cell`, the structure LOBSTER ran on; null for lists without translations (LOBSTER 2).
// Throws where the structure can't hold the pair: missing site, other element, no lattice
// for a translation, or (with a translation) a distance off the listed one by over `tol` Å.
export function pair_vector(
  entry: IcohpEntry,
  unit_cell: AnyStructure,
  tol = 1e-3,
): Vec3 | null {
  const [xyz_1, xyz_2] = entry.atoms.map(({ site_idx, label, element }) => {
    const site = get_site(unit_cell, site_idx)
    if (!site) throw new Error(`LOBSTER atom ${label} is not in the structure`)
    if (!site.species.some((species) => species.element === element)) {
      const elements = site.species.map((species) => species.element).join(`/`)
      throw new Error(`LOBSTER atom ${label} is ${elements} in the structure`)
    }
    return site.xyz
  })
  const { translation, label, length } = entry
  if (!translation) return null
  const lattice = `lattice` in unit_cell ? unit_cell.lattice.matrix : null
  if (!lattice && translation.some(Boolean))
    throw new Error(`LOBSTER pair ${label} has a translation but the structure no lattice`)
  const vector = xyz_2.map(
    (val, axis) =>
      val -
      xyz_1[axis] +
      translation.reduce((sum, step, row) => sum + step * (lattice?.[row][axis] ?? 0), 0),
  ) as Vec3
  const distance = Math.hypot(...vector)
  if (Math.abs(distance - length) > tol)
    throw new Error(
      `LOBSTER pair ${label} is ${length} Å long, ${distance.toFixed(5)} Å in the structure`,
    )
  return vector
}

export interface LobsterDoscar {
  efermi: number // eV, absolute Fermi energy from the header
  // total DOS, energies relative to E_F (as LOBSTER writes them, so efermi is 0) like CohpData's
  total: ElectronicDos
  // per atom in POSCAR order: the sum over its orbitals and each orbital's projected DOS
  atoms: { total: ElectronicDos; orbitals: Record<string, ElectronicDos> }[]
}

// Parse DOSCAR.lobster, in VASP's DOSCAR layout: `n_atoms ...` on line 1, `e_max e_min
// n_energies e_fermi 1.0` on line 6, then n_energies rows of energy, DOS and integrated DOS
// (spin-polarized: up and down of each); then per atom that header line with `; Z= <Z>;
// <orbitals>` appended and n_energies rows of energy and each orbital's DOS (up and down).
export function parse_doscar(text: string): LobsterDoscar {
  const name = `DOSCAR.lobster`
  const lines = text.split(/\r?\n/)
  const n_atoms = Number(tokens_of(lines[0] ?? ``)[0])
  const header = tokens_of(lines[5] ?? ``).slice(0, 4)
  const [, , n_energies, efermi] = parse_numbers(header, `${name} line 6`)
  if (!Number.isInteger(n_atoms) || !Number.isInteger(n_energies) || n_energies < 1)
    throw new Error(`${name}: invalid header "${lines[0]}" / "${lines[5]}"`)
  const n_total = tokens_of(lines[6] ?? ``).length
  if (n_total !== 3 && n_total !== 5)
    throw new Error(`${name} line 7: ${n_total} columns, expected 3 or 5`)
  const n_spins = n_total === 5 ? 2 : 1
  // n_energies rows from line index `start` on, as columns
  const block = (start: number, n_cols: number) =>
    read_rows(lines, start, n_energies, n_cols, name)
  const [energy_col, ...total_cols] = block(6, n_total)
  const energies = Array.from(energy_col)
  // DOS of spin channel columns [up, down?]
  const dos = (up: Float64Array, down?: Float64Array): ElectronicDos => ({
    type: `electronic`,
    energy_unit: `eV`,
    energies,
    densities: Array.from(up),
    ...(down && { spin_down_densities: Array.from(down) }),
    spin_polarized: n_spins === 2,
    efermi: 0,
  })
  const spins = (columns: Float64Array[], idx: number) =>
    dos(columns[idx * n_spins], n_spins === 2 ? columns[idx * n_spins + 1] : undefined)
  const atoms = Array.from({ length: n_atoms }, (_, atom_idx) => {
    const header_idx = 6 + n_energies + atom_idx * (n_energies + 1)
    const atom_header = lines[header_idx] ?? ``
    if (!atom_header.includes(`;`))
      throw new Error(
        `${name} line ${header_idx + 1}: no "; <orbitals>" header for atom ${atom_idx + 1}`,
      )
    const orbitals = tokens_of(atom_header.slice(atom_header.lastIndexOf(`;`) + 1))
    const [, ...columns] = block(header_idx + 1, 1 + orbitals.length * n_spins)
    const sums = Array.from({ length: n_spins }, (_spin_col, spin) =>
      Float64Array.from(energies, (_energy, row_idx) =>
        orbitals.reduce(
          (sum, _orbital, idx) => sum + columns[idx * n_spins + spin][row_idx],
          0,
        ),
      ),
    )
    return {
      total: spins(sums, 0),
      orbitals: Object.fromEntries(
        orbitals.map((orbital, idx) => [orbital, spins(columns, idx)]),
      ),
    }
  })
  const end = 6 + n_energies + n_atoms * (n_energies + 1)
  if (lines.slice(end).some((line) => line.trim()))
    throw new Error(`${name} has lines past its ${n_atoms} atoms' blocks (line ${end + 1})`)
  return { efermi, total: spins(total_cols, 0), atoms }
}

export interface LobsterFiles {
  // per COHPCAR-type file, in LOBSTER_KINDS order: its curves and its matching list
  by_kind: Map<LobsterKind, { cohp: CohpData; icohp: IcohpList | null }>
  structure: AnyStructure | null
  dos: LobsterDoscar | null // from DOSCAR.lobster
  ignored: string[] // files nothing uses (lobsterout, ...)
}

// LOBSTER output parsed from file names to contents: every COHPCAR-type file with its list,
// DOSCAR.lobster, and the POSCAR LOBSTER read (else the only structure file), parsed once.
// Throws on no COHPCAR-type file, several structures but no POSCAR, or files that don't fit
// together.
export function parse_lobster_files(files: Record<string, string>): LobsterFiles {
  const cars = new Map<LobsterKind, string>()
  const lists = new Map<LobsterKind, string>()
  const structures: string[] = []
  const doscar = Object.keys(files).filter((filename) =>
    /^DOSCAR\.lobster(?:\.(?:gz|bz2|xz|zst))?$/i.test(filename.split(/[\\/]/).pop() ?? ``),
  )
  if (doscar.length > 1) throw new Error(`Several DOSCAR.lobster files: ${doscar.join(`, `)}`)
  for (const filename of Object.keys(files)) {
    const file = lobster_file(filename)
    const by_kind = file?.list ? lists : cars
    if (file && by_kind.has(file.kind))
      throw new Error(`Two ${file.kind} files: ${by_kind.get(file.kind)} and ${filename}`)
    if (file) by_kind.set(file.kind, filename)
    else if (is_structure_file(filename)) structures.push(filename)
  }
  if (cars.size === 0) throw new Error(`No COHPCAR/COOPCAR/COBICAR.lobster among the files`)
  const poscar = structures.find((name) =>
    /^POSCAR(?:\.|$)/i.test(name.split(/[\\/]/).pop() ?? ``),
  )
  if (!poscar && structures.length > 1)
    throw new Error(`Several structure files but no POSCAR: ${structures.join(`, `)}`)
  const structure_name = poscar ?? structures[0]
  const structure = structure_name
    ? parse_structure_file(files[structure_name], structure_name)
    : null

  const dos = doscar[0] ? parse_doscar(files[doscar[0]]) : null
  const n_sites = structure?.sites.length
  if (dos && n_sites !== undefined && dos.atoms.length !== n_sites)
    throw new Error(`${doscar[0]} has ${dos.atoms.length} atoms, ${structure_name} ${n_sites}`)
  const used = new Set<string | undefined>([structure_name, doscar[0]])
  const by_kind: LobsterFiles[`by_kind`] = new Map()
  for (const kind of LOBSTER_KINDS) {
    const [car_name, list_name] = [cars.get(kind), lists.get(kind)]
    if (!car_name) continue
    const cohp = parse_cohpcar(files[car_name], kind)
    const icohp = list_name ? parse_icohplist(files[list_name], kind) : null
    by_kind.set(kind, { cohp, icohp })
    for (const name of [car_name, list_name]) used.add(name)
    for (const { atoms } of cohp.bonds)
      for (const { label, site_idx } of atoms)
        if (dos && site_idx >= dos.atoms.length)
          throw new Error(`${car_name} atom ${label} is not in ${doscar[0]}`)
    if (!icohp) continue
    if (icohp.spin_polarized !== cohp.spin_polarized)
      throw new Error(`${list_name} and ${car_name} differ in spin polarization`)
    const bond_by_label = new Map(cohp.bonds.map((bond) => [bond.label, bond]))
    for (const entry of icohp.entries) {
      const pair = entry.atoms.map((atom) => atom.label).join(`-`)
      const bond = bond_by_label.get(entry.label)
      const bond_pair = bond?.atoms.map((atom) => atom.label).join(`-`)
      if (bond_pair !== pair || Math.abs((bond?.length ?? NaN) - entry.length) > 1e-3)
        throw new Error(
          `${list_name} pair ${entry.label} is ${pair} (${entry.length} Å), ${car_name}'s is ${bond_pair ?? `missing`} (${bond?.length} Å)`,
        )
      if (structure) pair_vector(entry, structure)
    }
  }
  const ignored = Object.keys(files).filter((name) => !used.has(name))
  return { by_kind, structure, dos, ignored }
}

// Structure bond_colors callback: per bond, color_fn of its LOBSTER pair and the pair's bonding
// strength, undefined for bonds without a pair. A pair matches a bond when its pair_vector in
// `unit_cell` (the structure LOBSTER ran on) equals the bond's pos_1 -> pos_2 within `tol` Å, in
// either direction; lists without translations (LOBSTER 2) match the pair's sites and length
// instead. Image and supercell sites resolve to the unit-cell site they copy. Bonds are matched
// once per bond list, so recoloring (e.g. on hover) calls color_fn once per pair.
export function icohp_bond_colors(
  list: IcohpList,
  unit_cell: AnyStructure,
  color_fn: (strength: number, entry: IcohpEntry) => string,
  tol = 0.01,
): (bonds: BondData, structure: AnyStructure) => (string | undefined)[] {
  const by_pair = new Map<string, { entry: IcohpEntry; vector: Vec3 | null }[]>()
  for (const entry of list.entries) {
    const key = `${entry.atoms[0].site_idx},${entry.atoms[1].site_idx}`
    by_pair.set(key, [
      ...(by_pair.get(key) ?? []),
      { entry, vector: pair_vector(entry, unit_cell, tol) },
    ])
  }
  const match = (bond: BondPair, structure: AnyStructure) => {
    const orig = (idx: number) => get_orig_site_idx(get_site(structure, idx), idx)
    const [idx_1, idx_2] = [orig(bond.site_idx_1), orig(bond.site_idx_2)]
    const delta = bond.pos_2.map((val, axis) => val - bond.pos_1[axis])
    // a pair listed as (idx_1, idx_2) runs along the bond, one listed as (idx_2, idx_1) against
    // it; a same-site pair (an atom and its image) can do either
    for (const [key, signs] of [
      [`${idx_1},${idx_2}`, idx_1 === idx_2 ? [1, -1] : [1]],
      [`${idx_2},${idx_1}`, idx_1 === idx_2 ? [] : [-1]],
    ] as const) {
      for (const { entry, vector } of by_pair.get(key) ?? []) {
        const matches = vector
          ? signs.some((sign) =>
              vector.every((val, axis) => Math.abs(sign * val - delta[axis]) <= tol),
            )
          : signs.length > 0 && Math.abs(entry.length - bond.bond_length) <= tol
        if (matches) return entry
      }
    }
    return undefined
  }
  const matched = new WeakMap<BondData, (IcohpEntry | undefined)[]>()
  return (bonds, structure) => {
    let entries = matched.get(bonds)
    if (!entries) {
      entries = Array.from({ length: bonds.length }, (_, idx) =>
        match(bond_at(bonds, idx), structure),
      )
      matched.set(bonds, entries)
    }
    const colors = new Map(
      list.entries.map((entry) => [
        entry,
        color_fn(bonding_strength(entry, list.kind), entry),
      ]),
    )
    return entries.map((entry) => entry && colors.get(entry))
  }
}

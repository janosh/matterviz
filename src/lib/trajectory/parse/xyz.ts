import { display_idx } from '#lib/labels.js'
import {
  element_from_atomic_number,
  element_from_lammps_type,
  symbol_to_atomic_number,
} from '#lib/element/helpers.js'
import type { ElementSymbol } from '#lib/element/types.js'
import { BOHR_TO_ANGSTROM, HARTREE_TO_EV } from '#lib/constants.js'
import {
  cell_to_lattice_matrix,
  is_finite_matrix3x3,
  mat3x3_from_flat_col_major,
  mat3x3_from_flat_row_major,
  is_finite_vec3,
  type Matrix3x3,
  transpose_3x3,
} from '#lib/math.js'
import { parse_leading_num, yield_turn } from '#lib/utils.js'
import { LineScanner, parse_float_token } from '#lib/structure/parsers/shared.js'
import type { Pbc } from '#lib/structure/pbc.js'
import type { ExtxyzColumn, XyzFrameSpec } from '#lib/trajectory/helpers.js'
import {
  compute_force_stats,
  create_plot_row_frame,
  create_trajectory_frame,
  elem_symbol_from_token,
  element_from_species_label,
  holds_numbers,
  label_sites,
  iter_xyz_frames,
  decode_finite_frames,
  NonFiniteFrameError,
  parse_extxyz_columns,
  TextLines,
} from '#lib/trajectory/helpers.js'
import type { TrajectoryFrame, TrajectoryMetadata } from '#lib/trajectory/index.js'
import { frame_property_row } from '../extract'
import {
  create_numeric_md_frame,
  encode_frame,
  type NumericFrame,
  write_frame_vector,
} from '../frame'
import { MAX_STRING_CHARS } from '#lib/io/decompress.js'
import { ase_momentum_mass, ase_velocity, type ByteSource } from './ase'
import { ase_stress_metadata } from './shared'
import type { ParsedTrajectory, WarnFn, WarningCollector } from './shared'

function parse_extxyz_lattice(comment: string): Matrix3x3 | undefined {
  // Both quote styles, as parse_extxyz_pbc below already accepts: ASE writes double quotes but
  // single-quoted cells occur, and matching only `"` dropped the cell without a word, turning
  // a crystal into a molecule with every fractional coordinate at the origin.
  const match = /\bLattice\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/i.exec(comment)
  const raw = match?.groups?.double ?? match?.groups?.single
  if (raw === undefined) return undefined
  // commas too, as ASE's reader and the vector signals below accept: `Lattice="1.98, -0.37, …"`
  const vals = raw.split(/[\s,]/).filter(Boolean).map(parse_float_token)
  if (vals.length !== 9 || !vals.every(Number.isFinite)) {
    throw new Error(`Invalid EXTXYZ Lattice: expected 9 finite numbers, got "${raw}"`)
  }
  return mat3x3_from_flat_row_major(vals)
}

// i-PI heads each frame `# CELL(abcABC): a b c alpha beta gamma Step: 4 Bead: 0
// positions{atomic_unit} cell{atomic_unit}`, or `CELL(H):` / `CELL(GENH):` with the cell
// matrix (lattice vectors as columns, written row-major; GENH is the general cell in the
// positions' own frame, which i-PI rotates into its upper-triangular H). Lengths are in their
// tagged unit, Bohr untagged as in i-PI's reader: read as Å, they came out 1.89x too large.
const IPI_LENGTH_UNITS: Record<string, number> = {
  atomic_unit: BOHR_TO_ANGSTROM,
  angstrom: 1,
  picometer: 0.01,
  nanometer: 10,
  meter: 1e10,
}
const ipi_length_scale = (unit = `atomic_unit`): number => {
  const scale = IPI_LENGTH_UNITS[unit]
  if (scale === undefined) {
    const known = Object.keys(IPI_LENGTH_UNITS).join(`, `)
    throw new Error(`i-PI length unit {${unit}} is not supported (${known})`)
  }
  return scale
}
function parse_ipi_header(comment: string): { lattice?: Matrix3x3; pos_scale: number } {
  // `positions{angstrom}  cell{angstrom}`: the frame's quantity and the cell, each with a unit
  const { cell: cell_unit, ...quantities } = Object.fromEntries(
    Array.from(comment.matchAll(/(?<name>\w+)\{(?<unit>[^}]*)\}/g), ([, name, unit]) => [
      name,
      unit,
    ]),
  )
  const [quantity, unit] = Object.entries(quantities)[0] ?? [undefined, undefined]
  const cell = /\bCELL\((?<kind>\w*)\):(?<raw>[-+0-9.eE\s]*)/.exec(comment)?.groups
  // positions (an i-PI header's untagged default) are lengths; forces or velocities are not
  const is_length =
    quantity === undefined
      ? cell !== undefined
      : [`positions`, `x_centroid`].includes(quantity)
  const pos_scale = is_length ? ipi_length_scale(unit) : 1
  if (!cell) return { pos_scale }
  const { kind, raw } = cell
  if (![`abcABC`, `H`, `GENH`].includes(kind)) {
    throw new Error(`i-PI CELL(${kind}) is not supported (abcABC, H or GENH)`)
  }
  const vals = raw.trim().split(/\s+/).map(Number)
  if (vals.length !== (kind === `abcABC` ? 6 : 9) || !vals.every(Number.isFinite)) {
    throw new Error(`Invalid i-PI CELL(${kind}): "${raw.trim()}"`)
  }
  const cell_scale = ipi_length_scale(cell_unit)
  const [len_a, len_b, len_c, alpha, beta, gamma] = vals
  const lattice =
    kind === `abcABC`
      ? cell_to_lattice_matrix(
          len_a * cell_scale,
          len_b * cell_scale,
          len_c * cell_scale,
          alpha,
          beta,
          gamma,
        )
      : transpose_3x3(
          [0, 3, 6].map((start) =>
            vals.slice(start, start + 3).map((val) => val * cell_scale),
          ) as Matrix3x3,
        )
  return { lattice, pos_scale }
}

const EXTXYZ_BOOL = new Map([
  [`t`, true],
  [`true`, true],
  [`1`, true],
  [`f`, false],
  [`false`, false],
  [`0`, false],
]) // Map avoids Object.prototype hits (e.g. `constructor`)

function lookup_extxyz_bools(tokens: string[]): Pbc | undefined {
  if (tokens.length !== 3) return undefined
  const [first, second, third] = tokens.map((token) => EXTXYZ_BOOL.get(token.toLowerCase()))
  if (first === undefined || second === undefined || third === undefined) return undefined
  return [first, second, third]
}

const MOVE_FLAG_COLUMNS = [`move_mask`, `selective_dynamics`] as const

function read_extxyz_move_flags(
  scanner: LineScanner,
  layout: Record<string, ExtxyzColumn> | null,
): [boolean, boolean, boolean] | undefined {
  for (const name of MOVE_FLAG_COLUMNS) {
    const column = layout?.[name]
    if (!column || scanner.count < column.offset + Math.min(column.ncols, 3)) continue
    if (column.ncols >= 3) {
      const flags = [0, 1, 2].map((axis) =>
        EXTXYZ_BOOL.get(scanner.str(column.offset + axis).toLowerCase()),
      )
      if (flags.every((flag) => flag !== undefined)) {
        return flags as [boolean, boolean, boolean]
      }
    } else {
      const flag = EXTXYZ_BOOL.get(scanner.str(column.offset).toLowerCase())
      if (flag !== undefined) return [flag, flag, flag]
    }
  }
  return undefined
}

const RESERVED_EXTXYZ_COLUMNS = new Set([
  `species`,
  `pos`,
  `forces`,
  `force`,
  ...MOVE_FLAG_COLUMNS,
])

// a Map: a plain object's inherited keys (`constructor`) would alias real columns
const EXTXYZ_COLUMN_ALIASES = new Map([
  [`velocities`, `velocity`],
  [`momenta`, `momentum`],
  [`charges`, `charge`],
  [`masses`, `mass`],
])

function read_extxyz_column(scanner: LineScanner, column: ExtxyzColumn): unknown {
  const { offset, ncols, type } = column
  if (scanner.count < offset + ncols) return undefined
  const values: (number | string | boolean)[] = []
  for (let col = offset; col < offset + ncols; col++) {
    let value: number | string | boolean | undefined
    if (type === `s`) value = scanner.str(col)
    else if (type === `l`) value = EXTXYZ_BOOL.get(scanner.str(col).toLowerCase())
    else {
      const num = scanner.num(col)
      value = Number.isFinite(num) ? num : undefined
    }
    if (value === undefined) return undefined
    values.push(value)
  }
  return ncols === 1 ? values[0] : values
}

function parse_extxyz_pbc(comment: string): Pbc | undefined {
  const match =
    /\bpbc\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>\S+(?:\s+\S+){0,2}))/iu.exec(
      comment,
    )
  const raw = (match?.groups?.double ?? match?.groups?.single ?? match?.groups?.bare)?.trim()
  if (!raw) return undefined
  const split = raw.split(/\s+/u)
  const cut = split.findIndex((word) => word.includes(`=`))
  const words = cut === -1 ? split : split.slice(0, cut)
  if (words.length === 0) return undefined
  const [first] = words
  if (first.length === 3) {
    const compact = lookup_extxyz_bools(first.split(``))
    if (compact) return compact
  }
  if (words.length === 1) {
    const only = EXTXYZ_BOOL.get(first.toLowerCase())
    return only === undefined ? undefined : [only, only, only]
  }
  return lookup_extxyz_bools(words.slice(0, 3))
}

// Every `key=value` (or `key: value`) pair of an extXYZ comment, in order. Quote-aware, and a
// bare value is consumed whole, so `Properties=species:S:1:pos:R:3` yields no colon pairs.
// A bare value's trailing comma separates pairs (CP2K: `i =  5, time =  2.500, E = -17.1`)
const EXTXYZ_PAIR_RE =
  /(?:^|\s)(?<key>[A-Za-z_]\w*)\s*[=:]\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>\S+?),?(?=\s|$))/gu

// CP2K's header (MD adds `time = ...` between): `i` is the step, `E` the energy in Hartree
const CP2K_COMMENT_RE = /^\s*i\s*=\s*\d+,\s*(?:time|E)\s*=/
// LAMMPS `dump xyz` header: ` Atoms. Timestep: 100`
const LAMMPS_XYZ_COMMENT_RE = /^\s*Atoms\.\s+Timestep:\s*(?<step>\d+)/

// Read back by dedicated parsers (lattice, pbc, columns) or the step regex below, so
// re-emitting them as frame properties would duplicate or contradict the frame
const RESERVED_COMMENT_KEY_RE = /^(?:lattice|properties|pbc|step|frame|ionic_step)$/

// Spelling aliases only, so every other scalar round-trips under its own name — including
// `coords_unwrapped`, which decides whether MSD/VACF may re-apply the minimum image, and
// `total_energy`, an MD total (potential + kinetic) that folding into `energy` mislabeled and
// dropped on re-import. No bare `t`: as often a time as a temperature.
// oxfmt-ignore
const METADATA_KEY_ALIASES: Record<string, string> = {
  e: `energy`, etot: `total_energy`,
  vol: `volume`, v: `volume`,
  press: `pressure`, p: `pressure`,
  temp: `temperature`,
  max_force: `force_max`, fmax: `force_max`,
  e_gap: `bandgap`, gap: `bandgap`,
}

const comment_scalar = (raw: string): number | boolean | undefined => {
  const token = raw.trim()
  if (!token || /\s/u.test(token)) return undefined // multi-value: a signal, not a scalar
  // number first so `1`/`0` stay numbers, not flags; Fortran writers emit `1.0D-3`
  const num = parse_float_token(token)
  return Number.isFinite(num) ? num : EXTXYZ_BOOL.get(token.toLowerCase())
}

// ASE's 3x3 keys besides Lattice: it lists their 9 values column-major and writes every other
// matrix as `_JSON [[...], ...]`, while other 9-value arrays stay flat in their listed order
export const ASE_3X3_KEYS = new Set([`stress`, `virial`])

// A quoted multi-value payload as ASE reads it: a flat vector (9 values stay flat), a 3x3 key's
// column-major matrix, or a `_JSON` vector (ASE's 1-vector, as plain `7` is a scalar) or matrix
function comment_signal(raw: string, key: string): number[] | Matrix3x3 | undefined {
  if (raw.startsWith(`_JSON `)) {
    const parsed: unknown = JSON.parse(raw.slice(`_JSON `.length))
    const is_vector =
      Array.isArray(parsed) && parsed.length > 0 && parsed.every(Number.isFinite)
    return is_vector || is_finite_matrix3x3(parsed) ? parsed : undefined
  }
  const values = raw.split(/[\s,]+/u).map(parse_float_token)
  if (!values.every(Number.isFinite)) return undefined
  if (values.length === 9 && ASE_3X3_KEYS.has(key)) return mat3x3_from_flat_col_major(values)
  // A 6-value stress is Voigt order (ASE's own writer), which ase_stress_metadata expands
  if (key === `stress`) return values.length === 6 ? values : undefined
  return values
}

// One pass over the comment's pairs yields every view a frame needs: scalars, flags, quoted
// 3-/9-component signals and the step. Two passes had drifted apart on their reserved keys.
export function parse_xyz_comment_metadata(comment: string): {
  step?: number
  properties: Record<string, number>
  flags: Record<string, boolean>
  signals: Record<string, number[] | number[][]>
} {
  const properties: Record<string, number> = {}
  const flags: Record<string, boolean> = {}
  const signals: Record<string, number[] | number[][]> = {}
  for (const { groups } of comment.matchAll(EXTXYZ_PAIR_RE)) {
    if (!groups?.key) continue
    const quoted = groups.double ?? groups.single
    const raw = quoted ?? groups.bare ?? ``
    const lower = groups.key.toLowerCase()
    if (RESERVED_COMMENT_KEY_RE.test(lower)) continue
    const value = comment_scalar(raw)
    if (value === undefined) {
      // Not a scalar: a quoted multi-value payload is a vector or 3x3 matrix signal, under
      // `lower` like the scalars below: `Stress=` and `stress=` are one series
      const signal = quoted === undefined ? undefined : comment_signal(raw.trim(), lower)
      if (signal) signals[lower] = signal
      continue
    }
    // Lowercase, so `Free_Energy=` and `free_energy=` are one series, not two half-populated
    const canonical = METADATA_KEY_ALIASES[lower] ?? lower
    // leftmost wins
    if (canonical in properties || canonical in flags) continue
    if (typeof value === `boolean`) flags[canonical] = value
    else properties[canonical] = value
  }
  if (CP2K_COMMENT_RE.test(comment)) {
    if (properties.energy !== undefined) properties.energy *= HARTREE_TO_EV
    const { i: step, ...rest } = properties
    return { step, properties: rest, flags, signals }
  }
  const lammps_step = LAMMPS_XYZ_COMMENT_RE.exec(comment)?.groups?.step
  if (lammps_step !== undefined) {
    delete properties.timestep // the step itself
    return { step: Number(lammps_step), properties, flags, signals }
  }
  const step = /(?:^|\s)(?:step|frame|ionic_step)\s*[=:]?\s*(?<step>\d+)/i.exec(comment)?.[1]
  return { step: step ? Math.trunc(Number(step)) : undefined, properties, flags, signals }
}

// Element of the atom on the scanned line: the symbol token, or the atomic number when the
// layout declares `Z` in place of a species column
const scanned_element = (
  scanner: LineScanner,
  symbol_col: number,
  atomic_number_col: number,
): ElementSymbol | undefined => {
  if (atomic_number_col < 0) return elem_symbol_from_token(scanner.str(symbol_col))
  // Integer only: truncating would turn a malformed `14.9` into silicon
  return element_from_atomic_number(scanner.num(atomic_number_col))
}

// Symbols are case-normalised (`FE` -> `Fe`) like the structure parsers do. Unknown symbols
// are skipped (with a warning) rather than rejected because real files carry them: ASE writes
// `X` for ghost/dummy atoms and some codes emit placeholder species. A frame with no
// recognised atom at all, or a malformed coordinate, is corruption and names its line.
function parse_xyz_atom_lines(
  lines: TextLines,
  { start, num_atoms, comment }: XyzFrameSpec,
  frame_label: string,
  warn_once: WarningCollector[`warn_once`],
): {
  elements: ElementSymbol[]
  positions: number[][]
  forces: number[][]
  site_properties: Record<string, unknown>[]
  // the raw species token of each kept atom read off a label (`O1` -> O), else undefined
  labels: (string | undefined)[]
} {
  const { atomic_number_col, symbol_col, pos_col, forces_col, min_cols, layout, spec_error } =
    parse_extxyz_columns(comment)
  if (spec_error) throw new Error(`XYZ ${frame_label}: ${spec_error}`)
  const elements: ElementSymbol[] = []
  const positions: number[][] = []
  const forces: number[][] = []
  const site_properties: Record<string, unknown>[] = []
  const labels: (string | undefined)[] = []
  const extra_columns = Object.entries(layout ?? {})
    .filter(([name]) => !RESERVED_EXTXYZ_COLUMNS.has(name))
    .map(([name, column]) => [EXTXYZ_COLUMN_ALIASES.get(name) ?? name, column] as const)
  const has_move_flags = MOVE_FLAG_COLUMNS.some((name) => layout?.[name])
  let move_flag_count = 0

  const scanner = new LineScanner()
  for (let idx = 0; idx < num_atoms; idx++) {
    // a body const, not the loop variable: capturing that in `quoted` slows the loop down
    const line_idx = start + 2 + idx
    const line_number = line_idx + 1
    const n_cols = lines.scan(scanner, line_idx)
    // the quoted line is only built on error
    const quoted = () => lines.line(line_idx) ?? ``
    if (n_cols < min_cols) {
      throw new Error(
        `XYZ ${frame_label} line ${line_number} has ${n_cols} columns, expected at least ${min_cols}: "${quoted()}"`,
      )
    }
    const pos = [scanner.num(pos_col), scanner.num(pos_col + 1), scanner.num(pos_col + 2)]
    if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1]) || !Number.isFinite(pos[2])) {
      if (holds_numbers(scanner, [pos_col, pos_col + 1, pos_col + 2]))
        throw new NonFiniteFrameError(
          `Non-finite XYZ coordinates in ${frame_label} line ${line_number} "${quoted()}"`,
        )
      throw new TypeError(
        `XYZ ${frame_label} line ${line_number} has non-numeric coordinates: "${quoted()}"`,
      )
    }
    let element_symbol = scanned_element(scanner, symbol_col, atomic_number_col)
    // Integer species are atomic numbers, or LAMMPS `dump xyz` atom types (unless dump_modify
    // element names them), which the LAMMPS dump reader also reads as atomic numbers
    const atom_type = element_symbol || atomic_number_col >= 0 ? NaN : scanner.num(symbol_col)
    if (Number.isInteger(atom_type) && atom_type > 0) {
      element_symbol = element_from_lammps_type(atom_type)
      warn_once(
        `lammps-types`,
        `XYZ species column holds integers (first "${scanner.str(symbol_col)}" in ${frame_label} at line ${line_number}); read them as atomic numbers (1 = H), as for LAMMPS dump xyz atom types`,
      )
    }
    let label: string | undefined
    if (!element_symbol && atomic_number_col < 0) {
      label = scanner.str(symbol_col)
      element_symbol = element_from_species_label(label)
      if (element_symbol)
        warn_once(
          `labelled-species`,
          `XYZ species are labels (first "${label}" in ${frame_label} at line ${line_number}); read each as its leading element ("${label}" -> ${element_symbol}) and kept it as the site label`,
        )
    }
    if (!element_symbol) {
      // once per symbol: a file of Wannier centres (`X`) would warn for every frame's atoms
      const symbol = scanner.str(symbol_col)
      warn_once(
        `unknown-element:${symbol}`,
        `Skipping XYZ atoms with unknown element symbol "${symbol}", first in ${frame_label} at line ${line_number}`,
      )
      continue
    }
    elements.push(element_symbol)
    labels.push(label)
    positions.push(pos)
    const props: Record<string, unknown> = {}
    if (forces_col >= 0 && n_cols >= forces_col + 3) {
      const force_vec = [
        scanner.num(forces_col),
        scanner.num(forces_col + 1),
        scanner.num(forces_col + 2),
      ]
      if (
        Number.isFinite(force_vec[0]) &&
        Number.isFinite(force_vec[1]) &&
        Number.isFinite(force_vec[2])
      ) {
        forces.push(force_vec)
        props.force = force_vec
      }
    }
    for (const [name, column] of extra_columns) {
      const value = read_extxyz_column(scanner, column)
      if (value !== undefined) props[name] = value
    }
    // ASE writes an Atoms' momenta as-is (sqrt(amu*eV)) and its masses only when set, so its
    // reader divides by the standard masses otherwise. An explicit velocity column wins.
    if (props.velocity === undefined && is_finite_vec3(props.momentum)) {
      const recorded = typeof props.mass === `number` ? props.mass : undefined
      const atom_label = `XYZ ${frame_label} line ${line_number} atom`
      const mass = ase_momentum_mass(element_symbol, recorded, atom_label)
      props.velocity = props.momentum.map((momentum) => ase_velocity(momentum, mass))
    }
    if (has_move_flags) {
      const flags = read_extxyz_move_flags(scanner, layout)
      if (flags) {
        props.selective_dynamics = flags
        props.constraint_basis = `cartesian` // a move_mask is per Cartesian axis
        move_flag_count++
      }
    }
    site_properties.push(props)
  }
  if (positions.length === 0) {
    lines.scan(scanner, start + 2)
    throw new TypeError(
      `XYZ ${frame_label} has no atom with a recognised element symbol in its ${num_atoms} atom lines (first species column: "${scanner.str(symbol_col)}")`,
    )
  }
  // Forces and move flags are only meaningful when every kept atom has them
  if (forces.length !== positions.length) {
    forces.length = 0
    for (const props of site_properties) delete props.force
  }
  if (move_flag_count > 0 && move_flag_count !== positions.length) {
    for (const props of site_properties) {
      delete props.selective_dynamics
      delete props.constraint_basis
    }
  }
  return { elements, positions, forces, site_properties, labels }
}

// Run metadata of an extXYZ whose velocities parse_xyz_atom_lines derives from ASE momenta,
// in Å/fs. An explicit velocity column is in the file's own, unrecorded units.
export function extxyz_run_metadata(comment: string | undefined): Record<string, unknown> {
  const layout = comment === undefined ? null : parse_extxyz_columns(comment).layout
  const explicit = layout?.velocities ?? layout?.velocity
  const momenta = layout?.momenta ?? layout?.momentum
  return momenta && !explicit ? { velocity_unit: `A/fs` } : {}
}

// Comment-line fields of a frame, shared by the record and numeric decoders
function xyz_frame_header(comment: string, frame_label: string, collector: WarningCollector) {
  const { step, properties, flags, signals } = parse_xyz_comment_metadata(comment)
  const ipi = parse_ipi_header(comment)
  const lattice_matrix = parse_extxyz_lattice(comment) ?? ipi.lattice
  const parsed_pbc = parse_extxyz_pbc(comment)
  if (parsed_pbc === undefined && /\bpbc\s*=/iu.test(comment)) {
    collector.warn_once(
      `invalid-pbc`,
      `Invalid EXTXYZ pbc (first seen in ${frame_label}); defaulting to fully periodic [T, T, T]`,
    )
  }
  const pbc = lattice_matrix ? (parsed_pbc ?? ([true, true, true] satisfies Pbc)) : undefined
  return { step, properties, flags, signals, pos_scale: ipi.pos_scale, lattice_matrix, pbc }
}

// Frame metadata from the comment and the atoms' force statistics
function xyz_frame_metadata(
  { properties, flags, signals }: ReturnType<typeof xyz_frame_header>,
  force_stats: ReturnType<typeof compute_force_stats>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...properties, ...flags, ...signals }
  // an extXYZ `stress=` follows ASE (eV/Å³, tensile positive); store it like every other
  // reader, with its pressure, unless the comment states a pressure itself
  const stress = ase_stress_metadata(signals.stress)
  if (stress)
    Object.assign(metadata, { ...stress, pressure: properties.pressure ?? stress.pressure })
  // The vectors themselves live on the sites (`force`); only their statistics go here
  return Object.assign(metadata, force_stats)
}

export function build_xyz_frame(
  lines: TextLines,
  frame: XyzFrameSpec,
  opts: { frame_label: string; default_step: number },
  collector: WarningCollector,
): TrajectoryFrame {
  const header = xyz_frame_header(frame.comment, opts.frame_label, collector)
  const { elements, positions, forces, site_properties, labels } = parse_xyz_atom_lines(
    lines,
    frame,
    opts.frame_label,
    collector.warn_once,
  )
  const { pos_scale } = header
  if (pos_scale !== 1) {
    for (const xyz of positions) for (const axis of [0, 1, 2]) xyz[axis] *= pos_scale
  }
  const built = create_trajectory_frame(
    positions,
    elements,
    header.lattice_matrix,
    header.pbc,
    header.step ?? opts.default_step,
    xyz_frame_metadata(header, compute_force_stats(forces)),
    site_properties,
    collector.warn,
  )
  label_sites(built, labels)
  return built
}

const PLAIN_XYZ_COLUMNS = new Set([`species`, `pos`, `forces`, `force`])
// The numeric frame encode_frame makes of build_xyz_frame's, decoded straight from the atom
// lines when they hold only a species symbol, positions and optional forces: no Site, species
// record, label or per-atom array (1k atoms: 0.65 -> 0.22 ms per frame). Other layouts, and
// frames with an unrecognised or integer species, return null: they take build_xyz_frame,
// whose frame a caller either encodes or uses as it is (a plot row needs no numeric frame).
export function read_xyz_frame(
  lines: TextLines,
  frame: XyzFrameSpec,
  opts: { frame_label: string; default_step: number },
  collector: WarningCollector,
): (NumericFrame & { sites: Uint8Array }) | null {
  const { start, num_atoms, comment } = frame
  const { symbol_col, pos_col, forces_col, min_cols, layout, spec_error } =
    parse_extxyz_columns(comment)
  const plain = Object.keys(layout ?? {}).every((name) => PLAIN_XYZ_COLUMNS.has(name))
  if (spec_error || num_atoms === 0 || !plain) return null
  const header = xyz_frame_header(comment, opts.frame_label, collector)
  const numbers = new Uint8Array(num_atoms)
  const positions = new Float64Array(num_atoms * 3)
  const forces = new Float64Array(forces_col >= 0 ? num_atoms * 3 : 0)
  // compute_force_stats' arithmetic, in order, over the packed vectors
  let [n_forces, force_max, sum_sq] = [0, -Infinity, 0]
  const scanner = new LineScanner()
  for (let idx = 0; idx < num_atoms; idx++) {
    const n_cols = lines.scan(scanner, start + 2 + idx)
    const symbol = elem_symbol_from_token(scanner.str(symbol_col))
    const atomic_number = symbol && symbol_to_atomic_number(symbol)
    // build_xyz_frame reports a short or non-numeric line and resolves odd species
    if (n_cols < min_cols || !atomic_number) return null
    numbers[idx] = atomic_number
    for (let axis = 0; axis < 3; axis++) {
      const coord = scanner.num(pos_col + axis)
      if (!Number.isFinite(coord)) return null
      positions[idx * 3 + axis] = coord * header.pos_scale
    }
    if (forces_col < 0 || n_cols < forces_col + 3) continue
    const force_x = scanner.num(forces_col)
    const force_y = scanner.num(forces_col + 1)
    const force_z = scanner.num(forces_col + 2)
    if (!Number.isFinite(force_x) || !Number.isFinite(force_y) || !Number.isFinite(force_z))
      continue
    forces[idx * 3] = force_x
    forces[idx * 3 + 1] = force_y
    forces[idx * 3 + 2] = force_z
    const magnitude = Math.hypot(force_x, force_y, force_z)
    if (magnitude > force_max) force_max = magnitude
    sum_sq += magnitude ** 2
    n_forces++
  }
  // Forces count only when every atom has them, as on the decoded sites
  const has_forces = n_forces === num_atoms
  const force_stats = has_forces
    ? { force_max, force_norm: Math.sqrt(sum_sq / num_atoms) }
    : null
  const numeric = create_numeric_md_frame(
    positions,
    numbers,
    header.lattice_matrix,
    header.pbc,
    header.step ?? opts.default_step,
    xyz_frame_metadata(header, force_stats),
    has_forces ? [`force`] : [],
    { fixed_order: false, warn: collector.warn },
  )
  if (has_forces) write_frame_vector(numeric, 0, forces)
  return numeric
}

// The frame walk steps over lines that form no frame it can sample, e.g. a frame whose first
// atom lines read `nan` after an MD blow-up: every such frame vanished from the run without a
// word, and one mid-file shifted every later frame number. Blank lines and empty (`0` atom)
// frames are not content; anything else between, before or after the frames (up to `end`, a
// torn tail's start) is reported once per gap.
function warn_skipped_xyz_lines(
  lines: TextLines,
  specs: readonly XyzFrameSpec[],
  end: number,
  warn: WarnFn,
): void {
  const report = (from: number, to: number, where: string) => {
    let [first, last] = [-1, -1]
    for (let idx = from; idx < to; idx++) {
      const line = lines.line(idx) ?? ``
      if (!line.trim()) continue
      if (line.trim() === `0`) {
        idx++ // an empty frame's comment line
        continue
      }
      if (first === -1) first = idx
      last = idx
    }
    if (first === -1) return
    warn(
      `Skipping XYZ lines ${first + 1}-${last + 1} ${where}: they form no complete frame (an atom count, a comment and one "symbol x y z" line per atom), so any frame written there is missing`,
    )
  }
  report(0, specs[0].start, `before frame 1`)
  for (let frame_idx = 1; frame_idx < specs.length; frame_idx++) {
    const between = `between frames ${frame_idx} and ${display_idx(frame_idx)}`
    report(specs[frame_idx - 1].end, specs[frame_idx].start, between)
  }
  report(specs[specs.length - 1].end, end, `after frame ${specs.length}`)
}

// Whether the last atom line of `last`, a frame reaching the end of the text, is half-written
function ends_in_partial_line(
  lines: TextLines,
  last: XyzFrameSpec,
  scanner: LineScanner,
): boolean {
  const { pos_col, min_cols, layout } = parse_extxyz_columns(last.comment)
  // Every declared column, not just through pos: a line cut inside its forces dropped the
  // whole frame's forces instead of the torn frame. Capped by the frame's first atom line, so
  // a writer that omits a declared column on every line keeps its last frame.
  const first_line_cols = last.num_atoms > 1 ? lines.scan(scanner, last.start + 2) : Infinity
  const declared_end = Math.max(
    0,
    ...Object.values(layout ?? {}).map(({ offset, ncols }) => offset + ncols),
  )
  const declared_cols = Math.max(min_cols, Math.min(first_line_cols, declared_end))
  return (
    lines.scan(scanner, last.end - 1) < declared_cols ||
    !holds_numbers(scanner, [pos_col, pos_col + 1, pos_col + 2])
  )
}

// Index of the first atom line of `frame` holding `nan`/`inf` coordinates, or -1
function find_non_finite_line(
  lines: TextLines,
  frame: XyzFrameSpec,
  scanner: LineScanner,
): number {
  const { pos_col } = parse_extxyz_columns(frame.comment)
  const pos_cols = [pos_col, pos_col + 1, pos_col + 2]
  for (let idx = frame.start + 2; idx < frame.end; idx++) {
    lines.scan(scanner, idx)
    const finite =
      Number.isFinite(scanner.num(pos_col)) &&
      Number.isFinite(scanner.num(pos_col + 1)) &&
      Number.isFinite(scanner.num(pos_col + 2))
    if (!finite && holds_numbers(scanner, pos_cols)) return idx
  }
  return -1
}

// The frame walk's complete frames, and the one the end of the text cuts short (if any)
const walk_xyz_frames = (lines: TextLines): [XyzFrameSpec[], XyzFrameSpec | null] => {
  const specs: XyzFrameSpec[] = []
  const frames = iter_xyz_frames(lines)
  let next = frames.next()
  for (; !next.done; next = frames.next()) specs.push(next.value)
  return [specs, next.value]
}

// Every complete frame of a split XYZ file. A writer still appending leaves one of two tails:
// a frame whose atom block runs past the end of the file (iter_xyz_frames returns its header
// instead of yielding it) or a final frame whose last atom line, the file's last line, is
// half-written. Either is dropped with a warning. Any other defect in a complete final frame
// is corruption and throws like in every other frame. An MD blow-up's frames hold `nan`/`inf`
// coordinates to the end of the run; its onset frame passes the walk's samples (its first
// atoms are still finite) and would end the run unreadable, so like the LAMMPS reader the last
// frame is read in full and skipped while it holds any (eager parsing also skips one mid-run).
export function index_xyz_frames(lines: TextLines, warn: WarnFn): XyzFrameSpec[] {
  const [specs, torn] = walk_xyz_frames(lines)
  const scanner = new LineScanner()
  const last = specs.at(-1)
  const partial = last?.end === lines.count && ends_in_partial_line(lines, last, scanner)
  const unfinished = partial ? specs.pop() : torn
  const end = unfinished?.start ?? lines.count // past the last line a dropped tail does not hold
  const truncated = unfinished && unfinished_frame_warning(lines, unfinished, specs.length)
  let blowup_start = end
  let non_finite: [number, string?] | undefined // the first such line's index and text
  while (specs.length > 1) {
    const frame = specs[specs.length - 1]
    const line_idx = find_non_finite_line(lines, frame, scanner)
    if (line_idx < 0) break
    specs.pop()
    blowup_start = frame.start
    non_finite = [line_idx, lines.line(line_idx)]
  }
  if (specs.length > 0) warn_skipped_xyz_lines(lines, specs, blowup_start, warn)
  if (non_finite) warn(blowup_warning(blowup_start, end, specs.length, ...non_finite))
  if (truncated) warn(truncated)
  return specs
}

// Reports the frame a writer still appending left unfinished: cut short by the end of the
// text, or ending it in a half-written atom line. `frame_idx` counts the frames before it,
// `line_base` the lines before `lines` (a window of a file).
const unfinished_frame_warning = (
  lines: TextLines,
  { start, end, num_atoms }: XyzFrameSpec,
  frame_idx: number,
  line_base = 0,
): string => {
  const atom_lines = Math.max(end - start - 2, 0)
  const reason =
    atom_lines < num_atoms
      ? `${atom_lines} of ${num_atoms} atom lines`
      : `partial atom line ${line_base + end} "${lines.line(end - 1)}"`
  return `Dropping truncated final XYZ frame ${display_idx(frame_idx)} (line ${line_base + start + 1}): ${reason}`
}

// Reports the frames dropped after the first `n_frames` for their non-finite coordinates: lines
// `start` to `end` (indices, end exclusive), the first non-finite one being `line_idx`
const blowup_warning = (
  start: number,
  end: number,
  n_frames: number,
  line_idx: number,
  text?: string,
): string =>
  `Skipping XYZ lines ${start + 1}-${end} after frame ${n_frames}: non-finite coordinates from line ${line_idx + 1} "${text}" on, as after an MD blow-up`

// Byte offset of every frame of the XYZ file behind `source`, then the offset its last frame
// ends at: what reads its frames one at a time off disk (indexed_text_run) instead of holding
// the text in memory. The file is walked in line-aligned windows decoded as latin1, whose one
// char per byte makes a line's offset a byte offset (the walk reads only counts and numbers),
// yielding the thread between windows. A torn, half-written or non-finite tail (a writer still
// appending, an MD blow-up) is left out with the warnings index_xyz_frames gives. null for a
// file that takes its whole text to index: under two frames, a frame past the JS string limit,
// or lines between frames.
export async function index_xyz_file(
  source: ByteSource,
  warn: WarnFn,
  window_bytes = 2 ** 24,
  // aborts a pass a newer one replaced (the file changed while it was walked)
  signal?: AbortSignal,
): Promise<number[] | null> {
  const next_turn = async () => {
    await yield_turn()
    signal?.throwIfAborted()
  }
  const { byte_length } = source
  const decoder = new TextDecoder(`latin1`)
  const scanner = new LineScanner()
  const offsets: number[] = []
  // where the complete frames end, and what reports the unfinished one after them
  let [end_offset, end_line, truncated] = [byte_length, 0, ``]
  let [pos, span, line_base] = [0, window_bytes, 0]
  for (; pos < byte_length; await next_turn()) {
    const size = Math.min(span, byte_length - pos)
    if (size > MAX_STRING_CHARS) return null
    const view = source.read(pos, size)
    const bytes = new Uint8Array(view.buffer, view.byteOffset, size)
    const final = pos + size === byte_length
    const text = decoder.decode(final ? bytes : bytes.subarray(0, bytes.lastIndexOf(10) + 1))
    const lines = new TextLines(text)
    const [frames, torn] = walk_xyz_frames(lines)
    const last = frames.at(-1)
    // What a window leaves to the next: the frame its end cuts, or one ending on its last
    // line, which the walk sampled as if a writer could have left that line half-written.
    // The final window leaves the frame a writer did leave unfinished.
    const cut =
      last?.end === lines.count && (!final || ends_in_partial_line(lines, last, scanner))
    const rest = cut ? frames.pop() : torn
    const end = frames.at(-1)?.end ?? 0
    const contiguous = frames.every(
      (frame, idx) => frame.start === (frames[idx - 1]?.end ?? 0),
    )
    if (!contiguous || end !== (rest?.start ?? lines.count)) return null
    for (const frame of frames) offsets.push(pos + lines.offset(frame.start))
    if (final) {
      end_line = line_base + end
      if (rest) {
        end_offset = pos + lines.offset(rest.start)
        truncated = unfinished_frame_warning(lines, rest, offsets.length, line_base)
      }
      break
    }
    if (!rest) return null
    if (rest.start === 0) span *= 2 // its frame outgrows the window
    else {
      pos += lines.offset(rest.start)
      line_base += rest.start
    }
  }
  // An MD blow-up's frames, read back from the last one as index_xyz_frames does
  let blowup_start = end_line
  let non_finite: [number, string?] | undefined
  for (; offsets.length > 1; await next_turn()) {
    const start = offsets[offsets.length - 1]
    const lines = new TextLines(decoder.decode(source.read(start, end_offset - start)))
    const [comment, end] = [lines.line(1) ?? ``, lines.count]
    const frame = { start: 0, num_atoms: end - 2, comment, end }
    const line_idx = find_non_finite_line(lines, frame, scanner)
    if (line_idx < 0) break
    offsets.pop()
    end_offset = start
    blowup_start -= end
    non_finite = [blowup_start + line_idx, lines.line(line_idx)]
  }
  if (offsets.length < 2) return null
  if (non_finite) warn(blowup_warning(blowup_start, end_line, offsets.length, ...non_finite))
  if (truncated) warn(truncated)
  offsets.push(end_offset)
  return offsets
}

// Why the frame walk refused the first frame's `token x y z` atom lines: a species token that
// is no element symbol, label or atom type
function unreadable_species(lines: TextLines, num_atoms: number): string | null {
  const scanner = new LineScanner()
  for (let line_idx = 2; line_idx < Math.min(num_atoms, 3) + 2; line_idx++) {
    lines.scan(scanner, line_idx)
    const token = scanner.str(0)
    const coords_ok = [1, 2, 3].every((col) => Number.isFinite(scanner.num(col)))
    if (scanner.count < 4 || !coords_ok) return null
    const atom_type = scanner.num(0)
    const readable =
      Boolean(elem_symbol_from_token(token) ?? element_from_species_label(token)) ||
      (Number.isInteger(atom_type) && atom_type > 0)
    if (!readable)
      return `XYZ line ${line_idx + 1} species "${token}" is no element symbol or species label (e.g. Fe, Fe1, O_a) in "${lines.line(line_idx)}"`
  }
  return null
}

// Every frame of a multi- or single-frame XYZ text, located and checked
function xyz_frame_specs(lines: TextLines, collector: WarningCollector): XyzFrameSpec[] {
  const dropped: string[] = []
  const specs = index_xyz_frames(lines, (message) => dropped.push(message))
  if (specs.length === 0) {
    // Decode a whole first frame the sampler skipped (title after the count) or dropped (bad
    // last line), as parse_xyz does; only one that ended early fails as dropped. Like there, it
    // must account for every line: decoding it alone silently dropped any later frames.
    const num_atoms = Math.trunc(parse_leading_num(lines.line(0) ?? ``))
    if (!(num_atoms > 0 && num_atoms + 2 <= lines.count))
      throw new Error(dropped[0] ?? `No XYZ frames found`)
    if (num_atoms + 2 < lines.count) {
      // the frame walk refused its atom lines: name the species when that is what it balked at
      const species = unreadable_species(lines, num_atoms)
      if (species) throw new Error(species)
      throw new Error(
        `XYZ count line 1 "${lines.line(0)}" is not a bare atom count, and its ${num_atoms}-atom frame leaves lines ${num_atoms + 3}-${lines.count} unread`,
      )
    }
    specs.push({ start: 0, num_atoms, comment: lines.line(1) ?? ``, end: num_atoms + 2 })
  } else for (const message of dropped) collector.warn(message)
  return specs
}

const eager_frame_opts = (specs: XyzFrameSpec[], frame_idx: number) => ({
  frame_label: `frame ${display_idx(frame_idx)} (line ${specs[frame_idx].start + 1})`,
  default_step: frame_idx,
})

export function parse_xyz_trajectory(
  content: string | TextLines,
  collector: WarningCollector,
): ParsedTrajectory {
  const lines = TextLines.of(content)
  const specs = xyz_frame_specs(lines, collector)
  const decode = (frame_idx: number): TrajectoryFrame =>
    build_xyz_frame(lines, specs[frame_idx], eager_frame_opts(specs, frame_idx), collector)
  const frames = decode_finite_frames(specs.length, decode, `XYZ`, collector.warn)
  return { format: `xyz`, frames, metadata: extxyz_run_metadata(specs[0]?.comment) }
}

// The eager open: parse_xyz_trajectory's frames as trajectory_from_frames encodes them, plus
// plot rows. Plain species/pos/forces frames skip Site records (100 MB: 7.2 -> 1.3 s).
export function read_xyz_snapshots(
  content: string | TextLines,
  collector: WarningCollector,
): {
  snapshots: NumericFrame[]
  properties: TrajectoryMetadata[]
  metadata: Record<string, unknown>
} {
  const lines = TextLines.of(content)
  const specs = xyz_frame_specs(lines, collector)
  const read = (frame_idx: number): { snapshot: NumericFrame; row: TrajectoryFrame } => {
    const opts = eager_frame_opts(specs, frame_idx)
    const numeric = read_xyz_frame(lines, specs[frame_idx], opts, collector)
    if (!numeric) {
      const frame = build_xyz_frame(lines, specs[frame_idx], opts, collector)
      return { snapshot: encode_frame(frame), row: frame }
    }
    const { header, structure, sites } = numeric
    const { matrix, pbc } = structure.lattice ?? {}
    // its plot row without the atoms; the read already reported a singular lattice
    const metadata = header.metadata ?? {}
    const row = create_plot_row_frame(sites, matrix, pbc, header.step, metadata, () => {})
    return { snapshot: numeric, row }
  }
  const frames = decode_finite_frames(specs.length, read, `XYZ`, collector.warn)
  return {
    snapshots: frames.map(({ snapshot }) => snapshot),
    properties: frames.map(({ row }, frame_idx) => frame_property_row(row, frame_idx)),
    metadata: extxyz_run_metadata(specs[0]?.comment),
  }
}

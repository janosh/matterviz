import { element_from_atomic_number, symbol_to_atomic_number } from '$lib/element/helpers'
import type { ElementSymbol } from '$lib/element/types'
import type { Matrix3x3 } from '$lib/math'
import { LineScanner, parse_float_token } from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import { numeric_sites, NumericSites, snapshot_topologies } from '$lib/structure/site'
import { encode_frame, type NumericFrame } from '$lib/trajectory/frame'
import type { ExtxyzColumn, NumericColumn, XyzFrameSpec } from '$lib/trajectory/helpers'
import {
  calc_flat_force_stats,
  calc_force_stats,
  create_standard_numeric_frame,
  create_trajectory_frame,
  elem_symbol_from_token,
  iter_xyz_frames,
  line_end,
  parse_extxyz_columns,
} from '$lib/trajectory/helpers'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import type { ParsedTrajectory, WarnFn, WarningCollector } from './shared'

function parse_extxyz_lattice(comment: string): Matrix3x3 | undefined {
  // Both quote styles, as parse_extxyz_pbc below already accepts: ASE writes double quotes but
  // single-quoted cells occur, and matching only `"` dropped the cell without a word, turning
  // a crystal into a molecule with every fractional coordinate at the origin.
  const match = /\bLattice\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/i.exec(comment)
  const raw = match?.groups?.double ?? match?.groups?.single
  if (raw === undefined) return undefined
  const vals = raw.trim().split(/\s+/).filter(Boolean).map(parse_float_token)
  if (vals.length !== 9 || !vals.every(Number.isFinite)) {
    throw new Error(`Invalid EXTXYZ Lattice: expected 9 finite numbers, got "${raw}"`)
  }
  return [vals.slice(0, 3), vals.slice(3, 6), vals.slice(6, 9)] as Matrix3x3
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

const EXTXYZ_COLUMN_ALIASES: Record<string, string> = {
  velocities: `velocity`,
  momenta: `momentum`,
  charges: `charge`,
  masses: `mass`,
}

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
const EXTXYZ_PAIR_RE =
  /(?:^|\s)(?<key>[A-Za-z_]\w*)\s*[=:]\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>\S+))/gu

// Read back by dedicated parsers (lattice, pbc, columns) or the step regex below, so
// re-emitting them as frame properties would duplicate or contradict the frame
const RESERVED_COMMENT_KEY_RE = /^(?:lattice|properties|pbc|step|frame|ionic_step)$/

// Spelling aliases only, so every other scalar round-trips under its own name — including
// `coords_unwrapped`, which decides whether MSD/VACF may re-apply the minimum image.
// oxfmt-ignore
const METADATA_KEY_ALIASES: Record<string, string> = {
  e: `energy`, etot: `energy`, total_energy: `energy`,
  vol: `volume`, v: `volume`,
  press: `pressure`, p: `pressure`,
  temp: `temperature`, t: `temperature`,
  max_force: `force_max`, fmax: `force_max`,
  e_gap: `bandgap`, gap: `bandgap`,
}

const comment_scalar = (raw: string): number | boolean | undefined => {
  const token = raw.trim()
  if (!token || /\s/u.test(token)) return undefined // multi-value: a signal, not a scalar
  const num = Number(token) // number first so `1`/`0` stay numbers, not flags
  return Number.isFinite(num) ? num : EXTXYZ_BOOL.get(token.toLowerCase())
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
      // Not a scalar: a quoted multi-value payload is a vec3 or a 3x3 matrix signal
      if (quoted === undefined) continue
      const values = raw
        .trim()
        .split(/[\s,]+/u)
        .map(Number)
      if (!values.every(Number.isFinite)) continue
      // under `lower` like the scalars below: `Stress=` and `stress=` are one series
      if (values.length === 3) signals[lower] = values
      else if (values.length === 9) {
        signals[lower] = [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)]
      }
      continue
    }
    // Lowercase, so `Free_Energy=` and `free_energy=` are one series, not two half-populated
    const canonical = METADATA_KEY_ALIASES[lower] ?? lower
    // leftmost wins, as the old regexes did
    if (canonical in properties || canonical in flags) continue
    if (typeof value === `boolean`) flags[canonical] = value
    else properties[canonical] = value
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
  text: string,
  { atoms_start, end, line, num_atoms, comment }: XyzFrameSpec,
  frame_label: string,
  warn: WarningCollector[`warn`],
): {
  elements: ElementSymbol[]
  positions: number[][]
  forces: number[][]
  site_properties: Record<string, unknown>[]
} {
  const { atomic_number_col, symbol_col, pos_col, forces_col, min_cols, layout, spec_error } =
    parse_extxyz_columns(comment)
  if (spec_error) throw new Error(`XYZ ${frame_label}: ${spec_error}`)
  const elements: ElementSymbol[] = []
  const positions: number[][] = []
  const forces: number[][] = []
  const site_properties: Record<string, unknown>[] = []
  const extra_columns = Object.entries(layout ?? {})
    .filter(([name]) => !RESERVED_EXTXYZ_COLUMNS.has(name))
    .map(([name, column]) => [EXTXYZ_COLUMN_ALIASES[name] ?? name, column] as const)
  const has_move_flags = MOVE_FLAG_COLUMNS.some((name) => layout?.[name])
  let move_flag_count = 0

  const scanner = new LineScanner()
  let cursor = atoms_start
  for (let idx = 0; idx < num_atoms; idx++) {
    const line_number = line + 2 + idx
    const line_start = cursor
    const eol = line_end(text, line_start, end)
    cursor = eol + 1
    const n_cols = scanner.scan(text, line_start, eol)
    // the quoted line is only built on error, so a `\r` is stripped there rather than per line
    const quoted = () => text.slice(line_start, eol).replace(/\r$/, ``)
    if (n_cols < min_cols) {
      throw new Error(
        `XYZ ${frame_label} line ${line_number} has ${n_cols} columns, expected at least ${min_cols}: "${quoted()}"`,
      )
    }
    const pos = [scanner.num(pos_col), scanner.num(pos_col + 1), scanner.num(pos_col + 2)]
    if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1]) || !Number.isFinite(pos[2])) {
      throw new TypeError(
        `XYZ ${frame_label} line ${line_number} has non-numeric coordinates: "${quoted()}"`,
      )
    }
    const element_symbol = scanned_element(scanner, symbol_col, atomic_number_col)
    if (!element_symbol) {
      warn(
        `Skipping XYZ atom with unknown element symbol "${scanner.str(symbol_col)}" in ${frame_label} at line ${line_number}`,
      )
      continue
    }
    elements.push(element_symbol)
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
    if (has_move_flags) {
      const flags = read_extxyz_move_flags(scanner, layout)
      if (flags) {
        props.selective_dynamics = flags
        move_flag_count++
      }
    }
    site_properties.push(props)
  }
  if (positions.length === 0) {
    scanner.scan(text, atoms_start, line_end(text, atoms_start, end))
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
    for (const props of site_properties) delete props.selective_dynamics
  }
  return { elements, positions, forces, site_properties }
}

// Comment-line fields every decode of a frame shares; warns once about an invalid pbc
function xyz_frame_header(
  comment: string,
  opts: { frame_label: string; default_step: number },
  collector: WarningCollector,
): {
  step: number
  lattice_matrix: Matrix3x3 | undefined
  pbc: Pbc | undefined
  metadata: Record<string, unknown>
} {
  const { step, properties, flags, signals } = parse_xyz_comment_metadata(comment)
  const lattice_matrix = parse_extxyz_lattice(comment)
  const parsed_pbc = parse_extxyz_pbc(comment)
  if (parsed_pbc === undefined && /\bpbc\s*=/iu.test(comment)) {
    collector.warn_once(
      `invalid-pbc`,
      `Invalid EXTXYZ pbc (first seen in ${opts.frame_label}); defaulting to fully periodic [T, T, T]`,
    )
  }
  const pbc = parsed_pbc ?? ([true, true, true] satisfies Pbc)
  return {
    step: step ?? opts.default_step,
    lattice_matrix,
    pbc: lattice_matrix ? pbc : undefined,
    metadata: { ...properties, ...flags, ...signals },
  }
}

export function build_xyz_frame(
  text: string,
  frame: XyzFrameSpec,
  opts: { frame_label: string; default_step: number },
  collector: WarningCollector,
): TrajectoryFrame {
  const { step, lattice_matrix, pbc, metadata } = xyz_frame_header(
    frame.comment,
    opts,
    collector,
  )
  const { elements, positions, forces, site_properties } = parse_xyz_atom_lines(
    text,
    frame,
    opts.frame_label,
    collector.warn,
  )
  // The vectors themselves live on the sites (`force`); only their statistics go here
  Object.assign(metadata, calc_force_stats(forces))
  return create_trajectory_frame(
    positions,
    elements,
    lattice_matrix,
    pbc,
    step,
    metadata,
    site_properties,
    collector.warn,
  )
}

// === Direct numeric decode ===
// The indexed reader's hot paths: atom lines scanned straight into typed arrays, no Site,
// species record or per-atom array. Output equals the Site path's (encode_frame of it, or its
// plot row), so any frame outside the common all-numeric shape is handed to that path.

type NumericXyzAtoms = {
  numbers: Uint8Array
  // null for a plot-row scan, which reads coordinates only to validate them
  positions: Float64Array | null
  // null unless every kept atom has a finite force
  forces: Float64Array | null
  extras: (NumericColumn & { ncols: 1 | 3 })[]
  // unknown-element warnings, emitted by the caller once the scan succeeded
  warnings: string[]
}

const numeric_scanner = new LineScanner()

// null when the frame needs the Site path: a bad or string/bool/move-flag column spec,
// extra columns other than dense finite 1- or 3-vectors, or any line that path rejects (it
// then throws its own error, after its own warnings). A plot-row scan ignores extra columns
// and tokenizes each line only as far as the element, coordinate and force columns.
function scan_numeric_xyz_atoms(
  text: string,
  { atoms_start, end, line, num_atoms, comment }: XyzFrameSpec,
  frame_label: string,
  plot_row: boolean,
): NumericXyzAtoms | null {
  const { atomic_number_col, symbol_col, pos_col, forces_col, min_cols, layout, spec_error } =
    parse_extxyz_columns(comment)
  if (spec_error) return null
  const extras: NumericXyzAtoms[`extras`] = []
  const extra_columns: ExtxyzColumn[] = []
  if (!plot_row) {
    for (const [name, column] of Object.entries(layout ?? {})) {
      if ((MOVE_FLAG_COLUMNS as readonly string[]).includes(name)) return null
      if (RESERVED_EXTXYZ_COLUMNS.has(name)) continue
      const key = EXTXYZ_COLUMN_ALIASES[name] ?? name
      const { type, ncols } = column
      if (type === `s` || type === `l` || (ncols !== 1 && ncols !== 3)) return null
      if (key === `__proto__` || extras.some((extra) => extra.key === key)) return null
      extras.push({ key, ncols, values: new Float64Array(num_atoms * ncols) })
      extra_columns.push(column)
    }
  }
  const max_columns = plot_row
    ? Math.max(min_cols, symbol_col + 1, forces_col >= 0 ? forces_col + 3 : 0)
    : Infinity
  const scanner = numeric_scanner
  const numbers = new Uint8Array(num_atoms)
  const positions = plot_row ? null : new Float64Array(num_atoms * 3)
  const forces = forces_col >= 0 ? new Float64Array(num_atoms * 3) : null
  const warnings: string[] = []
  let kept = 0
  let n_forces = 0
  let cursor = atoms_start
  for (let idx = 0; idx < num_atoms; idx++) {
    const line_start = cursor
    const eol = line_end(text, line_start, end)
    cursor = eol + 1
    const n_cols = scanner.scan(text, line_start, eol, max_columns)
    if (n_cols < min_cols) return null
    const pos_x = scanner.num(pos_col)
    const pos_y = scanner.num(pos_col + 1)
    const pos_z = scanner.num(pos_col + 2)
    if (!Number.isFinite(pos_x) || !Number.isFinite(pos_y) || !Number.isFinite(pos_z))
      return null
    const element_symbol = scanned_element(scanner, symbol_col, atomic_number_col)
    if (!element_symbol) {
      warnings.push(
        `Skipping XYZ atom with unknown element symbol "${scanner.str(symbol_col)}" in ${frame_label} at line ${line + 2 + idx}`,
      )
      continue
    }
    const atomic_number = symbol_to_atomic_number(element_symbol)
    if (atomic_number === undefined)
      throw new Error(`Element ${element_symbol} has no atomic number (${frame_label})`)
    numbers[kept] = atomic_number
    if (positions) {
      positions[kept * 3] = pos_x
      positions[kept * 3 + 1] = pos_y
      positions[kept * 3 + 2] = pos_z
    }
    if (forces && n_cols >= forces_col + 3) {
      const force_x = scanner.num(forces_col)
      const force_y = scanner.num(forces_col + 1)
      const force_z = scanner.num(forces_col + 2)
      if (Number.isFinite(force_x) && Number.isFinite(force_y) && Number.isFinite(force_z)) {
        forces[kept * 3] = force_x
        forces[kept * 3 + 1] = force_y
        forces[kept * 3 + 2] = force_z
        n_forces++
      }
    }
    for (let extra_idx = 0; extra_idx < extras.length; extra_idx++) {
      const { offset, ncols } = extra_columns[extra_idx]
      if (scanner.count < offset + ncols) return null
      const { values } = extras[extra_idx]
      for (let col = 0; col < ncols; col++) {
        const value = scanner.num(offset + col)
        if (!Number.isFinite(value)) return null
        values[kept * ncols + col] = value
      }
    }
    kept++
  }
  if (kept === 0) return null
  const trim = <T extends Uint8Array | Float64Array>(values: T, width: number): T =>
    (kept < num_atoms ? values.slice(0, kept * width) : values) as T
  for (const extra of extras) extra.values = trim(extra.values, extra.ncols)
  return {
    numbers: trim(numbers, 1),
    positions: positions && trim(positions, 3),
    forces: forces && n_forces === kept ? trim(forces, 3) : null,
    extras,
    warnings,
  }
}

// encode_frame(build_xyz_frame(...)) without building Site records
export function read_xyz_numeric_frame(
  text: string,
  frame: XyzFrameSpec,
  opts: { frame_label: string; default_step: number },
  collector: WarningCollector,
): NumericFrame {
  const { step, lattice_matrix, pbc, metadata } = xyz_frame_header(
    frame.comment,
    opts,
    collector,
  )
  const atoms = scan_numeric_xyz_atoms(text, frame, opts.frame_label, false)
  if (!atoms?.positions) return encode_frame(build_xyz_frame(text, frame, opts, collector))
  const { numbers, positions, forces, extras, warnings } = atoms
  for (const message of warnings) collector.warn(message)
  if (forces) Object.assign(metadata, calc_flat_force_stats(forces, numbers.length))
  // site property order: force, then the extra columns as the spec declares them
  const vectors = [
    ...(forces ? [{ key: `force`, values: forces }] : []),
    ...extras.filter(({ ncols }) => ncols === 3),
  ]
  return create_standard_numeric_frame(
    positions,
    numbers,
    lattice_matrix,
    pbc,
    step,
    metadata,
    vectors,
    extras.filter(({ ncols }) => ncols === 1),
    collector.warn,
  )
}

// A frame whose plot row (frame_property_row) equals build_xyz_frame's: metadata, force
// statistics, lattice and element counts, without positions or sites. `previous` holds the
// last frame's element bytes: an unchanged species column reuses them as the topology key so
// get_density counts elements once, not per frame.
export function xyz_plot_row_frame(
  text: string,
  frame: XyzFrameSpec,
  opts: { frame_label: string; default_step: number },
  collector: WarningCollector,
  previous: { numbers?: Uint8Array } = {},
): TrajectoryFrame {
  const { step, lattice_matrix, pbc, metadata } = xyz_frame_header(
    frame.comment,
    opts,
    collector,
  )
  const atoms = scan_numeric_xyz_atoms(text, frame, opts.frame_label, true)
  if (!atoms) return build_xyz_frame(text, frame, opts, collector)
  const { forces, warnings } = atoms
  let { numbers } = atoms
  for (const message of warnings) collector.warn(message)
  if (forces) Object.assign(metadata, calc_flat_force_stats(forces, numbers.length))
  const row_frame = create_trajectory_frame(
    [],
    [],
    lattice_matrix,
    pbc,
    step,
    metadata,
    undefined,
    collector.warn,
  )
  if (previous.numbers && equal_bytes(previous.numbers, numbers)) numbers = previous.numbers
  previous.numbers = numbers
  numeric_sites.set(
    row_frame.structure,
    new NumericSites(numbers, new Float64Array(0), [], []),
  )
  snapshot_topologies.set(row_frame.structure, numbers)
  return row_frame
}

const equal_bytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false
  for (let idx = 0; idx < left.length; idx++) if (left[idx] !== right[idx]) return false
  return true
}

// Every complete frame of a split XYZ file. A writer still appending leaves one of two tails:
// a frame whose atom block runs past the end of the file (iter_xyz_frames returns its header
// instead of yielding it) or a final frame whose last atom line, the file's last line, is
// half-written. Either is dropped with a warning. Any other defect in a complete final frame
// is corruption and throws like in every other frame.
export function index_xyz_frames(text: string, warn: WarnFn): XyzFrameSpec[] {
  const specs: XyzFrameSpec[] = []
  const frames = iter_xyz_frames(text)
  let next = frames.next()
  for (; !next.done; next = frames.next()) specs.push(next.value)
  const torn = next.value
  const drop = (spec: XyzFrameSpec, reason: string) =>
    warn(`Dropping truncated final XYZ frame ${specs.length} (line ${spec.line}): ${reason}`)
  if (torn) {
    let atom_lines = 0
    for (let pos = torn.atoms_start; pos < torn.end; pos = line_end(text, pos, torn.end) + 1) {
      atom_lines++
    }
    drop(torn, `${atom_lines} of ${torn.num_atoms} atom lines`)
    return specs
  }
  const last = specs.at(-1)
  // only a frame that reaches the end of the text can have a half-written last line
  if (!last || text.slice(last.end).trim() !== ``) return specs
  const { pos_col, min_cols } = parse_extxyz_columns(last.comment)
  let last_line_start = last.atoms_start
  for (let idx = 1; idx < last.num_atoms; idx++) {
    last_line_start = line_end(text, last_line_start, last.end) + 1
  }
  const last_line = text.slice(last_line_start, last.end).trimEnd()
  const scanner = new LineScanner()
  const complete =
    scanner.scan(last_line) >= min_cols &&
    [0, 1, 2].every((axis) => Number.isFinite(scanner.num(pos_col + axis)))
  if (complete) return specs
  specs.pop()
  drop(last, `partial atom line ${last.line + 1 + last.num_atoms} "${last_line}"`)
  return specs
}

export function parse_xyz_trajectory(
  content: string,
  collector: WarningCollector,
): ParsedTrajectory {
  const frames = index_xyz_frames(content, collector.warn).map((spec, frame_idx) =>
    build_xyz_frame(
      content,
      spec,
      { frame_label: `frame ${frame_idx} (line ${spec.line})`, default_step: frame_idx },
      collector,
    ),
  )
  if (frames.length === 0) throw new Error(`No XYZ frames found`)
  return { format: `xyz`, frames, metadata: {} }
}

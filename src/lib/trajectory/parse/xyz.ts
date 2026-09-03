import { element_from_atomic_number } from '$lib/element/helpers'
import type { ElementSymbol } from '$lib/element/types'
import type { Matrix3x3 } from '$lib/math'
import { LineScanner, parse_float_token } from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import type { ExtxyzColumn, XyzFrameSpec } from '$lib/trajectory/helpers'
import {
  calc_force_stats,
  create_trajectory_frame,
  elem_symbol_from_token,
  iter_xyz_frames,
  line_end,
  parse_extxyz_columns,
} from '$lib/trajectory/helpers'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import type { ParsedTrajectory, WarnFn, WarningCollector } from './shared'

export function parse_extxyz_lattice(comment: string): Matrix3x3 | undefined {
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

const RESERVED_EXTXYZ_COLUMNS = new Set([`species`, `pos`, `forces`, ...MOVE_FLAG_COLUMNS])

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

export function build_xyz_frame(
  text: string,
  frame: XyzFrameSpec,
  opts: { frame_label: string; default_step: number },
  collector: WarningCollector,
): TrajectoryFrame {
  const { comment } = frame
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
  const { elements, positions, forces, site_properties } = parse_xyz_atom_lines(
    text,
    frame,
    opts.frame_label,
    collector.warn,
  )
  const metadata: Record<string, unknown> = { ...properties, ...flags, ...signals }
  const force_stats = calc_force_stats(forces)
  if (force_stats) Object.assign(metadata, { forces, ...force_stats })
  return create_trajectory_frame(
    positions,
    elements,
    lattice_matrix,
    lattice_matrix ? pbc : undefined,
    step ?? opts.default_step,
    metadata,
    site_properties,
    collector.warn,
  )
}

// Force statistics straight off a frame's atom lines, without building the frame: what the
// indexed (large-file) run needs for its plot rows. Identical arithmetic to the materialized
// path's calc_force_stats over the same columns — including its rules that an atom whose
// species is unrecognised does not count and that forces are dropped unless every counted
// atom has them — so the force curve does not change with the file size that picks the path.
export function xyz_frame_force_stats(
  text: string,
  { atoms_start, end, num_atoms, comment }: XyzFrameSpec,
): { force_max: number; force_norm: number } | null {
  const { atomic_number_col, symbol_col, forces_col, min_cols, pos_col, spec_error } =
    parse_extxyz_columns(comment)
  // An unusable spec establishes no offsets, and the materialized path rejects the frame over
  // it. Scanning `forces_col` anyway published a force curve point for a frame that cannot be
  // built - here it read the tail of the position columns.
  if (spec_error || forces_col < 0) return null
  const scanner = new LineScanner()
  let force_max = -Infinity
  let sum_sq = 0
  let counted = 0
  let cursor = atoms_start
  for (let idx = 0; idx < num_atoms && cursor < end; idx++) {
    const eol = line_end(text, cursor, end)
    const n_cols = scanner.scan(text, cursor, eol)
    cursor = eol + 1
    if (n_cols < min_cols) return null
    // The frame builder rejects an atom whose coordinates are not finite. The frame walk's
    // atom-line test only rules out NaN, so an overflowing `1e999` reaches here and used to
    // contribute a force-curve point to a frame that cannot be built.
    if (![0, 1, 2].every((axis) => Number.isFinite(scanner.num(pos_col + axis)))) return null
    // An atom whose species the frame builder skips does not count toward the stats either
    if (!scanned_element(scanner, symbol_col, atomic_number_col)) continue
    if (n_cols < forces_col + 3) return null
    const force_x = scanner.num(forces_col)
    const force_y = scanner.num(forces_col + 1)
    const force_z = scanner.num(forces_col + 2)
    if (!Number.isFinite(force_x) || !Number.isFinite(force_y) || !Number.isFinite(force_z))
      return null
    const magnitude = Math.hypot(force_x, force_y, force_z)
    if (magnitude > force_max) force_max = magnitude
    sum_sq += magnitude ** 2
    counted++
  }
  if (counted === 0) return null
  return { force_max, force_norm: Math.sqrt(sum_sq / counted) }
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

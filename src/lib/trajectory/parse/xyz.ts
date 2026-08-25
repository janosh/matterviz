import type { ElementSymbol } from '$lib/element/types'
import type { Matrix3x3 } from '$lib/math'
import { LineScanner, parse_float_token } from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import type { XyzFrameSpec } from '$lib/trajectory/helpers'
import {
  calc_force_stats,
  create_trajectory_frame,
  elem_symbol_from_token,
  iter_xyz_frames,
  split_lines,
} from '$lib/trajectory/helpers'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import type { ParsedTrajectory, WarnFn, WarningCollector } from './shared'

type ExtxyzColumn = { offset: number; ncols: number; type: string }

function parse_extxyz_columns(comment: string): {
  species_col: number
  pos_col: number
  forces_col: number
  min_cols: number
  layout: Record<string, ExtxyzColumn> | null
} {
  const fields =
    /Properties\s*=\s*"?(?<properties>[^"\s]+)"?/i.exec(comment)?.[1].split(`:`) ?? []
  let layout: Record<string, ExtxyzColumn> | null = fields.length % 3 === 0 ? {} : null
  for (let idx = 0, offset = 0; layout && idx + 3 <= fields.length; idx += 3) {
    const ncols = Math.trunc(Number(fields[idx + 2]))
    if (Number.isInteger(ncols) && ncols > 0) {
      layout[fields[idx].toLowerCase()] = {
        offset,
        ncols,
        type: fields[idx + 1].toLowerCase(),
      }
      offset += ncols
    } else layout = null
  }
  const species_col = layout?.species?.offset ?? 0
  const pos_col = layout?.pos?.offset ?? 1
  const forces_col = layout?.forces && layout.forces.ncols >= 3 ? layout.forces.offset : -1
  return {
    species_col,
    pos_col,
    forces_col,
    min_cols: Math.max(pos_col + 3, species_col + 1),
    layout: layout && Object.keys(layout).length > 0 ? layout : null,
  }
}

export function parse_extxyz_lattice(comment: string): Matrix3x3 | undefined {
  const raw = /Lattice\s*=\s*"(?<lattice>[^"]*)"/i.exec(comment)?.[1]
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

const make_pattern = (keys: string): RegExp =>
  new RegExp(`(?:^|\\s)(?:${keys})\\s*[=:]\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)`, `i`)

const METADATA_PATTERNS = {
  energy: make_pattern(`energy|E|etot|total_energy`),
  volume: make_pattern(`volume|vol|V`),
  pressure: make_pattern(`pressure|press|P`),
  temperature: make_pattern(`temperature|temp|T`),
  force_max: make_pattern(`max_force|force_max|fmax`),
  bandgap: make_pattern(`bandgap|E_gap|gap`),
  time: make_pattern(`time`),
} as const

export function parse_xyz_comment_metadata(comment: string): {
  step?: number
  properties: Record<string, number>
} {
  const properties: Record<string, number> = {}
  for (const [key, pattern] of Object.entries(METADATA_PATTERNS)) {
    const match = pattern.exec(comment)
    if (match) properties[key] = Number(match[1])
  }
  const step = /(?:^|\s)(?:step|frame|ionic_step)\s*[=:]?\s*(?<step>\d+)/i.exec(comment)?.[1]
  return { step: step ? Math.trunc(Number(step)) : undefined, properties }
}

function parse_xyz_comment_signals(comment: string): Record<string, number[] | number[][]> {
  const signals: Record<string, number[] | number[][]> = {}
  const pattern =
    /(?:^|\s)(?<key>[A-Za-z_]\w*)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/gu
  for (const match of comment.matchAll(pattern)) {
    const key = match.groups?.key
    if (!key || [`properties`, `lattice`, `pbc`].includes(key.toLowerCase())) continue
    const raw = match.groups?.double ?? match.groups?.single ?? ``
    const values = raw
      .trim()
      .split(/[\s,]+/u)
      .map(Number)
    if (!values.every(Number.isFinite)) continue
    if (values.length === 3) signals[key] = values
    else if (values.length === 9) {
      signals[key] = [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)]
    }
  }
  return signals
}

// Symbols are case-normalised (`FE` -> `Fe`) like the structure parsers do. Unknown symbols
// are skipped (with a warning) rather than rejected because real files carry them: ASE writes
// `X` for ghost/dummy atoms and some codes emit placeholder species. A frame with no
// recognised atom at all, or a malformed coordinate, is corruption and names its line.
function parse_xyz_atom_lines(
  lines: string[],
  start: number,
  num_atoms: number,
  comment: string,
  frame_label: string,
  warn: WarningCollector[`warn`],
): {
  elements: ElementSymbol[]
  positions: number[][]
  forces: number[][]
  site_properties: Record<string, unknown>[]
} {
  const { species_col, pos_col, forces_col, min_cols, layout } = parse_extxyz_columns(comment)
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
  for (let idx = 0; idx < num_atoms; idx++) {
    const line_number = start + idx + 1
    const n_cols = scanner.scan(lines[start + idx])
    if (n_cols < min_cols) {
      throw new Error(
        `XYZ ${frame_label} line ${line_number} has ${n_cols} columns, expected at least ${min_cols}: "${lines[start + idx]}"`,
      )
    }
    const pos = [scanner.num(pos_col), scanner.num(pos_col + 1), scanner.num(pos_col + 2)]
    if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1]) || !Number.isFinite(pos[2])) {
      throw new TypeError(
        `XYZ ${frame_label} line ${line_number} has non-numeric coordinates: "${lines[start + idx]}"`,
      )
    }
    const symbol = scanner.str(species_col)
    const element_symbol = elem_symbol_from_token(symbol)
    if (!element_symbol) {
      warn(
        `Skipping XYZ atom with unknown element symbol "${symbol}" in ${frame_label} at line ${line_number}`,
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
    throw new TypeError(
      `XYZ ${frame_label} has no atom with a recognised element symbol in its ${num_atoms} atom lines (first species column: "${lines[start].trim().split(/\s+/)[species_col]}")`,
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
  lines: string[],
  frame: XyzFrameSpec,
  opts: { frame_label: string; default_step: number },
  collector: WarningCollector,
): TrajectoryFrame {
  const { start, num_atoms, comment } = frame
  const { step, properties } = parse_xyz_comment_metadata(comment)
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
    lines,
    start + 2,
    num_atoms,
    comment,
    opts.frame_label,
    collector.warn,
  )
  const metadata: Record<string, unknown> = {
    ...properties,
    ...parse_xyz_comment_signals(comment),
  }
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

// Every complete frame of a split XYZ file. A writer still appending leaves one of two tails:
// a frame whose atom block runs past the end of the file (iter_xyz_frames returns its header
// instead of yielding it) or a final frame whose last atom line, the file's last line, is
// half-written. Either is dropped with a warning. Any other defect in a complete final frame
// is corruption and throws like in every other frame.
export function index_xyz_frames(lines: string[], warn: WarnFn): XyzFrameSpec[] {
  const specs: XyzFrameSpec[] = []
  const frames = iter_xyz_frames(lines)
  let next = frames.next()
  for (; !next.done; next = frames.next()) specs.push(next.value)
  const torn = next.value
  const drop = (spec: XyzFrameSpec, reason: string) =>
    warn(
      `Dropping truncated final XYZ frame ${specs.length} (line ${spec.start + 1}): ${reason}`,
    )
  if (torn) {
    const atom_lines = Math.max(0, lines.length - torn.start - 2)
    drop(torn, `${atom_lines} of ${torn.num_atoms} atom lines`)
    return specs
  }
  const last = specs.at(-1)
  if (!last || last.start + last.num_atoms + 2 !== lines.length) return specs
  const { pos_col, min_cols } = parse_extxyz_columns(last.comment)
  const parts = lines[lines.length - 1].trim().split(/\s+/)
  const complete =
    parts.length >= min_cols &&
    [0, 1, 2].every((axis) => Number.isFinite(parse_float_token(parts[pos_col + axis])))
  if (complete) return specs
  specs.pop()
  drop(last, `partial atom line ${lines.length} "${lines[lines.length - 1]}"`)
  return specs
}

export function parse_xyz_trajectory(
  content: string,
  collector: WarningCollector,
): ParsedTrajectory {
  const lines = split_lines(content)
  const frames = index_xyz_frames(lines, collector.warn).map((spec, frame_idx) =>
    build_xyz_frame(
      lines,
      spec,
      { frame_label: `frame ${frame_idx} (line ${spec.start + 1})`, default_step: frame_idx },
      collector,
    ),
  )
  if (frames.length === 0) throw new Error(`No XYZ frames found`)
  return { format: `xyz`, frames, metadata: {} }
}

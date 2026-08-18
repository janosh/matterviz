// XYZ / extxyz trajectory parsing
import type { ElementSymbol } from '$lib/element/types'
import * as math from '$lib/math'
import { coerce_elem_symbol } from '$lib/element/helpers'
import type { Pbc } from '$lib/structure/pbc'
import {
  calc_force_stats,
  create_trajectory_frame,
  derive_time_step,
  iter_xyz_frames,
} from '$lib/trajectory/helpers'
import { get_traj_parse_warnings, traj_warn } from './diagnostics'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory/index'
import { normalize_scientific_notation } from '$lib/utils'

// `type` is the extxyz type letter, lowercased: `s` string, `r` real, `i` integer, `l` logical.
// Needed to decide whether a declared column reads back as a number, a string or a boolean.
export type ExtxyzColumn = { offset: number; ncols: number; type: string }
export type ExtxyzColumns = {
  species_col: number
  pos_col: number
  forces_col: number
  min_cols: number
  // Every declared column by lowercased name, so callers can read properties beyond the three
  // resolved above (move_mask, selective_dynamics, charges, ...) without re-parsing the string.
  // Null when Properties was absent or malformed and the conventional layout was assumed.
  layout: Record<string, ExtxyzColumn> | null
}

// Resolve species/pos/forces column offsets from an extxyz Properties string of
// name:type:ncols triples (e.g. "species:S:1:pos:R:3:forces:R:3"), falling back
// to the conventional "symbol x y z" layout when absent or malformed
export function parse_extxyz_columns(comment: string): ExtxyzColumns {
  const fields =
    /Properties\s*=\s*"?(?<properties>[^"\s]+)"?/i.exec(comment)?.[1].split(`:`) ?? []
  // Well-formed Properties is name:type:ncols triples; a non-multiple of 3 is malformed,
  // so bail to the conventional default rather than trusting a partial layout
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

// Parse Lattice="ax ay az bx by bz cx cy cz" from an extxyz comment line.
// Values go through normalize_scientific_notation so Fortran-style exponents (1.0D+00) and
// Mathematica's `*^` survive, matching how the atom coordinates themselves are read.
// Undefined means the file declared no cell (a molecule); a declared but unreadable cell
// throws instead, since silently rendering a crystal as an isolated molecule hides the defect.
export function parse_extxyz_lattice(comment: string): math.Matrix3x3 | undefined {
  const raw = /Lattice\s*=\s*"(?<lattice>[^"]*)"/i.exec(comment)?.[1]
  if (raw === undefined) return undefined
  const vals = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => Number(normalize_scientific_notation(token)))
  if (vals.length !== 9 || !vals.every(Number.isFinite)) {
    throw new Error(`Invalid EXTXYZ Lattice: expected 9 finite numbers, got "${raw}"`)
  }
  return [vals.slice(0, 3), vals.slice(3, 6), vals.slice(6, 9)] as math.Matrix3x3
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

// Read a declared boolean column as per-axis motion flags (T = free to move).
// ASE writes `move_mask:L:3` for a per-axis FixCartesian and `move_mask:L:1` for a whole-atom
// FixAtoms, so both arities are accepted and the 1-column form broadcasts. `selective_dynamics`
// is read as a fallback for files written by tools that use the VASP name. Anything else
// (missing column, short line, unrecognized token) yields undefined so callers fall through.
export function read_extxyz_move_flags(
  tokens: string[],
  layout: Record<string, ExtxyzColumn> | null,
): [boolean, boolean, boolean] | undefined {
  for (const name of MOVE_FLAG_COLUMNS) {
    const column = layout?.[name]
    if (!column || tokens.length < column.offset + Math.min(column.ncols, 3)) continue
    if (column.ncols >= 3) {
      const flags = tokens
        .slice(column.offset, column.offset + 3)
        .map((token) => EXTXYZ_BOOL.get(token.toLowerCase()))
      if (flags.every((flag) => flag !== undefined)) {
        return flags as [boolean, boolean, boolean]
      }
    } else {
      const flag = EXTXYZ_BOOL.get(tokens[column.offset].toLowerCase())
      if (flag !== undefined) return [flag, flag, flag]
    }
  }
  return undefined
}

// Structural fields, normalized motion flags, and forces handled with frame-level statistics.
const RESERVED_EXTXYZ_COLUMNS = new Set([`species`, `pos`, `forces`, ...MOVE_FLAG_COLUMNS])

// Canonical site-property names shared with LAMMPS and exporters.
const EXTXYZ_COLUMN_ALIASES: Record<string, string> = {
  velocities: `velocity`,
  momenta: `momentum`,
  charges: `charge`,
  masses: `mass`,
}

// Read one declared column of an atom line as a site property value. Logical columns
// become booleans, string columns strings, everything else numbers. Returns undefined
// when the line is too short or any component fails to parse, so a malformed column is
// dropped for that atom rather than written as NaN.
function read_extxyz_column(tokens: string[], column: ExtxyzColumn): unknown {
  const { offset, ncols, type } = column
  if (tokens.length < offset + ncols) return undefined
  const read_token = (token: string): number | string | boolean | undefined => {
    if (type === `s`) return token
    if (type === `l`) return EXTXYZ_BOOL.get(token.toLowerCase())
    const num = Number(normalize_scientific_notation(token))
    return Number.isFinite(num) ? num : undefined
  }
  const values = tokens.slice(offset, offset + ncols).map(read_token)
  if (values.includes(undefined)) return undefined
  return ncols === 1 ? values[0] : values
}

export function parse_extxyz_pbc(comment: string): Pbc | undefined {
  const match =
    /\bpbc\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>\S+(?:\s+\S+){0,2}))/iu.exec(
      comment,
    )
  const raw = (match?.groups?.double ?? match?.groups?.single ?? match?.groups?.bare)?.trim()
  if (!raw) return undefined
  // Stop before a following `Key=` token that bare matching may have swallowed
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

// Keys anchored at ^|\s and followed by [=:] so single-letter keys (E/V/P/T) don't match mid-word
const make_pattern = (keys: string): RegExp =>
  new RegExp(`(?:^|\\s)(?:${keys})\\s*[=:]\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)`, `i`)

const METADATA_PATTERNS = {
  energy: make_pattern(`energy|E|etot|total_energy`),
  volume: make_pattern(`volume|vol|V`),
  pressure: make_pattern(`pressure|press|P`),
  temperature: make_pattern(`temperature|temp|T`),
  force_max: make_pattern(`max_force|force_max|fmax`),
  bandgap: make_pattern(`bandgap|E_gap|gap`),
  // Absolute snapshot time; derive_time_step divides out the step interval.
  time: make_pattern(`time`),
} as const

// Extract step number and scalar properties from an (ext)XYZ comment line
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

// Parse quoted frame-level numerical vectors/tensors without interpreting unrelated
// extXYZ strings such as Properties, Lattice, or pbc. Three values become a vec3 and nine
// values a row-major 3x3 tensor, matching trajectory spectroscopy signal shapes.
export function parse_xyz_comment_signals(
  comment: string,
): Record<string, number[] | number[][]> {
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

type ForceStats = { forces: number[][]; force_max: number; force_norm: number }

// Parse num_atoms atom lines starting at lines[start], reading species/pos/forces from
// their Properties-declared column offsets; invalid atoms are skipped with a warning.
// force_stats holds raw forces plus max and RMS force magnitudes when forces are present.
// move_flags is populated only when every kept atom declared one, so a partially-annotated
// file doesn't silently report unconstrained axes for the atoms that were missing flags.
// Other declared columns become per-site properties under their canonical or declared name.
function parse_xyz_atom_lines(
  lines: string[],
  start: number,
  num_atoms: number,
  comment: string,
  frame_label: string,
): {
  elements: ElementSymbol[]
  positions: number[][]
  force_stats: ForceStats | null
  move_flags: [boolean, boolean, boolean][] | null
  site_properties: Record<string, unknown>[]
} {
  const { species_col, pos_col, forces_col, min_cols, layout } = parse_extxyz_columns(comment)
  const elements: ElementSymbol[] = []
  const positions: number[][] = []
  const forces: number[][] = []
  const move_flags: [boolean, boolean, boolean][] = []
  const site_properties: Record<string, unknown>[] = []
  const extra_columns = Object.entries(layout ?? {})
    .filter(([name]) => !RESERVED_EXTXYZ_COLUMNS.has(name))
    .map(([name, column]) => [EXTXYZ_COLUMN_ALIASES[name] ?? name, column] as const)

  for (let idx = 0; idx < num_atoms; idx++) {
    const parts = lines[start + idx]?.trim().split(/\s+/) ?? []
    if (parts.length < min_cols) continue
    const pos = parts.slice(pos_col, pos_col + 3).map(parseFloat)
    if (!pos.every(Number.isFinite)) {
      traj_warn(
        `Skipping XYZ atom with invalid coordinates in ${frame_label} at line ${
          start + idx + 1
        }`,
      )
      continue
    }
    const symbol = parts[species_col]
    const element_symbol = coerce_elem_symbol(symbol)
    if (!element_symbol) {
      traj_warn(`Skipping XYZ atom with unknown element symbol "${symbol}" in ${frame_label}`)
      continue
    }
    elements.push(element_symbol)
    positions.push(pos)
    if (forces_col >= 0 && parts.length >= forces_col + 3) {
      const force_vec = parts.slice(forces_col, forces_col + 3).map(parseFloat)
      if (force_vec.every(Number.isFinite)) forces.push(force_vec)
    }
    const flags = read_extxyz_move_flags(parts, layout)
    if (flags) move_flags.push(flags)

    const props: Record<string, unknown> = {}
    for (const [name, column] of extra_columns) {
      const value = read_extxyz_column(parts, column)
      if (value !== undefined) props[name] = value
    }
    site_properties.push(props)
  }

  const stats = calc_force_stats(forces)
  return {
    elements,
    positions,
    force_stats: stats && { forces, ...stats },
    move_flags:
      move_flags.length === positions.length && positions.length > 0 ? move_flags : null,
    site_properties,
  }
}

// Assemble a TrajectoryFrame from the XYZ frame starting at lines[start] (count line,
// comment line, atom lines). Shared by the eager parser and the indexed frame reader.
export function build_xyz_frame(
  lines: string[],
  frame: { start: number; num_atoms: number; comment: string },
  opts: { frame_label: string; default_step: number },
): TrajectoryFrame {
  const { start, num_atoms, comment } = frame
  const { step, properties } = parse_xyz_comment_metadata(comment)
  const lattice_matrix = parse_extxyz_lattice(comment)
  const parsed_pbc = parse_extxyz_pbc(comment)
  if (
    parsed_pbc === undefined &&
    /\bpbc\s*=/iu.test(comment) &&
    !get_traj_parse_warnings().some((msg) => msg.includes(`Invalid EXTXYZ pbc`))
  ) {
    traj_warn(
      `Invalid EXTXYZ pbc (first seen in ${opts.frame_label}); defaulting to fully periodic [T, T, T]`,
    )
  }
  const pbc = parsed_pbc ?? ([true, true, true] satisfies Pbc)
  const { elements, positions, force_stats, move_flags, site_properties } =
    parse_xyz_atom_lines(lines, start + 2, num_atoms, comment, opts.frame_label)
  const metadata: Record<string, unknown> = {
    ...properties,
    ...parse_xyz_comment_signals(comment),
    ...force_stats,
  }
  if (lattice_matrix) metadata.volume = math.calc_lattice_params(lattice_matrix).volume
  const built = create_trajectory_frame(
    positions,
    elements,
    lattice_matrix,
    lattice_matrix ? pbc : undefined,
    step ?? opts.default_step,
    metadata,
  )
  // Attach per-atom data to sites. Forces are all-or-nothing and use the canonical singular key.
  const { sites } = built.structure
  const forces = force_stats?.forces.length === sites.length ? force_stats.forces : null
  for (const [idx, site] of sites.entries()) {
    site.properties = { ...site.properties, ...site_properties[idx] }
    if (forces) site.properties.force = forces[idx]
    if (move_flags) site.properties.selective_dynamics = move_flags[idx]
  }
  return built
}

export function parse_xyz_trajectory(content: string): TrajectoryType {
  const lines = content.trim().split(/\r?\n/)
  const frames: TrajectoryFrame[] = []

  for (const frame of iter_xyz_frames(lines)) {
    frames.push(
      build_xyz_frame(lines, frame, {
        frame_label: `frame ${frames.length}`,
        default_step: frames.length,
      }),
    )
  }

  // extXYZ does not state the time unit, so do not guess time_unit.
  const time_step = derive_time_step(
    frames.map(({ metadata }) => (typeof metadata?.time === `number` ? metadata.time : null)),
    frames.map(({ step }) => step),
  )

  return {
    frames,
    ...(time_step === undefined ? {} : { time_step }),
    metadata: {
      source_format: `xyz_trajectory`,
      frame_count: frames.length,
      total_atoms: frames[0]?.structure.sites.length || 0,
    },
  }
}

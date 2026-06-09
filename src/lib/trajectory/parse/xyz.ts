// XYZ / extxyz trajectory parsing
import type { ElementSymbol } from '$lib/element/types'
import * as math from '$lib/math'
import { coerce_elem_symbol } from '$lib/element'
import {
  calc_force_stats,
  create_trajectory_frame,
  iter_xyz_frames,
} from '$lib/trajectory/helpers'
import { traj_warn } from './diagnostics'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory/index'

// Resolve species/pos/forces column offsets from an extxyz Properties string of
// name:type:ncols triples (e.g. "species:S:1:pos:R:3:forces:R:3"), falling back
// to the conventional "symbol x y z" layout when absent or malformed
function parse_extxyz_columns(comment: string) {
  const fields = /Properties\s*=\s*"?([^"\s]+)"?/i.exec(comment)?.[1].split(`:`) ?? []
  // Well-formed Properties is name:type:ncols triples; a non-multiple of 3 is malformed,
  // so bail to the conventional default rather than trusting a partial layout
  let layout: Record<string, { offset: number; ncols: number }> | null =
    fields.length % 3 === 0 ? {} : null
  for (let idx = 0, offset = 0; layout && idx + 3 <= fields.length; idx += 3) {
    const ncols = parseInt(fields[idx + 2], 10)
    if (Number.isInteger(ncols) && ncols > 0) {
      layout[fields[idx].toLowerCase()] = { offset, ncols }
      offset += ncols
    } else layout = null
  }
  const species_col = layout?.species?.offset ?? 0
  const pos_col = layout?.pos?.offset ?? 1
  const forces_col = layout?.forces && layout.forces.ncols >= 3 ? layout.forces.offset : -1
  return { species_col, pos_col, forces_col, min_cols: Math.max(pos_col + 3, species_col + 1) }
}

// Parse Lattice="ax ay az bx by bz cx cy cz" from an extxyz comment line
export function parse_extxyz_lattice(comment: string): math.Matrix3x3 | undefined {
  const vals = /Lattice\s*=\s*"([^"]+)"/i.exec(comment)?.[1].trim().split(/\s+/).map(Number)
  if (vals?.length !== 9 || !vals.every(Number.isFinite)) return undefined
  return [vals.slice(0, 3), vals.slice(3, 6), vals.slice(6, 9)] as math.Matrix3x3
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
} as const

// Extract step number and scalar properties from an (ext)XYZ comment line
export function parse_xyz_comment_metadata(comment: string): {
  step?: number
  properties: Record<string, number>
} {
  const properties: Record<string, number> = {}
  for (const [key, pattern] of Object.entries(METADATA_PATTERNS)) {
    const match = pattern.exec(comment)
    if (match) properties[key] = parseFloat(match[1])
  }
  const step = /(?:^|\s)(?:step|frame|ionic_step)\s*[=:]?\s*(\d+)/i.exec(comment)?.[1]
  return { step: step ? parseInt(step, 10) : undefined, properties }
}

type ForceStats = { forces: number[][]; force_max: number; force_norm: number }

// Parse num_atoms atom lines starting at lines[start], reading species/pos/forces from
// their Properties-declared column offsets; invalid atoms are skipped with a warning.
// force_stats holds raw forces plus max and RMS force magnitudes when forces are present.
export function parse_xyz_atom_lines(
  lines: string[],
  start: number,
  num_atoms: number,
  comment: string,
  frame_label: string,
): { elements: ElementSymbol[]; positions: number[][]; force_stats: ForceStats | null } {
  const { species_col, pos_col, forces_col, min_cols } = parse_extxyz_columns(comment)
  const elements: ElementSymbol[] = []
  const positions: number[][] = []
  const forces: number[][] = []

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
  }

  const stats = calc_force_stats(forces)
  return { elements, positions, force_stats: stats && { forces, ...stats } }
}

export function parse_xyz_trajectory(content: string): TrajectoryType {
  const lines = content.trim().split(/\r?\n/)
  const frames: TrajectoryFrame[] = []

  for (const { start, num_atoms, comment } of iter_xyz_frames(lines)) {
    const { step, properties } = parse_xyz_comment_metadata(comment)
    const metadata: Record<string, unknown> = { ...properties }

    const lattice_matrix = parse_extxyz_lattice(comment)
    if (lattice_matrix) metadata.volume = math.calc_lattice_params(lattice_matrix).volume

    const { elements, positions, force_stats } = parse_xyz_atom_lines(
      lines,
      start + 2,
      num_atoms,
      comment,
      `frame ${frames.length}`,
    )
    Object.assign(metadata, force_stats)
    frames.push(
      create_trajectory_frame(
        positions,
        elements,
        lattice_matrix,
        lattice_matrix ? [true, true, true] : undefined,
        step ?? frames.length,
        metadata,
      ),
    )
  }

  return {
    frames,
    metadata: {
      source_format: `xyz_trajectory`,
      frame_count: frames.length,
      total_atoms: frames[0]?.structure.sites.length || 0,
    },
  }
}

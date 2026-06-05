// XYZ / extxyz trajectory parsing
import type { ElementSymbol } from '$lib/element/types'
import * as math from '$lib/math'
import { coerce_element_symbol, create_trajectory_frame } from '$lib/trajectory/helpers'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory/index'

// Resolve species/pos/forces column offsets from an extxyz Properties string of
// name:type:ncols triples (e.g. "species:S:1:pos:R:3:forces:R:3"), falling back
// to the conventional "symbol x y z" layout when absent or malformed
export function parse_extxyz_columns(comment: string) {
  const fields = /Properties\s*=\s*"?([^"\s]+)"?/i.exec(comment)?.[1].split(`:`) ?? []
  let layout: Record<string, { offset: number; ncols: number }> | null = {}
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

export function parse_xyz_trajectory(content: string): TrajectoryType {
  const lines = content.trim().split(/\r?\n/)
  const frames: TrajectoryFrame[] = []
  let line_idx = 0

  while (line_idx < lines.length) {
    if (!lines[line_idx]?.trim()) {
      line_idx++
      continue
    }

    const num_atoms = parseInt(lines[line_idx].trim(), 10)
    if (isNaN(num_atoms) || num_atoms <= 0 || line_idx + num_atoms + 1 >= lines.length) {
      line_idx++
      continue
    }

    const comment = lines[++line_idx] || ``
    const metadata: Record<string, unknown> = {}

    // Keys anchored at ^|\s and followed by [=:] so single-letter keys don't match mid-word
    const extractors = {
      step: /(?:^|\s)(?:step|frame|ionic_step)\s*[=:]?\s*(\d+)/i,
      energy:
        /(?:^|\s)(?:energy|E|etot|total_energy)\s*[=:]\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      volume: /(?:^|\s)(?:volume|vol|V)\s*[=:]\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      pressure: /(?:^|\s)(?:pressure|press|P)\s*[=:]\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      temperature:
        /(?:^|\s)(?:temperature|temp|T)\s*[=:]\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      force_max:
        /(?:^|\s)(?:max_force|force_max|fmax)\s*[=:]\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      bandgap: /(?:^|\s)(?:bandgap|E_gap|gap)\s*[=:]\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
    }

    const step_match = extractors.step.exec(comment)
    const step = step_match?.[1] ? parseInt(step_match[1], 10) : frames.length
    Object.entries(extractors).forEach(([key, pattern]) => {
      if (key === `step`) return
      const match = pattern.exec(comment)
      if (match) metadata[key] = parseFloat(match[1])
    })

    const lattice_matrix = parse_extxyz_lattice(comment)
    if (lattice_matrix) metadata.volume = math.calc_lattice_params(lattice_matrix).volume

    // Parse atoms, reading each field from its Properties-declared column offset
    const positions: number[][] = []
    const elements: ElementSymbol[] = []
    const forces: number[][] = []
    const { species_col, pos_col, forces_col, min_cols } = parse_extxyz_columns(comment)

    for (let idx = 0; idx < num_atoms; idx++) {
      line_idx++
      if (line_idx >= lines.length) break
      const parts = lines[line_idx].trim().split(/\s+/)
      if (parts.length >= min_cols) {
        const x_coord = parseFloat(parts[pos_col])
        const y_coord = parseFloat(parts[pos_col + 1])
        const z_coord = parseFloat(parts[pos_col + 2])
        if (
          !Number.isFinite(x_coord) ||
          !Number.isFinite(y_coord) ||
          !Number.isFinite(z_coord)
        ) {
          console.warn(
            `Skipping XYZ atom with invalid coordinates in frame ${frames.length} at line ${
              line_idx + 1
            }`,
          )
          continue
        }

        const raw_symbol = parts[species_col]
        const element_symbol = coerce_element_symbol(raw_symbol)
        if (!element_symbol) {
          console.warn(
            `Skipping XYZ atom with unknown element symbol "${raw_symbol}" in frame ${frames.length}`,
          )
          continue
        }
        elements.push(element_symbol)
        positions.push([x_coord, y_coord, z_coord])

        if (forces_col >= 0 && parts.length >= forces_col + 3) {
          const force_vec = parts.slice(forces_col, forces_col + 3).map(parseFloat)
          if (force_vec.every(Number.isFinite)) forces.push(force_vec)
        }
      }
    }
    if (forces.length > 0) {
      metadata.forces = forces
      const magnitudes = forces.map((force) => Math.hypot(...force))
      metadata.force_max = Math.max(...magnitudes)
      // Calculate RMS (root mean square) of force magnitudes
      metadata.force_norm = Math.sqrt(
        magnitudes.reduce((sum, mag) => sum + mag ** 2, 0) / magnitudes.length,
      )
    }
    frames.push(
      create_trajectory_frame(
        positions,
        elements,
        lattice_matrix,
        lattice_matrix ? [true, true, true] : undefined,
        step,
        metadata,
      ),
    )
    line_idx++
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

// XYZ / extxyz trajectory parsing
import type { ElementSymbol } from '$lib/element'
import * as math from '$lib/math'
import type { TrajectoryFrame, TrajectoryType } from '../index'
import { coerce_element_symbol, create_trajectory_frame } from '../helpers'

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

    // Extract properties efficiently
    const extractors = {
      step: /(?:step|frame|ionic_step)\s*[=:]?\s*(\d+)/i,
      energy:
        /(?:energy|E|etot|total_energy)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      volume: /(?:volume|vol|V)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      pressure: /(?:pressure|press|P)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      temperature: /(?:temperature|temp|T)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      force_max:
        /(?:max_force|force_max|fmax)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
      bandgap: /(?:bandgap|E_gap|gap)\s*[=:]?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i,
    }

    const step_match = extractors.step.exec(comment)
    const step = step_match?.[1] ? parseInt(step_match[1]) : frames.length
    Object.entries(extractors).forEach(([key, pattern]) => {
      if (key === `step`) return
      const match = pattern.exec(comment)
      if (match) metadata[key] = parseFloat(match[1])
    })

    // Extract lattice matrix
    const lattice_match = comment.match(/Lattice\s*=\s*"([^"]+)"/i)
    let lattice_matrix: math.Matrix3x3 | undefined
    if (lattice_match) {
      const values = lattice_match[1].split(/\s+/).map(Number)
      if (values.length === 9 && values.every((value) => Number.isFinite(value))) {
        lattice_matrix = [[values[0], values[1], values[2]], [
          values[3],
          values[4],
          values[5],
        ], [values[6], values[7], values[8]]]
        metadata.volume = math.calc_lattice_params(lattice_matrix).volume
      }
    }

    // Parse atoms
    const positions: number[][] = []
    const elements: ElementSymbol[] = []
    const forces: number[][] = []
    const has_forces = comment.includes(`forces:R:3`)

    for (let idx = 0; idx < num_atoms; idx++) {
      line_idx++
      if (line_idx >= lines.length) break
      const parts = lines[line_idx].trim().split(/\s+/)
      if (parts.length >= 4) {
        const x_coord = parseFloat(parts[1])
        const y_coord = parseFloat(parts[2])
        const z_coord = parseFloat(parts[3])
        if (
          !Number.isFinite(x_coord) || !Number.isFinite(y_coord) ||
          !Number.isFinite(z_coord)
        ) {
          console.warn(
            `Skipping XYZ atom with invalid coordinates in frame ${frames.length} at line ${
              line_idx + 1
            }`,
          )
          continue
        }

        const raw_symbol = parts[0]
        const element_symbol = coerce_element_symbol(raw_symbol)
        if (!element_symbol) {
          console.warn(
            `Skipping XYZ atom with unknown element symbol "${raw_symbol}" in frame ${frames.length}`,
          )
          continue
        }
        elements.push(element_symbol)
        positions.push([x_coord, y_coord, z_coord])

        if (has_forces && parts.length >= 7) {
          const force_x = parseFloat(parts[4])
          const force_y = parseFloat(parts[5])
          const force_z = parseFloat(parts[6])
          if (
            Number.isFinite(force_x) &&
            Number.isFinite(force_y) &&
            Number.isFinite(force_z)
          ) {
            forces.push([force_x, force_y, force_z])
          }
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

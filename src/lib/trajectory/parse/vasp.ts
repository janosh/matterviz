// VASP XDATCAR trajectory parsing
import type { ElementSymbol } from '$lib/element'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Pbc } from '$lib/structure'
import type { TrajectoryFrame, TrajectoryType } from '../index'
import {
  create_trajectory_frame,
  is_valid_element_symbol,
  validate_3x3_matrix,
} from '../helpers'

export function parse_vasp_xdatcar(
  content: string,
  filename?: string,
): TrajectoryType {
  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 10) throw new Error(`XDATCAR file too short`)

  const scale = parseFloat(lines[1])
  if (isNaN(scale)) throw new Error(`Invalid scale factor`)

  const lattice_matrix = validate_3x3_matrix(
    lines.slice(2, 5).map((line) =>
      line.trim().split(/\s+/).map((x) => parseFloat(x) * scale)
    ),
  )

  const element_names = lines[5].trim().split(/\s+/)
  const element_counts = lines[6].trim().split(/\s+/).map(Number)
  if (element_names.length !== element_counts.length) {
    throw new Error(
      `XDATCAR element names/counts mismatch: names=${element_names.length}, counts=${element_counts.length}`,
    )
  }
  if (
    element_counts.some((count) =>
      !Number.isFinite(count) || !Number.isInteger(count) || count <= 0
    )
  ) {
    throw new Error(
      `XDATCAR contains invalid element counts: expected finite positive integers`,
    )
  }
  const validated_element_names = element_names.map((name) => {
    if (!is_valid_element_symbol(name)) {
      throw new Error(`Invalid element symbol in XDATCAR: ${name}`)
    }
    return name
  })
  const elements: ElementSymbol[] = validated_element_names.flatMap((name, idx) =>
    Array(element_counts[idx]).fill(name as ElementSymbol)
  )

  const frames: TrajectoryFrame[] = []
  let line_idx = 7
  const frac_to_cart = math.create_frac_to_cart(lattice_matrix)

  while (line_idx < lines.length) {
    const config_idx = lines.findIndex((line, idx) =>
      idx >= line_idx && line.includes(`Direct configuration=`)
    )
    if (config_idx === -1) break

    const config_line = lines[config_idx]
    line_idx = config_idx + 1
    const step_match = config_line.match(/configuration=\s*(\d+)/)
    const step = step_match ? parseInt(step_match[1]) : frames.length + 1

    const positions = []
    for (let idx = 0; idx < elements.length && line_idx < lines.length; idx++) {
      const coords = lines[line_idx].trim().split(/\s+/).slice(0, 3).map(Number)
      if (coords.length === 3 && !coords.some(isNaN)) {
        positions.push(frac_to_cart(coords as Vec3))
      }
      line_idx++
    }

    if (positions.length === elements.length) {
      const pbc: Pbc = [true, true, true]
      const { volume } = math.calc_lattice_params(lattice_matrix)
      frames.push(
        create_trajectory_frame(positions, elements, lattice_matrix, pbc, step, {
          volume,
        }),
      )
    }
  }

  return {
    frames,
    metadata: {
      filename,
      source_format: `vasp_xdatcar`,
      frame_count: frames.length,
      total_atoms: elements.length,
      periodic_boundary_conditions: [true, true, true],
      elements: element_names,
      element_counts,
    },
  }
}

// VASP XDATCAR trajectory parsing
import type { ElementSymbol } from '$lib/element/types'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory/index'
import { is_elem_symbol } from '$lib/element'
import { create_trajectory_frame, validate_3x3_matrix } from '$lib/trajectory/helpers'

// Parse the 7-line XDATCAR header at lines[start]: title, scale factor, 3 lattice rows
// (multiplied by scale), element names, element counts
function parse_xdatcar_header(lines: string[], start: number) {
  const scale = parseFloat(lines[start + 1])
  const rows = lines.slice(start + 2, start + 5).map((line) =>
    line
      .trim()
      .split(/\s+/)
      .map((val) => parseFloat(val) * scale),
  )
  const names = lines[start + 5].trim().split(/\s+/)
  const counts = lines[start + 6].trim().split(/\s+/).map(Number)
  return { scale, rows, names, counts }
}

export function parse_vasp_xdatcar(content: string, filename?: string): TrajectoryType {
  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 10) throw new Error(`XDATCAR file too short`)

  const header = parse_xdatcar_header(lines, 0)
  const { names: element_names, counts: element_counts } = header
  if (isNaN(header.scale)) throw new Error(`Invalid scale factor`)
  let lattice_matrix = validate_3x3_matrix(header.rows)

  if (element_names.length !== element_counts.length) {
    throw new Error(
      `XDATCAR element names/counts mismatch: names=${element_names.length}, counts=${element_counts.length}`,
    )
  }
  if (
    element_counts.some(
      (count) => !Number.isFinite(count) || !Number.isInteger(count) || count <= 0,
    )
  ) {
    throw new Error(
      `XDATCAR contains invalid element counts: expected finite positive integers`,
    )
  }
  const bad_element = element_names.find((name) => !is_elem_symbol(name))
  if (bad_element) throw new Error(`Invalid element symbol in XDATCAR: ${bad_element}`)
  // "Na Cl" + [2, 2] -> [Na, Na, Cl, Cl]
  const expand_element_counts = (names: string[], counts: number[]): ElementSymbol[] =>
    names.flatMap((name, idx) => Array(counts[idx]).fill(name))
  let elements = expand_element_counts(element_names, element_counts)

  const frames: TrajectoryFrame[] = []
  let line_idx = 7
  let frac_to_cart = math.create_frac_to_cart(lattice_matrix)

  while (line_idx < lines.length) {
    const config_idx = lines.findIndex(
      (line, idx) => idx >= line_idx && line.includes(`Direct configuration=`),
    )
    if (config_idx === -1) break

    // Variable-cell runs (NPT/ISIF=3) repeat the full 7-line header before each configuration
    if (config_idx - line_idx >= 7) {
      const hdr = parse_xdatcar_header(lines, config_idx - 7)
      if (
        Number.isFinite(hdr.scale) &&
        hdr.rows.every((row) => row.length === 3 && row.every(Number.isFinite))
      ) {
        lattice_matrix = validate_3x3_matrix(hdr.rows)
        frac_to_cart = math.create_frac_to_cart(lattice_matrix)
        if (
          hdr.names.length === hdr.counts.length &&
          hdr.names.every(is_elem_symbol) &&
          hdr.counts.every((count) => Number.isInteger(count) && count > 0)
        ) {
          elements = expand_element_counts(hdr.names, hdr.counts)
        }
      }
    }

    const config_line = lines[config_idx]
    line_idx = config_idx + 1
    const step_match = /configuration=\s*(?<step>\d+)/.exec(config_line)
    const step = step_match ? parseInt(step_match[1], 10) : frames.length + 1

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

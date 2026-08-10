// VASP XDATCAR trajectory parsing
import type { ElementSymbol } from '$lib/element/types'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory/index'
import { lines_cursor, parse_vasp_header } from '$lib/structure/parsers/vasp-header'
import { create_trajectory_frame } from '$lib/trajectory/helpers'

// The XDATCAR header is the POSCAR one minus the coordinate-mode line, because its
// `Direct configuration= N` line doubles as the frame marker and the frame loop needs to
// read it. `strict_species` keeps XDATCAR's refusal to invent element symbols: they end up
// in the trajectory metadata, where an indexed fallback would be a silent lie.
const parse_xdatcar_header = (lines: string[], start: number) => {
  const cursor = lines_cursor(lines, start)
  const result = parse_vasp_header(cursor, {
    format: `XDATCAR`,
    coord_mode: `skip`,
    strict_species: true,
    line_offset: start,
  })
  // `end` is normally start + 7, but a wrapped element-symbol block makes the header longer
  return { result, end: cursor.position() }
}

export function parse_vasp_xdatcar(content: string, filename?: string): TrajectoryType {
  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 10) throw new Error(`XDATCAR file too short`)

  const { result: parsed, end: header_end } = parse_xdatcar_header(lines, 0)
  if (!parsed.ok) throw new Error(parsed.error)
  const { elements: element_names, counts: element_counts } = parsed.header
  let lattice_matrix = parsed.header.lattice

  // "Na Cl" + [2, 2] -> [Na, Na, Cl, Cl]
  const expand_element_counts = (
    names: readonly ElementSymbol[],
    counts: readonly number[],
  ): ElementSymbol[] => names.flatMap((name, idx) => Array(counts[idx]).fill(name))
  let elements = expand_element_counts(element_names, element_counts)

  const frames: TrajectoryFrame[] = []
  let line_idx = header_end
  let frac_to_cart = math.create_frac_to_cart(lattice_matrix)

  while (line_idx < lines.length) {
    // Scan forward from the cursor: `lines.findIndex` restarts at 0 every frame, making this
    // O(F x total_lines) — quadratic in frame count on long MD runs.
    let config_idx = line_idx
    while (config_idx < lines.length) {
      if (lines[config_idx].includes(`Direct configuration=`)) break
      config_idx++
    }
    if (config_idx === lines.length) break

    // Variable-cell runs repeat full headers; wrapped species blocks exceed seven lines.
    if (config_idx > line_idx) {
      const { result: repeat, end } = parse_xdatcar_header(lines, line_idx)
      if (repeat.ok && end === config_idx) {
        lattice_matrix = repeat.header.lattice
        frac_to_cart = math.create_frac_to_cart(lattice_matrix)
        elements = expand_element_counts(repeat.header.elements, repeat.header.counts)
      }
    }

    const config_line = lines[config_idx]
    line_idx = config_idx + 1
    const step_match = /configuration=\s*(?<step>\d+)/.exec(config_line)
    const step = step_match ? Math.trunc(Number(step_match[1])) : frames.length + 1

    const positions = []
    for (let idx = 0; idx < elements.length && line_idx < lines.length; idx++) {
      // Read the tokens directly: slice().map(Number) allocated two throwaway arrays per line
      const tokens = lines[line_idx].trim().split(/\s+/)
      if (tokens.length >= 3) {
        const coords: Vec3 = [Number(tokens[0]), Number(tokens[1]), Number(tokens[2])]
        if (!coords.some(isNaN)) positions.push(frac_to_cart(coords))
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

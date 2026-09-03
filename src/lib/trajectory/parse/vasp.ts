// VASP XDATCAR trajectory parsing
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import { parse_float_token } from '$lib/structure/parsers/shared'
import { lines_cursor, parse_vasp_header } from '$lib/structure/parsers/vasp-header'
import {
  create_trajectory_frame,
  expand_ion_types,
  split_lines,
} from '$lib/trajectory/helpers'
import type { ParsedTrajectory, WarnFn } from './shared'

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

export function parse_vasp_xdatcar(content: string, warn: WarnFn): ParsedTrajectory {
  const lines = split_lines(content)
  if (lines.length < 10) throw new Error(`XDATCAR file too short`)

  const { result: parsed, end: header_end } = parse_xdatcar_header(lines, 0)
  if (!parsed.ok) throw new Error(parsed.error)
  const { elements: element_names, counts: element_counts } = parsed.header
  let lattice_matrix = parsed.header.lattice
  // One fractional-coordinate line per ion, so no file can hold more ions than it has lines
  const line_budget = { max_ions: lines.length, source: `XDATCAR lines` }
  let elements = expand_ion_types(element_names, element_counts, line_budget)

  const frames: TrajectoryFrame[] = []
  let line_idx = header_end
  let frac_to_cart = math.create_frac_to_cart(lattice_matrix)

  while (line_idx < lines.length) {
    // Scan forward from the cursor, never from line 0: a whole-file search per frame would be
    // quadratic in the frame count on long MD runs
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
        elements = expand_ion_types(repeat.header.elements, repeat.header.counts, line_budget)
      }
    }

    const config_line = lines[config_idx]
    line_idx = config_idx + 1
    const step_match = /configuration=\s*(?<step>\d+)/.exec(config_line)
    const step = step_match ? Math.trunc(Number(step_match[1])) : frames.length + 1

    // A frame cut off by the end of the file (missing lines, or a half-written final line) is
    // a writer still appending: drop it with a warning. A malformed line anywhere else is
    // corruption and names itself.
    if (line_idx + elements.length > lines.length) {
      warn(
        `Dropping truncated final XDATCAR frame ${step} (line ${config_idx + 1}): ${lines.length - line_idx} of ${elements.length} coordinate lines`,
      )
      break
    }
    const positions: Vec3[] = []
    let torn_last_line = false
    for (let idx = 0; idx < elements.length; idx++, line_idx++) {
      const tokens = lines[line_idx].trim().split(/\s+/)
      const coords: Vec3 = [
        parse_float_token(tokens[0]),
        parse_float_token(tokens[1]),
        parse_float_token(tokens[2]),
      ]
      if (
        !Number.isFinite(coords[0]) ||
        !Number.isFinite(coords[1]) ||
        !Number.isFinite(coords[2])
      ) {
        if (line_idx === lines.length - 1) {
          torn_last_line = true
          break
        }
        throw new Error(
          `XDATCAR frame ${step} line ${line_idx + 1} is not a fractional coordinate triple: "${lines[line_idx]}"`,
        )
      }
      positions.push(frac_to_cart(coords))
    }
    if (torn_last_line) {
      warn(
        `Dropping truncated final XDATCAR frame ${step}: partial coordinate line ${lines.length} "${lines[lines.length - 1]}"`,
      )
      break
    }

    frames.push(
      create_trajectory_frame(
        positions,
        elements,
        lattice_matrix,
        [true, true, true],
        step,
        {},
        undefined,
        warn,
      ),
    )
  }
  if (frames.length === 0) throw new Error(`XDATCAR contains no complete frame`)

  return { format: `xdatcar`, frames, metadata: {} }
}

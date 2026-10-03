// VASP XDATCAR trajectory parsing: frames are located by line and decoded on demand (the eager
// parser decodes them all), so the eager and indexed paths read identical frames
import type { ElementSymbol } from '#lib/element/types.js'
import { symbol_to_atomic_number } from '#lib/element/helpers.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { Pbc } from '#lib/structure/pbc.js'
import { parse_float_token } from '#lib/structure/parsers/shared.js'
import { parse_vasp_header } from '#lib/structure/parsers/vasp-header.js'
import {
  create_plot_row_frame,
  create_trajectory_frame,
  expand_ion_types,
  TextLines,
} from '#lib/trajectory/helpers.js'
import type { TrajectoryFrame } from '#lib/trajectory/index.js'
import type { AseFrames } from './ase'
import type { ParsedTrajectory, WarnFn } from './shared'

// The XDATCAR header is the POSCAR one minus the coordinate-mode line, because its
// `Direct configuration= N` line doubles as the frame marker and the frame loop needs to
// read it. `strict_species` keeps XDATCAR's refusal to invent element symbols: they end up
// in the trajectory metadata, where an indexed fallback would be a silent lie.
const parse_xdatcar_header = (lines: TextLines, start: number) => {
  let index = start
  const cursor = {
    peek: (lookahead = 0) => lines.line(index + lookahead),
    advance: (count = 1) => {
      index += count
    },
    position: () => index,
  }
  const result = parse_vasp_header(cursor, {
    format: `XDATCAR`,
    coord_mode: `skip`,
    strict_species: true,
    line_offset: start,
  })
  // `end` is normally start + 7, but a wrapped element-symbol block makes the header longer
  return { result, end: cursor.position() }
}

// One cell/species block: the file header, or a variable-cell run's repeated one
type XdatcarCell = {
  lattice: Matrix3x3
  elements: ElementSymbol[]
  // header symbols are validated elements, so each has an atomic number
  numbers: Uint8Array
  frac_to_cart: (frac: Vec3) => Vec3
}
// `line` is the 0-based index of the frame's first coordinate line
type XdatcarFrameSpec = { line: number; step: number; cell: XdatcarCell }

const make_cell = (lattice: Matrix3x3, elements: ElementSymbol[]): XdatcarCell => ({
  lattice,
  elements,
  numbers: new Uint8Array(elements.map((element) => symbol_to_atomic_number(element) ?? 0)),
  frac_to_cart: math.create_frac_to_cart(lattice),
})

// Cartesian positions of a frame's ions, or null when its last coordinate line is the file's
// half-written final line
function read_positions(
  lines: TextLines,
  { line, step, cell }: XdatcarFrameSpec,
): Vec3[] | null {
  const positions: Vec3[] = []
  for (let line_idx = line; line_idx < line + cell.elements.length; line_idx++) {
    const text = lines.line(line_idx) ?? ``
    const tokens = text.trim().split(/\s+/)
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
      if (line_idx === lines.count - 1) return null
      throw new Error(
        `XDATCAR frame ${step} line ${line_idx + 1} is not a fractional coordinate triple: "${text}"`,
      )
    }
    positions.push(cell.frac_to_cart(coords))
  }
  return positions
}

// Locate every frame by walking frame markers and headers, reading no coordinate line but the
// last frame's. A frame cut off by the end of the file (missing lines, or a half-written final
// line) is a writer still appending: it is dropped with a warning. A malformed coordinate line
// anywhere else is corruption and fails that frame's read.
function index_xdatcar_frames(lines: TextLines, warn: WarnFn): XdatcarFrameSpec[] {
  if (lines.count < 10) throw new Error(`XDATCAR file too short`)

  const { result: parsed, end: header_end } = parse_xdatcar_header(lines, 0)
  if (!parsed.ok) throw new Error(parsed.error)
  const { elements: element_names, counts: element_counts } = parsed.header
  // One fractional-coordinate line per ion, so no file can hold more ions than it has lines
  const line_budget = { max_ions: lines.count, source: `XDATCAR lines` }
  let cell = make_cell(
    parsed.header.lattice,
    expand_ion_types(element_names, element_counts, line_budget),
  )
  const frames: XdatcarFrameSpec[] = []
  let line_idx = header_end

  while (line_idx < lines.count) {
    // Scan forward from the cursor, never from line 0: a whole-file search per frame would be
    // quadratic in the frame count on long MD runs
    let config_idx = line_idx
    while (config_idx < lines.count) {
      if (lines.line(config_idx)?.includes(`Direct configuration=`)) break
      config_idx++
    }
    if (config_idx === lines.count) break

    // Variable-cell runs repeat full headers; wrapped species blocks exceed seven lines.
    if (config_idx > line_idx) {
      const { result: repeat, end } = parse_xdatcar_header(lines, line_idx)
      if (repeat.ok && end === config_idx) {
        const { lattice, elements, counts } = repeat.header
        cell = make_cell(lattice, expand_ion_types(elements, counts, line_budget))
      }
    }

    const config_line = lines.line(config_idx) ?? ``
    line_idx = config_idx + 1
    const step_match = /configuration=\s*(?<step>\d+)/.exec(config_line)
    const step = step_match ? Math.trunc(Number(step_match[1])) : frames.length + 1

    const n_ions = cell.elements.length
    if (line_idx + n_ions > lines.count) {
      warn(
        `Dropping truncated final XDATCAR frame ${step} (line ${config_idx + 1}): ${lines.count - line_idx} of ${n_ions} coordinate lines`,
      )
      break
    }
    frames.push({ line: line_idx, step, cell })
    line_idx += n_ions
  }
  const last = frames.at(-1)
  if (last && !read_positions(lines, last)) {
    warn(
      `Dropping truncated final XDATCAR frame ${last.step}: partial coordinate line ${lines.count} "${lines.line(lines.count - 1)}"`,
    )
    frames.pop()
  }
  if (frames.length === 0) throw new Error(`XDATCAR contains no complete frame`)
  return frames
}

// Indexed XDATCAR: open walks only headers and frame markers; a frame's coordinate lines are
// read on demand. Plot rows take lattice and species from the header, but still parse the
// coordinates so a frame that cannot be read gets no plot point either.
export function open_xdatcar_frames(lines: TextLines, warn: WarnFn): AseFrames {
  const frames = index_xdatcar_frames(lines, warn)
  const frame = (frame_idx: number, plot_row: boolean): TrajectoryFrame => {
    const { step, cell } = frames[frame_idx]
    // only the last frame can hold the torn final line, and a torn last frame was dropped
    const coords = read_positions(lines, frames[frame_idx])
    if (!coords) throw new Error(`XDATCAR frame ${step} ends in a partial line`)
    const { lattice, elements, numbers } = cell
    const pbc: Pbc = [true, true, true]
    if (plot_row) return create_plot_row_frame(numbers, lattice, pbc, step, {}, warn)
    return create_trajectory_frame(coords, elements, lattice, pbc, step, {}, undefined, warn)
  }
  return {
    frame_count: frames.length,
    decode: (frame_idx) => frame(frame_idx, false),
    plot_row_frame: (frame_idx) => frame(frame_idx, true),
  }
}

export function parse_vasp_xdatcar(
  content: string | TextLines,
  warn: WarnFn,
): ParsedTrajectory {
  const { frame_count, decode } = open_xdatcar_frames(TextLines.of(content), warn)
  const frames = Array.from({ length: frame_count }, (_unused, frame_idx) => decode(frame_idx))
  return { format: `xdatcar`, frames, metadata: {} }
}

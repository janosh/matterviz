// VASP XDATCAR trajectory parsing: frames are located by line and decoded on demand (the eager
// parser decodes them all), so the eager and indexed paths read identical frames
import type { ElementSymbol } from '#lib/element/types.js'
import { symbol_to_atomic_number } from '#lib/element/helpers.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { Pbc } from '#lib/structure/pbc.js'
import { LineScanner } from '#lib/structure/parsers/shared.js'
import { parse_vasp_header } from '#lib/structure/parsers/vasp-header.js'
import {
  create_plot_row_frame,
  create_trajectory_frame,
  expand_ion_types,
  TextLines,
} from '#lib/trajectory/helpers.js'
import { create_numeric_md_frame } from '../frame'
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
  frac_to_cart: (frac: Vec3, target?: Vec3) => Vec3
}
// `line` is the 0-based index of the frame's first coordinate line
type XdatcarFrameSpec = { line: number; step: number; cell: XdatcarCell }

const make_cell = (lattice: Matrix3x3, elements: ElementSymbol[]): XdatcarCell => ({
  lattice,
  elements,
  numbers: new Uint8Array(elements.map((element) => symbol_to_atomic_number(element) ?? 0)),
  frac_to_cart: math.create_frac_to_cart(lattice),
})

// Cartesian positions of a frame's ions, 3 per ion, or null when its last coordinate line is
// the file's half-written final line. Tokenized in place: a split per line cost 2/3 of a
// frame's decode.
function read_positions(
  lines: TextLines,
  { line, step, cell }: XdatcarFrameSpec,
  scanner = new LineScanner(),
): Float64Array | null {
  const n_ions = cell.elements.length
  const positions = new Float64Array(n_ions * 3)
  const frac: Vec3 = [0, 0, 0]
  const cart: Vec3 = [0, 0, 0]
  for (let ion_idx = 0; ion_idx < n_ions; ion_idx++) {
    const line_idx = line + ion_idx
    lines.scan(scanner, line_idx)
    frac[0] = scanner.num(0)
    frac[1] = scanner.num(1)
    frac[2] = scanner.num(2)
    if (!Number.isFinite(frac[0]) || !Number.isFinite(frac[1]) || !Number.isFinite(frac[2])) {
      if (line_idx === lines.count - 1) return null
      throw new Error(
        `XDATCAR frame ${step} line ${line_idx + 1} is not a fractional coordinate triple: "${lines.line(line_idx) ?? ``}"`,
      )
    }
    cell.frac_to_cart(frac, cart)
    positions[ion_idx * 3] = cart[0]
    positions[ion_idx * 3 + 1] = cart[1]
    positions[ion_idx * 3 + 2] = cart[2]
  }
  return positions
}

// Locate every frame by walking frame markers and headers, reading no coordinate line but the
// last frame's. A frame cut off by the end of the file (missing lines, or a half-written final
// line) is a writer still appending: it is dropped with a warning. A malformed coordinate line
// anywhere else is corruption and fails that frame's read.
function index_xdatcar_frames(lines: TextLines, warn: WarnFn): XdatcarFrameSpec[] {
  // title, scale, 3 lattice rows, symbols, counts, one config marker and one ion = 9 lines
  if (lines.count < 9) throw new Error(`XDATCAR file too short`)

  // One fractional-coordinate line per ion, so no file can hold more ions than it has lines
  const line_budget = { max_ions: lines.count, source: `XDATCAR lines` }
  let cell: XdatcarCell | null = null
  const frames: XdatcarFrameSpec[] = []
  let line_idx = 0

  while (line_idx < lines.count) {
    // Scan forward from the cursor, never from line 0: a whole-file search per frame would be
    // quadratic in the frame count on long MD runs
    let config_idx = line_idx
    while (config_idx < lines.count) {
      if (lines.line(config_idx)?.includes(`Direct configuration=`)) break
      config_idx++
    }
    if (config_idx === lines.count) break

    // The file header, and the full header a variable-cell run repeats per frame (wrapped
    // species blocks exceed seven lines), possibly after blank lines. Anything else before a
    // marker is corruption: keeping the previous cell would misplace every atom of an NPT frame.
    let header_idx = line_idx
    while (header_idx < config_idx && !lines.line(header_idx)?.trim()) header_idx++
    if (header_idx < config_idx) {
      // the title line itself may be blank, so also try the header from the line before
      const starts = header_idx > line_idx ? [header_idx, header_idx - 1] : [header_idx]
      const attempts = starts.map((start) => parse_xdatcar_header(lines, start))
      const header = attempts.find(
        ({ result, end }) => result.ok && end === config_idx,
      )?.result
      if (!header?.ok) {
        const { result } = attempts[0]
        throw new Error(
          `XDATCAR lines ${header_idx + 1}-${config_idx} before "Direct configuration=" are ` +
            `not a cell header${result.ok ? `` : `: ${result.error}`}`,
        )
      }
      const { lattice, elements, counts } = header.header
      cell = make_cell(lattice, expand_ion_types(elements, counts, line_budget))
    }
    if (!cell) throw new Error(`XDATCAR has no cell header before line ${config_idx + 1}`)

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
// read on demand, straight into a numeric frame (what encode_frame makes of the decoded one).
// Plot rows take lattice and species from the header, but still parse the coordinates so a
// frame that cannot be read gets no plot point either.
export function open_xdatcar_frames(lines: TextLines, warn: WarnFn): AseFrames {
  const frames = index_xdatcar_frames(lines, warn)
  const scanner = new LineScanner()
  const pbc: Pbc = [true, true, true]
  const positions_of = (frame_idx: number): Float64Array => {
    // only the last frame can hold the torn final line, and a torn last frame was dropped
    const positions = read_positions(lines, frames[frame_idx], scanner)
    if (!positions)
      throw new Error(`XDATCAR frame ${frames[frame_idx].step} ends in a partial line`)
    return positions
  }
  return {
    frame_count: frames.length,
    // fresh numbers, lattice and pbc per frame: frames of one cell sharing them would let an
    // edit to one frame show in the others
    read: (frame_idx) => {
      const { step, cell } = frames[frame_idx]
      return create_numeric_md_frame(
        positions_of(frame_idx),
        cell.numbers.slice(),
        structuredClone(cell.lattice),
        [...pbc],
        step,
        {},
        [],
        { fixed_order: false, warn },
      )
    },
    decode: (frame_idx) => {
      const { step, cell } = frames[frame_idx]
      const positions = positions_of(frame_idx)
      const coords = Array.from({ length: cell.elements.length }, (_unused, idx): Vec3 => [
        positions[idx * 3],
        positions[idx * 3 + 1],
        positions[idx * 3 + 2],
      ])
      return create_trajectory_frame(
        coords,
        cell.elements,
        cell.lattice,
        pbc,
        step,
        {},
        undefined,
        warn,
      )
    },
    plot_row_frame: (frame_idx) => {
      const { step, cell } = frames[frame_idx]
      positions_of(frame_idx)
      return create_plot_row_frame(cell.numbers, cell.lattice, pbc, step, {}, warn)
    },
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

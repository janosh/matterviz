// VASP XDATCAR trajectory parsing: eager (every frame materialised) or indexed (frames located
// by line, decoded on demand) over the same frame walk, so both read identical frames
import type { ElementSymbol } from '$lib/element/types'
import { symbol_to_atomic_number } from '$lib/element/helpers'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import { parse_float_token } from '$lib/structure/parsers/shared'
import { parse_vasp_header } from '$lib/structure/parsers/vasp-header'
import {
  create_plot_row_frame,
  create_trajectory_frame,
  expand_ion_types,
  TextLines,
} from '$lib/trajectory/helpers'
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
  // atomic numbers of `elements`, shared by every frame of an unchanged species block
  numbers: Uint8Array
  frac_to_cart: (frac: Vec3) => Vec3
}
// `line` is the 0-based index of the frame's first coordinate line
type XdatcarFrameSpec = { line: number; step: number; cell: XdatcarCell }

const make_cell = (
  lattice: Matrix3x3,
  elements: ElementSymbol[],
  previous?: XdatcarCell,
): XdatcarCell => {
  const same_species =
    previous?.elements.length === elements.length &&
    previous.elements.every((element, idx) => element === elements[idx])
  const numbers = same_species
    ? previous.numbers
    : Uint8Array.from(elements, (element) => {
        const atomic_number = symbol_to_atomic_number(element)
        if (atomic_number === undefined)
          throw new Error(`XDATCAR element ${element} has no atomic number`)
        return atomic_number
      })
  return { lattice, elements, numbers, frac_to_cart: math.create_frac_to_cart(lattice) }
}

// Walk the frame markers and headers, never a coordinate line. Yields each complete frame's
// location; a frame cut off by the end of the file is dropped with a warning.
function* iter_xdatcar_frames(lines: TextLines, warn: WarnFn): Generator<XdatcarFrameSpec> {
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
  let line_idx = header_end
  let frame_count = 0

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
        const elements = expand_ion_types(
          repeat.header.elements,
          repeat.header.counts,
          line_budget,
        )
        cell = make_cell(repeat.header.lattice, elements, cell)
      }
    }

    const config_line = lines.line(config_idx) ?? ``
    line_idx = config_idx + 1
    const step_match = /configuration=\s*(?<step>\d+)/.exec(config_line)
    const step = step_match ? Math.trunc(Number(step_match[1])) : frame_count + 1

    // A frame cut off by the end of the file (missing lines, or a half-written final line) is
    // a writer still appending: drop it with a warning. A malformed line anywhere else is
    // corruption and names itself.
    const n_ions = cell.elements.length
    if (line_idx + n_ions > lines.count) {
      warn(
        `Dropping truncated final XDATCAR frame ${step} (line ${config_idx + 1}): ${lines.count - line_idx} of ${n_ions} coordinate lines`,
      )
      break
    }
    yield { line: line_idx, step, cell }
    frame_count++
    line_idx += n_ions
  }
}

// Hands each ion's Cartesian position of one frame to `emit`; false when the frame's last
// coordinate line is the file's half-written final line
function read_xdatcar_positions(
  lines: TextLines,
  { line, step, cell }: XdatcarFrameSpec,
  emit: (idx: number, xyz: Vec3) => void,
): boolean {
  for (let idx = 0; idx < cell.elements.length; idx++) {
    const line_idx = line + idx
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
      if (line_idx === lines.count - 1) return false
      throw new Error(
        `XDATCAR frame ${step} line ${line_idx + 1} is not a fractional coordinate triple: "${text}"`,
      )
    }
    emit(idx, cell.frac_to_cart(coords))
  }
  return true
}

const position_rows = (lines: TextLines, spec: XdatcarFrameSpec): Vec3[] | null => {
  const rows: Vec3[] = []
  return read_xdatcar_positions(lines, spec, (_idx, xyz) => rows.push(xyz)) ? rows : null
}

const torn_warning = (lines: TextLines, step: number): string =>
  `Dropping truncated final XDATCAR frame ${step}: partial coordinate line ${lines.count} "${lines.line(lines.count - 1)}"`

const xdatcar_frame = (
  positions: Vec3[],
  { step, cell }: XdatcarFrameSpec,
  warn: WarnFn,
): TrajectoryFrame =>
  create_trajectory_frame(
    positions,
    cell.elements,
    cell.lattice,
    [true, true, true],
    step,
    {},
    undefined,
    warn,
  )

export function parse_vasp_xdatcar(content: string, warn: WarnFn): ParsedTrajectory {
  const lines = new TextLines(content)
  const frames: TrajectoryFrame[] = []
  for (const spec of iter_xdatcar_frames(lines, warn)) {
    const positions = position_rows(lines, spec)
    if (!positions) {
      warn(torn_warning(lines, spec.step))
      break
    }
    frames.push(xdatcar_frame(positions, spec, warn))
  }
  if (frames.length === 0) throw new Error(`XDATCAR contains no complete frame`)
  return { format: `xdatcar`, frames, metadata: {} }
}

// Indexed XDATCAR: open walks only headers and frame markers (plus the last frame, to drop a
// torn tail as the eager parser does); a frame's coordinate lines are read on demand. A
// malformed coordinate line in any other frame fails that frame's read and plot row, not the
// open. Plot rows need no coordinates: lattice and species come from the frame's header.
export function open_xdatcar_frames(content: string, warn: WarnFn): AseFrames {
  let lines: TextLines | null = new TextLines(content)
  const frames = [...iter_xdatcar_frames(lines, warn)]
  const last = frames.at(-1)
  if (last && !read_xdatcar_positions(lines, last, () => {})) {
    warn(torn_warning(lines, last.step))
    frames.pop()
  }
  if (frames.length === 0) throw new Error(`XDATCAR contains no complete frame`)
  const live = (): TextLines => {
    if (!lines) throw new Error(`XDATCAR trajectory text was released`)
    return lines
  }
  const unexpected_tear = (spec: XdatcarFrameSpec) =>
    new Error(`XDATCAR frame ${spec.step} ends in a partial line`)
  return {
    frame_count: frames.length,
    decode: (frame_idx) => {
      const spec = frames[frame_idx]
      const positions = position_rows(live(), spec)
      if (!positions) throw unexpected_tear(spec)
      return xdatcar_frame(positions, spec, warn)
    },
    plot_row_frame: (frame_idx) => {
      const spec = frames[frame_idx]
      // A frame whose read would fail gets no plot row: its coordinate lines are validated
      // (allocation-free) but not kept
      if (!read_xdatcar_positions(live(), spec, () => {})) throw unexpected_tear(spec)
      const { lattice, numbers } = spec.cell
      return create_plot_row_frame(numbers, lattice, [true, true, true], spec.step, {}, warn)
    },
    release: () => {
      lines = null
      frames.length = 0
    },
  }
}

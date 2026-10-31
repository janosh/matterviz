// SVG path and rendering utilities for plot components.

import type { Vec2 } from '#lib/math.js'
import type { CurveFactory } from 'd3-shape'

// Build a closed SVG path for a violin (KDE density) shape.
// `grid_px` are value-axis pixel positions, `half_offsets_px` the category-axis half-widths
// (>= 0) at each grid point, `center` the category-axis center pixel. `orient(cross, val)`
// swaps coordinates for orientation (vertical: [cross, val], horizontal: [val, cross]).
// `both` mirrors density around the center; `positive`/`negative` draw one half against the
// center line. Linear interpolation between grid points (no curve overshoot).
export function violin_path(
  grid_px: readonly number[],
  half_offsets_px: readonly number[],
  center: number,
  side: `both` | `positive` | `negative`,
  orient: (cross: number, val: number) => Vec2,
): string {
  const n_pts = grid_px.length
  if (n_pts === 0) return ``
  const sign = side === `negative` ? -1 : 1
  const pts = grid_px.map((val_px, idx) =>
    orient(center + sign * half_offsets_px[idx], val_px),
  )
  // `both` returns down the mirrored side, a half violin along a straight inner edge
  if (side !== `both`) pts.push(orient(center, grid_px[n_pts - 1]), orient(center, grid_px[0]))
  else {
    for (let idx = n_pts - 1; idx >= 0; idx--) {
      pts.push(orient(center - half_offsets_px[idx], grid_px[idx]))
    }
  }
  return `M${pts.map(([x_pos, y_pos]) => `${x_pos},${y_pos}`).join(`L`)}Z`
}

// Generate SVG path for a bar with rounded corners on the "free" end (away from axis).
// For vertical bars, rounds top corners. For horizontal bars, rounds right corners.
// `flip` moves the rounding to the opposite end (bottom / left) for bars whose tip
// points the other way, i.e. negative values. The radius is clamped to half the bar's
// width and height so thin bars degrade to plain rectangles instead of self-intersecting arcs.
export function bar_path(
  coord_x: number,
  coord_y: number,
  width_value: number,
  height_value: number,
  radius: number,
  vertical: boolean = true,
  flip: boolean = false,
): string {
  const clamped_radius = Math.min(radius, width_value / 2, height_value / 2)
  if (!(clamped_radius > 0))
    return `M${coord_x},${coord_y}h${width_value}v${height_value}h${-width_value}Z`

  const sweep = flip ? 0 : 1
  if (vertical) {
    const y_start = flip ? coord_y : coord_y + height_value
    const y_arc = flip ? coord_y + height_value - clamped_radius : coord_y + clamped_radius
    const y_tip = flip ? coord_y + height_value : coord_y
    return `M${coord_x},${y_start}V${y_arc}A${clamped_radius},${clamped_radius} 0 0 ${sweep} ${coord_x + clamped_radius},${y_tip}H${
      coord_x + width_value - clamped_radius
    }A${clamped_radius},${clamped_radius} 0 0 ${sweep} ${coord_x + width_value},${y_arc}V${y_start}Z`
  }
  const x_start = flip ? coord_x + width_value : coord_x
  const x_arc = flip ? coord_x + clamped_radius : coord_x + width_value - clamped_radius
  const x_tip = flip ? coord_x : coord_x + width_value
  return `M${x_start},${coord_y}H${x_arc}A${clamped_radius},${clamped_radius} 0 0 ${sweep} ${x_tip},${coord_y + clamped_radius}V${
    coord_y + height_value - clamped_radius
  }A${clamped_radius},${clamped_radius} 0 0 ${sweep} ${x_arc},${coord_y + height_value}H${x_start}Z`
}

// === Line paths ===
// The text d3-shape's line() writes at its default 3-digit precision, byte for byte, built in a
// byte buffer. d3 formats each coordinate as a double (shortest round-trip digits) and appends
// it to a growing string, which was most of mounting many long lines (400 x 2000 points).
// Math.round(val * 1000) is an integer whose shortest decimal form, divided by 1000, is its own
// digits with a point three places in (trailing zeros dropped), so integer arithmetic writes
// the same characters; values past int32 (and NaN/Infinity) are formatted as d3 does.
const ASCII = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0))
// `.001` ... `.999` without trailing zeros, empty for a whole number
const FRACTION_BYTES = Array.from({ length: 1000 }, (_, frac) =>
  frac === 0 ? [] : ASCII(`.${String(frac).padStart(3, `0`).replace(/0+$/, ``)}`),
)
const path_decoder = new TextDecoder(`latin1`)
// One buffer shared by every call (tracing is synchronous), grown on demand
let path_bytes = new Uint8Array(1 << 14)
let path_len = 0
const digit_scratch = new Uint8Array(10)

// Room for one command: the letter, 6 int32 numbers of at most 12 bytes (sign, 7 digits and a
// 4-byte fraction) and 5 commas. A fallback text reserves its own length on top.
const reserve = (n_bytes: number): void => {
  if (path_len + n_bytes <= path_bytes.length) return
  const grown = new Uint8Array(Math.max(path_bytes.length * 2, path_len + n_bytes))
  grown.set(path_bytes.subarray(0, path_len))
  path_bytes = grown
}
const COMMAND_BYTES = 1 + 6 * 12 + 5

const write_number = (val: number): void => {
  const scaled = Math.round(val * 1000)
  if (!(scaled > -2_147_483_648 && scaled < 2_147_483_648)) {
    const codes = ASCII(`${scaled / 1000}`)
    reserve(codes.length + COMMAND_BYTES)
    for (const code of codes) path_bytes[path_len++] = code
    return
  }
  // -0 joins 0 here, as String(-0) is `0`
  let abs = Math.trunc(scaled)
  if (abs < 0) {
    path_bytes[path_len++] = 45 // -
    abs = -abs
  }
  let whole = Math.trunc(abs / 1000)
  const fraction = FRACTION_BYTES[abs - whole * 1000]
  let n_digits = 0
  do {
    const rest = Math.trunc(whole / 10)
    digit_scratch[n_digits++] = 48 + whole - rest * 10
    whole = rest
  } while (whole > 0)
  while (n_digits > 0) path_bytes[path_len++] = digit_scratch[--n_digits]
  for (const code of fraction) path_bytes[path_len++] = code
}
// A command letter, then its coordinates joined by commas
const write_letter = (letter: number): void => {
  reserve(COMMAND_BYTES)
  path_bytes[path_len++] = letter
}
const write_pair = (x: number, y: number): void => {
  write_number(x)
  path_bytes[path_len++] = 44 // ,
  write_number(y)
}

// The d3-path context a curve draws into. Tracks the subpath's start and current x as d3's
// Path does, which decide whether closePath writes a Z; arcs are never drawn by line curves.
class PathWriter {
  #x0: number | null = null
  #x1: number | null = null
  moveTo(x: number, y: number): void {
    write_letter(77) // M
    write_pair(x, y)
    this.#x0 = x
    this.#x1 = x
  }
  lineTo(x: number, y: number): void {
    write_letter(76) // L
    write_pair(x, y)
    this.#x1 = x
  }
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void {
    write_letter(81) // Q
    write_pair(x1, y1)
    path_bytes[path_len++] = 44
    write_pair(x, y)
    this.#x1 = x
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    write_letter(67) // C
    write_pair(x1, y1)
    path_bytes[path_len++] = 44
    write_pair(x2, y2)
    path_bytes[path_len++] = 44
    write_pair(x, y)
    this.#x1 = x
  }
  closePath(): void {
    if (this.#x1 === null) return
    this.#x1 = this.#x0
    write_letter(90) // Z
  }
  arcTo(): void {
    throw new Error(`line paths draw no arcs`)
  }
  arc(): void {
    throw new Error(`line paths draw no arcs`)
  }
  rect(): void {
    throw new Error(`line paths draw no rects`)
  }
}

// d3.line().x(x_of).y(y_of).curve(curve).defined(defined)(points) ?? ``: a point failing
// `defined` lifts the pen, as in d3, whose segmentation loop this repeats
export function line_path<Point>(
  points: readonly Point[],
  curve: CurveFactory,
  x_of: (point: Point) => number,
  y_of: (point: Point) => number,
  defined?: (point: Point) => boolean,
): string {
  path_len = 0
  const output = curve(new PathWriter())
  let drawing = false
  for (let idx = 0; idx <= points.length; idx++) {
    const point = points[idx]
    if (!(idx < points.length && (defined?.(point) ?? true)) === drawing) {
      drawing = !drawing
      if (drawing) output.lineStart()
      else output.lineEnd()
    }
    if (drawing) output.point(x_of(point), y_of(point))
  }
  return path_decoder.decode(path_bytes.subarray(0, path_len))
}

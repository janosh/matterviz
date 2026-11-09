// Parses phase diagram SVGs (matplotlib or simple/Gemini format) into binary-phase-diagram/2
// data for rendering by IsobaricBinaryPhaseDiagram. Region labels ("A + B") name the phases;
// axis-aligned boundaries become invariant (horizontal) or solvus (vertical) lines.

import { array_extent, leading_number, type Vec2, type Vec4 } from '#lib/math.js'
import {
  BINARY_DIAGRAM_FORMAT,
  type BinaryPhaseDiagram,
  type DiagramBoundary,
  type BinaryPhase,
  type DiagramRegion,
} from './types'
import { find_region_at } from './utils'

// Round to 6 decimal places for clean floating-point output
const round = (val: number): number => Math.round(val * 1e6) / 1e6

// === Types ===

type SvgFormat = `matplotlib` | `simple`

interface LinearScale {
  to_data: (pixel: number) => number
  domain: Vec2 // [min_data, max_data] of the plot area
  // Data units spanned by 1 px: the snapping tolerance for coordinates drawn at pixel precision
  px_tol: number
}

interface Tick {
  px: number
  value: number
  text: string // tick label, e.g. `1000 °C`
}

interface Boundary {
  x1: number // data coordinates
  y1: number
  x2: number
  y2: number
  orientation: `horizontal` | `vertical`
}

interface Label {
  text: string // plain text, e.g. "La2NiO4 + NiO"
  px_x: number // pixel position
  px_y: number
}

// === Format Detection ===

// Matplotlib SVGs have xtick/ytick group IDs; anything else is treated as the simple format
const detect_format = (doc: Document): SvgFormat =>
  doc.querySelector(`[id^="xtick_"], [id^="ytick_"]`) ? `matplotlib` : `simple`

// Non-null results of `callback` over every element matching `selector`
const query_map = <T>(
  doc: Document,
  selector: string,
  callback: (element: Element) => T | null,
): T[] =>
  Array.from(doc.querySelectorAll(selector), callback).filter(
    (item): item is T => item !== null,
  )

// === Axis Scale Extraction ===

// Matplotlib ticks: <use> markers inside id="xtick_N"/"ytick_N" groups, value in an XML comment
function extract_matplotlib_ticks(doc: Document): [Tick[], Tick[]] {
  const ticks_of = (axis: `x` | `y`) =>
    query_map(doc, `[id^="${axis}tick_"]`, (group) => {
      const text = comment_number_text(group)
      const use_el = group.querySelector(`use`)
      const pixel = use_el && parse_float_attr(use_el, axis)
      return text !== null && pixel !== null
        ? { px: pixel, value: leading_number(text), text }
        : null
    })
  return [ticks_of(`x`), ticks_of(`y`)]
}

// Simple-format ticks: y values are <text class="tick-text"> right after their tick <line>
// (px from its y1), x values <text class="tick-text-x"> (px from its x attribute); both are
// offset by the parent group's translate
function extract_simple_ticks(doc: Document): [Tick[], Tick[]] {
  const tick_of = (text_el: Element, pixel: number | null, axis: 0 | 1): Tick | null => {
    const text = text_el.textContent ?? ``
    const value = leading_number(text)
    if (isNaN(value) || pixel === null) return null
    return { px: pixel + (parse_translate(text_el.parentElement)?.[axis] ?? 0), value, text }
  }
  return [
    query_map(doc, `.tick-text-x`, (element) =>
      tick_of(element, parse_float_attr(element, `x`), 0),
    ),
    query_map(doc, `.tick-text`, (element) => {
      const tick_line = element.previousElementSibling
      if (!tick_line?.matches(`.tick-line, line`)) return null
      return tick_of(element, parse_float_attr(tick_line, `y1`), 1)
    }),
  ]
}

// Linear scale from ticks, its domain spanning the plot area's pixel span [px_a, px_b] (either
// order). Fewer than two ticks means an unsupported SVG (e.g. an MPDS export).
function build_scale(axis: `x` | `y`, ticks: Tick[], [px_a, px_b]: Vec2): LinearScale {
  if (ticks.length < 2) {
    throw new Error(
      `could not find ${axis}-axis tick marks in this SVG (need at least 2, found ${ticks.length})`,
    )
  }
  const sorted = ticks.toSorted((tick_a, tick_b) => tick_a.value - tick_b.value)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  const range = last.value - first.value
  const px_range = last.px - first.px
  if (range === 0 || px_range === 0) {
    throw new Error(
      `${axis}-axis ticks span a zero range (values ${first.value}..${last.value}, px ${first.px}..${last.px}); cannot build scale`,
    )
  }
  const px_per_unit = px_range / range
  const to_data = (pixel: number) => first.value + (pixel - first.px) / px_per_unit
  const [data_a, data_b] = [to_data(px_a), to_data(px_b)]

  return {
    to_data,
    domain: [Math.min(data_a, data_b), Math.max(data_a, data_b)],
    px_tol: 1 / Math.abs(px_per_unit),
  }
}

// Composition scale from x ticks in mole fraction, or in at% when the plot spans 0..100.
// Values within 1 px outside [0, 1] snap onto its edge; a wider span throws.
function composition_scale(ticks: Tick[], px_span: Vec2): LinearScale {
  const raw = build_scale(`x`, ticks, px_span)
  const [lower, upper] = raw.domain
  const near = (val: number, target: number) => Math.abs(val - target) <= raw.px_tol
  const percent = near(lower, 0) && near(upper, 100)
  if (!percent && (lower < -raw.px_tol || upper > 1 + raw.px_tol)) {
    throw new Error(
      `x-axis spans ${lower}..${upper}: x ticks must be mole fractions in [0, 1] or at% spanning 0..100`,
    )
  }
  const scale = percent
    ? build_scale(
        `x`,
        ticks.map((tick) => ({ ...tick, value: tick.value / 100 })),
        px_span,
      )
    : raw
  const { to_data, domain, px_tol } = scale
  const snap = (val: number) =>
    val < 0 && val >= -px_tol ? 0 : val > 1 && val <= 1 + px_tol ? 1 : val
  return {
    to_data: (pixel) => snap(to_data(pixel)),
    domain: [snap(domain[0]), snap(domain[1])],
    px_tol,
  }
}

// Tick label units of a temperature in °C, e.g. `25 °C` or `1000℃`
const CELSIUS_REGEX = /°\s*C|℃/

// [min_x, min_y, max_x, max_y] of pixel vertices
const bbox_of = (verts: Vec2[]): Vec4 => {
  const [min_x, max_x] = array_extent(verts.map(([x_px]) => x_px))
  const [min_y, max_y] = array_extent(verts.map(([, y_px]) => y_px))
  return [min_x, min_y, max_x, max_y]
}

// Pixel bbox of the plot area (the tick span alone crops past the outermost ticks):
// matplotlib's axes patch, else the smallest filled shape (by bbox) enclosing all ticks and
// boundaries, else their span.
function plot_area_px(
  doc: Document,
  [x_ticks, y_ticks]: [Tick[], Tick[]],
  lines: Vec4[],
  filled_bboxes: Vec4[],
): Vec4 {
  const area = ([min_x, min_y, max_x, max_y]: Vec4) => (max_x - min_x) * (max_y - min_y)
  const patch = doc.querySelector(`[id^="axes_"] > [id^="patch_"] > *`)
  const patch_verts = (patch && shape_rings(patch))?.flat() ?? []
  // a degenerate patch (e.g. a spine line when the background patch is missing) has no area
  if (patch_verts.length && area(bbox_of(patch_verts)) > 0) return bbox_of(patch_verts)
  const [min_x, max_x] = array_extent([
    ...x_ticks.map(({ px }) => px),
    ...lines.flatMap(([x_1, , x_2]) => [x_1, x_2]),
  ])
  const [min_y, max_y] = array_extent([
    ...y_ticks.map(({ px }) => px),
    ...lines.flatMap(([, y_1, , y_2]) => [y_1, y_2]),
  ])
  // 1 px slack for strokes drawn on the plot edge
  const enclosing = filled_bboxes.filter(
    ([left, top, right, bottom]) =>
      left <= min_x + 1 && right >= max_x - 1 && top <= min_y + 1 && bottom >= max_y - 1,
  )
  const span: Vec4 = [min_x, min_y, max_x, max_y]
  return enclosing.toSorted((bbox_a, bbox_b) => area(bbox_a) - area(bbox_b))[0] ?? span
}

// === Boundary Extraction ===

// Pixel endpoints of the candidate boundary lines: matplotlib line2d_N groups holding one
// straight path segment, or simple-format <line class="phase-boundary"> elements
function extract_boundary_lines(doc: Document, format: SvgFormat): Vec4[] {
  if (format === `matplotlib`) {
    return query_map(doc, `[id^="line2d_"]`, (group) => {
      const path_el = group.querySelector(`path`)
      const d_attr = path_el?.getAttribute(`d`)
      if (!path_el || typeof d_attr !== `string`) return null
      // Multi-segment paths are not straight boundaries
      const segments = parse_path_segments(d_attr)
      if (segments.length !== 1) return null
      const [x_1, y_1, x_2, y_2] = segments[0]
      // Skip tick mark lines (short lines, typically < 10px)
      if (Math.abs(x_2 - x_1) < 15 && Math.abs(y_2 - y_1) < 15) return null
      // Hairlines are axis furniture (matplotlib draws ticks and spines at 0.8 px); an
      // unparsable/absent stroke-width (0) is kept as a boundary
      const stroke_width = parse_stroke_width(path_el)
      return stroke_width > 0 && stroke_width < 1 ? null : segments[0]
    })
  }
  return query_map(doc, `.phase-boundary, line[class*="phase-boundary"]`, (line_el) => {
    const coords = [`x1`, `y1`, `x2`, `y2`].map((attr) => parse_float_attr(line_el, attr))
    if (coords.some((coord) => coord === null)) {
      throw new Error(
        `Phase boundary line is missing numeric x1/y1/x2/y2 attributes: ${line_el.outerHTML.slice(0, 200)}`,
      )
    }
    return coords as Vec4
  })
}

// Axis-aligned boundary (0.5 px tolerance) in data coordinates, null for diagonal lines
function to_boundary(
  [px_x1, px_y1, px_x2, px_y2]: Vec4,
  x_scale: LinearScale,
  y_scale: LinearScale,
): Boundary | null {
  const is_vertical = Math.abs(px_x1 - px_x2) < 0.5
  const is_horizontal = Math.abs(px_y1 - px_y2) < 0.5
  if (!is_vertical && !is_horizontal) return null
  const [data_x1, data_x2] = [x_scale.to_data(px_x1), x_scale.to_data(px_x2)]
  const [data_y1, data_y2] = [y_scale.to_data(px_y1), y_scale.to_data(px_y2)]
  return {
    x1: Math.min(data_x1, data_x2),
    y1: Math.min(data_y1, data_y2),
    x2: Math.max(data_x1, data_x2),
    y2: Math.max(data_y1, data_y2),
    orientation: is_vertical ? `vertical` : `horizontal`,
  }
}

// === Label Extraction ===

// Phase region labels (text containing "+", unlike axis labels) with pixel positions.
// Matplotlib keeps LaTeX in text_N group comments, maybe continued in later groups ("+ ...");
// the simple format uses <text class="label-main"> positioned by transform or x/y.
function extract_labels(doc: Document, format: SvgFormat): Label[] {
  if (format === `matplotlib`) {
    return query_map(doc, `[id^="text_"]`, (group) => {
      let comment = find_comment_text(group)
      if (!comment) return null
      for (
        let sibling = group.nextElementSibling;
        sibling && !sibling.id?.startsWith(`text_`);
        sibling = sibling.nextElementSibling
      ) {
        const continuation = find_comment_text(sibling)
        if (!continuation?.trimStart().startsWith(`+`)) break
        comment += ` ${continuation.trim()}`
      }
      if (!comment.includes(`+`)) return null
      // Clean LaTeX: "La$_2$NiO$_4$ + NiO" -> "La2NiO4 + NiO"
      const text = comment
        .trim()
        .replaceAll(/\$_\{(?<digits>[^}]*)\}\$/g, `$1`) // $_{10}$ -> 10
        .replaceAll(/\$_(?<digit>\d)\$/g, `$1`) // $_2$ -> 2
        .replaceAll(`$`, ``) // remove any remaining $
        .replaceAll(/\s+/g, ` `)
        .trim()
      const pos =
        parse_translate(group.querySelector(`g[transform]`)) ?? parse_translate(group)
      return pos && { text, px_x: pos[0], px_y: pos[1] }
    })
  }
  return query_map(doc, `.label-main`, (text_el) => {
    const text = (text_el.textContent ?? ``).replaceAll(/\s+/g, ` `).trim()
    if (!text.includes(`+`)) return null
    const pos = parse_translate(text_el)
    const px_x = pos?.[0] ?? parse_float_attr(text_el, `x`)
    const px_y = pos?.[1] ?? parse_float_attr(text_el, `y`)
    return px_x !== null && px_y !== null ? { text, px_x, px_y } : null
  })
}

// === Region Fill Extraction ===

// Page/axes background fills, not phase regions (matplotlib's figure/axes patches are white)
const BACKGROUND_FILLS = new Set([`#fff`, `#ffffff`, `white`, `rgb(255,255,255)`])

// Fill colour of an element from style="fill: ..." or the fill attribute; null if unset/none
function element_fill(element: Element): string | null {
  const style_match = /(?:^|;)\s*fill\s*:\s*(?<fill>[^;]+)/.exec(
    element.getAttribute(`style`) ?? ``,
  )
  const fill = (style_match?.groups?.fill ?? element.getAttribute(`fill`))?.trim()
  if (!fill || fill === `none` || fill === `transparent`) return null
  if (BACKGROUND_FILLS.has(fill.toLowerCase().replaceAll(/\s+/g, ``))) return null
  return fill
}

// Closed vertex rings of a segment chain. parse_path_segments emits no segment for an M, so a
// gap between one segment's end and the next one's start begins a new subpath.
function segments_to_rings(segments: Vec4[]): Vec2[][] {
  const rings: Vec2[][] = []
  for (const [x_1, y_1, x_2, y_2] of segments) {
    const tail = rings.at(-1)?.at(-1)
    if (tail?.[0] !== x_1 || tail[1] !== y_1) rings.push([[x_1, y_1]]) // jump: new subpath
    rings.at(-1)?.push([x_2, y_2])
  }
  return rings
}

// Closed pixel-space rings of a rect/polygon/path, or a <use> of one shifted by its x/y
// (matplotlib's fill_between fills a <use> of a <defs> polygon). Transforms aren't applied.
function shape_rings(element: Element): Vec2[][] | null {
  const tag = element.tagName.toLowerCase()
  if (tag === `use`) {
    const href = element.getAttribute(`href`) ?? element.getAttribute(`xlink:href`) ?? ``
    const target = href.startsWith(`#`)
      ? element.ownerDocument.querySelector(`[id="${href.slice(1).replaceAll(`"`, `\\"`)}"]`)
      : null
    const rings = target && target.tagName.toLowerCase() !== `use` ? shape_rings(target) : null
    const [delta_x, delta_y] = [
      parse_float_attr(element, `x`) ?? 0,
      parse_float_attr(element, `y`) ?? 0,
    ]
    return (
      rings?.map((ring) => ring.map(([x_px, y_px]) => [x_px + delta_x, y_px + delta_y])) ??
      null
    )
  }
  if (tag === `rect`) {
    const [x_px, y_px] = [
      parse_float_attr(element, `x`) ?? 0,
      parse_float_attr(element, `y`) ?? 0,
    ]
    const [width, height] = [
      parse_float_attr(element, `width`),
      parse_float_attr(element, `height`),
    ]
    if (width === null || height === null) return null
    const [max_x, max_y] = [x_px + width, y_px + height]
    return [
      [
        [x_px, y_px],
        [max_x, y_px],
        [max_x, max_y],
        [x_px, max_y],
      ],
    ]
  }
  if (tag === `polygon`) {
    const nums = ((element.getAttribute(`points`) ?? ``).match(NUMBER_REGEX) ?? []).map(Number)
    return [
      Array.from({ length: nums.length >> 1 }, (_, idx) => [nums[2 * idx], nums[2 * idx + 1]]),
    ]
  }
  const d_attr = tag === `path` ? element.getAttribute(`d`) : null
  return d_attr === null ? null : segments_to_rings(parse_path_segments(d_attr))
}

// Pixel bboxes [min_x, min_y, max_x, max_y] of all non-background filled shapes (plot-area
// candidates). Transformed shapes are skipped since shape_rings ignores transforms (their
// pixel coords would be wrong).
const extract_filled_bboxes = (doc: Document): Vec4[] =>
  query_map(doc, `rect, polygon, path, use`, (element) => {
    if (element_fill(element) === null || element.hasAttribute(`transform`)) return null
    const verts = (shape_rings(element) ?? []).flat()
    // fewer than 3 corners encloses no area
    return verts.length < 3 ? null : bbox_of(verts)
  })

// === Component Inference ===

const split_label = (label: string): string[] =>
  label
    .split(`+`)
    .map((token) => token.trim())
    .filter(Boolean)
// L, Liq, Liquid, optionally numbered for a liquid miscibility gap (L1, L₂, Liquid 2)
const LIQUID_LABEL = /^(?:l|liq|liquid)\s*[\d₀-₉]*$/i

// Infer binary components from region labels sorted by x: each end's pure component is the
// solid phase of its two-phase end region absent from the three regions at the other end (for
// "La2NiO4 + La2O3" on the left, La2O3 is the pure A endpoint). A liquid is never a component:
// an end without such a solid, or ends resolving to the same phase, fall back to A and B.
function infer_components(labels: Label[]): [string, string] {
  const sorted = labels.toSorted((label_a, label_b) => label_a.px_x - label_b.px_x)
  if (sorted.length < 2) return [`A`, `B`]
  const end_component = (end: Label, other_end: Label[], fallback: string): string => {
    const phases = split_label(end.text)
    if (phases.length !== 2) return fallback
    const other_phases = new Set(other_end.flatMap(({ text }) => split_label(text)))
    const solids = phases.filter((phase) => !LIQUID_LABEL.test(phase))
    return solids.find((phase) => !other_phases.has(phase)) ?? fallback
  }
  // the other end's labels exclude this end's own (with few labels the slices overlap)
  const ends: [string, string] = [
    end_component(sorted[0], sorted.slice(1).slice(-3), `A`),
    end_component(sorted[sorted.length - 1], sorted.slice(0, -1).slice(0, 3), `B`),
  ]
  return ends[0] === ends[1] ? [`A`, `B`] : ends
}

// === Region Inference ===

// Infer labelled region polygons (data coords) from orthogonal boundaries using flood-fill on a
// cell grid; a region without a label under it gets a null label
function infer_regions(
  boundaries: Boundary[],
  labels: Label[],
  x_scale: LinearScale,
  y_scale: LinearScale,
): { label: string | null; vertices: Vec2[] }[] {
  const verticals = boundaries.filter((boundary) => boundary.orientation === `vertical`)
  const horizontals = boundaries.filter((boundary) => boundary.orientation === `horizontal`)

  // Unique x/y coords of domain edges and boundaries, merging ones within 1 px (pixel jitter)
  const [x_tol, y_tol] = [x_scale.px_tol, y_scale.px_tol]
  const x_coords = collect_unique_sorted(
    [...x_scale.domain, ...verticals.map(({ x1 }) => x1)],
    x_tol,
  )
  const y_coords = collect_unique_sorted(
    [...y_scale.domain, ...horizontals.map(({ y1 }) => y1)],
    y_tol,
  )

  const n_cols = x_coords.length - 1
  const n_rows = y_coords.length - 1
  const cell_ids = Array.from({ length: n_cols }, () => Array(n_rows).fill(-1))

  // Walled cell edges: h_walls[col][row] is the bottom edge of cell (col, row), v_walls[col][row]
  // its left edge; the plot edges are always walls
  const h_walls = Array.from({ length: n_cols }, () => Array(n_rows + 1).fill(false))
  const v_walls = Array.from({ length: n_cols + 1 }, () => Array(n_rows).fill(false))
  for (const col_walls of h_walls) for (const row of [0, n_rows]) col_walls[row] = true
  for (const col of [0, n_cols]) v_walls[col].fill(true)
  // Cell intervals of `coords` that the span [lo, hi] covers, ends snapped within `tol` so a
  // boundary stopping a pixel short of the one it meets still closes the wall
  const spanned_cells = (lower: number, upper: number, coords: number[], tol: number) =>
    coords
      .slice(0, -1)
      .flatMap((cell_min, idx) =>
        lower <= cell_min + tol && upper >= coords[idx + 1] - tol ? [idx] : [],
      )
  for (const { x1, x2, y1 } of horizontals) {
    const row = find_coord_index(y_coords, y1, y_tol)
    if (row === -1) continue
    for (const col of spanned_cells(x1, x2, x_coords, x_tol)) h_walls[col][row] = true
  }
  for (const { x1, y1, y2 } of verticals) {
    const col = find_coord_index(x_coords, x1, x_tol)
    if (col === -1) continue
    for (const row of spanned_cells(y1, y2, y_coords, y_tol)) v_walls[col][row] = true
  }

  let next_region_id = 0
  for (let col = 0; col < n_cols; col++) {
    for (let row = 0; row < n_rows; row++) {
      if (cell_ids[col][row] !== -1) continue
      flood_fill(cell_ids, h_walls, v_walls, col, row, n_cols, n_rows, next_region_id)
      next_region_id++
    }
  }

  // Each label names the region of the cell under it
  const region_labels = new Map<number, string>()
  for (const label of labels) {
    const col = find_cell_index(x_coords, x_scale.to_data(label.px_x), x_tol)
    const row = find_cell_index(y_coords, y_scale.to_data(label.px_y), y_tol)
    if (col !== -1 && row !== -1) region_labels.set(cell_ids[col][row], label.text)
  }

  // Build region polygons by tracing the outline of each region's merged cells
  return Array.from({ length: next_region_id }, (_, region_id) => {
    const label = region_labels.get(region_id) ?? null
    const vertices = trace_region_outline(
      cell_ids,
      region_id,
      n_cols,
      n_rows,
      label ?? undefined,
    ).map(([col, row]): Vec2 => [round(x_coords[col]), round(y_coords[row])])
    return { label, vertices }
  })
}

// Flood-fill connected cells that share an open edge
function flood_fill(
  cell_ids: number[][],
  h_walls: boolean[][],
  v_walls: boolean[][],
  start_col: number,
  start_row: number,
  n_cols: number,
  n_rows: number,
  region_id: number,
): void {
  const stack: Vec2[] = [[start_col, start_row]]
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [col, row] = item
    if (col < 0 || col >= n_cols || row < 0 || row >= n_rows) continue
    if (cell_ids[col][row] !== -1) continue
    cell_ids[col][row] = region_id
    // Neighbours with no wall between them (left, right, bottom, top)
    if (col > 0 && !v_walls[col][row]) stack.push([col - 1, row])
    if (col < n_cols - 1 && !v_walls[col + 1][row]) stack.push([col + 1, row])
    if (row > 0 && !h_walls[col][row]) stack.push([col, row - 1])
    if (row < n_rows - 1 && !h_walls[col][row + 1]) stack.push([col, row + 1])
  }
}

// Outer outline of region_id's cells as rectilinear polygon in grid-vertex coords [col, row],
// counter-clockwise in data space, collinear vertices removed. Boundary edges (interior on the
// left) are chained into a loop, preferring right-hand turns at pinch vertices; leftover hole
// edges are dropped. Should the chain break, warn and fall back to the cells' bounding box so
// one pathological region cannot fail the whole import. Exported for tests.
export function trace_region_outline(
  cell_ids: number[][],
  region_id: number,
  n_cols: number,
  n_rows: number,
  name: string = `Region ${region_id + 1}`,
): Vec2[] {
  const in_region = (col: number, row: number): boolean =>
    col >= 0 && col < n_cols && row >= 0 && row < n_rows && cell_ids[col][row] === region_id

  const vertex_key = ([col, row]: Vec2) => `${col},${row}`
  const outgoing = new Map<string, Vec2[]>()
  const add_edge = (from: Vec2, target: Vec2) => {
    const key = vertex_key(from)
    const edges = outgoing.get(key)
    if (edges) edges.push(target)
    else outgoing.set(key, [target])
  }

  let start: Vec2 | null = null
  let [min_col, max_col, min_row, max_row] = [Infinity, -Infinity, Infinity, -Infinity]
  for (let col = 0; col < n_cols; col++) {
    for (let row = 0; row < n_rows; row++) {
      if (!in_region(col, row)) continue
      // Lowest-then-leftmost cell: its bottom-left corner touches only this cell
      if (!start || row < start[1] || (row === start[1] && col < start[0])) start = [col, row]
      min_col = Math.min(min_col, col)
      max_col = Math.max(max_col, col + 1)
      min_row = Math.min(min_row, row)
      max_row = Math.max(max_row, row + 1)
      if (!in_region(col, row - 1)) add_edge([col, row], [col + 1, row]) // bottom, left→right
      if (!in_region(col + 1, row)) add_edge([col + 1, row], [col + 1, row + 1]) // right, up
      if (!in_region(col, row + 1)) add_edge([col + 1, row + 1], [col, row + 1]) // top, right→left
      if (!in_region(col - 1, row)) add_edge([col, row + 1], [col, row]) // left, down
    }
  }
  if (!start) throw new Error(`Region ${region_id} has no cells; cannot trace its outline`)

  const loop: Vec2[] = [start]
  let prev: Vec2 | null = null
  let current: Vec2 = start
  while (true) {
    const key = vertex_key(current)
    const candidates = outgoing.get(key) ?? []
    if (candidates.length === 0) {
      console.warn(
        `Phase region "${name}": outline is not closed at grid vertex (${key}); using its bounding box instead`,
      )
      return [
        [min_col, min_row],
        [max_col, min_row],
        [max_col, max_row],
        [min_col, max_row],
      ]
    }
    // Prefer the right-hand turn (negative cross product of incoming × outgoing direction)
    let next = candidates[0]
    if (prev && candidates.length > 1) {
      const [in_dx, in_dy] = [current[0] - prev[0], current[1] - prev[1]]
      const turn = (target: Vec2) =>
        in_dx * (target[1] - current[1]) - in_dy * (target[0] - current[0])
      next = candidates.reduce((best, cand) => (turn(cand) < turn(best) ? cand : best))
    }
    candidates.splice(candidates.indexOf(next), 1)
    if (next[0] === start[0] && next[1] === start[1]) break
    loop.push(next)
    prev = current
    current = next
  }

  // Drop vertices lying on a straight run between their neighbours
  return loop.filter((vertex, idx) => {
    const before = loop[(idx + loop.length - 1) % loop.length]
    const after = loop[(idx + 1) % loop.length]
    const same_col = before[0] === vertex[0] && vertex[0] === after[0]
    const same_row = before[1] === vertex[1] && vertex[1] === after[1]
    return !same_col && !same_row
  })
}

// === Diagram Assembly ===

// Phases (one per distinct label token, the label doubling as id) and regions with their phases
// ordered left to right: by the mean centre of the regions each phase occurs in, the end
// components pinned to their edges
function assemble_regions(
  traced: { label: string | null; vertices: Vec2[] }[],
  components: [string, string],
): { phases: BinaryPhase[]; regions: DiagramRegion[] } {
  const centres = new Map<string, number[]>()
  for (const { label, vertices } of traced) {
    const [x_min, x_max] = array_extent(vertices.map(([x_val]) => x_val))
    for (const token of split_label(label ?? ``)) {
      centres.set(token, [...(centres.get(token) ?? []), (x_min + x_max) / 2])
    }
  }
  const position = (token: string): number => {
    if (token === components[0]) return -Infinity
    if (token === components[1]) return Infinity
    const xs = centres.get(token) ?? []
    return xs.reduce((sum, x_val) => sum + x_val, 0) / xs.length
  }
  const phases = [...centres.keys()].map((id): BinaryPhase => ({
    id,
    model_phase: id,
    label: id,
    kind: LIQUID_LABEL.test(id) ? `liquid` : `solid`,
  }))
  // Only labels with a `+` are extracted, so an unlabelled or single-name field stays
  // uncovered, as does a 3-token label, rather than making the whole diagram invalid
  const regions = traced.flatMap(({ label, vertices }) => {
    const ids = [...new Set(split_label(label ?? ``))]
    if (ids.length < 1 || ids.length > 2) return []
    return [
      { phases: ids.toSorted((id_a, id_b) => position(id_a) - position(id_b)), vertices },
    ]
  })
  return { phases, regions }
}

// Boundary lines with the phases of the regions on either side of their midpoint
function assemble_boundaries(
  boundaries: Boundary[],
  regions: DiagramRegion[],
  [x_tol, y_tol]: Vec2,
): DiagramBoundary[] {
  return boundaries.map(({ x1, y1, x2, y2, orientation }) => {
    const vertical = orientation === `vertical`
    const points: Vec2[] = [
      [round(x1), round(y1)],
      [round(vertical ? x1 : x2), round(vertical ? y2 : y1)],
    ]
    const [mid_x, mid_y] = [(x1 + (vertical ? x1 : x2)) / 2, (y1 + (vertical ? y2 : y1)) / 2]
    const sides: Vec2[] = vertical
      ? [
          [mid_x - x_tol, mid_y],
          [mid_x + x_tol, mid_y],
        ]
      : [
          [mid_x, mid_y - y_tol],
          [mid_x, mid_y + y_tol],
        ]
    const phases = sides.flatMap(
      ([x_val, y_val]) => find_region_at(regions, x_val, y_val)?.phases ?? [],
    )
    const ids = [...new Set(phases)]
    // an invariant line is three-phase by definition; any other line stays a plain solvus
    const kind = !vertical && ids.length === 3 ? `invariant` : `solvus`
    return { kind, phases: ids, points }
  })
}

// === Main Entry Point ===

// Parse a phase diagram SVG string into binary-phase-diagram/2 data. T is read in K, or in °C
// when the y tick labels carry a °C suffix; x in mole fraction, or in at% when the x ticks
// span 0..100.
export function parse_phase_diagram_svg(svg_string: string): BinaryPhaseDiagram {
  const doc = new DOMParser().parseFromString(svg_string, `image/svg+xml`)
  const parse_error = doc.querySelector(`parsererror`)
  if (parse_error) throw new Error(`Invalid SVG: ${parse_error.textContent}`)

  const format = detect_format(doc)
  const ticks: [Tick[], Tick[]] =
    format === `matplotlib` ? extract_matplotlib_ticks(doc) : extract_simple_ticks(doc)
  const lines = extract_boundary_lines(doc, format)
  const filled_bboxes = extract_filled_bboxes(doc)
  const [min_x, min_y, max_x, max_y] = plot_area_px(doc, ticks, lines, filled_bboxes)
  const x_scale = composition_scale(ticks[0], [min_x, max_x])
  // y-axis inverted (SVG y down, temp up)
  const celsius = ticks[1].some(({ text }) => CELSIUS_REGEX.test(text))
  const y_ticks = celsius
    ? ticks[1].map((tick) => ({ ...tick, value: tick.value + 273.15 }))
    : ticks[1]
  const y_scale = build_scale(`y`, y_ticks, [min_y, max_y])
  if (y_scale.domain[0] < 0) {
    throw new Error(
      `y-axis reaches ${y_scale.domain[0]} K: y tick labels must be in K or °C (e.g. "25 °C")`,
    )
  }
  const boundaries = lines.flatMap((line) => to_boundary(line, x_scale, y_scale) ?? [])
  const labels = extract_labels(doc, format)
  if (boundaries.length === 0) throw new Error(`No phase boundaries found in SVG`)

  const components = infer_components(labels)
  const traced = infer_regions(boundaries, labels, x_scale, y_scale)
  const { phases, regions } = assemble_regions(traced, components)
  return {
    format: BINARY_DIAGRAM_FORMAT,
    components,
    pressure_pa: 101325,
    temperature_range: y_scale.domain,
    phases,
    regions,
    boundaries: assemble_boundaries(boundaries, regions, [x_scale.px_tol, y_scale.px_tol]),
    invariants: [],
    congruent_points: [],
    critical_points: [],
    unary_transitions: [],
    polymorphic_transitions: [],
    provenance: { kind: `sketch`, source: `imported SVG` },
  }
}

// === Utility Functions ===

// Parse stroke-width from style or direct attribute (0 if missing, `2px` units ok)
function parse_stroke_width(element: Element): number {
  const width = /stroke-width:\s*(?<width>[\d.]+)/.exec(element.getAttribute(`style`) ?? ``)
    ?.groups?.width
  if (width !== undefined) return Number(width)
  const parsed = leading_number(element.getAttribute(`stroke-width`))
  return isNaN(parsed) ? 0 : parsed
}

// Leading number of an SVG element's attribute, null if absent or non-numeric
function parse_float_attr(element: Element, attr: string): number | null {
  const parsed = leading_number(element.getAttribute(attr))
  return isNaN(parsed) ? null : parsed
}

// Text of every XML comment node inside `group`, in document order
function* comment_texts(group: Element): Generator<string> {
  const walker = group.ownerDocument.createTreeWalker(group, NodeFilter.SHOW_COMMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    yield node.textContent ?? ``
  }
}

// First XML comment inside a group element that starts with a number
function comment_number_text(group: Element): string | null {
  for (const text of comment_texts(group)) if (!isNaN(leading_number(text))) return text
  return null
}

// First XML comment text (longer than one character) inside a group, else the nearest
// comment preceding it before the previous element
function find_comment_text(group: Element): string | null {
  for (const text of comment_texts(group)) if (text.trim().length > 1) return text.trim()
  for (
    let sibling = group.previousSibling;
    sibling && sibling.nodeType !== Node.ELEMENT_NODE;
    sibling = sibling.previousSibling
  ) {
    const text = sibling.nodeType === Node.COMMENT_NODE ? sibling.textContent?.trim() : ``
    if (text && text.length > 1) return text
  }
  return null
}

const NUMBER_REGEX = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g
const PATH_TOKEN_REGEX = new RegExp(`[MmLlHhVvCcSsQqTtAaZz]|${NUMBER_REGEX.source}`, `g`)

// Parse SVG path data (all commands, absolute and relative) into absolute line segments
// [x1,y1,x2,y2], curves approximated by straight lines to their endpoint. Throws on malformed
// data (unknown characters, missing coordinates) with a `d` snippet.
function parse_path_segments(path_str: string): Vec4[] {
  const snippet = path_str.length > 80 ? `${path_str.slice(0, 80)}…` : path_str
  const malformed = (reason: string) =>
    new Error(`Malformed SVG path data "${snippet}": ${reason}`)

  const leftover = path_str.replaceAll(PATH_TOKEN_REGEX, ``).replaceAll(/[\s,]/g, ``)
  if (leftover) throw malformed(`unexpected characters "${leftover.slice(0, 20)}"`)
  const tokens = path_str.match(PATH_TOKEN_REGEX)
  if (!tokens) throw malformed(`no path commands`)

  const segments: Vec4[] = []
  let [cursor_x, cursor_y] = [0, 0]
  let [start_x, start_y] = [0, 0]
  let last_cmd = ``
  const line_to = (x_end: number, y_end: number) => {
    segments.push([cursor_x, cursor_y, x_end, y_end])
    cursor_x = x_end
    cursor_y = y_end
  }

  // Numbers to skip before the endpoint x,y for each lineto-like command (arcs skip
  // rx ry rotation, then their two flags)
  const endpoint_skip: Record<string, number> = { L: 0, C: 4, S: 2, Q: 2, T: 0, A: 3 }
  const is_command = (token: string | undefined) =>
    token !== undefined && /^[A-Za-z]$/.test(token)

  let idx = 0
  const next_num = (cmd: string): number => {
    const token = tokens[idx]
    if (token === undefined || is_command(token)) {
      throw malformed(`command "${cmd}" is missing a coordinate at token ${idx}`)
    }
    idx++
    const value = Number(token)
    // a flag split off the front can leave a non-number ("11e2" → flags 1, 1 then "e2")
    if (!Number.isFinite(value))
      throw malformed(`invalid number "${token}" at token ${idx - 1}`)
    return value
  }
  // Arc flags are single 0/1 characters that minifiers run into what follows ("a1 1 0 011 1"
  // is flags 0, 1 then x = 1), so split one off the front of the token
  const next_flag = (cmd: string): number => {
    const token = tokens[idx]
    if (token === undefined || !/^[01]/.test(token)) {
      throw malformed(`command "${cmd}" needs a 0/1 arc flag at token ${idx}`)
    }
    if (token.length === 1) idx++
    else tokens[idx] = token.slice(1)
    return Number(token[0])
  }

  while (idx < tokens.length) {
    let cmd = tokens[idx]
    if (is_command(cmd)) {
      idx++
      last_cmd = cmd
    } else {
      // Implicit repeat: after M→L, after m→l, others repeat themselves
      if (!last_cmd) throw malformed(`coordinates before any command`)
      // Z takes no coordinates, so repeating it would consume nothing and loop forever
      if (last_cmd.toUpperCase() === `Z`) throw malformed(`coordinates after Z`)
      cmd = last_cmd === `M` ? `L` : last_cmd === `m` ? `l` : last_cmd
    }

    // Lowercase commands are relative to the current point
    const upper = cmd.toUpperCase()
    const abs_x = (val: number) => (cmd === upper ? val : cursor_x + val)
    const abs_y = (val: number) => (cmd === upper ? val : cursor_y + val)
    if (upper === `M`) {
      cursor_x = abs_x(next_num(cmd))
      cursor_y = abs_y(next_num(cmd))
      start_x = cursor_x
      start_y = cursor_y
    } else if (upper === `H`) line_to(abs_x(next_num(cmd)), cursor_y)
    else if (upper === `V`) line_to(cursor_x, abs_y(next_num(cmd)))
    else if (upper === `Z`) {
      if (cursor_x !== start_x || cursor_y !== start_y) line_to(start_x, start_y)
    } else {
      const skip = endpoint_skip[upper]
      if (skip === undefined) throw malformed(`unknown command "${cmd}"`)
      for (let skip_idx = 0; skip_idx < skip; skip_idx++) next_num(cmd)
      if (upper === `A`) {
        next_flag(cmd)
        next_flag(cmd)
      }
      line_to(abs_x(next_num(cmd)), abs_y(next_num(cmd)))
    }
  }
  return segments
}

// Parse translate(x, y) or translate(x) (implicit y=0 per SVG spec) from a transform attribute
function parse_translate(element: Element | null): Vec2 | null {
  const match = /translate\(\s*(?<x>[\d.eE+-]+)(?:\s*[,\s]\s*(?<y>[\d.eE+-]+))?\s*\)/.exec(
    element?.getAttribute(`transform`) ?? ``,
  )
  if (!match?.groups) return null
  const { x: coord_x, y: coord_y } = match.groups
  return [Number(coord_x), coord_y ? Number(coord_y) : 0]
}

// Unique sorted values, merging values within `tol` of the previous kept one
function collect_unique_sorted(values: number[], tol: number): number[] {
  if (values.length === 0) return []
  const sorted = values.toSorted((val_a, val_b) => val_a - val_b)
  const unique: number[] = [sorted[0]]
  for (let idx = 1; idx < sorted.length; idx++) {
    if (Math.abs(sorted[idx] - unique[unique.length - 1]) > tol) unique.push(sorted[idx])
  }
  return unique
}

// Index of the coordinate within `tol` of value in a sorted array, -1 if absent
const find_coord_index = (coords: number[], value: number, tol: number): number =>
  coords.findIndex((coord) => Math.abs(coord - value) <= tol)

// Index of the cell interval [coords[idx], coords[idx + 1]] containing value (±tol), -1 if none
const find_cell_index = (coords: number[], value: number, tol: number): number =>
  coords
    .slice(0, -1)
    .findIndex((lower, idx) => value >= lower - tol && value <= coords[idx + 1] + tol)

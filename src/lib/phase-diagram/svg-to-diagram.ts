// SVG-to-DiagramInput converter
// Parses phase diagram SVGs (matplotlib or simple/Gemini format) into DiagramInput JSON
// for immediate rendering by IsobaricBinaryPhaseDiagram

import { array_extent, point_in_polygon, type Vec2, type Vec4 } from '$lib/math'
import type { DiagramInput, DiagramPoint, RegionInput } from './diagram-input'

// Round to 6 decimal places for clean floating-point output
const round = (val: number): number => Math.round(val * 1e6) / 1e6

// === Types ===

type SvgFormat = `matplotlib` | `simple`

interface LinearScale {
  to_data: (px: number) => number
  to_px: (value: number) => number
  domain: Vec2 // [min_data, max_data]
}

interface Tick {
  px: number
  value: number
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

// A filled SVG shape (region fill) with its pixel-space outline rings and bounding box
interface FilledShape {
  fill: string
  bbox: Vec4 // [min_x, min_y, max_x, max_y] in px
  rings: Vec2[][] // closed outline rings; the bbox alone cannot decide a concave shape
}

// === Format Detection ===

// Matplotlib SVGs have xtick/ytick group IDs; anything else is treated as the simple format
const detect_format = (doc: Document): SvgFormat =>
  doc.querySelector(`[id^="xtick_"], [id^="ytick_"]`) ? `matplotlib` : `simple`

// Non-null results of `fn` over every element matching `selector`
const query_map = <T>(doc: Document, selector: string, fn: (el: Element) => T | null): T[] =>
  Array.from(doc.querySelectorAll(selector), fn).filter((item): item is T => item !== null)

// === Axis Scale Extraction ===

// Matplotlib ticks: <use> markers inside id="xtick_N"/"ytick_N" groups, value in an XML comment
function extract_matplotlib_ticks(doc: Document): [Tick[], Tick[]] {
  const ticks_of = (axis: `x` | `y`) =>
    query_map(doc, `[id^="${axis}tick_"]`, (group) => {
      const value = extract_comment_number(group)
      const use_el = group.querySelector(`use`)
      const px = use_el && parse_float_attr(use_el, axis)
      return value !== null && px !== null ? { px, value } : null
    })
  return [ticks_of(`x`), ticks_of(`y`)]
}

// Simple-format ticks: y values are <text class="tick-text"> right after their tick <line>
// (px from its y1), x values <text class="tick-text-x"> (px from its x attribute); both are
// offset by the parent group's translate
function extract_simple_ticks(doc: Document): [Tick[], Tick[]] {
  const tick_of = (text_el: Element, px: number | null, axis: 0 | 1): Tick | null => {
    const value = leading_number(text_el.textContent)
    if (isNaN(value) || px === null) return null
    return { px: px + (parse_translate(text_el.parentElement)?.[axis] ?? 0), value }
  }
  return [
    query_map(doc, `.tick-text-x`, (el) => tick_of(el, parse_float_attr(el, `x`), 0)),
    query_map(doc, `.tick-text`, (el) => {
      const tick_line = el.previousElementSibling
      if (!tick_line?.matches(`.tick-line, line`)) return null
      return tick_of(el, parse_float_attr(tick_line, `y1`), 1)
    }),
  ]
}

// Build a linear scale from tick data points. Fewer than two ticks means the SVG is neither a
// matplotlib export nor the simple class-based format (e.g. an MPDS export), so say so
// instead of failing on the missing tick.
function build_scale(axis: `x` | `y`, ticks: Tick[]): LinearScale {
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

  return {
    to_data: (px: number) => first.value + (px - first.px) / px_per_unit,
    to_px: (value: number) => first.px + (value - first.value) * px_per_unit,
    domain: [first.value, last.value],
  }
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
      const [x1, y1, x2, y2] = segments[0]
      // Skip tick mark lines (short lines, typically < 10px)
      if (Math.abs(x2 - x1) < 15 && Math.abs(y2 - y1) < 15) return null
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

// Phase region labels (text containing "+", which axis labels lack) with pixel positions.
// Matplotlib stores the LaTeX text in XML comments of text_N groups and may split a label
// into a following continuation group ("+ La$_3$Ni$_2$O$_7$"); the simple format uses
// <text class="label-main"> positioned by transform or x/y attributes.
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

// Fills that are page/axes backgrounds rather than phase regions (matplotlib's
// figure and axes patches are white)
const BACKGROUND_FILLS = new Set([`#fff`, `#ffffff`, `white`, `rgb(255,255,255)`])

// Fill colour of an element from style="fill: ..." or the fill attribute; null if unset/none
function element_fill(el: Element): string | null {
  const style_match = /(?:^|;)\s*fill\s*:\s*(?<fill>[^;]+)/.exec(
    el.getAttribute(`style`) ?? ``,
  )
  const fill = (style_match?.groups?.fill ?? el.getAttribute(`fill`))?.trim()
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

// Closed pixel-space outline of a rect/polygon/path element, or of a <use> instance of one
// shifted by its x/y offset (matplotlib's fill_between puts the polygon in <defs> and fills
// the <use>), as the rings SVG would fill. Other transforms are not applied.
function shape_rings(el: Element): Vec2[][] | null {
  const tag = el.tagName.toLowerCase()
  if (tag === `use`) {
    const href = el.getAttribute(`href`) ?? el.getAttribute(`xlink:href`) ?? ``
    const target = href.startsWith(`#`)
      ? el.ownerDocument.querySelector(`[id="${href.slice(1).replaceAll(`"`, `\\"`)}"]`)
      : null
    const rings = target && target.tagName.toLowerCase() !== `use` ? shape_rings(target) : null
    const [dx, dy] = [parse_float_attr(el, `x`) ?? 0, parse_float_attr(el, `y`) ?? 0]
    return rings?.map((ring) => ring.map(([x_px, y_px]) => [x_px + dx, y_px + dy])) ?? null
  }
  if (tag === `rect`) {
    const [x_px, y_px] = [parse_float_attr(el, `x`) ?? 0, parse_float_attr(el, `y`) ?? 0]
    const [width, height] = [parse_float_attr(el, `width`), parse_float_attr(el, `height`)]
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
    const nums = ((el.getAttribute(`points`) ?? ``).match(NUMBER_REGEX) ?? []).map(Number)
    return [
      Array.from({ length: nums.length >> 1 }, (_, idx) => [nums[2 * idx], nums[2 * idx + 1]]),
    ]
  }
  const d_attr = tag === `path` ? el.getAttribute(`d`) : null
  return d_attr === null ? null : segments_to_rings(parse_path_segments(d_attr))
}

// Collect all non-background filled shapes (candidate phase region fills). Transformed shapes
// are skipped since shape_rings ignores transforms (their pixel coords would be wrong).
function extract_filled_shapes(doc: Document): FilledShape[] {
  const shapes: FilledShape[] = []
  for (const el of Array.from(doc.querySelectorAll(`rect, polygon, path, use`))) {
    const fill = element_fill(el)
    if (fill === null || el.hasAttribute(`transform`)) continue
    const rings = shape_rings(el) ?? []
    const verts = rings.flat()
    if (verts.length < 3) continue // fewer than 3 corners encloses no area
    const [min_x, max_x] = array_extent(verts.map(([x_px]) => x_px))
    const [min_y, max_y] = array_extent(verts.map(([, y_px]) => y_px))
    shapes.push({ fill, bbox: [min_x, min_y, max_x, max_y], rings })
  }
  return shapes
}

// Fill of the smallest filled shape actually containing the given pixel point. The bounding box
// is only the cheap reject: a concave phase field's bbox covers its neighbours.
function fill_at_px(shapes: FilledShape[], [px_x, px_y]: Vec2): string | undefined {
  let best: FilledShape | undefined
  let best_area = Infinity
  for (const shape of shapes) {
    const [min_x, min_y, max_x, max_y] = shape.bbox
    if (px_x < min_x || px_x > max_x || px_y < min_y || px_y > max_y) continue
    const area = (max_x - min_x) * (max_y - min_y)
    if (area >= best_area) continue
    // even-odd across subpaths, so a ring cut out of another reads as a hole
    const inside = shape.rings.reduce(
      (acc, ring) => acc !== point_in_polygon(px_x, px_y, ring),
      false,
    )
    if (inside) [best, best_area] = [shape, area]
  }
  return best?.fill
}

// === Component Inference ===

const split_phase_label = (label: Label) => label.text.split(/\s*\+\s*/)

// Infer binary components from region labels sorted by x: each end's pure component is the
// phase of its two-phase end region absent from the three regions at the other end (for
// "La2NiO4 + La2O3" on the left, La2O3 is the pure A endpoint)
function infer_components(labels: Label[]): [string, string] {
  const sorted = labels.toSorted((label_a, label_b) => label_a.px_x - label_b.px_x)
  if (sorted.length < 2) return [`A`, `B`]
  const end_component = (end: Label, other_end: Label[], fallback: string): string => {
    const phases = split_phase_label(end)
    if (phases.length !== 2) return fallback
    const other_phases = new Set(other_end.flatMap(split_phase_label))
    return phases.find((phase) => !other_phases.has(phase)) ?? phases[1]
  }
  return [
    end_component(sorted[0], sorted.slice(-3), `A`),
    end_component(sorted[sorted.length - 1], sorted.slice(0, 3), `B`),
  ]
}

// === Region Inference ===

// Infer phase regions from orthogonal boundaries using flood-fill on a cell grid
function infer_regions(
  boundaries: Boundary[],
  labels: Label[],
  filled_shapes: FilledShape[],
  x_scale: LinearScale,
  y_scale: LinearScale,
): RegionInput[] {
  const verticals = boundaries.filter((boundary) => boundary.orientation === `vertical`)
  const horizontals = boundaries.filter((boundary) => boundary.orientation === `horizontal`)

  // Collect all unique x and y coordinates (boundaries + domain edges)
  const x_coords = collect_unique_sorted([
    x_scale.domain[0],
    x_scale.domain[1],
    ...verticals.map((boundary) => boundary.x1), // x1 === x2 for vertical
  ])

  const y_coords = collect_unique_sorted([
    y_scale.domain[0],
    y_scale.domain[1],
    ...horizontals.map((boundary) => boundary.y1), // y1 === y2 for horizontal
  ])

  // Build cell grid: cells[col][row]
  const n_cols = x_coords.length - 1
  const n_rows = y_coords.length - 1
  const cell_ids = Array.from({ length: n_cols }, () => Array(n_rows).fill(-1))

  // Walled cell edges: h_walls[col][row] is the bottom edge of cell (col, row), v_walls[col][row]
  // its left edge; the plot edges are always walls
  const h_walls = Array.from({ length: n_cols }, () => Array(n_rows + 1).fill(false))
  const v_walls = Array.from({ length: n_cols + 1 }, () => Array(n_rows).fill(false))
  for (const col_walls of h_walls) for (const row of [0, n_rows]) col_walls[row] = true
  for (const col of [0, n_cols]) v_walls[col].fill(true)
  // Cell intervals of `coords` that the span [lo, hi] covers
  const spanned_cells = (lo: number, hi: number, coords: number[]): number[] =>
    coords
      .slice(0, -1)
      .flatMap((cell_min, idx) =>
        lo <= cell_min + 1e-6 && hi >= coords[idx + 1] - 1e-6 ? [idx] : [],
      )
  for (const hb of horizontals) {
    const row = find_coord_index(y_coords, hb.y1)
    if (row === -1) continue
    for (const col of spanned_cells(hb.x1, hb.x2, x_coords)) h_walls[col][row] = true
  }
  for (const vb of verticals) {
    const col = find_coord_index(x_coords, vb.x1)
    if (col === -1) continue
    for (const row of spanned_cells(vb.y1, vb.y2, y_coords)) v_walls[col][row] = true
  }

  // Flood-fill to assign region IDs
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
    const col = find_cell_index(x_coords, x_scale.to_data(label.px_x))
    const row = find_cell_index(y_coords, y_scale.to_data(label.px_y))
    if (col !== -1 && row !== -1) region_labels.set(cell_ids[col][row], label.text)
  }

  // Build region polygons by tracing the outline of each region's merged cells
  const regions: RegionInput[] = []
  for (let region_id = 0; region_id < next_region_id; region_id++) {
    const name = region_labels.get(region_id) ?? `Region ${region_id + 1}`
    // Slug can be empty for non-ASCII labels like "α + β" — fall back to region_N
    const slug =
      name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, `_`)
        .replaceAll(/^_|_$/g, ``) || `region_${region_id + 1}`

    const bounds: DiagramPoint[] = trace_region_outline(
      cell_ids,
      region_id,
      n_cols,
      n_rows,
      name,
    ).map(([col, row]) => [round(x_coords[col]), round(y_coords[row])])

    // Region colour: fill of the SVG shape under the centre of the region's largest cell (a
    // point guaranteed inside the region, unlike the centroid of a thin L or U shape)
    let [probe_col, probe_row, probe_area] = [-1, -1, -Infinity]
    for (let col = 0; col < n_cols; col++) {
      for (let row = 0; row < n_rows; row++) {
        if (cell_ids[col][row] !== region_id) continue
        const area = (x_coords[col + 1] - x_coords[col]) * (y_coords[row + 1] - y_coords[row])
        if (area > probe_area) [probe_col, probe_row, probe_area] = [col, row, area]
      }
    }
    const color = fill_at_px(filled_shapes, [
      x_scale.to_px((x_coords[probe_col] + x_coords[probe_col + 1]) / 2),
      y_scale.to_px((y_coords[probe_row] + y_coords[probe_row + 1]) / 2),
    ])

    regions.push({ id: slug, name, ...(color ? { color } : {}), bounds })
  }

  return regions
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

// Trace the outer outline of the cells belonging to region_id as a rectilinear polygon
// in grid-vertex coordinates [col_idx, row_idx], counter-clockwise in data space (x right,
// temperature up) with collinear vertices removed. Boundary edges are emitted with the
// region interior on their left and chained into a loop; at a pinch vertex (two region
// cells touching only diagonally) the right-hand turn keeps the traversal on one loop.
// Any remaining edges after the outer loop closes belong to holes and are dropped. Flood-filled
// cells always yield a closed loop; should the chain still break (an unclosed outline or a
// turn with nowhere to go) the region falls back to the bounding box of its cells with a
// warning, so one pathological region cannot fail the whole import. Exported for tests.
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
  const add_edge = (from: Vec2, to: Vec2) => {
    const key = vertex_key(from)
    const edges = outgoing.get(key)
    if (edges) edges.push(to)
    else outgoing.set(key, [to])
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
      const turn = (to: Vec2) => in_dx * (to[1] - current[1]) - in_dy * (to[0] - current[0])
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

// === Curve Generation ===

// Generate named curves from boundaries for the DiagramInput format
function generate_curves(boundaries: Boundary[]): Record<string, DiagramPoint[]> {
  const curves: Record<string, DiagramPoint[]> = {}
  const counts = { vertical: 0, horizontal: 0 }

  for (const bnd of boundaries) {
    const is_vert = bnd.orientation === `vertical`
    const name = `${bnd.orientation}_${counts[bnd.orientation]++}`
    curves[name] = [
      [round(bnd.x1), round(bnd.y1)],
      [round(is_vert ? bnd.x1 : bnd.x2), round(is_vert ? bnd.y2 : bnd.y1)],
    ]
  }

  return curves
}

// === Main Entry Point ===

// Parse a phase diagram SVG string and return a DiagramInput
export function parse_phase_diagram_svg(svg_string: string): DiagramInput {
  const doc = new DOMParser().parseFromString(svg_string, `image/svg+xml`)
  const parse_error = doc.querySelector(`parsererror`)
  if (parse_error) throw new Error(`Invalid SVG: ${parse_error.textContent}`)

  const format = detect_format(doc)
  const [x_ticks, y_ticks] =
    format === `matplotlib` ? extract_matplotlib_ticks(doc) : extract_simple_ticks(doc)
  // y-axis inverted (SVG y down, temp up)
  const [x_scale, y_scale] = [build_scale(`x`, x_ticks), build_scale(`y`, y_ticks)]
  const boundaries = extract_boundary_lines(doc, format).flatMap(
    (line) => to_boundary(line, x_scale, y_scale) ?? [],
  )
  const labels = extract_labels(doc, format)
  if (boundaries.length === 0) throw new Error(`No phase boundaries found in SVG`)

  return {
    meta: {
      components: infer_components(labels),
      temp_range: y_scale.domain,
      temp_unit: `K`,
      comp_unit: `fraction`,
      title: `Imported Phase Diagram`,
    },
    curves: generate_curves(boundaries),
    regions: infer_regions(boundaries, labels, extract_filled_shapes(doc), x_scale, y_scale),
  }
}

// === Utility Functions ===

// Leading numeric prefix like parseFloat (`2px` -> 2, `600 K` -> 600, else NaN):
// Number() alone rejects unit-suffixed/annotated values that real SVG exports contain
function leading_number(text: string | null | undefined): number {
  const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text?.trim() ?? ``)
  return match ? Number(match[0]) : NaN
}

// Parse stroke-width from style or direct attribute (0 if missing, `2px` units ok)
function parse_stroke_width(el: Element): number {
  const width = /stroke-width:\s*(?<width>[\d.]+)/.exec(el.getAttribute(`style`) ?? ``)?.groups
    ?.width
  if (width !== undefined) return Number(width)
  const parsed = leading_number(el.getAttribute(`stroke-width`))
  return isNaN(parsed) ? 0 : parsed
}

// Parse a float attribute from an SVG element
function parse_float_attr(el: Element, attr: string): number | null {
  const val = el.getAttribute(attr)
  if (val === null) return null
  const parsed = leading_number(val)
  return isNaN(parsed) ? null : parsed
}

// Text of every XML comment node inside `group`, in document order
function* comment_texts(group: Element): Generator<string> {
  const walker = group.ownerDocument.createTreeWalker(group, NodeFilter.SHOW_COMMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    yield node.textContent ?? ``
  }
}

// First number found in an XML comment inside a group element
function extract_comment_number(group: Element): number | null {
  for (const text of comment_texts(group)) {
    const value = leading_number(text)
    if (!isNaN(value)) return value
  }
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

// Parse SVG path data into absolute line segments [x1,y1,x2,y2]
// Handles all SVG path commands (M/L/H/V/C/S/Q/T/A/Z, both absolute and relative)
// Curves (C/S/Q/T/A) are approximated as straight lines from start to endpoint
// After M/m, implicit coordinates are treated as L/l per SVG spec
// Throws on malformed data (unknown characters, missing coordinates) with a `d` snippet
function parse_path_segments(path_str: string): Vec4[] {
  const snippet = path_str.length > 80 ? `${path_str.slice(0, 80)}…` : path_str
  const malformed = (reason: string) =>
    new Error(`Malformed SVG path data "${snippet}": ${reason}`)

  const leftover = path_str.replace(PATH_TOKEN_REGEX, ``).replaceAll(/[\s,]/g, ``)
  if (leftover) throw malformed(`unexpected characters "${leftover.slice(0, 20)}"`)
  const tokens = path_str.match(PATH_TOKEN_REGEX)
  if (!tokens) throw malformed(`no path commands`)

  const segments: Vec4[] = []
  let [cursor_x, cursor_y] = [0, 0]
  let [start_x, start_y] = [0, 0]
  let last_cmd = ``
  const line_to = (x2: number, y2: number) => {
    segments.push([cursor_x, cursor_y, x2, y2])
    cursor_x = x2
    cursor_y = y2
  }

  // Numbers to skip before the endpoint x,y for each lineto-like command (curves are
  // approximated by the straight line to their endpoint)
  const endpoint_skip: Record<string, number> = { L: 0, C: 4, S: 2, Q: 2, T: 0, A: 5 }
  const is_command = (token: string | undefined) =>
    token !== undefined && /^[A-Za-z]$/.test(token)

  let idx = 0
  const next_num = (cmd: string): number => {
    const token = tokens[idx]
    if (token === undefined || is_command(token)) {
      throw malformed(`command "${cmd}" is missing a coordinate at token ${idx}`)
    }
    idx++
    return Number(token)
  }

  while (idx < tokens.length) {
    let cmd = tokens[idx]
    if (is_command(cmd)) {
      idx++
      last_cmd = cmd
    } else {
      // Implicit repeat: after M→L, after m→l, others repeat themselves
      if (!last_cmd) throw malformed(`coordinates before any command`)
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
      line_to(abs_x(next_num(cmd)), abs_y(next_num(cmd)))
    }
  }
  return segments
}

// Parse translate(x, y) or translate(x) from a transform attribute
// Single-arg translate uses implicit y=0 per SVG spec
function parse_translate(el: Element | null): Vec2 | null {
  const match = /translate\(\s*(?<x>[\d.eE+-]+)(?:\s*[,\s]\s*(?<y>[\d.eE+-]+))?\s*\)/.exec(
    el?.getAttribute(`transform`) ?? ``,
  )
  if (!match?.groups) return null
  const { x, y } = match.groups
  return [Number(x), y ? Number(y) : 0]
}

// Collect unique sorted values from an array (with epsilon deduplication)
function collect_unique_sorted(values: number[]): number[] {
  if (values.length === 0) return []
  const sorted = values.toSorted((val_a, val_b) => val_a - val_b)
  const unique: number[] = [sorted[0]]
  for (let idx = 1; idx < sorted.length; idx++) {
    if (Math.abs(sorted[idx] - unique[unique.length - 1]) > 1e-4) {
      unique.push(sorted[idx])
    }
  }
  return unique
}

// Index of a coordinate in a sorted array (with epsilon tolerance), -1 if absent
const find_coord_index = (coords: number[], value: number): number =>
  coords.findIndex((coord) => Math.abs(coord - value) < 1e-4)

// Index of the cell interval [coords[idx], coords[idx + 1]] containing value, -1 if none
const find_cell_index = (coords: number[], value: number): number =>
  coords
    .slice(0, -1)
    .findIndex((lower, idx) => value >= lower - 1e-4 && value <= coords[idx + 1] + 1e-4)

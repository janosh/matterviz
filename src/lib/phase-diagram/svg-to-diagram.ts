// SVG-to-DiagramInput converter
// Parses phase diagram SVGs (matplotlib or simple/Gemini format) into DiagramInput JSON
// for immediate rendering by IsobaricBinaryPhaseDiagram

import type { Vec2, Vec4 } from '$lib/math'
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

// A filled SVG shape (region fill) with its pixel bounding box
interface FilledShape {
  fill: string
  bbox: Vec4 // [min_x, min_y, max_x, max_y] in px
}

// === Format Detection ===

// Matplotlib SVGs have xtick/ytick group IDs; anything else is treated as the simple format
const detect_format = (doc: Document): SvgFormat =>
  doc.querySelector(`[id^="xtick_"], [id^="ytick_"]`) ? `matplotlib` : `simple`

// === Axis Scale Extraction ===

// Extract x and y axis scales from tick marks
function extract_axis_scales(
  doc: Document,
  format: SvgFormat,
): { x_scale: LinearScale; y_scale: LinearScale } {
  const x_ticks: Tick[] = []
  const y_ticks: Tick[] = []

  if (format === `matplotlib`) extract_matplotlib_ticks(doc, x_ticks, y_ticks)
  else extract_simple_ticks(doc, x_ticks, y_ticks)

  return {
    x_scale: build_scale(`x`, x_ticks),
    y_scale: build_scale(`y`, y_ticks), // y-axis inverted (SVG y down, temp up)
  }
}

// Extract ticks from matplotlib SVG (id="xtick_N", comment-based values)
function extract_matplotlib_ticks(doc: Document, x_ticks: Tick[], y_ticks: Tick[]): void {
  const axes: [string, string, Tick[]][] = [
    [`xtick_`, `x`, x_ticks],
    [`ytick_`, `y`, y_ticks],
  ]
  for (const [prefix, attr, ticks] of axes) {
    for (const group of Array.from(doc.querySelectorAll(`[id^="${prefix}"]`))) {
      const value = extract_comment_number(group)
      const use_el = group.querySelector(`use`)
      if (value !== null && use_el) {
        const px = parse_float_attr(use_el, attr)
        if (px !== null) ticks.push({ px, value })
      }
    }
  }
}

// Extract ticks from simple SVG (class-based text elements)
function extract_simple_ticks(doc: Document, x_ticks: Tick[], y_ticks: Tick[]): void {
  // Y-axis ticks: class="tick-text" with text-anchor: end
  for (const text_el of Array.from(doc.querySelectorAll(`.tick-text`))) {
    const value = leading_number(text_el.textContent)
    if (isNaN(value)) continue

    // Find the immediately preceding sibling tick line (not just any line in parent)
    const tick_line = text_el.previousElementSibling
    if (!tick_line || !tick_line.matches(`.tick-line, line`)) continue
    const py = parse_float_attr(tick_line, `y1`)
    // Apply parent group transform if present
    const transform_y = parse_translate(text_el.parentElement)?.[1] ?? 0
    if (py !== null) y_ticks.push({ px: py + transform_y, value })
  }

  // X-axis ticks: class="tick-text-x"
  for (const text_el of Array.from(doc.querySelectorAll(`.tick-text-x`))) {
    const value = leading_number(text_el.textContent)
    if (isNaN(value)) continue

    const px_x = parse_float_attr(text_el, `x`)
    // Apply parent group transform if present
    const transform_x = parse_translate(text_el.parentElement)?.[0] ?? 0
    if (px_x !== null) x_ticks.push({ px: px_x + transform_x, value })
  }
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

// Extract phase boundary lines from SVG and convert to data coordinates
function extract_boundaries(
  doc: Document,
  format: SvgFormat,
  x_scale: LinearScale,
  y_scale: LinearScale,
): Boundary[] {
  const boundaries: Boundary[] = []
  const epsilon = 0.5 // pixel tolerance for classifying horizontal/vertical

  if (format === `matplotlib`) {
    // Matplotlib: look for line2d_N groups with path elements (skip tick marks at line2d_1..12ish)
    for (const group of Array.from(doc.querySelectorAll(`[id^="line2d_"]`))) {
      const path_el = group.querySelector(`path`)
      const d_attr = path_el?.getAttribute(`d`)
      if (!path_el || typeof d_attr !== `string`) continue

      // Multi-segment paths are not straight boundaries
      const segments = parse_path_segments(d_attr)
      if (segments.length !== 1) continue
      const [x1, y1, x2, y2] = segments[0]

      // Skip tick mark lines (short lines, typically < 10px)
      if (Math.abs(x2 - x1) < 15 && Math.abs(y2 - y1) < 15) continue

      // Hairlines are axis furniture (matplotlib draws ticks and spines at 0.8 px); an
      // unparsable/absent stroke-width (0) is kept as a boundary
      const stroke_width = parse_stroke_width(path_el)
      if (stroke_width > 0 && stroke_width < 1) continue

      add_boundary(boundaries, [x1, y1, x2, y2], x_scale, y_scale, epsilon)
    }
  } else {
    // Simple: <line class="phase-boundary">
    for (const line_el of Array.from(
      doc.querySelectorAll(`.phase-boundary, line[class*="phase-boundary"]`),
    )) {
      const x1 = parse_float_attr(line_el, `x1`)
      const y1 = parse_float_attr(line_el, `y1`)
      const x2 = parse_float_attr(line_el, `x2`)
      const y2 = parse_float_attr(line_el, `y2`)
      if (x1 === null || y1 === null || x2 === null || y2 === null) {
        throw new Error(
          `Phase boundary line is missing numeric x1/y1/x2/y2 attributes: ${line_el.outerHTML.slice(0, 200)}`,
        )
      }

      add_boundary(boundaries, [x1, y1, x2, y2], x_scale, y_scale, epsilon)
    }
  }

  return boundaries
}

// Add a boundary line (pixel endpoints), classifying as horizontal or vertical
function add_boundary(
  boundaries: Boundary[],
  [px_x1, px_y1, px_x2, px_y2]: Vec4,
  x_scale: LinearScale,
  y_scale: LinearScale,
  epsilon: number,
): void {
  const is_vertical = Math.abs(px_x1 - px_x2) < epsilon
  const is_horizontal = Math.abs(px_y1 - px_y2) < epsilon

  if (!is_vertical && !is_horizontal) return // skip diagonal lines

  const data_x1 = x_scale.to_data(px_x1)
  const data_y1 = y_scale.to_data(px_y1)
  const data_x2 = x_scale.to_data(px_x2)
  const data_y2 = y_scale.to_data(px_y2)

  boundaries.push({
    x1: Math.min(data_x1, data_x2),
    y1: Math.min(data_y1, data_y2),
    x2: Math.max(data_x1, data_x2),
    y2: Math.max(data_y1, data_y2),
    orientation: is_vertical ? `vertical` : `horizontal`,
  })
}

// === Label Extraction ===

// Extract phase region labels with their pixel positions
function extract_labels(doc: Document, format: SvgFormat): Label[] {
  const labels: Label[] = []
  if (format === `matplotlib`) extract_matplotlib_labels(doc, labels)
  else extract_simple_labels(doc, labels)
  return labels
}

// Extract labels from matplotlib SVG using XML comments
function extract_matplotlib_labels(doc: Document, labels: Label[]): void {
  // Find text groups with comments containing phase names
  // Matplotlib may split multi-line labels (especially rotated ones) into
  // separate <g> groups: text_N has "La$_2$NiO$_4$", followed by a sibling
  // with "+ La$_3$Ni$_2$O$_7$". We concatenate these continuation groups.
  for (const group of Array.from(doc.querySelectorAll(`[id^="text_"]`))) {
    let comment = find_comment_text(group)
    if (!comment) continue

    // Check following sibling groups for continuation comments starting with "+"
    let sibling = group.nextElementSibling
    while (sibling) {
      // Stop at the next text_N group (that's a separate label)
      if (sibling.id?.startsWith(`text_`)) break
      const continuation = find_comment_text(sibling)
      if (continuation?.trimStart().startsWith(`+`)) {
        comment += ` ${continuation.trim()}`
        sibling = sibling.nextElementSibling
      } else {
        break
      }
    }

    if (!comment.includes(`+`)) continue // skip axis labels (no "+")

    // Clean LaTeX: "La$_2$NiO$_4$ + NiO" -> "La2NiO4 + NiO"
    const text = comment
      .trim()
      .replaceAll(/\$_\{(?<digits>[^}]*)\}\$/g, `$1`) // $_{10}$ -> 10
      .replaceAll(/\$_(?<digit>\d)\$/g, `$1`) // $_2$ -> 2
      .replaceAll(`$`, ``) // remove any remaining $
      .replaceAll(/\s+/g, ` `)
      .trim()

    // Get position from transform="translate(x, y)"
    const pos = parse_translate(group.querySelector(`g[transform]`)) ?? parse_translate(group)
    if (!pos) continue

    labels.push({ text, px_x: pos[0], px_y: pos[1] })
  }
}

// Extract labels from simple SVG using class="label-main"
function extract_simple_labels(doc: Document, labels: Label[]): void {
  for (const text_el of Array.from(doc.querySelectorAll(`.label-main`))) {
    // Get plain text content (strips tspan tags)
    const text = (text_el.textContent ?? ``).replaceAll(/\s+/g, ` `).trim()
    if (!text.includes(`+`)) continue // skip non-phase labels

    // Get position from transform or x/y attributes
    const pos = parse_translate(text_el)
    const px_x = pos?.[0] ?? parse_float_attr(text_el, `x`)
    const px_y = pos?.[1] ?? parse_float_attr(text_el, `y`)

    if (px_x !== null && px_y !== null) {
      labels.push({ text, px_x, px_y })
    }
  }
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

// Pixel bounding box of a rect/polygon/path element, or of a <use> instance of one shifted by
// its x/y offset (matplotlib's fill_between puts the polygon in <defs> and fills the <use>).
// Other transforms are not applied.
function shape_bbox(el: Element): Vec4 | null {
  const tag = el.tagName.toLowerCase()
  if (tag === `use`) {
    const href = el.getAttribute(`href`) ?? el.getAttribute(`xlink:href`) ?? ``
    const target = href.startsWith(`#`)
      ? el.ownerDocument.querySelector(`[id="${href.slice(1).replaceAll(`"`, `\\"`)}"]`)
      : null
    const bbox = target && target.tagName.toLowerCase() !== `use` ? shape_bbox(target) : null
    if (!bbox) return null
    const [dx, dy] = [parse_float_attr(el, `x`) ?? 0, parse_float_attr(el, `y`) ?? 0]
    return [bbox[0] + dx, bbox[1] + dy, bbox[2] + dx, bbox[3] + dy]
  }
  if (tag === `rect`) {
    const x_px = parse_float_attr(el, `x`) ?? 0
    const y_px = parse_float_attr(el, `y`) ?? 0
    const width = parse_float_attr(el, `width`)
    const height = parse_float_attr(el, `height`)
    if (width === null || height === null) return null
    return [x_px, y_px, x_px + width, y_px + height]
  }
  const points: number[] = []
  if (tag === `polygon`) {
    const raw = el.getAttribute(`points`) ?? ``
    points.push(...(raw.match(NUMBER_REGEX) ?? []).map(Number))
  } else if (tag === `path`) {
    const d_attr = el.getAttribute(`d`)
    if (d_attr === null) return null
    points.push(...parse_path_segments(d_attr).flat())
  }
  if (points.length < 4) return null
  const xs = points.filter((_, idx) => idx % 2 === 0)
  const ys = points.filter((_, idx) => idx % 2 === 1)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

// Collect all non-background filled shapes (candidate phase region fills). Transformed shapes
// are skipped since shape_bbox ignores transforms (their pixel bbox would be wrong).
function extract_filled_shapes(doc: Document): FilledShape[] {
  const shapes: FilledShape[] = []
  for (const el of Array.from(doc.querySelectorAll(`rect, polygon, path, use`))) {
    const fill = element_fill(el)
    if (fill === null || el.hasAttribute(`transform`)) continue
    const bbox = shape_bbox(el)
    if (bbox) shapes.push({ fill, bbox })
  }
  return shapes
}

// Fill of the smallest filled shape whose bbox contains the given pixel point
function fill_at_px(shapes: FilledShape[], [px_x, px_y]: Vec2): string | undefined {
  let best: FilledShape | undefined
  let best_area = Infinity
  for (const shape of shapes) {
    const [min_x, min_y, max_x, max_y] = shape.bbox
    if (px_x < min_x || px_x > max_x || px_y < min_y || px_y > max_y) continue
    const area = (max_x - min_x) * (max_y - min_y)
    if (area < best_area) {
      best = shape
      best_area = area
    }
  }
  return best?.fill
}

// === Component Inference ===

const split_phase_label = (label: Label) => label.text.split(/\s*\+\s*/)

// Infer binary components from region labels
function infer_components(labels: Label[]): [string, string] {
  // Sort labels by x position, split each into phases
  const sorted = labels.toSorted((label_a, label_b) => label_a.px_x - label_b.px_x)
  if (sorted.length < 2) return [`A`, `B`]

  const leftmost = split_phase_label(sorted[0])
  const rightmost = split_phase_label(sorted[sorted.length - 1])

  // Component A: the unique phase in the leftmost region that doesn't appear on the right
  // For "La2NiO4 + La2O3", La2O3 is the pure A endpoint
  let comp_a = `A`
  if (leftmost.length === 2) {
    const right_phases = new Set(sorted.slice(-3).flatMap(split_phase_label))
    comp_a = leftmost.find((phase) => !right_phases.has(phase)) ?? leftmost[1] ?? `A`
  }

  // Component B: the unique phase in the rightmost region that doesn't appear on the left
  let comp_b = `B`
  if (rightmost.length === 2) {
    const left_phases = new Set(sorted.slice(0, 3).flatMap(split_phase_label))
    comp_b = rightmost.find((phase) => !left_phases.has(phase)) ?? rightmost[1] ?? `B`
  }

  return [comp_a, comp_b]
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

  // Check which cell edges have boundaries
  const h_walls = Array.from({ length: n_cols }, () => Array(n_rows + 1).fill(false))
  const v_walls = Array.from({ length: n_cols + 1 }, () => Array(n_rows).fill(false))

  // Mark horizontal walls (bottom/top of cells)
  for (const hb of horizontals) {
    const row = find_coord_index(y_coords, hb.y1)
    if (row === -1) continue
    for (let col = 0; col < n_cols; col++) {
      const cell_x_min = x_coords[col]
      const cell_x_max = x_coords[col + 1]
      // Check if the boundary spans this cell's x range
      if (hb.x1 <= cell_x_min + 1e-6 && hb.x2 >= cell_x_max - 1e-6) {
        h_walls[col][row] = true
      }
    }
  }

  // Mark vertical walls (left/right of cells)
  for (const vb of verticals) {
    const col = find_coord_index(x_coords, vb.x1)
    if (col === -1) continue
    for (let row = 0; row < n_rows; row++) {
      const cell_y_min = y_coords[row]
      const cell_y_max = y_coords[row + 1]
      // Check if the boundary spans this cell's y range
      if (vb.y1 <= cell_y_min + 1e-6 && vb.y2 >= cell_y_max - 1e-6) {
        v_walls[col][row] = true
      }
    }
  }

  // Plot edges are always walls
  for (let col = 0; col < n_cols; col++) {
    h_walls[col][0] = true // bottom edge
    h_walls[col][n_rows] = true // top edge
  }
  for (let row = 0; row < n_rows; row++) {
    v_walls[0][row] = true // left edge
    v_walls[n_cols][row] = true // right edge
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

  // Assign labels to regions by checking which region contains each label's position
  const region_labels = new Map<number, string>()
  for (const label of labels) {
    const data_x = x_scale.to_data(label.px_x)
    const data_y = y_scale.to_data(label.px_y)

    const col = find_cell_index(x_coords, data_x)
    const row = find_cell_index(y_coords, data_y)
    if (col >= 0 && col < n_cols && row >= 0 && row < n_rows) {
      const region_id = cell_ids[col][row]
      if (region_id !== -1) {
        region_labels.set(region_id, label.text)
      }
    }
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

    // Check neighbors (no wall between them)
    // Left neighbor: check v_walls[col][row]
    if (col > 0 && !v_walls[col][row]) stack.push([col - 1, row])
    // Right neighbor: check v_walls[col+1][row]
    if (col < n_cols - 1 && !v_walls[col + 1][row]) stack.push([col + 1, row])
    // Bottom neighbor: check h_walls[col][row]
    if (row > 0 && !h_walls[col][row]) stack.push([col, row - 1])
    // Top neighbor: check h_walls[col][row+1]
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
  const parser = new DOMParser()
  const doc = parser.parseFromString(svg_string, `image/svg+xml`)

  // Check for parse errors
  const parse_error = doc.querySelector(`parsererror`)
  if (parse_error) {
    throw new Error(`Invalid SVG: ${parse_error.textContent}`)
  }

  const format = detect_format(doc)
  const { x_scale, y_scale } = extract_axis_scales(doc, format)
  const boundaries = extract_boundaries(doc, format, x_scale, y_scale)
  const labels = extract_labels(doc, format)
  const components = infer_components(labels)

  if (boundaries.length === 0) {
    throw new Error(`No phase boundaries found in SVG`)
  }

  const regions = infer_regions(
    boundaries,
    labels,
    extract_filled_shapes(doc),
    x_scale,
    y_scale,
  )
  const curves = generate_curves(boundaries)

  return {
    meta: {
      components,
      temp_range: y_scale.domain,
      temp_unit: `K`,
      comp_unit: `fraction`,
      title: `Imported Phase Diagram`,
    },
    curves,
    regions,
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

// Extract a number from XML comment nodes inside a group element
function extract_comment_number(group: Element): number | null {
  const walker = group.ownerDocument.createTreeWalker(group, NodeFilter.SHOW_COMMENT)
  let node: Comment | null
  while ((node = walker.nextNode() as Comment | null)) {
    const value = leading_number(node.textContent)
    if (!isNaN(value)) return value
  }
  return null
}

// Find the first XML comment text inside or preceding a group
function find_comment_text(group: Element): string | null {
  // Check comment nodes inside the group
  const walker = group.ownerDocument.createTreeWalker(group, NodeFilter.SHOW_COMMENT)
  let node: Comment | null
  while ((node = walker.nextNode() as Comment | null)) {
    const text = node.textContent?.trim()
    if (text && text.length > 1) return text
  }

  // Check preceding sibling comments
  let sibling = group.previousSibling
  while (sibling) {
    if (sibling.nodeType === Node.COMMENT_NODE) {
      const text = sibling.textContent?.trim()
      if (text && text.length > 1) return text
    }
    if (sibling.nodeType === Node.ELEMENT_NODE) break // stop at previous element
    sibling = sibling.previousSibling
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

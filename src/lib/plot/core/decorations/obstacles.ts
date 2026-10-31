// Obstacle fields the decoration solver routes around, plus the DOM footprint helpers the
// hosts use to size auto-placed decorations before and after first render.

import type { Vec2 } from '#lib/math.js'
import type { Rect, Sides } from '#lib/plot/core/layout.js'
import { PLACEMENT_CELL } from '#lib/plot/core/layout.js'
import type { DecorationPoint, DecorationSize, Obstacle } from './types'

// True when the user pinned a decoration via its style (an edge property or position:absolute),
// in which case auto-placement must leave it alone.
export const has_explicit_position = (style?: string | null): boolean =>
  /(?:^|[;{]\s*)(?:top|bottom|left|right)\s*:|position\s*:\s*absolute/.test(style ?? ``)

// A decoration's pixel footprint: its rendered box once laid out, else `fallback` (offset dims
// read 0 before first render). Used to decide crowding before the real size is known.
export const measured_footprint = (
  element: HTMLElement | null | undefined,
  fallback: DecorationSize,
): DecorationSize =>
  element?.offsetWidth && element?.offsetHeight
    ? { width: element.offsetWidth, height: element.offsetHeight }
    : fallback

// A legend's cells at their natural size, margins included, the same whether it renders as a
// column or wrapped into a row (PlotLegend's `wrap`): a cell spans its children, a growing
// one (a group label) by its text; the filter its min-width. Its column and its wrapped row
// derive from these alone, so the solver's side decision cannot flip with the layout it
// picks. Null while no cell has a layout box (before render, or without a layout engine).
export type LegendCellSizes = {
  cells: (DecorationSize & { own_line: boolean })[] // own_line: a group header
  chrome: DecorationSize // padding + border
  gap: { row: number; column: number }
}
export function legend_cell_sizes(element: HTMLElement): LegendCellSizes | null {
  const px = (value: string) => Number.parseFloat(value) || 0 // oxlint-disable-line unicorn/prefer-number-coercion -- CSS lengths carry units
  const edges = (style: CSSStyleDeclaration, axis: `x` | `y`, kinds = [`padding`, `border`]) =>
    kinds
      .flatMap((kind) =>
        (axis === `x` ? [`left`, `right`] : [`top`, `bottom`]).map((side) =>
          kind === `border` ? `border-${side}-width` : `${kind}-${side}`,
        ),
      )
      .reduce((sum, prop) => sum + px(style.getPropertyValue(prop)), 0)
  const range = element.ownerDocument.createRange()
  const width_of = (child: Element) => {
    const style = getComputedStyle(child)
    range.selectNodeContents(child)
    const box = px(style.flexGrow) > 0 ? range : child
    return box.getBoundingClientRect().width + edges(style, `x`, [`margin`])
  }
  const laid_out = [...element.children].some((cell) => cell.getBoundingClientRect().width > 0)
  if (!laid_out) return null // margins alone would read as a size
  const cells = [...element.children].map((cell) => {
    const style = getComputedStyle(cell)
    const children = [...cell.children]
    const content = cell.classList.contains(`legend-filter`)
      ? px(style.minWidth)
      : children.reduce((sum, child) => sum + width_of(child), 0) +
        px(style.columnGap) * Math.max(0, children.length - 1) +
        edges(style, `x`)
    return {
      width: content + edges(style, `x`, [`margin`]),
      height: cell.getBoundingClientRect().height + edges(style, `y`, [`margin`]),
      own_line: cell.classList.contains(`legend-group-header`),
    }
  })
  const style = getComputedStyle(element)
  return {
    cells,
    chrome: { width: edges(style, `x`), height: edges(style, `y`) },
    gap: { row: px(style.rowGap), column: px(style.columnGap) },
  }
}

// The legend wrapped into `available_width` like flex-wrap, lines filled greedily (headers on
// their own line); width 0 stacks every cell, i.e. the column it takes inside or beside the
// plot. Its width rounds up, so the browser given it breaks the same lines; its height rounds
// like offsetHeight.
export function legend_wrap_size(
  { cells, chrome, gap }: LegendCellSizes,
  available_width: number,
): DecorationSize {
  const lines: DecorationSize[] = []
  let line: DecorationSize | undefined
  for (const { width, height, own_line } of cells) {
    if (
      line &&
      !own_line &&
      line.width + gap.column + width <= available_width - chrome.width
    ) {
      line.width += gap.column + width
      line.height = Math.max(line.height, height)
    } else lines.push((line = { width, height }))
    if (own_line) line = undefined
  }
  return {
    width: Math.ceil(Math.max(0, ...lines.map((row) => row.width)) + chrome.width),
    height: Math.round(
      lines.reduce((total, row) => total + row.height, 0) +
        gap.row * Math.max(0, lines.length - 1) +
        chrome.height,
    ),
  }
}

// One mark's contribution: projected points, plus whether a line through them is drawn (which
// makes the segments between them obstacles too). Filled marks (bars, bins) are Obstacle rects.
export type ObstacleSeries = { points: DecorationPoint[]; draws_line?: boolean }

// Samples what `build` projects into the base plot box (frame minus decoration-independent
// padding), which is what keeps a decoration's own reservation out of the crowding decision.
export function with_obstacle_frame(
  frame: { width: number; height: number; effective_base_pad: Required<Sides> },
  has_marks: boolean,
  build: (base: { base_w: number; base_h: number }) => (ObstacleSeries | Obstacle)[],
): Obstacle[] {
  const { width, height, effective_base_pad: pad } = frame
  if (!has_marks || !width || !height) return []
  const [base_w, base_h] = [width - pad.l - pad.r, height - pad.t - pad.b]
  if (base_w <= 0 || base_h <= 0) return []
  return build_obstacles_norm(build({ base_w, base_h }), base_w, base_h)
}

const inside_unit_square = ({ x: coord_x, y: coord_y }: DecorationPoint): boolean =>
  Number.isFinite(coord_x) &&
  Number.isFinite(coord_y) &&
  coord_x >= 0 &&
  coord_x <= 1 &&
  coord_y >= 0 &&
  coord_y <= 1

// Liang-Barsky clipping keeps sampling proportional to the visible segment rather
// than spending the fixed sample budget on far-offscreen portions. Writes the visible part's
// [lower, upper] fractions of the segment to clip_span, false when none of it is visible.
const clip_span: [number, number] = [0, 1]
// One edge's bound on the span (direction: the segment's travel toward that edge's outside)
const clip_edge = (direction: number, distance: number): boolean => {
  if (direction === 0) return distance >= 0
  const ratio = distance / direction
  if (direction < 0) clip_span[0] = Math.max(clip_span[0], ratio)
  else clip_span[1] = Math.min(clip_span[1], ratio)
  return clip_span[0] <= clip_span[1]
}
const clip_fractions = (
  start_x: number,
  start_y: number,
  delta_x: number,
  delta_y: number,
): boolean => {
  if (!Number.isFinite(delta_x) || !Number.isFinite(delta_y)) return false
  clip_span[0] = 0
  clip_span[1] = 1
  return (
    clip_edge(-delta_x, start_x) &&
    clip_edge(delta_x, 1 - start_x) &&
    clip_edge(-delta_y, start_y) &&
    clip_edge(delta_y, 1 - start_y)
  )
}

export const clip_segment_to_unit_square = (
  start: DecorationPoint,
  end: DecorationPoint,
): [DecorationPoint, DecorationPoint] | null => {
  const [delta_x, delta_y] = [end.x - start.x, end.y - start.y]
  if (!clip_fractions(start.x, start.y, delta_x, delta_y)) return null
  const [lower, upper] = clip_span
  return [
    { x: start.x + lower * delta_x, y: start.y + lower * delta_y },
    { x: start.x + upper * delta_x, y: start.y + upper * delta_y },
  ]
}

// Each mark's occupied cell keys (row * cols + col) in the order its walk first visits them,
// kept per mark object and plot box: a host handing back the marks it didn't change (the other
// series beside a legend toggle) skips their walks. Marks are read as immutable.
const mark_cells_cache = new WeakMap<
  ObstacleSeries,
  { base_w: number; base_h: number; cells: Int32Array }
>()
// `stamp`: per cell, the walk that last marked it, which spares clearing it between marks
type CellGrid = {
  cell_w: number
  cell_h: number
  cols: number
  rows: number
  step: number
  stamp: Int32Array
  walk: number
}

// The cells one mark covers: its points, plus the segments between them for a drawn line
function walk_mark_cells(
  { points, draws_line = false }: ObstacleSeries,
  { cell_w, cell_h, cols, rows, step, stamp, walk }: CellGrid,
): Int32Array {
  const cells: number[] = []
  const add_point = (coord_x: number, coord_y: number): void => {
    // clamped, as rounding can put a clipped end just past the unit square
    const col = Math.min(Math.max(Math.floor(coord_x / cell_w), 0), cols - 1)
    const row = Math.min(Math.max(Math.floor(coord_y / cell_h), 0), rows - 1)
    const key = row * cols + col
    if (stamp[key] === walk) return
    stamp[key] = walk
    cells.push(key)
  }
  // A drawn line is walked a cell at a time, so no decoration slips across it
  const add_segment = (start: DecorationPoint, end: DecorationPoint): void => {
    const delta_x = end.x - start.x
    const delta_y = end.y - start.y
    if (!clip_fractions(start.x, start.y, delta_x, delta_y)) return
    const from_x = start.x + clip_span[0] * delta_x
    const from_y = start.y + clip_span[0] * delta_y
    const to_x = start.x + clip_span[1] * delta_x
    const to_y = start.y + clip_span[1] * delta_y
    const n_steps = Math.max(1, Math.ceil(Math.hypot(to_x - from_x, to_y - from_y) / step))
    for (let idx = 0; idx <= n_steps; idx++) {
      const frac = idx / n_steps
      add_point(from_x + (to_x - from_x) * frac, from_y + (to_y - from_y) * frac)
    }
  }
  const add_if_inside = (point: DecorationPoint): void => {
    if (inside_unit_square(point)) add_point(point.x, point.y)
  }
  if (!draws_line) {
    for (const point of points) add_if_inside(point)
    return Int32Array.from(cells)
  }
  // A vertex joined to no neighbour (non-finite ones break the line) is a lone point
  let previous: DecorationPoint | null = null
  let previous_joined = false
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (previous && !previous_joined) add_if_inside(previous)
      previous = null
      continue
    }
    if (previous) add_segment(previous, point)
    previous_joined = previous !== null
    previous = point
  }
  if (previous && !previous_joined) add_if_inside(previous)
  return Int32Array.from(cells)
}

// Build normalized obstacles from data so decoration reservations cannot change the result and
// cause a reserve -> data-shift -> re-decide loop.
export function build_obstacles_norm(
  marks: (ObstacleSeries | Obstacle)[],
  base_w: number,
  base_h: number,
): Obstacle[] {
  // Points snap to placement-cell rects, one per occupied cell, added as they are sampled: the
  // count stays bounded by the plot area however dense or noisy a mark is (nothing upstream
  // thins it), and coverage stays conservative. Merging each mark's cells in mark order adds
  // the same cells, in the same order, as one walk over every mark.
  const [cell_w, cell_h] = [PLACEMENT_CELL / base_w, PLACEMENT_CELL / base_h]
  const [cols, rows] = [Math.ceil(1 / cell_w) + 1, Math.ceil(1 / cell_h) + 1]
  const step = PLACEMENT_CELL / Math.max(base_w, base_h, 1)
  const grid = {
    cell_w,
    cell_h,
    cols,
    rows,
    step,
    stamp: new Int32Array(cols * rows),
    walk: 0,
  }
  const occupied = new Uint8Array(cols * rows)
  const obstacles: Obstacle[] = []
  for (const mark of marks) {
    if (!(`points` in mark)) {
      obstacles.push(mark)
      continue
    }
    let cached = mark_cells_cache.get(mark)
    if (cached?.base_w !== base_w || cached.base_h !== base_h) {
      grid.walk++
      cached = { base_w, base_h, cells: walk_mark_cells(mark, grid) }
      mark_cells_cache.set(mark, cached)
    }
    for (const key of cached.cells) {
      if (occupied[key]) continue
      occupied[key] = 1
      const [col, row] = [key % cols, Math.floor(key / cols)]
      obstacles.push({ x: col * cell_w, y: row * cell_h, width: cell_w, height: cell_h })
    }
  }
  return obstacles
}

// A bar's visible part as one filled rect (none when it lies off the plot); a zero-width bar
// such as a whisker is a line rect
export function bar_obstacles(vertical: boolean, cross: Vec2, span: Vec2): Obstacle[] {
  const clamp_to_plot = ([start, end]: Vec2): Vec2 => [
    Math.max(0, Math.min(start, end)),
    Math.min(1, Math.max(start, end)),
  ]
  const [lower, upper] = clamp_to_plot(span)
  const [left, right] = clamp_to_plot(cross)
  if (!(upper >= lower && right >= left)) return []
  const [min_x, max_x, min_y, max_y] = vertical
    ? [left, right, lower, upper]
    : [lower, upper, left, right]
  return [{ x: min_x, y: min_y, width: max_x - min_x, height: max_y - min_y }]
}

// Project a decoration-independent normalized obstacle field into the final plot rectangle.
export const project_obstacles = (
  obstacles_norm: readonly Obstacle[],
  plot_bounds: Rect,
): Obstacle[] =>
  obstacles_norm.map(({ x: coord_x, y: coord_y, width = 0, height = 0 }) => ({
    x: plot_bounds.x + coord_x * plot_bounds.width,
    y: plot_bounds.y + coord_y * plot_bounds.height,
    width: width * plot_bounds.width,
    height: height * plot_bounds.height,
  }))

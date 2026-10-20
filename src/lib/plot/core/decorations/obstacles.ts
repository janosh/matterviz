// Obstacle fields the decoration solver routes around, plus the DOM footprint helpers the
// hosts use to size auto-placed decorations before and after first render.

import type { Vec2 } from '#lib/math.js'
import type { Rect, Sides } from '#lib/plot/core/layout.js'
import { sample_series_obstacle_points } from '#lib/plot/core/layout.js'
import type { DecorationPoint, DecorationSize } from './types'

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
// makes the segments between them obstacles too)
export type ObstacleSeries = { points: DecorationPoint[]; draws_line?: boolean }

// Samples what `build` projects into the base plot box (frame minus decoration-independent
// padding), which is what keeps a decoration's own reservation out of the crowding decision.
export function with_obstacle_frame(
  frame: { width: number; height: number; effective_base_pad: Required<Sides> },
  has_marks: boolean,
  build: (base: { base_w: number; base_h: number }) => ObstacleSeries[],
): DecorationPoint[] {
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
// than spending the fixed sample budget on far-offscreen portions.
export const clip_segment_to_unit_square = (
  start: DecorationPoint,
  end: DecorationPoint,
): [DecorationPoint, DecorationPoint] | null => {
  const delta_x = end.x - start.x
  const delta_y = end.y - start.y
  if (!Number.isFinite(delta_x) || !Number.isFinite(delta_y)) return null
  let lower = 0
  let upper = 1
  for (const [direction, distance] of [
    [-delta_x, start.x],
    [delta_x, 1 - start.x],
    [-delta_y, start.y],
    [delta_y, 1 - start.y],
  ] as const) {
    if (direction === 0) {
      if (distance < 0) return null
      continue
    }
    const ratio = distance / direction
    if (direction < 0) lower = Math.max(lower, ratio)
    else upper = Math.min(upper, ratio)
    if (lower > upper) return null
  }
  return [
    { x: start.x + lower * delta_x, y: start.y + lower * delta_y },
    { x: start.x + upper * delta_x, y: start.y + upper * delta_y },
  ]
}

// Build normalized obstacles from data so decoration reservations cannot change the result and
// cause a reserve -> data-shift -> re-decide loop.
export function build_obstacles_norm(
  series: ObstacleSeries[],
  base_w: number,
  base_h: number,
): DecorationPoint[] {
  const step = 12 / Math.max(base_w, base_h, 1)
  const obstacles: DecorationPoint[] = []
  for (const { points, draws_line = false } of series) {
    if (!draws_line) {
      sample_series_obstacle_points(points.filter(inside_unit_square), false, step, obstacles)
      continue
    }
    let previous: DecorationPoint | null = null
    let previous_belongs_to_segment = false
    let last_appended: DecorationPoint | null = null
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        if (previous && !previous_belongs_to_segment && inside_unit_square(previous)) {
          obstacles.push(previous)
        }
        previous = null
        previous_belongs_to_segment = false
        last_appended = null
        continue
      }
      if (previous) {
        const clipped = clip_segment_to_unit_square(previous, point)
        if (clipped) {
          for (const obstacle of sample_series_obstacle_points(clipped, true, step)) {
            if (last_appended?.x !== obstacle.x || last_appended.y !== obstacle.y) {
              obstacles.push(obstacle)
              last_appended = obstacle
            }
          }
        } else last_appended = null
        previous_belongs_to_segment = true
      } else previous_belongs_to_segment = false
      previous = point
    }
    if (previous && !previous_belongs_to_segment && inside_unit_square(previous)) {
      obstacles.push(previous)
    }
  }
  return obstacles
}

// Widest gap (plot fraction) between a bar's obstacle lines, so no legend fits in a wide bar
const MAX_BAR_LINE_GAP = 0.25

// A bar's visible part as lines along both edges, its center and as many interior lines as the
// gap limit needs (one line for a zero-width bar like a whisker). Clipped to the unit square
// before sampling so zoomed, off-screen spans cannot emit millions of points.
export function bar_obstacles(vertical: boolean, cross: Vec2, span: Vec2): ObstacleSeries[] {
  const clamp_to_plot = ([start, end]: Vec2): Vec2 => [
    Math.max(0, Math.min(start, end)),
    Math.min(1, Math.max(start, end)),
  ]
  const [lower, upper] = clamp_to_plot(span)
  const [left, right] = clamp_to_plot(cross)
  if (!(upper >= lower && right >= left)) return []
  const n_gaps = right > left ? Math.max(2, Math.ceil((right - left) / MAX_BAR_LINE_GAP)) : 0
  return Array.from({ length: n_gaps + 1 }, (_, idx) => {
    const line_at = left + ((right - left) * idx) / (n_gaps || 1)
    const point = (along: number) =>
      vertical ? { x: line_at, y: along } : { x: along, y: line_at }
    return { points: [point(lower), point(upper)], draws_line: true }
  })
}

// Project a decoration-independent normalized obstacle field into the final plot rectangle.
export const project_obstacles = (
  obstacles_norm: readonly DecorationPoint[],
  plot_bounds: Rect,
): DecorationPoint[] =>
  obstacles_norm.map(({ x: coord_x, y: coord_y }) => ({
    x: plot_bounds.x + coord_x * plot_bounds.width,
    y: plot_bounds.y + coord_y * plot_bounds.height,
  }))

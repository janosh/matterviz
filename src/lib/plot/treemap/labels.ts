import type { Rect } from '$lib/plot/core/layout'
import type { TreemapArc } from '$lib/plot/treemap/treemap'

export type TreemapLabelFit = `hide` | `shrink` | `clip`

export interface TreemapLabelLine {
  text: string
  // CSS hook for targeting lines. Must NOT change text metrics (font-size,
  // font-family, font-weight, letter-spacing): fitting measures only the base
  // font plus font_scale/font_weight below, so metric-altering classes cause
  // mis-fit and (in hide mode, which renders unclipped) overflow.
  class?: string
  font_scale?: number // per-line multiplier on the fitted base font size
  font_weight?: string | number
  opacity?: number
  fill?: string
}

export type TreemapLabelFormatter<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> = (
  arc: TreemapArc<Metadata>,
) => string | TreemapLabelLine | readonly (string | TreemapLabelLine)[] | null | undefined

export interface TreemapLabelPlacement {
  x: number
  lines: (TreemapLabelLine & { y: number })[]
  font_size?: number
  header: boolean
  transform?: string
}

interface TreemapLabelPlacementOptions {
  rect: Rect
  lines: readonly TreemapLabelLine[]
  header: boolean
  fit: TreemapLabelFit
  min_font_size: number
  max_font_size: number
  padding_top: number
  margin: number
  measure_line: (line: TreemapLabelLine, font_size: number) => number
}

const LINE_HEIGHT = 1.1
const MIN_FONT_SIZE = 0.5
const MIN_FONT_SCALE = 0.05
// Coerce a user-provided font size to a usable px value (0.5px floor guards
// against zero/negative sizes; non-finite input falls back)
export const safe_font_size = (font_size: number, fallback: number): number =>
  Number.isFinite(font_size) ? Math.max(MIN_FONT_SIZE, font_size) : fallback

export function normalize_treemap_label_lines(
  content: ReturnType<TreemapLabelFormatter>,
): TreemapLabelLine[] {
  if (content == null) return []
  const lines = Array.isArray(content) ? content : [content]
  return lines.flatMap((line) => {
    const normalized = typeof line === `string` ? { text: line } : line
    return normalized.text ? [{ ...normalized }] : []
  })
}

const line_scale = (line: TreemapLabelLine): number =>
  Number.isFinite(line.font_scale) ? Math.max(MIN_FONT_SCALE, line.font_scale ?? 1) : 1

function block_metrics(
  lines: readonly TreemapLabelLine[],
  font_size: number,
  measure_line: (line: TreemapLabelLine, font_size: number) => number,
) {
  let width = 0
  let height = 0
  for (const line of lines) {
    const line_font_size = font_size * line_scale(line)
    width = Math.max(width, measure_line(line, line_font_size))
    height += line_font_size * LINE_HEIGHT
  }
  return { width, height }
}

export function place_treemap_label({
  rect,
  lines,
  header,
  fit,
  min_font_size,
  max_font_size,
  padding_top,
  margin,
  measure_line,
}: TreemapLabelPlacementOptions): TreemapLabelPlacement | null {
  if (lines.length === 0) return null
  const safe_max_font_size = safe_font_size(max_font_size, 11)
  const safe_min_font_size = Math.min(
    safe_max_font_size,
    safe_font_size(min_font_size, MIN_FONT_SIZE),
  )
  const header_height = Math.min(rect.height, padding_top)
  const available_width = Math.max(0, rect.width - 2 * margin)
  const label_height = header ? header_height : rect.height
  const available_height = Math.max(0, label_height - 2 * (header ? 1 : margin))
  // Single guard for all degenerate geometry (zero/negative/NaN rects, missing
  // header strips, margin-swallowed slivers): negated > 0 so NaN also bails
  // instead of emitting NaN SVG coordinates, same idiom as tile_rects.
  if (!(available_width > 0) || !(available_height > 0)) return null
  const max_metrics = block_metrics(lines, safe_max_font_size, measure_line)
  const fit_ratio = (block_width: number, block_height: number): number =>
    block_width > 0 && block_height > 0
      ? Math.min(1, available_width / block_width, available_height / block_height)
      : 0
  const horizontal_ratio = fit_ratio(max_metrics.width, max_metrics.height)
  // rotated 90°: the block's width runs along the cell's height (swapped args)
  const vertical_ratio = header ? 0 : fit_ratio(max_metrics.height, max_metrics.width)
  const rotated = vertical_ratio > horizontal_ratio
  const best_ratio = Math.max(horizontal_ratio, vertical_ratio)

  if (fit === `hide` && best_ratio < 1) return null
  const font_size =
    fit === `shrink`
      ? Math.max(safe_min_font_size, safe_max_font_size * best_ratio)
      : safe_max_font_size
  // text metrics scale linearly with font size, so the block height at the
  // final size derives from the max-size measurement — no re-measuring (which
  // would miss the width cache on every frame of a zoom tween in shrink mode,
  // since the fitted size varies continuously with the animated rect)
  const block_height = max_metrics.height * (font_size / safe_max_font_size)
  const center_x = rect.x + rect.width / 2
  const center_y = rect.y + label_height / 2
  const x = header ? rect.x + margin : center_x
  let line_top = center_y - block_height / 2
  const placed_lines = lines.map((line) => {
    const font_scale = line_scale(line)
    const line_height = font_size * font_scale * LINE_HEIGHT
    line_top += line_height / 2
    const y = line_top
    line_top += line_height / 2
    return { ...line, font_scale, y }
  })

  return {
    x,
    lines: placed_lines,
    font_size,
    header,
    ...(rotated ? { transform: `rotate(-90, ${center_x}, ${center_y})` } : {}),
  }
}

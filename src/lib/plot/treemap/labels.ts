// Treemap label fitting: structured multiline label blocks measured once per node
// (text metrics are zoom-independent) and placed per frame with pure arithmetic.

import type { Rect } from '$lib/plot/core/layout'
import type { FontSpec } from '$lib/plot/core/text-metrics'
import { measure_text_line } from '$lib/plot/core/text-metrics'
import type { TreemapArc } from '$lib/plot/treemap/treemap'
import type { ClassValue } from 'svelte/elements'

export type TreemapLabelFit = `hide` | `shrink` | `clip`

export interface TreemapLabelLine {
  text: string
  // CSS hook for targeting lines. Must NOT change text metrics (font-size,
  // font-family, font-weight, letter-spacing): fitting measures only the base
  // font plus font_scale/font_weight below, so metric-altering classes cause
  // mis-fit and (in hide mode, which renders unclipped) overflow.
  class?: ClassValue
  font_scale?: number // per-line multiplier on the fitted base font size
  font_weight?: string | number
  opacity?: number
  fill?: string
}

type TreemapLabelContent = string | TreemapLabelLine | null | undefined

export type TreemapLabelFormatter<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> = (arc: TreemapArc<Metadata>) => TreemapLabelContent | readonly TreemapLabelContent[]

// A label's lines measured at `font_size` (the largest size it may render at);
// block metrics scale linearly with font size, so fitting needs no re-measuring
export interface TreemapLabelBlock {
  lines: readonly TreemapLabelLine[]
  font_size: number
  width: number
  height: number
}

export interface TreemapLabelPlacement {
  x: number
  lines: (TreemapLabelLine & { y: number })[]
  font_size: number
  header: boolean
  dominant_baseline: `central`
  transform?: string
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
    return normalized?.text ? [{ ...normalized }] : []
  })
}

const line_scale = (line: TreemapLabelLine): number =>
  Number.isFinite(line.font_scale) ? Math.max(MIN_FONT_SCALE, line.font_scale ?? 1) : 1

// Measure a label block at `font_size` in `font` (per-line font_weight overrides
// the font's; font_scale multiplies the size). Shares the text-metrics cache.
export function measure_treemap_label_block(
  lines: readonly TreemapLabelLine[],
  font_size: number,
  font: Readonly<FontSpec>,
): TreemapLabelBlock {
  let width = 0
  let height = 0
  for (const line of lines) {
    const line_font_size = font_size * line_scale(line)
    const line_font: FontSpec = {
      ...font,
      font_size: line_font_size,
      font_weight: line.font_weight == null ? font.font_weight : `${line.font_weight}`,
    }
    width = Math.max(width, measure_text_line(line.text, line_font).width)
    height += line_font_size * LINE_HEIGHT
  }
  return { lines, font_size, width, height }
}

export function place_treemap_label({
  rect,
  block,
  header,
  fit,
  min_font_size,
  header_height,
  margin,
}: {
  rect: Rect
  block: TreemapLabelBlock
  header: boolean // label the branch's header strip instead of the cell center
  fit: TreemapLabelFit
  min_font_size: number // px floor for shrink mode
  header_height: number // header strip height (treemap.ts' header_strip)
  margin: number // px clearance between label text and cell edges
}): TreemapLabelPlacement | null {
  if (block.lines.length === 0) return null
  const max_font_size = block.font_size
  const safe_min_font_size = Math.min(
    max_font_size,
    safe_font_size(min_font_size, MIN_FONT_SIZE),
  )
  const strip_height = Math.min(rect.height, header_height)
  const available_width = Math.max(0, rect.width - 2 * margin)
  const label_height = header ? strip_height : rect.height
  const available_height = Math.max(0, label_height - 2 * (header ? 1 : margin))
  // Single guard for all degenerate geometry (zero/negative/NaN rects, missing
  // header strips, margin-swallowed slivers): negated > 0 so NaN also bails
  // instead of emitting NaN SVG coordinates, same idiom as tile_rects.
  if (!(available_width > 0) || !(available_height > 0)) return null
  const fit_ratio = (block_width: number, block_height: number): number =>
    block_width > 0 && block_height > 0
      ? Math.min(1, available_width / block_width, available_height / block_height)
      : 0
  const horizontal_ratio = fit_ratio(block.width, block.height)
  // rotated 90°: the block's width runs along the cell's height (swapped args)
  const vertical_ratio = header ? 0 : fit_ratio(block.height, block.width)
  const rotated = vertical_ratio > horizontal_ratio
  const best_ratio = Math.max(horizontal_ratio, vertical_ratio)

  if (fit === `hide` && best_ratio < 1) return null
  const font_size =
    fit === `shrink` ? Math.max(safe_min_font_size, max_font_size * best_ratio) : max_font_size
  const block_height = block.height * (font_size / max_font_size)
  const center_x = rect.x + rect.width / 2
  const center_y = rect.y + label_height / 2
  const x = header ? rect.x + margin : center_x
  let line_top = center_y - block_height / 2
  const placed_lines = block.lines.map((line) => {
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
    dominant_baseline: `central`,
    ...(rotated ? { transform: `rotate(-90, ${center_x}, ${center_y})` } : {}),
  }
}

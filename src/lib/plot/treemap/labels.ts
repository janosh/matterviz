// Treemap label fitting: structured multiline label blocks measured once per node
// (text metrics are zoom-independent) and placed per frame with pure arithmetic.

import type { Rect } from '#lib/plot/core/layout'
import type { FontSpec } from '#lib/plot/core/text-metrics'
import { measure_text_line } from '#lib/plot/core/text-metrics'
import type { TreemapArc } from '#lib/plot/treemap/treemap'
import type { ClassValue } from 'svelte/elements'

export type TreemapLabelFit = `hide` | `shrink` | `clip`
// center (default): labels centered in leaf cells; top-left: anchored at the cell's
// top-left corner (rotated ones read upward from the bottom-left), like file-size maps
export type TreemapLabelAlign = `center` | `top-left`

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
  lines: (TreemapLabelLine & { y: number; font_scale: number })[]
  font_size: number
  header: boolean
  start: boolean // text-anchor start (headers and top-left labels) instead of middle
  fits: boolean // false when shrink mode had to go below the block's fitting size
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

// Top-left label candidates, richest first: the name with its label+... suffix (e.g. the
// value) on a smaller, dimmer line below, then with the name wrapped after underscores,
// then the name alone (unwrapped, wrapped). `variants` is the node's fit chain
// (`name suffix`, name, short) from hierarchy-chart's node_label_variants.
export function corner_label_lines(
  variants: readonly { text: string }[],
): TreemapLabelLine[][] {
  const [first, second] = variants
  if (!first?.text) return []
  const name = second && first.text.startsWith(`${second.text} `) ? second.text : first.text
  const has_suffix = name !== first.text
  const pieces = name.split(`_`)
  const wrapped = pieces.map((piece, idx) => (idx < pieces.length - 1 ? `${piece}_` : piece))
  const names = pieces.length > 1 ? [[name], wrapped] : [[name]]
  const as_lines = (texts: string[]) => texts.map((text) => ({ text }))
  const suffix = { text: first.text.slice(name.length + 1), font_scale: 0.9, opacity: 0.75 }
  return [
    ...(has_suffix ? names.map((texts) => [...as_lines(texts), suffix]) : []),
    ...names.map(as_lines),
  ]
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
  align = `center`,
}: {
  rect: Rect
  block: TreemapLabelBlock
  header: boolean // label the branch's header strip instead of the cell center
  fit: TreemapLabelFit
  align?: TreemapLabelAlign
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
  const top_left = align === `top-left` && !header
  // top-left: lines start at the corner; rotated ones at the bottom-left corner, where
  // rotate(-90) turns the line stacking direction (down) into rightward
  const pivot_x = rect.x + margin
  const pivot_y = rotated ? rect.y + rect.height - margin : rect.y + margin
  const coord_x = header || top_left ? pivot_x : center_x
  let line_top = top_left ? pivot_y : center_y - block_height / 2
  const placed_lines = block.lines.map((line) => {
    const font_scale = line_scale(line)
    const line_height = font_size * font_scale * LINE_HEIGHT
    line_top += line_height / 2
    const coord_y = line_top
    line_top += line_height / 2
    return { ...line, font_scale, y: coord_y }
  })

  const [rotate_x, rotate_y] = top_left ? [pivot_x, pivot_y] : [center_x, center_y]
  return {
    x: coord_x,
    lines: placed_lines,
    font_size,
    header,
    start: header || top_left,
    fits: max_font_size * best_ratio >= safe_min_font_size,
    ...(rotated ? { transform: `rotate(-90, ${rotate_x}, ${rotate_y})` } : {}),
  }
}

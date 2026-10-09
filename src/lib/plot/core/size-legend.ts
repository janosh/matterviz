// Reference circles for bubble charts: a few round values drawn at the radius the size scale
// gives them, after layerchart's CircleLegend. Laid out side by side with labels underneath
// (CircleLegend nests them), which stays legible at the default 2-10 px marker radii. Value
// picking and layout are pure so the geometry is testable; SizeLegend.svelte only draws it.

import { ticks as d3_ticks } from 'd3-array'
import { type FontSpec, measure_text_line } from '#lib/plot/core/text-metrics.js'

export type SizeScaleFn = ((value: number) => number) & {
  domain: () => readonly number[]
  ticks?: (count?: number) => number[]
}
export type SizeLegendEntry = { value: number; radius: number }

// Evenly spaced picks from `items`, always keeping the first and last
const spread_pick = <T>(items: readonly T[], count: number): T[] =>
  items.length <= count
    ? [...items]
    : Array.from(
        { length: count },
        (_, idx) =>
          items[
            count === 1
              ? items.length - 1
              : Math.round((idx * (items.length - 1)) / (count - 1))
          ],
      )

// Round values spanning the scale's domain (or the given `values`), ascending, each with a
// distinct positive radius: a clamped scale can map several values to one radius, and a
// zero-radius circle is invisible, so neither earns a legend entry.
export function size_legend_entries(
  scale: SizeScaleFn,
  opts: { values?: readonly number[]; count?: number } = {},
): SizeLegendEntry[] {
  const { values, count = 3 } = opts
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`size legend count must be a positive integer, got ${count}`)
  }
  let candidates: number[]
  if (values) candidates = [...values]
  else {
    const domain = scale.domain()
    const [lo, hi] = [Math.min(...domain), Math.max(...domain)]
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
    const in_domain_ticks = (n_ticks: number) =>
      (scale.ticks ? scale.ticks(n_ticks) : d3_ticks(lo, hi, n_ticks)).filter(
        (val) => val >= lo && val <= hi,
      )
    // Nice ticks can fall outside the domain (0 for [2, 120] at step 50), leaving too few:
    // ask for twice as many and spread-pick from those
    let ticks = in_domain_ticks(count)
    if (ticks.length < count) ticks = in_domain_ticks(2 * count)
    candidates = spread_pick(ticks.length ? ticks : [lo, hi], count)
  }
  const entries: SizeLegendEntry[] = []
  for (const value of candidates
    .filter(Number.isFinite)
    .toSorted((left, right) => left - right)) {
    const radius = scale(value)
    if (!(radius > 0) || !Number.isFinite(radius)) continue
    if (entries.some((entry) => entry.radius === radius)) continue
    entries.push({ value, radius })
  }
  return entries
}

// Circles bottom-aligned in columns as wide as the circle or its label, label centered under
// each. Circles are stroked 1 px wide, so half a pixel of stroke falls outside each radius.
export function size_legend_layout(
  entries: readonly SizeLegendEntry[],
  opts: { format_label: (value: number) => string; font: FontSpec; title?: string },
) {
  const { format_label, font, title } = opts
  const [gap, edge] = [4, 0.5]
  const title_height = title ? font.font_size + gap : 0
  const title_width = title
    ? measure_text_line(title, { ...font, font_weight: `600` }).width
    : 0
  const max_radius = Math.max(0, ...entries.map((entry) => entry.radius))
  const baseline = title_height + edge + 2 * max_radius
  const label_y = baseline + edge + gap
  let cursor = 0
  const items = entries.map((entry, idx) => {
    const text = format_label(entry.value)
    const column = Math.max(2 * (entry.radius + edge), measure_text_line(text, font).width)
    const cx = cursor + column / 2
    cursor += column + (idx < entries.length - 1 ? 2 * gap : 0)
    return { ...entry, text, cx, cy: baseline - entry.radius }
  })
  return {
    width: Math.max(cursor, title_width),
    height: entries.length ? label_y + font.font_size : title_height,
    title_y: font.font_size,
    label_y,
    items,
  }
}

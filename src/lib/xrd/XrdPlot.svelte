<script lang="ts">
  import type { DataSeries, PlotPoint, Sides, TooltipProps } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { format_value } from '$lib/plot/formatting'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  type Hkl = [number, number, number]
  type HklObj = { hkl: Hkl; multiplicity?: number }

  // Single supported external JSON shape
  export type XrdPattern = {
    x: number[]
    y: number[]
    hkls?: HklObj[][]
    d_hkls?: number[]
  }

  type HklFormat = `compact` | `full` | null

  interface PatternEntry {
    label: string
    pattern: XrdPattern
    color?: string
  }

  function format_hkl(hkl: Hkl, format: HklFormat): string {
    if (format === `compact`) return `${hkl[0]}${hkl[1]}${hkl[2]}`
    if (format === `full`) return `(${hkl.join(`, `)})`
    return ``
  }

  interface Props extends HTMLAttributes<HTMLDivElement> {
    patterns:
      | XrdPattern
      | Record<string, XrdPattern | { pattern: XrdPattern; color?: string }>
      | PatternEntry[]
    peak_width?: number
    annotate_peaks?: number // int => top-k, float in (0,1) => threshold of max
    hkl_format?: HklFormat
    show_angles?: boolean | null
    wavelength?: number | null
    x_label?: string
    y_label?: string
    x_format?: string
    y_format?: string
    padding?: Sides
    legend?: ComponentProps<typeof ScatterPlot>[`legend`]
  }

  let {
    patterns,
    peak_width = 0.5,
    annotate_peaks = 5,
    hkl_format = `compact`,
    show_angles = null,
    x_label = `2θ (degrees)`,
    y_label = `Intensity (a.u.)`,
    x_format = `.1f`,
    y_format = `.0f`,
    padding,
    legend,
    ...rest
  }: Props = $props()

  // Normalize various input shapes to a consistent array of { label, pattern, color }
  const pattern_entries = $derived.by<PatternEntry[]>(() => {
    if (!patterns) return []
    if (Array.isArray(patterns)) return patterns as PatternEntry[]
    if (`x` in (patterns as XrdPattern)) {
      return [{ label: `XRD Pattern`, pattern: patterns as XrdPattern }]
    }
    const obj = patterns as Record<
      string,
      XrdPattern | { pattern: XrdPattern; color?: string }
    >
    return Object.entries(obj).map(([label, value]) =>
      `pattern` in (value as { pattern: XrdPattern })
        ? { label, ...(value as { pattern: XrdPattern; color?: string }) }
        : { label, pattern: value as XrdPattern }
    )
  })

  // Decide default show_angles
  const actual_show_angles = $derived(show_angles ?? pattern_entries.length <= 2)

  // Compute global max intensity for normalization (as in pymatviz xrd_pattern)
  const global_max_intensity = $derived.by(() => {
    let max_val = 0
    for (const entry of pattern_entries) {
      for (const y of entry.pattern.y) if (y > max_val) max_val = y
    }
    return max_val || 1
  })

  // Compute overall x-domain
  const x_domain = $derived.by<[number, number]>(() => {
    let max_x = 0
    for (const entry of pattern_entries) {
      const entry_max = Math.max(...entry.pattern.x)
      if (entry_max > max_x) max_x = entry_max
    }
    return [0, Math.ceil(max_x)]
  })

  function build_bar_path(
    pattern: XrdPattern,
    intensity_scale: (y: number) => number,
  ): {
    x: number[]
    y: number[]
  } {
    const xs: number[] = []
    const ys: number[] = []

    const pairs = pattern.x.map((x, idx) => ({
      x,
      y: intensity_scale(pattern.y[idx] || 0),
    }))
    // ensure sorted by x
    pairs.sort((a, b) => a.x - b.x)

    for (let i = 0; i < pairs.length; i++) {
      const cx = pairs[i].x
      const cy = pairs[i].y
      const half = peak_width / 2
      const left = cx - half
      const right = cx + half

      // baseline to left edge (for proper area closure between bars)
      if (xs.length === 0) {
        xs.push(left)
        ys.push(0)
      } else {
        xs.push(left)
        ys.push(0)
      }

      // up left edge
      xs.push(left)
      ys.push(cy)
      // across top
      xs.push(right)
      ys.push(cy)
      // down right edge
      xs.push(right)
      ys.push(0)
    }
    return { x: xs, y: ys }
  }

  // build series for a given pattern (bar polyline + invisible points for labels/tooltips)
  function build_series(entry: PatternEntry, include_name: boolean): DataSeries[] {
    const scale = (y: number) => (y / global_max_intensity) * 100
    const bar_path = build_bar_path(entry.pattern, scale)

    const area_series: DataSeries = {
      x: bar_path.x,
      y: bar_path.y,
      markers: `line`,
      // Make the bar outlines visible
      line_style: { stroke: `var(--accent-color, #4e79a7)`, stroke_width: 2 },
      point_style: { fill: `transparent` },
      label: include_name ? `${entry.label} bars` : `bars`,
    }

    // Create peak center points for labels/tooltip
    const points_x: number[] = []
    const points_y: number[] = []
    const metadata: Record<string, unknown>[] = []
    for (let idx = 0; idx < entry.pattern.x.length; idx++) {
      const cx = entry.pattern.x[idx]
      const cy = scale(entry.pattern.y[idx] || 0)
      points_x.push(cx)
      points_y.push(cy)
      const hkls_objs = entry.pattern.hkls?.[idx] ?? []
      const hkls: Hkl[] = hkls_objs
        .map((h) => (Array.isArray(h?.hkl) ? h.hkl : null))
        .filter((h): h is Hkl => Array.isArray(h) && h.length === 3)
      const d = entry.pattern.d_hkls?.[idx]
      metadata.push({ hkls, d, label: entry.label })
    }

    // Determine which peaks to annotate
    const selected_indices = (() => {
      if (!annotate_peaks || annotate_peaks <= 0) return [] as number[]
      const intens = points_y.map((y) => y)
      if (annotate_peaks > 0 && annotate_peaks < 1) {
        const thresh = annotate_peaks * 100
        return intens.map((y, i) => [y, i] as const).filter(([y]) => y > thresh).map((
          [, i],
        ) => i)
      }
      const k = Math.min(points_y.length, Math.floor(annotate_peaks))
      return intens
        .map((y, i) => [y, i] as const)
        .sort((a, b) => a[0] - b[0])
        .slice(-k)
        .map(([, i]) => i)
    })()

    const points_series: DataSeries = {
      x: points_x,
      y: points_y,
      markers: `points`,
      metadata,
      point_style: { fill: `rgba(0,0,0,0)`, radius: 6, stroke: `rgba(0,0,0,0)` },
      point_label: points_x.map((cx, i) => {
        if (!selected_indices.includes(i)) return { text: `` }
        const angle_text = actual_show_angles ? `${format_value(cx, `.2f`)}°` : ``
        const hkls = entry.pattern.hkls?.[i]?.map((h) => h.hkl as Hkl)
        const hkl_text = hkls && hkl_format
          ? hkls.map((h) => format_hkl(h as Hkl, hkl_format)).join(`\n`)
          : ``
        const text = [hkl_text, angle_text].filter(Boolean).join(`\n`)
        return { text, offset: { x: 0, y: -10 }, auto_placement: true }
      }),
      label: include_name ? `${entry.label} peaks` : `peaks`,
    }

    return [area_series, points_series]
  }

  // Visibility state for legend toggling
  let series_visibility = $state<boolean[]>([])

  const overlay_series = $derived.by<DataSeries[]>(() => {
    const all: DataSeries[] = []
    for (const entry of pattern_entries) {
      all.push(...build_series(entry, pattern_entries.length > 1))
    }
    // Apply visibility flags
    return all.map((s, idx) => ({ ...s, visible: series_visibility[idx] ?? true }))
  })

  // Initialize/reset visibility when series count changes
  $effect(() => {
    const count = overlay_series.length
    if (count > 0 && series_visibility.length !== count) {
      series_visibility = Array.from({ length: count }, () => true)
    }
  })

  function handle_legend_toggle(series_idx: number) {
    if (series_idx < 0 || series_idx >= overlay_series.length) return
    const is_bars = series_idx % 2 === 0
    const has_multiple = pattern_entries.length > 1

    // Single structure: bars cannot be hidden
    if (!has_multiple && is_bars) return

    const next = [...series_visibility]
    const will_hide = !!next[series_idx]

    if (is_bars) {
      // Ensure at least one bars series remains visible
      const bar_indices = overlay_series.map((_s, idx) => idx).filter((i) =>
        i % 2 === 0
      )
      const visible_bars = bar_indices.filter((i) => next[i]).length
      if (will_hide && visible_bars <= 1) return
    }

    next[series_idx] = !next[series_idx]
    series_visibility = next
  }
</script>

{#snippet tooltip(point: PlotPoint & TooltipProps)}
  {@const angle_text = `${format_value(point.x, `.2f`)}°`}
  {@const intensity_text = `${format_value(point.y, `.1f`)}`}
  {@const hkls = point.metadata?.hkls}
  {@const d = point.metadata?.d}
  {@const d_num = typeof d === `number` ? d : null}
  {@const hkl_text = hkls && hkl_format
    ? (hkls as Hkl[]).map((h) => format_hkl(h, hkl_format)).join(`, `)
    : ``}
  {@const d_text = d_num != null ? `${format_value(d_num, `.3f`)} Å` : ``}
  {@const label = point.metadata?.label ? `${point.metadata.label} — ` : ``}
  {label}2θ: {angle_text}
  <br />
  Intensity: {intensity_text}
  {hkl_text ? (`<br />hkl: {hkl_text}`) : null}
  {d_text ? (`<br />d: {d_text}`) : null}
{/snippet}

<ScatterPlot
  series={overlay_series}
  {x_label}
  {y_label}
  {x_format}
  {y_format}
  {tooltip}
  x_range={x_domain}
  y_range={[0, 100]}
  legend={{
    ...(legend ?? {}),
    on_toggle: handle_legend_toggle,
  }}
  {padding}
  {...rest}
  style={rest.style ?? `width: 600px; height: 260px`}
/>

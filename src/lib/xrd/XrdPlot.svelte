<script lang="ts">
  import { plot_colors } from '$lib/colors'
  import type { BarSeries, BarTooltipProps } from '$lib/plot'
  import { BarPlot } from '$lib/plot'
  import { format_value } from '$lib/plot/formatting'
  import type { ComponentProps } from 'svelte'
  import type { Hkl, HklFormat, PatternEntry, XrdPattern } from './index'

  function format_hkl(hkl: Hkl, format: HklFormat): string {
    if (format === `compact`) return `${hkl[0]}${hkl[1]}${hkl[2]}`
    if (format === `full`) return `(${hkl.join(`, `)})`
    return ``
  }

  interface Props extends ComponentProps<typeof BarPlot> {
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
  }
  let {
    patterns,
    peak_width = 0.5,
    annotate_peaks = 5,
    hkl_format = `compact`,
    show_angles = null,
    x_label = `2θ (degrees)`,
    y_label = `Intensity (a.u.)`,
    ...rest
  }: Props = $props()

  // Normalize various input shapes to a consistent array of { label, pattern, color }
  const pattern_entries = $derived.by<PatternEntry[]>(() => {
    if (!patterns) return []
    if (Array.isArray(patterns)) return patterns as PatternEntry[]
    if (`x` in patterns) {
      return [{ label: `XRD Pattern`, pattern: patterns as XrdPattern }]
    }
    const obj = patterns as Record<
      string,
      XrdPattern | { pattern: XrdPattern; color?: string }
    >
    return Object.entries(obj).map(([label, value]) =>
      `pattern` in value
        ? { label, ...value }
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
  const x_range = $derived.by<[number, number]>(() => {
    let max_x = 0
    for (const entry of pattern_entries) {
      const entry_max = Math.max(...entry.pattern.x)
      if (entry_max > max_x) max_x = entry_max
    }
    return [0, Math.ceil(max_x)]
  })

  // Build BarPlot series from entries
  const bar_series = $derived.by<BarSeries[]>(() => {
    const include_name = pattern_entries.length > 1
    const scale = (y: number) => (y / global_max_intensity) * 100
    return pattern_entries.map((entry, entry_idx) => {
      const xs = entry.pattern.x.slice()
      const ys = entry.pattern.y.map((val) => scale(val || 0))
      const metadata: Record<string, unknown>[] = []
      const labels: (string | null)[] = []

      // Determine which peaks to annotate
      const intens = ys
      let selected_indices: number[] = []
      if (annotate_peaks && annotate_peaks > 0) {
        if (annotate_peaks > 0 && annotate_peaks < 1) {
          const thresh = annotate_peaks * 100
          selected_indices = intens
            .map((y_val, idx) => [y_val, idx] as const)
            .filter(([y_val]) => y_val > thresh)
            .map(([, idx]) => idx)
        } else {
          const k = Math.min(intens.length, Math.floor(annotate_peaks))
          selected_indices = intens
            .map((y_val, idx) => [y_val, idx] as const)
            .sort((a, b) => a[0] - b[0])
            .slice(-k)
            .map(([, idx]) => idx)
        }
      }

      for (let idx = 0; idx < xs.length; idx++) {
        const hkls_objs = entry.pattern.hkls?.[idx] ?? []
        const hkls: Hkl[] = hkls_objs
          .map((h) => (Array.isArray(h?.hkl) ? h.hkl : null))
          .filter((h): h is Hkl => Array.isArray(h) && h.length === 3)
        const d_hkl = entry.pattern.d_hkls?.[idx]
        metadata.push({ hkls, d: d_hkl, label: entry.label })

        if (selected_indices.includes(idx)) {
          const angle_text = actual_show_angles
            ? `${format_value(xs[idx], `.2f`)}°`
            : ``
          const hkl_text = hkls && hkl_format
            ? hkls.map((h) => format_hkl(h, hkl_format)).join(`, `)
            : ``
          const text = [hkl_text, angle_text].filter(Boolean).join(` `)
          labels.push(text)
        } else labels.push(null)
      }

      return {
        x: xs,
        y: ys,
        label: include_name ? entry.label : ``,
        color: entry.color ?? plot_colors[entry_idx % plot_colors.length],
        bar_width: Math.max(peak_width, 0.8),
        visible: true,
        metadata,
        labels,
      }
    })
  })
</script>

{#snippet tooltip(info: BarTooltipProps)}
  {@const angle_text = `${format_value(info.x, `.2f`)}°`}
  {@const intensity_text = `${format_value(info.y, `.1f`)}`}
  {@const hkls = info.metadata?.hkls as Hkl[] | undefined}
  {@const d = info.metadata?.d as number | undefined}
  {@const hkl_text = hkls && hkl_format
    ? hkls.map((h) => format_hkl(h, hkl_format)).join(`, `)
    : ``}
  {@const d_text = d != null ? `${format_value(d, `.3f`)} Å` : ``}
  {@const series_label = info.metadata?.label ? `${String(info.metadata.label)} — ` : ``}
  {@html series_label}2θ: {angle_text}
  <br />
  Intensity: {intensity_text}
  {#if hkl_text}<br />hkl: {hkl_text}{/if}
  {#if d_text}<br />d: {d_text}{/if}
{/snippet}

<BarPlot
  series={bar_series}
  {x_label}
  x_label_shift={{ y: 20 }}
  y_label_shift={{ x: 2 }}
  {y_label}
  {tooltip}
  {x_range}
  y_range={[0, null]}
  {...rest}
/>

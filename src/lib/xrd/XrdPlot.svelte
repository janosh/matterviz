<script lang="ts">
  import { plot_colors } from '$lib/colors'
  import { decompress_file, handle_url_drop } from '$lib/io'
  import { format_value } from '$lib/labels'
  import type { AxisConfig, BarSeries, BarTooltipProps } from '$lib/plot'
  import { BarPlot } from '$lib/plot'
  import { parse_any_structure } from '$lib/structure/parse'
  import { compute_xrd_pattern } from '$lib/xrd/calc-xrd'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { Hkl, HklFormat, PatternEntry, XrdPattern } from './index'

  function format_hkl(hkl: Hkl, format: HklFormat): string {
    if (format === `compact`) { // Use crystallographic overbar notation for negative indices (e.g., 1̄ instead of -1)
      return hkl.map((val) => {
        // Use combining overline character (U+0305) for negative values
        // Apply overbar to each digit for multi-digit numbers
        if (val < 0) {
          const digits = String(Math.abs(val))
          return digits.split(``).map((digit) => `${digit}\u0305`).join(``)
        }
        return `${val}`
      }).join(``)
    }
    if (format === `full`) return `(${hkl.join(`, `)})`
    return ``
  }

  let {
    patterns,
    peak_width = 0.5,
    annotate_peaks = 5,
    hkl_format = `compact`,
    show_angles = null,
    orientation = `vertical`,
    wavelength = null,
    x_axis = { label: `2θ (degrees)` },
    y_axis = { label: `Intensity (a.u.)` },
    allow_file_drop = true,
    on_file_drop,
    loading = $bindable(false),
    error_msg = $bindable(undefined),
    children,
    ...rest
  }: ComponentProps<typeof BarPlot> & {
    patterns:
      | XrdPattern
      | Record<string, XrdPattern | { pattern: XrdPattern; color?: string }>
      | PatternEntry[]
    peak_width?: number
    annotate_peaks?: number // int => top-k, float in (0,1) => threshold of max
    hkl_format?: HklFormat
    show_angles?: boolean | null
    wavelength?: number | null
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    allow_file_drop?: boolean
    on_file_drop?: (content: string | ArrayBuffer, filename: string) => void
    loading?: boolean
    error_msg?: string
    children?: Snippet<[]>
  } = $props()

  let dragover = $state(false)

  // Patterns created from dropped structures
  let dropped_entries = $state<PatternEntry[]>([])

  // Normalize various input shapes to a consistent array of { label, pattern, color }
  const pattern_entries = $derived.by<PatternEntry[]>(() => {
    if (!patterns) return []
    const base_entries = Array.isArray(patterns)
      ? (patterns as PatternEntry[])
      : (`x` in patterns
        ? [{ label: `XRD Pattern`, pattern: patterns as XrdPattern }]
        : Object.entries(
          patterns as Record<
            string,
            XrdPattern | { pattern: XrdPattern; color?: string }
          >,
        ).map(([label, value]) =>
          `pattern` in value
            ? { label, ...value }
            : { label, pattern: value as XrdPattern }
        ))
    // Merge user-provided patterns with any dropped-on-the-fly entries
    return [...base_entries, ...dropped_entries]
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

  // Compute overall 2θ domain (degrees)
  const angle_range = $derived.by(() => {
    let max_x = 0
    for (const entry of pattern_entries) {
      const entry_max = Math.max(...entry.pattern.x)
      if (entry_max > max_x) max_x = entry_max
    }
    return [0, Math.ceil(max_x)] as [number, number]
  })

  // Scaled intensities are normalized to 0..100 downstream
  const intensity_range: [number, number] = [0, 100]

  // Build BarPlot series from entries
  const bar_series = $derived.by<BarSeries[]>(() => {
    const include_name = pattern_entries.length > 1
    const scale = (y: number) => (y / global_max_intensity) * 100
    return pattern_entries.map((entry, entry_idx) => {
      const xs = entry.pattern.x
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
          // Use @ separator between hkl and angle for better clarity
          const separator = hkl_text && angle_text ? ` @ ` : ``
          const text = [hkl_text, angle_text].filter(Boolean).join(separator)
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

  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return
    loading = true
    error_msg = undefined

    const compute_and_add = (content: string | ArrayBuffer, filename: string) => {
      try {
        const text_content = content instanceof ArrayBuffer
          ? new TextDecoder().decode(content)
          : content
        const parsed_structure = parse_any_structure(text_content, filename)
        if (parsed_structure && `lattice` in parsed_structure) {
          const pattern = compute_xrd_pattern(parsed_structure, {
            wavelength: typeof wavelength === `number` ? wavelength : undefined,
          })
          const label = filename || `Dropped structure`
          // Prepend latest dropped pattern for visibility
          dropped_entries = [{ label, pattern }, ...dropped_entries]
        } else if (parsed_structure && !(`lattice` in parsed_structure)) {
          error_msg = `Structure has no lattice; cannot compute XRD pattern`
        } else {
          error_msg = `Failed to parse structure from ${filename}`
        }
      } catch (exc) {
        error_msg = `Failed to compute XRD pattern: ${
          exc instanceof Error ? exc.message : String(exc)
        }`
      }
    }

    try {
      // Handle URL-based drops
      const handled = await handle_url_drop(event, on_file_drop || compute_and_add)
        .catch(() => false)
      if (handled) return

      // Handle file system drops
      const file = event.dataTransfer?.files?.[0]
      if (file) {
        try {
          const { content, filename } = await decompress_file(file)
          if (content) (on_file_drop || compute_and_add)(content, filename)
        } catch (exc) {
          error_msg = `Failed to load file ${file.name}: ${
            exc instanceof Error ? exc.message : String(exc)
          }`
        }
      }
    } finally {
      loading = false
    }
  }
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
  {@html info.metadata?.label ?? ``}<br />
  2θ: {angle_text}<br />
  Intensity: {intensity_text}
  {#if hkl_text}<br />hkl: {hkl_text}{/if}
  {#if d_text}<br />d: {d_text}{/if}
{/snippet}

<BarPlot
  {...rest}
  series={bar_series}
  bind:orientation
  x_axis={{
    label_shift: { y: 20 },
    range: orientation === `horizontal` ? intensity_range : angle_range,
    ...(orientation === `horizontal` ? y_axis : x_axis),
  }}
  y_axis={{
    label_shift: { x: 2 },
    range: orientation === `horizontal` ? angle_range : intensity_range,
    ...(orientation === `horizontal` ? x_axis : y_axis),
  }}
  {tooltip}
  ondrop={handle_file_drop}
  ondragover={(event) => {
    event.preventDefault()
    if (!allow_file_drop) return
    dragover = true
  }}
  ondragleave={(event) => {
    event.preventDefault()
    dragover = false
  }}
  class={(rest.class ?? ``) + (dragover ? ` dragover` : ``)}
  style={`overflow: visible; ${rest.style ?? ``}`}
  {children}
/>

<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import { compute_fermi_slice } from './compute'
  import { BAND_COLORS } from './constants'
  import type { FermiSliceData, FermiSurfaceData } from './types'

  let {
    fermi_data,
    miller_indices = [0, 0, 1],
    distance = 0,
    line_width = 2,
    show_axes = true,
    axis_labels,
    band_colors = BAND_COLORS,
    show_legend = true,
    on_error,
    children,
    ...rest
  }: {
    fermi_data?: FermiSurfaceData
    miller_indices?: Vec3
    distance?: number
    line_width?: number
    show_axes?: boolean
    axis_labels?: [string, string]
    band_colors?: readonly string[]
    show_legend?: boolean
    on_error?: (error: Error) => void
    children?: Snippet<
      [{ slice_data: FermiSliceData | null; export_svg: () => string | null }]
    >
  } & HTMLAttributes<HTMLDivElement> = $props()

  let wrapper = $state<HTMLDivElement | undefined>(undefined)
  let hidden_bands = new SvelteSet<number>()

  // Compute axis labels from Miller indices (subscript z doesn't exist in Unicode)
  let labels = $derived.by((): [string, string] => {
    if (axis_labels) return axis_labels
    const K = [`kₓ`, `kᵧ`, `kz`] as const
    const zeros = miller_indices.flatMap((val, idx) => (val === 0 ? [idx] : []))
    if (zeros.length === 2) return [K[zeros[0]], K[zeros[1]]]
    if (zeros.length === 1) return [`k⊥`, K[zeros[0]]]
    return [`k₁`, `k₂`]
  })

  // Compute slice with error handling
  let slice_data = $state<FermiSliceData | null>(null)
  $effect(() => {
    if (!fermi_data) {
      slice_data = null
      return
    }
    try {
      slice_data = compute_fermi_slice(fermi_data, { miller_indices, distance })
    } catch (err) {
      slice_data = null
      on_error?.(err instanceof Error ? err : new Error(String(err)))
    }
  })

  // Transform isolines to ScatterPlot series
  let series: DataSeries[] = $derived(
    slice_data?.isolines.map((iso, idx) => ({
      id: `iso-${iso.band_index}-${idx}`,
      x: iso.points_2d.map((pt) => pt[0]),
      y: iso.points_2d.map((pt) => pt[1]),
      markers: `line` as const,
      visible: !hidden_bands.has(iso.band_index),
      label: `Band ${iso.band_index + 1}`,
      line_style: {
        stroke: band_colors[iso.band_index % band_colors.length],
        stroke_width: line_width,
      },
    })) ?? [],
  )

  // Compute padded data bounds (single-pass to avoid stack overflow on large arrays)
  let bounds = $derived.by(() => {
    const isolines = slice_data?.isolines
    if (!isolines?.length) return { min: [-1, -1], max: [1, 1] }

    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity
    for (const iso of isolines) {
      for (const pt of iso.points_2d) {
        if (pt[0] < xmin) xmin = pt[0]
        if (pt[0] > xmax) xmax = pt[0]
        if (pt[1] < ymin) ymin = pt[1]
        if (pt[1] > ymax) ymax = pt[1]
      }
    }
    if (!isFinite(xmin)) return { min: [-1, -1], max: [1, 1] }

    const pad = 0.1, rx = xmax - xmin || 1, ry = ymax - ymin || 1
    return {
      min: [xmin - rx * pad, ymin - ry * pad],
      max: [xmax + rx * pad, ymax + ry * pad],
    }
  })

  function toggle_band(series_idx: number) {
    const band = slice_data?.isolines[series_idx]?.band_index
    if (band === undefined) return
    if (hidden_bands.has(band)) hidden_bands.delete(band)
    else hidden_bands.add(band)
  }

  function isolate_band(series_idx: number) {
    const band = slice_data?.isolines[series_idx]?.band_index
    if (band === undefined) return
    const all_bands = [
      ...new Set(slice_data?.isolines.map((iso) => iso.band_index) ?? []),
    ]
    const is_solo = all_bands.every((b) => b === band || hidden_bands.has(b))
    hidden_bands.clear()
    if (!is_solo) {
      for (const b of all_bands) {
        if (b !== band) hidden_bands.add(b)
      }
    }
  }

  // Returns null if SVG not found, making export failures explicit
  const export_svg = (): string | null =>
    wrapper?.querySelector(`svg`)?.outerHTML ?? null
</script>

<ScatterPlot
  bind:wrapper
  {series}
  x_axis={{ ticks: [], range: [bounds.min[0], bounds.max[0]] }}
  y_axis={{ ticks: [], range: [bounds.min[1], bounds.max[1]] }}
  range_padding={0}
  display={{ x_grid: false, y_grid: false, x_zero_line: show_axes, y_zero_line: show_axes }}
  styles={{ show_points: false, show_lines: true }}
  controls={{ show: false }}
  fullscreen_toggle={false}
  legend={show_legend && series.length > 0
  ? { on_toggle: toggle_band, on_double_click: isolate_band, draggable: false }
  : null}
  padding={{ t: 5, b: 5, l: 5, r: 5 }}
  class="fermi-slice {rest.class ?? ``}"
  style={rest.style}
>
  {#snippet user_content({ x_scale_fn, y_scale_fn, pad, width, height })}
    {#if show_axes && width && height}
      {@const ox = x_scale_fn(0)}
      {@const oy = y_scale_fn(0)}
      {@const x1 = x_scale_fn(bounds.min[0])}
      {@const x2 = x_scale_fn(bounds.max[0])}
      {@const y1 = y_scale_fn(bounds.min[1])}
      {@const y2 = y_scale_fn(bounds.max[1])}
      <line {x1} y1={oy} {x2} y2={oy} class="fermi-axis" />
      <line x1={ox} {y1} x2={ox} {y2} class="fermi-axis" />
      <text x={x2 - 3} y={oy - 6} text-anchor="end" class="fermi-label">{labels[0]}</text>
      <text x={ox + 6} y={Math.max(y2 + 12, pad.t + 12)} class="fermi-label">
        {labels[1]}
      </text>
    {/if}
  {/snippet}
</ScatterPlot>
{@render children?.({ slice_data, export_svg })}

<style>
  :global(.fermi-slice) {
    --scatter-min-height: 300px;
    --scatter-width: 100%;
    --scatter-height: 100%;
    width: 100%;
    height: 100%;
  }
  :global(.fermi-slice .zero-line) {
    display: none;
  }
  :global(.fermi-axis) {
    stroke: var(--fermi-surface-axis-color, #888);
    stroke-dasharray: 4, 4;
    stroke-width: 1;
  }
  :global(.fermi-label) {
    fill: var(--fermi-surface-axis-color, #888);
    font: 12px system-ui, sans-serif;
  }
</style>

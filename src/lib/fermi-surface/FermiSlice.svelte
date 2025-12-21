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
      [{
        fermi_data?: FermiSurfaceData
        slice_data?: FermiSliceData | null
        export_svg: () => string
      }]
    >
  } & HTMLAttributes<HTMLDivElement> = $props()

  // Using subscript characters where available in Unicode (no subscript z exists)
  const K_LABELS = [`kₓ`, `kᵧ`, `kz`] as const

  let wrapper = $state<HTMLDivElement | undefined>(undefined)
  let hidden_bands = new SvelteSet<number>()

  // Compute axis labels from Miller indices
  let labels = $derived.by(() => {
    if (axis_labels) return axis_labels
    const zeros = miller_indices.flatMap((val, idx) => (val === 0 ? [idx] : []))
    if (zeros.length === 2) {
      return [K_LABELS[zeros[0]], K_LABELS[zeros[1]]] as [string, string]
    }
    if (zeros.length === 1) return [`k⊥`, K_LABELS[zeros[0]]] as [string, string]
    return [`k₁`, `k₂`] as [string, string]
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

  // Get unique band indices for legend
  let unique_bands = $derived(
    [...new Set(slice_data?.isolines.map((iso) => iso.band_index) ?? [])].sort(
      (band_a, band_b) => band_a - band_b,
    ),
  )

  // Transform isolines to ScatterPlot series format
  let series: DataSeries[] = $derived(
    slice_data?.isolines.map((iso, idx) => ({
      id: `iso-${iso.band_index}-${idx}`,
      x: iso.points_2d.map((pt) => pt[0]),
      y: iso.points_2d.map((pt) => pt[1]),
      markers: `line` as const,
      visible: !hidden_bands.has(iso.band_index),
      label: `Band ${iso.band_index + 1}`,
      legend_group: `Bands`,
      line_style: {
        stroke: band_colors[iso.band_index % band_colors.length],
        stroke_width: line_width,
      },
    })) ?? [],
  )

  // Compute data bounds for axis lines
  let bounds = $derived.by(() => {
    const pts = slice_data?.isolines.flatMap((iso) => iso.points_2d) ?? []
    if (!pts.length) return { min: [-1, -1], max: [1, 1] }
    const xs = pts.map((pt) => pt[0]), ys = pts.map((pt) => pt[1])
    const [xmin, xmax, ymin, ymax] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ]
    const pad = 0.1, rx = xmax - xmin || 1, ry = ymax - ymin || 1
    return {
      min: [xmin - rx * pad, ymin - ry * pad],
      max: [xmax + rx * pad, ymax + ry * pad],
    }
  })

  function toggle_band(series_idx: number) {
    // series_idx here is the index in the series array, need to map to band_index
    const iso = slice_data?.isolines[series_idx]
    if (!iso) return
    const band_idx = iso.band_index
    if (hidden_bands.has(band_idx)) hidden_bands.delete(band_idx)
    else hidden_bands.add(band_idx)
  }

  function isolate_band(series_idx: number) {
    const iso = slice_data?.isolines[series_idx]
    if (!iso) return
    const band_idx = iso.band_index
    const is_solo = unique_bands.every((band) =>
      band === band_idx || hidden_bands.has(band)
    )
    hidden_bands.clear()
    if (!is_solo) {
      for (const band of unique_bands) {
        if (band !== band_idx) hidden_bands.add(band)
      }
    }
  }

  const export_svg = () => wrapper?.querySelector(`svg`)?.outerHTML ?? ``
</script>

<ScatterPlot
  bind:wrapper
  {series}
  x_axis={{
    label: show_axes ? labels[0] : undefined,
    ticks: [],
    range: [bounds.min[0], bounds.max[0]],
  }}
  y_axis={{
    label: show_axes ? labels[1] : undefined,
    ticks: [],
    range: [bounds.min[1], bounds.max[1]],
  }}
  display={{
    x_grid: false,
    y_grid: false,
    x_zero_line: show_axes,
    y_zero_line: show_axes,
  }}
  styles={{ show_points: false, show_lines: true }}
  controls={{ show: false }}
  fullscreen_toggle={false}
  legend={show_legend && unique_bands.length > 0
  ? {
    on_toggle: toggle_band,
    on_double_click: isolate_band,
    draggable: false,
  }
  : null}
  padding={{ t: 20, b: 30, l: 40, r: 20 }}
  class="fermi-slice {rest.class ?? ``}"
  style={rest.style}
>
  {#snippet user_content({ x_scale_fn, y_scale_fn, pad, width, height })}
    {#if show_axes && width && height}
      <!-- Custom dashed axis lines through origin -->
      {@const origin_x = x_scale_fn(0)}
      {@const origin_y = y_scale_fn(0)}
      {@const x_start = x_scale_fn(bounds.min[0])}
      {@const x_end = x_scale_fn(bounds.max[0])}
      {@const y_start = y_scale_fn(bounds.min[1])}
      {@const y_end = y_scale_fn(bounds.max[1])}
      <!-- X-axis line (horizontal through y=0) -->
      <line
        x1={x_start}
        y1={origin_y}
        x2={x_end}
        y2={origin_y}
        class="fermi-axis"
      />
      <!-- Y-axis line (vertical through x=0) -->
      <line
        x1={origin_x}
        y1={y_start}
        x2={origin_x}
        y2={y_end}
        class="fermi-axis"
      />
      <!-- Axis endpoint labels -->
      <text
        x={x_end - 3}
        y={origin_y - 6}
        text-anchor="end"
        class="fermi-label"
      >
        {labels[0]}
      </text>
      <text
        x={origin_x + 6}
        y={Math.max(y_end + 12, pad.t + 12)}
        class="fermi-label"
      >
        {labels[1]}
      </text>
    {/if}
  {/snippet}
</ScatterPlot>
{@render children?.({ fermi_data, slice_data, export_svg })}

<style>
  :global(.fermi-slice) {
    --scatter-min-height: 200px;
  }
  :global(.fermi-slice .zero-line) {
    display: none; /* Hide default zero lines, we render custom dashed ones */
  }
  :global(.fermi-axis) {
    stroke: var(--fermi-surface-axis-color, #888);
    stroke-dasharray: 4, 4;
    stroke-width: 1;
  }
  :global(.fermi-label) {
    fill: var(--fermi-surface-axis-color, #888);
    font: 10px system-ui, sans-serif;
  }
</style>

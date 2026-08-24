<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import type { DataSeries } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { untrack, type Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import { compute_fermi_slice } from './compute'
  import { BAND_COLORS } from './constants'
  import type { FermiSliceData, FermiSurfaceData } from './types'
  import { to_error } from '$lib/utils'

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
  const K_AXIS_LABELS = [`kₓ`, `kᵧ`, `kz`] as const
  let labels = $derived.by((): [string, string] => {
    if (axis_labels) return axis_labels
    const zeros = miller_indices.flatMap((val, idx) => (val === 0 ? [idx] : []))
    if (zeros.length === 2) return [K_AXIS_LABELS[zeros[0]], K_AXIS_LABELS[zeros[1]]]
    if (zeros.length === 1) return [`k⊥`, K_AXIS_LABELS[zeros[0]]]
    return [`k₁`, `k₂`]
  })

  // Slice of the current surface; a failed slice (e.g. zero Miller indices) reports through
  // on_error and renders empty
  let slice_data = $derived.by((): FermiSliceData | null => {
    if (!fermi_data) return null
    try {
      return compute_fermi_slice(fermi_data, { miller_indices, distance })
    } catch (err) {
      untrack(() => on_error?.(to_error(err)))
      return null
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

  // Data bounds padded by 10% (single pass: spreading 10^5 points into Math.min overflows)
  let bounds = $derived.by(() => {
    const isolines = slice_data?.isolines
    if (!isolines?.length) return { min: [-1, -1], max: [1, 1] }

    let [x_min, x_max, y_min, y_max] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const iso of isolines) {
      for (const [px, py] of iso.points_2d) {
        if (px < x_min) x_min = px
        if (px > x_max) x_max = px
        if (py < y_min) y_min = py
        if (py > y_max) y_max = py
      }
    }
    if (!Number.isFinite(x_min)) return { min: [-1, -1], max: [1, 1] }

    const pad_x = 0.1 * (x_max - x_min || 1)
    const pad_y = 0.1 * (y_max - y_min || 1)
    return { min: [x_min - pad_x, y_min - pad_y], max: [x_max + pad_x, y_max + pad_y] }
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
    const all_bands = [...new SvelteSet(slice_data?.isolines.map((iso) => iso.band_index))]
    const is_solo = all_bands.every((other) => other === band || hidden_bands.has(other))
    hidden_bands.clear()
    if (!is_solo) {
      for (const other of all_bands) if (other !== band) hidden_bands.add(other)
    }
  }

  // Returns null if SVG not found, making export failures explicit
  const export_svg = (): string | null => wrapper?.querySelector(`svg`)?.outerHTML ?? null
</script>

<ScatterPlot
  bind:wrapper
  {series}
  x_axis={{ ticks: [], range: [bounds.min[0], bounds.max[0]] }}
  y_axis={{ ticks: [], range: [bounds.min[1], bounds.max[1]] }}
  range_padding={0}
  line_tween={{ duration: 0 }}
  display={{ x_grid: false, y_grid: false, x_zero_line: show_axes, y_zero_line: show_axes }}
  styles={{ show_points: false, show_lines: true }}
  show_controls={false}
  fullscreen_toggle={false}
  {show_legend}
  legend={{
    on_toggle: toggle_band,
    on_double_click: isolate_band,
    draggable: false,
    // pin bottom-right so it clears the top-left title/controls overlay (e.g. in the demo)
    style: `left: auto; top: auto; right: 8px; bottom: 8px`,
  }}
  padding={{ t: 5, b: 5, l: 5, r: 5 }}
  class={[`fermi-slice`, rest.class]}
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
  .fermi-axis {
    stroke: var(--fermi-surface-axis-color, #888);
    stroke-dasharray: 4, 4;
    stroke-width: 1;
  }
  .fermi-label {
    fill: var(--fermi-surface-axis-color, #888);
    font:
      12px system-ui,
      sans-serif;
  }
</style>

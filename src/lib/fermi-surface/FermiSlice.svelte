<script lang="ts">
  import * as math from '#lib/math.js'
  import type { Vec2, Vec3 } from '#lib/math.js'
  import type { DataSeries } from '#lib/plot/index.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import { untrack, type Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import {
    band_carriers,
    compute_fermi_slice,
    reciprocal_cell_section,
    sample_slice_energies,
    slice_axis_label,
    slice_point_to_k,
    slice_shading_rgba,
  } from './compute'
  import { BAND_COLORS } from './constants'
  import type { CarrierType, SliceShading } from './compute'
  import type { BandGridData, FermiSliceData, FermiSurfaceData } from './types'
  import { to_error } from 'svelte-widgets/utils'
  import { format_num } from '#lib/labels.js'

  let {
    fermi_data,
    band_data,
    mu = 0,
    interpolation_factor = 1,
    shading = `pockets`,
    selected_bands,
    marker = null,
    hovered_k = $bindable(null),
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
    // the grid, mu and factor the surface was extracted with: enable band-energy shading
    band_data?: BandGridData
    mu?: number
    interpolation_factor?: number
    shading?: SliceShading | `none`
    selected_bands?: number[] // bands to show (e.g. the 3D viewer's), all when unset
    marker?: Vec3 | null // k-point (Cartesian Å⁻¹) to mark, e.g. hovered in the 3D viewer
    hovered_k?: Vec3 | null // Cartesian k under the cursor on the slice plane
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
  const uid = $props.id()
  const clip_id = `fermi-slice-clip-${uid}`

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

  // Axis labels from the directions points_2d actually use
  let labels = $derived.by((): [string, string] => {
    if (axis_labels) return axis_labels
    if (!slice_data) return [`k₁`, `k₂`]
    const [in_plane_u, in_plane_v] = slice_data.in_plane_basis
    return [slice_axis_label(in_plane_u, `k₁`), slice_axis_label(in_plane_v, `k₂`)]
  })

  // One series per isoline; the shared legend_id folds a band's segments into a single legend
  // row that toggles and isolates them together
  const shows_band = (band_index: number) =>
    selected_bands === undefined || selected_bands.includes(band_index)

  // Electron or hole carrier per band, named in the legend and picking the side pockets shade
  let carriers = $derived(
    band_data && slice_data
      ? band_carriers(band_data, slice_data, { mu, interpolation_factor })
      : new Map<number, CarrierType>(),
  )

  let series: DataSeries[] = $derived(
    slice_data?.isolines
      .filter((iso) => shows_band(iso.band_index))
      .map((iso, idx) => ({
        id: `iso-${iso.band_index}-${idx}`,
        legend_id: iso.band_index,
        x: iso.points_2d.map((point) => point[0]),
        y: iso.points_2d.map((point) => point[1]),
        markers: `line` as const,
        label: `Band ${iso.band_index + 1}${carriers.has(iso.band_index) ? ` · ${carriers.get(iso.band_index)}` : ``}`,
        line_style: {
          stroke: band_colors[iso.band_index % band_colors.length],
          stroke_width: line_width,
        },
      })) ?? [],
  )

  // Data bounds padded by 10% (single pass: spreading 10^5 points into Math.min overflows)
  let bounds = $derived.by((): { min: Vec2; max: Vec2 } => {
    const isolines = slice_data?.isolines
    if (!isolines?.length) return { min: [-1, -1], max: [1, 1] }

    let [x_min, x_max, y_min, y_max] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const iso of isolines) {
      for (const [pixel_x, pixel_y] of iso.points_2d) {
        if (pixel_x < x_min) x_min = pixel_x
        if (pixel_x > x_max) x_max = pixel_x
        if (pixel_y < y_min) y_min = pixel_y
        if (pixel_y > y_max) y_max = pixel_y
      }
    }
    if (!Number.isFinite(x_min)) return { min: [-1, -1], max: [1, 1] }

    const pad_x = 0.1 * (x_max - x_min || 1)
    const pad_y = 0.1 * (y_max - y_min || 1)
    return { min: [x_min - pad_x, y_min - pad_y], max: [x_max + pad_x, y_max + pad_y] }
  })

  // Band-energy shading under the contours, rendered once per slice/mu change to an image
  // (client-side only; contours only without a 2D canvas, e.g. in a test DOM)
  let shading_image = $derived.by(() => {
    if (!band_data || shading === `none` || !slice_data) return null
    const context = globalThis.document?.createElement(`canvas`).getContext(`2d`)
    if (!context) return null
    const energy_map = sample_slice_energies(band_data, {
      plane: slice_data,
      bounds,
      mu,
      interpolation_factor,
    })
    energy_map.layers = energy_map.layers.filter((layer) => shows_band(layer.band_index))
    const pixels = slice_shading_rgba(energy_map, shading, band_colors, { carriers })
    const { width, height } = energy_map
    ;[context.canvas.width, context.canvas.height] = [width, height]
    context.putImageData(new ImageData(pixels, width, height), 0, 0)
    return context.canvas.toDataURL()
  })

  // Where the plane cuts the cell the surfaces live in, in slice coordinates: the (periodic)
  // shading is clipped to it to cover the same area as the contours
  let cell_section = $derived.by((): Vec2[] | null => {
    if (!slice_data || !fermi_data || !shading_image) return null
    const { plane_normal, plane_distance, in_plane_basis } = slice_data
    const corners = reciprocal_cell_section(fermi_data, plane_normal, plane_distance)
    return corners.length
      ? corners.map((corner) => in_plane_basis.map((axis) => math.dot(corner, axis)) as Vec2)
      : null
  })

  // The marker in slice coordinates and whether it lies on the plane (within 1% of the view)
  let marker_2d = $derived.by(() => {
    if (!marker || !slice_data) return null
    const { plane_normal, plane_distance, in_plane_basis } = slice_data
    const span = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1])
    const off_plane = math.dot(plane_normal, marker) - plane_distance
    return {
      x: math.dot(in_plane_basis[0], marker),
      y: math.dot(in_plane_basis[1], marker),
      off_plane,
      on_plane: Math.abs(off_plane) < 0.01 * span,
    }
  })

  // Cartesian k of a pointer position on the plot (scales are linear: invert from 2 points)
  function update_hovered_k(
    event: PointerEvent & { currentTarget: SVGRectElement },
    scale_x: (coord: number) => number,
    scale_y: (coord: number) => number,
  ) {
    if (!slice_data) return
    const svg_box = event.currentTarget.closest(`svg`)?.getBoundingClientRect()
    if (!svg_box) return
    const invert = (scale: (coord: number) => number, pixel: number) => {
      const [at_0, at_1] = [scale(0), scale(1)]
      return (pixel - at_0) / (at_1 - at_0)
    }
    const coord_x = invert(scale_x, event.clientX - svg_box.left)
    const coord_y = invert(scale_y, event.clientY - svg_box.top)
    hovered_k = slice_point_to_k(slice_data, coord_x, coord_y)
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
  display={{ x_grid: false, y_grid: false, x_zero_line: false, y_zero_line: false }}
  styles={{ show_points: false, show_lines: true }}
  show_controls={false}
  fullscreen_toggle={false}
  {show_legend}
  legend={{
    draggable: false,
    // pin bottom-right so it clears the top-left title/controls overlay (e.g. in the demo)
    style: `left: auto; top: auto; right: 8px; bottom: 8px`,
  }}
  padding={{ t: 5, b: 5, l: 5, r: 5 }}
  class={[`fermi-slice`, rest.class]}
  style={rest.style}
>
  {#snippet user_content({ x_scale_fn, y_scale_fn, pad, width, height })}
    {#if shading_image}
      {@const [left, right] = [x_scale_fn(bounds.min[0]), x_scale_fn(bounds.max[0])]}
      {@const [top, bottom] = [y_scale_fn(bounds.max[1]), y_scale_fn(bounds.min[1])]}
      {#if cell_section}
        <clipPath id={clip_id}>
          <polygon
            points={cell_section
              .map(([coord_x, coord_y]) => `${x_scale_fn(coord_x)},${y_scale_fn(coord_y)}`)
              .join(` `)}
          />
        </clipPath>
      {/if}
      <image
        clip-path={cell_section ? `url(#${clip_id})` : undefined}
        href={shading_image}
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
        preserveAspectRatio="none"
        pointer-events="none"
      />
    {/if}
    {#if width && height}
      <rect
        x={pad.l}
        y={pad.t}
        width={Math.max(0, width - pad.l - pad.r)}
        height={Math.max(0, height - pad.t - pad.b)}
        fill="transparent"
        role="presentation"
        onpointermove={(event) => update_hovered_k(event, x_scale_fn, y_scale_fn)}
        onpointerleave={() => (hovered_k = null)}
      />
    {/if}
    {#if marker_2d}
      <circle
        cx={x_scale_fn(marker_2d.x)}
        cy={y_scale_fn(marker_2d.y)}
        r="5"
        class={[`fermi-marker`, { on_plane: marker_2d.on_plane }]}
      >
        <title>
          {marker_2d.on_plane
            ? `On the slice plane`
            : `${format_num(marker_2d.off_plane, `.3~f`)} Å⁻¹ off the slice plane`}
        </title>
      </circle>
    {/if}
    {#if show_axes && width && height}
      {@const offset_x = x_scale_fn(0)}
      {@const offset_y = y_scale_fn(0)}
      {@const coord_x_1 = x_scale_fn(bounds.min[0])}
      {@const coord_x = x_scale_fn(bounds.max[0])}
      {@const coord_y_1 = y_scale_fn(bounds.min[1])}
      {@const coord_y_2 = y_scale_fn(bounds.max[1])}
      <line x1={coord_x_1} y1={offset_y} x2={coord_x} y2={offset_y} class="fermi-axis" />
      <line x1={offset_x} y1={coord_y_1} x2={offset_x} y2={coord_y_2} class="fermi-axis" />
      <text x={coord_x - 3} y={offset_y - 6} text-anchor="end" class="fermi-label"
        >{labels[0]}</text
      >
      <text x={offset_x + 6} y={Math.max(coord_y_2 + 12, pad.t + 12)} class="fermi-label">
        {labels[1]}
      </text>
    {/if}
  {/snippet}
</ScatterPlot>
{@render children?.({ slice_data, export_svg })}

<style>
  :global(.fermi-slice) {
    width: 100%;
    height: 100%;
  }
  .fermi-axis {
    stroke: var(--fermi-surface-axis-color, #888);
    stroke-dasharray: 4, 4;
    stroke-width: 1;
  }
  .fermi-marker {
    fill: none;
    stroke: var(--fermi-slice-marker-color, #f59e0b);
    stroke-width: 2;
    stroke-dasharray: 3 2;
    pointer-events: none;
    &.on_plane {
      fill: var(--fermi-slice-marker-color, #f59e0b);
      stroke-dasharray: none;
    }
  }
  .fermi-label {
    fill: var(--fermi-surface-axis-color, #888);
    font:
      12px system-ui,
      sans-serif;
  }
</style>

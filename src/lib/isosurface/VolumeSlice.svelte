<script lang="ts">
  import { get_d3_interpolator, type D3InterpolateName } from '$lib/colors'
  import type { Vec2 } from '$lib/math'
  import ColorBar from '$lib/plot/core/components/ColorBar.svelte'
  import type { Orientation } from '$lib/plot/core/types'
  import { contours as create_contours } from 'd3-contour'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { SliceResult } from './slice'
  import {
    resolve_contour_thresholds,
    resolve_slice_color_range,
    slice_to_rgba,
  } from './slice-rendering'
  import type { VolumeSliceMode } from './slice-rendering'

  let {
    slice,
    mode = `both`,
    colormap = `interpolateRdBu`,
    color_range,
    symmetric = `auto`,
    contour_levels = 10,
    contour_color = `currentColor`,
    contour_width = 1,
    flip_y = true,
    show_colorbar = true,
    colorbar_title = `Value`,
    colorbar_orientation = `vertical`,
    canvas = $bindable(),
    onrender,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    slice?: SliceResult | null
    mode?: VolumeSliceMode
    colormap?: D3InterpolateName
    color_range?: Vec2
    symmetric?: boolean | `auto`
    contour_levels?: number | number[]
    contour_color?: string
    contour_width?: number
    flip_y?: boolean
    show_colorbar?: boolean
    colorbar_title?: string
    colorbar_orientation?: Orientation
    canvas?: HTMLCanvasElement
    onrender?: (detail: {
      canvas: HTMLCanvasElement
      color_range: Vec2
      contour_thresholds: number[]
      slice: SliceResult
    }) => void
  } = $props()

  let resolved_color_range = $derived<Vec2>(
    slice ? resolve_slice_color_range(slice, color_range, symmetric) : [0, 1],
  )
  let contour_thresholds = $derived(
    resolve_contour_thresholds(resolved_color_range, contour_levels),
  )
  let colorbar_color_scale = $derived.by(() => {
    const interpolator = get_d3_interpolator(colormap)
    const [range_start, range_end] = resolved_color_range
    const span = range_end - range_start
    return (value: number): string => {
      const normalized =
        span === 0 ? 0.5 : Math.max(0, Math.min(1, (value - range_start) / span))
      return interpolator(normalized)
    }
  })
  let image_data: ImageData | undefined
  let contour_values = new Float64Array()
  let aspect_ratio = $derived.by(() => {
    if (!slice) return 1
    const u_span = slice.u_range[1] - slice.u_range[0]
    const v_span = slice.v_range[1] - slice.v_range[0]
    return v_span > 0 ? u_span / v_span : 1
  })

  function clip_to_slice_polygon(
    context: CanvasRenderingContext2D,
    current_slice: SliceResult,
  ): void {
    const u_span = current_slice.u_range[1] - current_slice.u_range[0]
    const v_span = current_slice.v_range[1] - current_slice.v_range[0]
    context.beginPath()
    for (let point_idx = 0; point_idx < current_slice.polygon.length; point_idx++) {
      const point = current_slice.polygon[point_idx]
      const pixel_x =
        ((point[0] - current_slice.u_range[0]) / u_span) * (current_slice.width - 1) + 0.5
      const sampled_y =
        ((point[1] - current_slice.v_range[0]) / v_span) * (current_slice.height - 1) + 0.5
      const pixel_y = flip_y ? current_slice.height - sampled_y : sampled_y
      if (point_idx === 0) context.moveTo(pixel_x, pixel_y)
      else context.lineTo(pixel_x, pixel_y)
    }
    context.closePath()
    context.clip()
  }

  function draw_contours(context: CanvasRenderingContext2D, current_slice: SliceResult): void {
    if (contour_thresholds.length === 0) return
    const threshold_min = contour_thresholds[0]
    const outside_value =
      Math.min(...resolved_color_range, threshold_min) -
      Math.max(
        1,
        Math.abs(threshold_min),
        Math.abs(resolved_color_range[1] - resolved_color_range[0]),
      )
    if (contour_values.length !== current_slice.data.length) {
      contour_values = new Float64Array(current_slice.data.length)
    }
    for (let data_idx = 0; data_idx < current_slice.data.length; data_idx++) {
      const value = current_slice.data[data_idx]
      contour_values[data_idx] =
        current_slice.mask[data_idx] && Number.isFinite(value) ? value : outside_value
    }
    const shapes = create_contours()
      .size([current_slice.width, current_slice.height])
      .thresholds(contour_thresholds)(contour_values as unknown as number[])

    context.save()
    clip_to_slice_polygon(context, current_slice)
    context.strokeStyle =
      contour_color === `currentColor` && canvas
        ? getComputedStyle(canvas).color
        : contour_color
    context.lineWidth = Math.max(0.1, contour_width)
    context.lineJoin = `round`
    for (const shape of shapes) {
      context.beginPath()
      for (const polygon of shape.coordinates) {
        for (const ring of polygon) {
          for (let point_idx = 0; point_idx < ring.length; point_idx++) {
            const [point_x, sampled_y] = ring[point_idx]
            const point_y = flip_y ? current_slice.height - sampled_y : sampled_y
            if (point_idx === 0) context.moveTo(point_x, point_y)
            else context.lineTo(point_x, point_y)
          }
          context.closePath()
        }
      }
      context.stroke()
    }
    context.restore()
  }

  function render_slice(): void {
    if (!canvas) return
    if (!slice) {
      canvas.getContext(`2d`)?.clearRect(0, 0, canvas.width, canvas.height)
      image_data = undefined
      return
    }
    canvas.width = slice.width
    canvas.height = slice.height
    const context = canvas.getContext(`2d`)
    if (!context) return
    context.clearRect(0, 0, slice.width, slice.height)
    if (mode !== `contours`) {
      if (image_data?.width !== slice.width || image_data?.height !== slice.height) {
        image_data = context.createImageData(slice.width, slice.height)
      }
      slice_to_rgba(slice, colormap, resolved_color_range, {
        flip_y,
        out: image_data.data,
      })
      context.putImageData(image_data, 0, 0)
    }
    if (mode !== `filled`) draw_contours(context, slice)
    onrender?.({
      canvas,
      color_range: resolved_color_range,
      contour_thresholds,
      slice,
    })
  }

  $effect(render_slice)
</script>

<div {...rest} class={[`volume-slice`, rest.class]}>
  <canvas
    bind:this={canvas}
    aria-label="Volumetric scalar-field slice"
    style:aspect-ratio={aspect_ratio}
  ></canvas>
  {#if show_colorbar && slice}
    <ColorBar
      title={colorbar_title}
      color_scale={colormap}
      color_scale_fn={colorbar_color_scale}
      color_scale_domain={resolved_color_range}
      range={resolved_color_range}
      tick_labels={5}
      orientation={colorbar_orientation}
      class="slice-colorbar {colorbar_orientation}"
      --cbar-font-size="0.75em"
      --cbar-tick-label-font-weight="normal"
    />
  {/if}
</div>

<style>
  .volume-slice {
    position: relative;
    width: 100%;
    height: var(--volume-slice-height, auto);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    height: var(--volume-slice-canvas-height, auto);
    object-fit: contain;
    color: var(--volume-slice-contour-color, currentColor);
    outline: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    image-rendering: auto;
  }
  .volume-slice :global(.slice-colorbar) {
    position: absolute;
    z-index: 1;
    pointer-events: none;
    color: var(--volume-slice-colorbar-color, currentColor);
    text-shadow: var(
      --volume-slice-colorbar-text-shadow,
      0 1px 2px color-mix(in srgb, var(--struct-bg, #fff) 85%, transparent)
    );
  }
  .volume-slice :global(.slice-colorbar.vertical) {
    top: 50%;
    left: var(--volume-slice-colorbar-offset, 1rem);
    --cbar-height: var(--volume-slice-colorbar-size, min(70%, 360px));
    transform: translateY(-50%);
  }
  .volume-slice :global(.slice-colorbar.horizontal) {
    right: var(--volume-slice-colorbar-offset, 1rem);
    bottom: var(--volume-slice-colorbar-offset, 1rem);
    left: var(--volume-slice-colorbar-offset, 1rem);
  }
</style>

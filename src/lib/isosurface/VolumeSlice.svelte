<script lang="ts">
  import { get_d3_interpolator, type D3InterpolateName } from '$lib/colors'
  import type { Vec2 } from '$lib/math'
  import ColorBar from '$lib/plot/core/components/ColorBar.svelte'
  import { contours as create_contours } from 'd3-contour'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { SliceResult } from './slice'
  import {
    resolve_contour_thresholds,
    resolve_slice_color_range,
    slice_to_rgba,
    type VolumeSliceMode,
  } from './slice-rendering'

  let {
    slice,
    mode = `both`,
    colormap = `interpolateRdBu`,
    color_range,
    symmetric = `auto`,
    contour_levels = 10,
    show_colorbar = true,
    colorbar_title = `Value`,
    canvas = $bindable(),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    slice?: SliceResult | null
    mode?: VolumeSliceMode
    colormap?: D3InterpolateName
    color_range?: Vec2
    symmetric?: boolean | `auto`
    contour_levels?: number | number[]
    show_colorbar?: boolean
    colorbar_title?: string
    canvas?: HTMLCanvasElement
  } = $props()

  let resolved_color_range = $derived<Vec2>(
    slice ? resolve_slice_color_range(slice, color_range, symmetric) : [0, 1],
  )
  let contour_thresholds = $derived(
    resolve_contour_thresholds(resolved_color_range, contour_levels),
  )
  let colorbar_colormap = $derived.by(() => {
    const interpolator = get_d3_interpolator(colormap)
    return resolved_color_range[0] <= resolved_color_range[1]
      ? interpolator
      : (value: number) => interpolator(1 - value)
  })
  let image_data: ImageData | undefined
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
      const pixel_y = current_slice.height - sampled_y
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
    const contour_values = Float64Array.from(current_slice.data, (value, data_idx) =>
      current_slice.mask[data_idx] && Number.isFinite(value) ? value : outside_value,
    )
    const shapes = create_contours()
      .size([current_slice.width, current_slice.height])
      .thresholds(contour_thresholds)(contour_values as unknown as number[])

    context.save()
    clip_to_slice_polygon(context, current_slice)
    context.strokeStyle = canvas ? getComputedStyle(canvas).color : `currentColor`
    context.lineWidth = 1
    context.lineJoin = `round`
    for (const shape of shapes) {
      context.beginPath()
      for (const polygon of shape.coordinates) {
        for (const ring of polygon) {
          for (let point_idx = 0; point_idx < ring.length; point_idx++) {
            const [point_x, sampled_y] = ring[point_idx]
            const point_y = current_slice.height - sampled_y
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
      slice_to_rgba(slice, colormap, resolved_color_range, { out: image_data.data })
      context.putImageData(image_data, 0, 0)
    }
    if (mode !== `filled`) draw_contours(context, slice)
  }

  $effect(render_slice)
</script>

<div {...rest} class={[`volume-slice`, rest.class]}>
  <div class="canvas-wrapper">
    <canvas
      bind:this={canvas}
      aria-label="Volumetric scalar-field slice"
      style:aspect-ratio={aspect_ratio}
    ></canvas>
  </div>
  {#if show_colorbar && slice}
    <ColorBar
      title={colorbar_title}
      color_scale={colorbar_colormap}
      range={resolved_color_range}
      tick_labels={5}
      bar_style="width: 100%"
      wrapper_style="width: 100%"
      --cbar-font-size="0.75em"
      --cbar-tick-label-font-weight="normal"
    />
  {/if}
</div>

<style>
  .volume-slice {
    display: grid;
    gap: 0.5rem;
    width: 100%;
  }
  .canvas-wrapper {
    display: grid;
    place-items: center;
    min-width: 0;
  }
  canvas {
    display: block;
    width: min(100%, var(--volume-slice-max-width, 600px));
    height: auto;
    max-height: var(--volume-slice-max-height, 600px);
    color: var(--volume-slice-contour-color, currentColor);
    outline: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    image-rendering: auto;
  }
</style>

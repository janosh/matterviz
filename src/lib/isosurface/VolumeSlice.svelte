<script lang="ts">
  import { resolve_computed_color } from '#lib/colors/index.js'
  import type { Vec2 } from '#lib/math.js'
  import ColorBar from '#lib/plot/core/components/ColorBar.svelte'
  import { to_color_scale_config } from '#lib/plot/core/scales.js'
  import type { ColorScale } from '#lib/plot/core/types.js'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { SliceResult } from './slice'
  import {
    contour_segments,
    DEFAULT_SLICE_SCHEME,
    resolve_contour_thresholds,
    resolve_slice_value_range,
    slice_to_rgba,
  } from './slice-rendering'
  import type { VolumeSliceMode } from './slice-rendering'

  let {
    slice,
    mode = `both`,
    color_scale: color_scale_prop = DEFAULT_SLICE_SCHEME,
    symmetric = `auto`,
    contour_levels = 10,
    color_bar = {},
    canvas = $bindable(),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    slice?: SliceResult | null
    mode?: VolumeSliceMode
    color_scale?: ColorScale // unset value_range ends fit the slice (see `symmetric`)
    symmetric?: boolean | `auto`
    contour_levels?: number | number[]
    color_bar?: Partial<ComponentProps<typeof ColorBar>> | null // null hides it
    canvas?: HTMLCanvasElement
  } = $props()

  let color_scale = $derived(to_color_scale_config(color_scale_prop, DEFAULT_SLICE_SCHEME))
  let value_range = $derived<Vec2>(
    slice ? resolve_slice_value_range(slice, color_scale, symmetric) : [0, 1],
  )
  let contour_thresholds = $derived(resolve_contour_thresholds(value_range, contour_levels))
  // Contours are stroked in the canvas's CSS `color` (--volume-slice-contour-color).
  // getComputedStyle forces a style flush and the contour pass repaints on every slider
  // frame, so resolve the colour per theme/style change instead.
  const contour_color = resolve_computed_color(() => canvas, `color`, {
    fallback: `currentColor`,
    watch: [`--volume-slice-contour-color`],
  })

  let image_data: ImageData | undefined
  let contour_values = new Float64Array()
  let aspect_ratio = $derived.by(() => {
    if (!slice) return 1
    const u_span = slice.u_range[1] - slice.u_range[0]
    const v_span = slice.v_range[1] - slice.v_range[0]
    return v_span > 0 ? u_span / v_span : 1
  })

  // Clip to the cell/plane polygon in sampled pixel coordinates, y mirrored like the flipped
  // pixel rows
  function clip_to_slice_polygon(
    context: CanvasRenderingContext2D,
    { polygon, u_range, v_range, width, height }: SliceResult,
  ): void {
    const u_span = u_range[1] - u_range[0]
    const v_span = v_range[1] - v_range[0]
    context.beginPath()
    for (const [point_idx, [u_coord, v_coord]] of polygon.entries()) {
      const pixel_x = ((u_coord - u_range[0]) / u_span) * (width - 1) + 0.5
      const pixel_y = height - (((v_coord - v_range[0]) / v_span) * (height - 1) + 0.5)
      if (point_idx === 0) context.moveTo(pixel_x, pixel_y)
      else context.lineTo(pixel_x, pixel_y)
    }
    context.closePath()
    context.clip()
  }

  function draw_contours(context: CanvasRenderingContext2D, current_slice: SliceResult): void {
    if (contour_thresholds.length === 0) return
    const { data, mask, width, height } = current_slice
    if (contour_values.length !== data.length) contour_values = new Float64Array(data.length)
    // Masked pixels repeat their row's nearest in-mask value, and rows without one the nearest
    // filled row: a constant outside value made every level cross along the mask edge, inside
    // the clip polygon as often as outside it
    const valid = (idx: number): boolean => mask[idx] !== 0 && Number.isFinite(data[idx])
    let filled_row = -1
    for (let row = 0; row < height; row++) {
      const start = row * width
      let carry = Number.NaN
      for (let idx = start; idx < start + width && Number.isNaN(carry); idx++) {
        if (valid(idx)) carry = data[idx]
      }
      if (Number.isNaN(carry)) {
        if (filled_row >= 0) {
          contour_values.copyWithin(start, filled_row * width, (filled_row + 1) * width)
        }
        continue
      }
      for (let idx = start; idx < start + width; idx++) {
        if (valid(idx)) carry = data[idx]
        contour_values[idx] = carry
      }
      // leading rows without in-mask pixels repeat the first filled one
      if (filled_row < 0) {
        for (let empty_row = 0; empty_row < row; empty_row++) {
          contour_values.copyWithin(empty_row * width, start, start + width)
        }
      }
      filled_row = row
    }
    if (filled_row < 0) return
    context.save()
    clip_to_slice_polygon(context, current_slice)
    context.strokeStyle = contour_color.current
    context.lineWidth = 1
    // separate segments, so round caps stand in for the joins of a stroked ring
    context.lineCap = `round`
    context.beginPath()
    // y mirrored like the flipped pixel rows
    contour_segments(contour_values, width, height, contour_thresholds, (x0, y0, x1, y1) => {
      context.moveTo(x0, height - y0)
      context.lineTo(x1, height - y1)
    })
    context.stroke()
    context.restore()
  }

  function render_slice(): void {
    if (!canvas) return
    if (!slice) {
      canvas.getContext(`2d`)?.clearRect(0, 0, canvas.width, canvas.height)
      image_data = undefined
      return
    }
    // Assigning either dimension reallocates the backing store and resets all context state,
    // even when the value is unchanged — and slice size is constant while scrubbing.
    if (canvas.width !== slice.width) canvas.width = slice.width
    if (canvas.height !== slice.height) canvas.height = slice.height
    const context = canvas.getContext(`2d`)
    if (!context) return
    context.clearRect(0, 0, slice.width, slice.height)
    if (mode !== `contours`) {
      if (image_data?.width !== slice.width || image_data?.height !== slice.height) {
        image_data = context.createImageData(slice.width, slice.height)
      }
      slice_to_rgba(slice, color_scale, value_range, image_data.data)
      context.putImageData(image_data, 0, 0)
    }
    if (mode !== `filled`) draw_contours(context, slice)
  }

  $effect(render_slice)
</script>

<div {...rest} class={[`volume-slice`, rest.class]}>
  <canvas
    bind:this={canvas}
    aria-label="Volumetric scalar-field slice"
    style:aspect-ratio={aspect_ratio}
  ></canvas>
  {#if color_bar && slice}
    {@const orientation = color_bar.orientation ?? `vertical`}
    <ColorBar
      title="Value"
      color_scale={{ ...color_scale, value_range }}
      tick_labels={5}
      {...color_bar}
      {orientation}
      class={[`slice-colorbar`, orientation, color_bar.class]}
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
    object-fit: var(--volume-slice-object-fit, contain);
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
    /* a chip, not a text halo: tick labels must stay legible over any slice colour */
    padding: 4px 6px;
    border-radius: 4px;
    background: var(
      --volume-slice-colorbar-bg,
      color-mix(in srgb, var(--struct-bg, var(--page-bg, #fff)) 75%, transparent)
    );
  }
  .volume-slice :global(.slice-colorbar.vertical) {
    top: 50%;
    left: var(--volume-slice-colorbar-offset, 0.5rem);
    --cbar-height: var(--volume-slice-colorbar-size, min(70%, 360px));
    transform: translateY(-50%);
  }
  .volume-slice :global(.slice-colorbar.horizontal) {
    bottom: var(--volume-slice-colorbar-offset, 1rem);
    left: 50%;
    --cbar-width: var(--volume-slice-colorbar-size, min(70%, 360px));
    transform: translateX(-50%);
  }
</style>

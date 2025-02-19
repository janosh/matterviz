<script lang="ts">
  import type { Point } from '$lib'
  import { cubicOut } from 'svelte/easing'
  import { tweened } from 'svelte/motion'
  import type { HoverStyle, LabelStyle, PointStyle } from '.'

  export let x: number
  export let y: number

  export let style: PointStyle = {}
  export let hover: HoverStyle = {}
  export let label: LabelStyle = {}
  export let offset: Point[`offset`] = { x: 0, y: 0 }
  export let tween_duration = 600

  const {
    fill = `gray`,
    radius = 2,
    stroke = `transparent`,
    stroke_width = 1,
    stroke_opacity = 1,
    fill_opacity = 1,
  } = style

  const {
    enabled: hover_enabled = true,
    scale: hover_scale = 1.5,
    stroke: hover_stroke = `white`,
    stroke_width: hover_stroke_width = 2,
  } = hover

  const {
    text = ``,
    offset_x = 5,
    offset_y = 0,
    font_size = `10px`,
    font_family = `sans-serif`,
  } = label

  const tween_params = { duration: tween_duration, easing: cubicOut }
  const tweened_x = tweened(0, tween_params)
  const tweened_y = tweened(0, tween_params)

  $: tweened_x.set(x + offset.x)
  $: tweened_y.set(y + offset.y)
</script>

<g
  transform="translate({$tweened_x} {$tweened_y})"
  class:hover_effect={hover_enabled}
  style:--hover-scale={hover_scale}
  style:--hover-stroke={hover_stroke}
  style:--hover-stroke-width="{hover_stroke_width}px"
>
  <circle
    cx="0"
    cy="0"
    r={radius}
    {fill}
    {stroke}
    stroke-width={stroke_width}
    style:fill-opacity={fill_opacity}
    style:stroke-opacity={stroke_opacity}
  />
  {#if text}
    <text
      x={offset_x}
      y={offset_y}
      style:font-size={font_size}
      style:font-family={font_family}
      dominant-baseline="middle"
    >
      {text}
    </text>
  {/if}
</g>

<style>
  circle {
    transition: var(--scatter-point-transition, all 0.2s);
  }
  .hover_effect circle:hover {
    transform: scale(var(--scatter-point-hover-scale, 1.5));
    stroke: var(--scatter-point-hover-stroke, white);
    stroke-width: var(--scatter-point-hover-stroke-width, 2px);
  }
  text {
    fill: var(--scatter-point-text-fill, currentColor);
    pointer-events: var(--scatter-point-text-events, none);
  }
</style>

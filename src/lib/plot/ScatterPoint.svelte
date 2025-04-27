<script lang="ts">
  import type { Point } from '$lib'
  import type { HoverStyle, LabelStyle, PointStyle } from '$lib/plot'
  import * as d3_symbols from 'd3-shape'
  import { type SymbolType, symbol } from 'd3-shape'
  import { cubicOut } from 'svelte/easing'
  import { Tween, type TweenedOptions } from 'svelte/motion'

  interface Props {
    x: number
    y: number
    style?: PointStyle
    hover?: HoverStyle
    label?: LabelStyle
    offset?: Point[`offset`]
    point_tween?: TweenedOptions<{ x: number; y: number }>
    origin?: { x: number; y: number }
  }
  let {
    x,
    y,
    style = {},
    hover = {},
    label = {},
    offset = { x: 0, y: 0 },
    point_tween,
    origin = { x: 0, y: 0 },
  }: Props = $props()

  const {
    radius = 2,
    stroke = `transparent`,
    stroke_width = 1,
    stroke_opacity = 1,
    fill_opacity = 1,
    marker_type = `circle`,
    marker_size = null, // if null, derive from radius
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

  const symbol_map: Record<string, SymbolType> = {}
  Object.entries(d3_symbols).forEach(([key, value]) => {
    if (key.startsWith(`symbol`) && typeof value === `object`) {
      // Convert camelCase to snake_case used internally
      const snake_key = key.replace(`symbol`, ``).toLowerCase()
      symbol_map[snake_key] = value as SymbolType
    }
  })

  function get_symbol_path(): string {
    const symbol_type = symbol_map[marker_type] ?? d3_symbols.symbolCircle
    const size = marker_size ?? Math.pow(radius, 2) * 3
    return symbol().type(symbol_type).size(size)() || ``
  }

  let marker_path = $derived.by(get_symbol_path)

  const default_tween = { duration: 600, easing: cubicOut }
  // Single tween for {x, y} coordinates
  const tweened_coords = new Tween(origin, { ...default_tween, ...point_tween })

  $effect.pre(() => {
    tweened_coords.target = { x: x + offset.x, y: y + offset.y }
  })
</script>

<g
  transform="translate({tweened_coords.current.x} {tweened_coords.current.y})"
  class:hover_effect={hover_enabled}
  style:--hover-scale={hover_scale}
  style:--hover-stroke={hover_stroke}
  style:--hover-stroke-width="{hover_stroke_width}px"
>
  <path
    d={marker_path}
    {stroke}
    stroke-width={stroke_width}
    style:fill-opacity={fill_opacity}
    style:stroke-opacity={stroke_opacity}
    class="marker"
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
  .marker {
    transition: var(--scatter-point-transition, all 0.2s);
  }
  .hover_effect .marker:hover {
    transform: scale(var(--scatter-point-hover-scale, 1.5));
    stroke: var(--scatter-point-hover-stroke, white);
    stroke-width: var(--scatter-point-hover-stroke-width, 2px);
  }
  path {
    fill: var(--point-fill-color);
  }
  text {
    fill: var(--scatter-point-text-fill, currentColor);
    pointer-events: var(--scatter-point-text-events, none);
  }
</style>

<script lang="ts">
  import type { HoverStyle, LabelStyle, Point, PointStyle, XyObj } from '$lib/plot'
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
    point_tween?: TweenedOptions<XyObj>
    origin?: XyObj
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

  const symbol_map: Record<string, SymbolType> = {}
  Object.entries(d3_symbols).forEach(([key, value]) => {
    if (key.startsWith(`symbol`) && typeof value === `object`) {
      // Convert camelCase to snake_case used internally
      const snake_key = key.replace(`symbol`, ``).toLowerCase()
      symbol_map[snake_key] = value as SymbolType
    }
  })

  function get_symbol_path(): string {
    const symbol_type =
      symbol_map[style.marker_type ?? `circle`] ?? d3_symbols.symbolCircle
    const size = style.marker_size ?? Math.pow(style.radius ?? 2, 2) * 3
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
  class:hover_effect={hover.enabled}
  style:--hover-scale={hover.scale ?? 1.5}
  style:--hover-stroke={hover.stroke ?? `white`}
  style:--hover-stroke-width="{hover.stroke_width ?? 2}px"
>
  <path
    d={marker_path}
    stroke={style.stroke ?? `transparent`}
    stroke-width={style.stroke_width ?? 1}
    style:fill-opacity={style.fill_opacity}
    style:stroke-opacity={style.stroke_opacity}
    class="marker"
  />
  {#if label.text}
    <text
      x={label?.offset?.x ?? 10}
      y={label?.offset?.y ?? 0}
      style:font-size={label?.font_size ?? `10px`}
      style:font-family={label?.font_family ?? `sans-serif`}
      dominant-baseline="middle"
    >
      {label.text}
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

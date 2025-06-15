<script lang="ts">
  import type { HoverStyle, LabelStyle, Point, PointStyle, XyObj } from '$lib/plot'
  import { symbol_map } from '$lib/plot'
  import * as d3_symbols from 'd3-shape'
  import { symbol } from 'd3-shape'
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
    is_hovered?: boolean
    [key: string]: unknown
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
    is_hovered = false,
    ...rest
  }: Props = $props()

  // get the SVG path data as 'd' attribute
  function get_symbol_path(): string {
    const symbol_type = symbol_map[style.symbol_type ?? `Circle`] ??
      d3_symbols.symbolCircle
    const size = style.symbol_size ?? Math.PI * Math.pow(style.radius ?? 2, 2)
    return symbol().type(symbol_type).size(size)() || ``
  }

  let marker_path = $derived.by(get_symbol_path)

  const default_tween_props: TweenedOptions<XyObj> = {
    duration: 600,
    easing: cubicOut,
  }
  // Single tween for {x, y} coordinates
  const tweened_coords = new Tween(origin, { ...default_tween_props, ...point_tween })

  $effect.pre(() => {
    tweened_coords.target = { x: x + offset.x, y: y + offset.y }
  })
</script>

<g
  transform="translate({tweened_coords.current.x} {tweened_coords.current.y})"
  style:--hover-scale={hover.scale ?? 1.5}
  style:--hover-stroke={hover.stroke ?? `white`}
  style:--hover-stroke-width="{hover.stroke_width ?? 0}px"
  style:--hover-brightness={hover.brightness ?? 1.2}
  {...rest}
>
  <path
    d={marker_path}
    stroke={style.stroke ?? `transparent`}
    stroke-width={style.stroke_width ?? 1}
    style:fill-opacity={style.fill_opacity}
    style:stroke-opacity={style.stroke_opacity}
    style:fill="var(--point-fill-color, {style.fill ?? `black`})"
    class="marker"
    class:is-hovered={is_hovered && (hover.enabled ?? true)}
  />
  {#if label.text}
    <text
      x={label?.offset?.x ?? 10}
      y={label?.offset?.y ?? 0}
      style:font-size={label?.font_size ?? `10px`}
      style:font-family={label?.font_family ?? `sans-serif`}
      style:fill="var(--scatter-point-label-fill, currentColor)"
      dominant-baseline="middle"
      class="label-text"
    >
      {label.text}
    </text>
  {/if}
</g>

<style>
  .marker {
    transition: var(--scatter-point-transition, all 0.2s);
  }
  .marker.is-hovered {
    transform: scale(var(--hover-scale));
    stroke: var(--hover-stroke);
    stroke-width: var(--hover-stroke-width);
    filter: brightness(var(--hover-brightness));
  }
  .label-text {
    pointer-events: var(--scatter-point-label-pointer-events, none);
  }
</style>

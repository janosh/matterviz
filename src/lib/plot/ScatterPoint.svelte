<script lang="ts">
  import { type D3SymbolName, symbol_map } from '$lib/labels'
  import type { HoverStyle, LabelStyle, Point } from '$lib/plot'
  import type { PointStyle, TweenedOptions, XyObj } from '$lib/plot/types'
  import { DEFAULTS } from '$lib/settings'
  import * as d3_symbols from 'd3-shape'
  import { symbol } from 'd3-shape'
  import { cubicOut } from 'svelte/easing'
  import type { SVGAttributes } from 'svelte/elements'
  import { Tween } from 'svelte/motion'

  let {
    x,
    y,
    style = {},
    hover = {},
    label = {},
    offset = { x: 0, y: 0 },
    point_tween = $bindable({}),
    origin = $bindable({ x: 0, y: 0 }),
    is_hovered = false,
    is_selected = false,
    leader_line_threshold = 15,
    ...rest
  }: Omit<SVGAttributes<SVGGElement>, `style` | `offset` | `origin` | `transform`> & {
    x: number
    y: number
    style?: PointStyle
    hover?: HoverStyle
    label?: LabelStyle
    offset?: Point[`offset`]
    point_tween?: TweenedOptions<XyObj>
    origin?: XyObj
    is_hovered?: boolean
    is_selected?: boolean
    leader_line_threshold?: number
  } = $props()

  // get the SVG path data as 'd' attribute
  function get_symbol_path(): string {
    const symbol_key: D3SymbolName = style.symbol_type ?? DEFAULTS.scatter.symbol_type
    const symbol_type = symbol_map[symbol_key] ?? d3_symbols.symbolCircle
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
  {#if is_selected}
    <circle
      r={(style.radius ?? 4) * 2.5}
      class="effect-ring selected"
      fill="var(--point-fill-color, {style.fill ?? `cornflowerblue`})"
      stroke="var(--effect-ring-stroke, white)"
      stroke-width="var(--effect-ring-stroke-width, 1)"
    />
  {:else if style.is_highlighted && style.highlight_effect?.match(/pulse|glow/)}
    <circle
      r={(style.radius ?? 4) * 2}
      class="effect-ring {style.highlight_effect}"
      fill={style.highlight_color ?? `#ff4444`}
      stroke="var(--effect-ring-stroke, white)"
      stroke-width="var(--effect-ring-stroke-width, 1)"
    />
  {/if}
  <path
    d={marker_path}
    stroke={style.stroke ?? `transparent`}
    stroke-width={style.stroke_width ?? 1}
    fill-opacity={style.fill_opacity ?? 1}
    stroke-opacity={style.stroke_opacity ?? 1}
    fill="var(--point-fill-color, {style.fill ?? `black`})"
    class="marker"
    class:is-hovered={is_hovered && (hover.enabled ?? true)}
    style:cursor={style.cursor}
  />
  {#if label.text}
    {@const offset_x = label.offset?.x ?? 10}
    {@const offset_y = label.offset?.y ?? 0}
    {@const displacement = Math.hypot(offset_x, offset_y)}
    {#if displacement > leader_line_threshold}
      {@const marker_radius = style.radius ?? 3}
      {@const angle = Math.atan2(offset_y, offset_x)}
      {@const cos_a = Math.cos(angle)}
      {@const sin_a = Math.sin(angle)}
      {@const start_x = cos_a * (marker_radius + 2)}
      {@const start_y = sin_a * (marker_radius + 2)}
      {@const font_px = parseFloat(label.font_size ?? `10`) || 10}
      {@const half_w = (label.text?.length ?? 1) * font_px * 0.2}
      {@const half_h = font_px * 0.5}
      {@const edge_dist = Math.min(
        Math.abs(cos_a) > 0.01 ? half_w / Math.abs(cos_a) : Infinity,
        Math.abs(sin_a) > 0.01 ? half_h / Math.abs(sin_a) : Infinity,
      )}
      {@const end_x = offset_x - cos_a * (edge_dist + 1)}
      {@const end_y = offset_y - sin_a * (edge_dist + 1)}
      {@const line_len = Math.hypot(end_x - start_x, end_y - start_y)}
      {#if line_len > 6}
      <line
        x1={start_x}
        y1={start_y}
        x2={end_x}
        y2={end_y}
        class="leader-line"
        stroke="var(--scatter-leader-line-color, #888)"
        stroke-width="var(--scatter-leader-line-width, 0.8)"
        stroke-dasharray="var(--scatter-leader-line-dash, 2 2)"
        stroke-opacity="var(--scatter-leader-line-opacity, 0.6)"
      />
      {/if}
    {/if}
    <text
      x={offset_x}
      y={offset_y}
      text-anchor={label.auto_placement ? `middle` : undefined}
      style:font-size={label.font_size ?? `10px`}
      style:font-family={label.font_family ?? `sans-serif`}
      fill="var(--scatter-point-label-fill, currentColor)"
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
  .effect-ring {
    pointer-events: none;
    animation: ring-pulse var(--effect-ring-duration, 1s) ease-in-out
      var(--effect-ring-iterations, infinite);
  }
  .effect-ring.pulse {
    --effect-ring-duration: 1.2s;
  }
  .effect-ring.glow {
    --effect-ring-duration: 1.5s;
    filter: blur(3px);
  }
  @keyframes ring-pulse {
    0%, 100% {
      opacity: 0.3;
      transform: scale(1);
    }
    50% {
      opacity: 0.7;
      transform: scale(1.2);
    }
  }
  .label-text {
    pointer-events: var(--scatter-point-label-pointer-events, none);
  }
  .leader-line {
    pointer-events: none;
  }
</style>

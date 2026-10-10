<script lang="ts">
  import { type D3SymbolName, symbol_map } from '#lib/labels.js'
  import { lerp, type Point2D } from '#lib/math.js'
  import type { HoverStyle, LabelStyle, PointStyle } from '#lib/plot/core/types.js'
  import { create_settling_tween } from '#lib/plot/core/settling-tween.svelte.js'
  import {
    estimate_label_size,
    label_leader_segment,
  } from '#lib/plot/core/utils/label-placement.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { rgb } from 'd3-color'
  import { symbol, symbolCircle } from 'd3-shape'
  import { cubicOut } from 'svelte/easing'
  import type { SVGAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'

  let {
    x: coord_x,
    y: coord_y,
    style = {},
    hover = {},
    label = {},
    offset = { x: 0, y: 0 },
    point_tween = $bindable({}),
    is_hovered = false,
    is_selected = false,
    is_dimmed = false,
    leader_line_threshold = 15,
    hit_padding = 0,
    ...rest
  }: Omit<SVGAttributes<SVGGElement>, `style` | `offset` | `transform`> & {
    x: number
    y: number
    style?: PointStyle
    hover?: HoverStyle
    label?: LabelStyle
    offset?: Point2D
    point_tween?: TweenOptions<Point2D>
    is_hovered?: boolean
    is_selected?: boolean
    is_dimmed?: boolean
    leader_line_threshold?: number
    hit_padding?: number
  } = $props()

  type Marker = Point2D & Pick<PointStyle, `radius` | `fill`> & { label: Point2D | null }
  // Size, colour and the label's offset glide with the position, so re-encoding a marker (new
  // size or colour column, colour scale, log toggle) or re-placing its label animates like a
  // data change. Colour blends in RGB; an unset radius or a colour d3 can't parse (e.g. a CSS
  // variable) switches at the start.
  const interpolate_marker = (from: Marker, to: Marker) => {
    const position = point_tween.interpolate?.(from, to)
    const [from_fill, to_fill] = [rgb(from.fill ?? ``), rgb(to.fill ?? ``)]
    const blend_fill =
      from.fill !== to.fill && from_fill.displayable() && to_fill.displayable()
    return (frac: number): Marker => ({
      ...(position?.(frac) ?? { x: lerp(from.x, to.x, frac), y: lerp(from.y, to.y, frac) }),
      label:
        from.label && to.label
          ? {
              x: lerp(from.label.x, to.label.x, frac),
              y: lerp(from.label.y, to.label.y, frac),
            }
          : to.label,
      radius:
        from.radius === undefined || to.radius === undefined
          ? to.radius
          : lerp(from.radius, to.radius, frac),
      fill: blend_fill
        ? rgb(
            lerp(from_fill.r, to_fill.r, frac),
            lerp(from_fill.g, to_fill.g, frac),
            lerp(from_fill.b, to_fill.b, frac),
            lerp(from_fill.opacity, to_fill.opacity, frac),
          ).formatRgb()
        : to.fill,
    })
  }
  const label_offset = $derived({ x: label.offset?.x ?? 10, y: label.offset?.y ?? 0 })
  const target = $derived({
    x: coord_x + offset.x,
    y: coord_y + offset.y,
    radius: style.radius,
    fill: style.fill,
    // null while hidden or awaiting auto-placement, so a label appearing after the plot
    // settled lands on its placed spot instead of sliding in from the default offset
    label: label.text && (label.offset || !label.auto_placement) ? label_offset : null,
  })
  // Seeded at the marker's own state so a plot appearing on screen draws it where the data
  // is instead of animating every point in from elsewhere.
  // Object.is, not ===, so a NaN coordinate compares equal to itself instead of retargeting
  // every render (BarPlot passes coordinates through unclamped).
  const tweened = create_settling_tween(
    () => target,
    { duration: 600, easing: cubicOut, interpolate: interpolate_marker },
    {
      live: () => ({ ...point_tween, interpolate: interpolate_marker }),
      is_same: (left, right) =>
        Object.is(left.x, right.x) &&
        Object.is(left.y, right.y) &&
        Object.is(left.radius, right.radius) &&
        left.fill === right.fill &&
        Object.is(left.label?.x, right.label?.x) &&
        Object.is(left.label?.y, right.label?.y),
    },
  )
  const { radius, fill } = $derived(tweened.current)

  // SVG path data for the marker's `d` attribute
  let marker_path = $derived.by(() => {
    const symbol_key: D3SymbolName = style.symbol_type ?? DEFAULTS.scatter.symbol_type
    const size = style.symbol_size ?? Math.PI * (radius ?? 2) ** 2
    return (
      symbol()
        .type(symbol_map[symbol_key] ?? symbolCircle)
        .size(size)() || ``
    )
  })
</script>

<g
  transform="translate({tweened.current.x} {tweened.current.y})"
  style="--hover-scale: {hover.scale ?? 1.5}; {hover.stroke === ``
    ? ``
    : `--hover-stroke: ${hover.stroke ?? `white`}; `}--hover-stroke-width: {hover.stroke_width ??
    0}px; --hover-brightness: {hover.brightness ?? 1.2}"
  {...rest}
>
  {#if hit_padding > 0}
    <circle
      r={(radius ?? 2) + hit_padding}
      class="marker-hit-target"
      fill="transparent"
      stroke="none"
      pointer-events="all"
    />
  {/if}
  {#if is_selected}
    <circle
      r={(radius ?? 4) * 2.5}
      class="effect-ring selected"
      fill="var(--point-fill-color, {fill ?? `cornflowerblue`})"
      stroke="var(--effect-ring-stroke, white)"
      stroke-width="var(--effect-ring-stroke-width, 1)"
    />
  {:else if style.is_highlighted && style.highlight_effect}
    <circle
      r={(radius ?? 4) * 2}
      class={[`effect-ring`, style.highlight_effect]}
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
    fill="var(--point-fill-color, {fill ?? `black`})"
    class="marker"
    class:is-hovered={is_hovered && (hover.enabled ?? true)}
    class:is-dimmed={is_dimmed}
    style:cursor={style.cursor}
  />
  {#if label.text}
    {@const { x: offset_x, y: offset_y } = tweened.current.label ?? label_offset}
    {@const displacement = Math.hypot(offset_x, offset_y)}
    {@const leader_line =
      displacement > leader_line_threshold
        ? label_leader_segment({
            point: { x: 0, y: 0 },
            point_radius: radius ?? 3,
            label_center: { x: offset_x, y: offset_y },
            label_size: label.size ?? estimate_label_size(label.text, label.font_size),
            min_length: 6,
          })
        : null}
    {#if leader_line}
      <line
        x1={leader_line.x1}
        y1={leader_line.y1}
        x2={leader_line.x2}
        y2={leader_line.y2}
        class="leader-line"
        stroke="var(--scatter-leader-line-color, #888)"
        stroke-width="var(--scatter-leader-line-width, 0.8)"
        stroke-dasharray="var(--scatter-leader-line-dash, 2 2)"
        stroke-opacity="var(--scatter-leader-line-opacity, 0.6)"
        pointer-events="none"
      />
    {/if}
    <text
      x={offset_x}
      y={offset_y}
      text-anchor={label.auto_placement ? `middle` : undefined}
      style="font-size: {label.font_size ?? `10px`}; font-family: {label.font_family ??
        `sans-serif`}; pointer-events: var(--scatter-point-label-pointer-events, none)"
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
    /* Match canvas recoloring immediately; reserve transitions for hover/selection effects. */
    transition: var(
      --scatter-point-transition,
      transform 0.2s,
      stroke 0.2s,
      stroke-width 0.2s,
      stroke-opacity 0.2s,
      fill-opacity 0.2s,
      filter 0.2s,
      opacity 0.2s
    );
  }
  .marker.is-hovered {
    transform: scale(var(--hover-scale));
    stroke: var(--hover-stroke);
    stroke-width: var(--hover-stroke-width);
    filter: brightness(var(--hover-brightness));
  }
  .marker.is-dimmed {
    opacity: var(--scatter-point-dimmed-opacity, 0.25);
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
    0%,
    100% {
      opacity: 0.3;
      transform: scale(1);
    }
    50% {
      opacity: 0.7;
      transform: scale(1.2);
    }
  }
</style>

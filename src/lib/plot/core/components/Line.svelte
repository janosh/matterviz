<script lang="ts">
  import type { Vec2 } from '#lib/math.js'
  import { line_curve_factory } from '#lib/plot/core/fill-utils.js'
  import type { LineCurve } from '#lib/plot/core/types.js'
  import { create_settling_tween } from '#lib/plot/core/settling-tween.svelte.js'
  import { line_path as trace_line } from '#lib/plot/core/svg.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { interpolatePath } from 'd3-interpolate-path'
  import { linear } from 'svelte/easing'
  import type { SVGAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'
  import type { CurveFactory } from 'd3-shape'

  let {
    points,
    line_color = `rgba(255, 255, 255, 0.5)`,
    line_width = 2,
    line_tween = {},
    line_dash = DEFAULTS.scatter.line.dash,
    curve = `monotone`,
    ...rest
  }: Omit<SVGAttributes<SVGPathElement>, `points`> & {
    points: readonly Vec2[]
    line_color?: string
    line_width?: number
    line_tween?: TweenOptions<string>
    line_dash?: string
    curve?: LineCurve
  } = $props()

  const point_x = (point: Vec2) => point[0]
  const point_y = (point: Vec2) => point[1]
  const is_finite_point = ([x, y]: Vec2) => Number.isFinite(x) && Number.isFinite(y)

  // null/undefined curves mean monotone; unknown names from untyped (Python/JSON) callers throw.
  // A non-finite point lifts the pen (a series' line_breaks), the line resuming after it.
  const curve_factory = $derived(line_curve_factory(curve))
  // Traced once per coordinates and curve: Svelte re-runs this derived whenever upstream marks
  // it maybe-dirty, as every pan frame does through a parent's per-frame series objects.
  // Compared by value, as a $state array edited in place keeps its identity (a miss re-traces,
  // reading every coordinate, so the derived stays subscribed to them).
  let traced: { coords: Float64Array; curve: CurveFactory; path: string } | null = null
  const line_path = $derived.by(() => {
    const coords = traced?.curve === curve_factory ? traced.coords : null
    const same =
      coords?.length === 2 * points.length &&
      points.every(
        ([x, y], idx) => Object.is(coords[2 * idx], x) && Object.is(coords[2 * idx + 1], y),
      )
    if (same && traced) return traced.path
    const path = trace_line(points, curve_factory, point_x, point_y, is_finite_point)
    traced = { coords: Float64Array.from(points.flat()), curve: curve_factory, path }
    return path
  })

  const default_tween = {
    duration: 300,
    easing: linear,
    interpolate: interpolatePath,
  }
  // Morphing via interpolatePath costs a parse + resample + re-serialize every frame, per
  // line, so `duration <= 0` renders line_path directly below instead.
  let tween_disabled = $derived.by(() => {
    const duration = line_tween.duration ?? default_tween.duration
    return typeof duration === `number` && duration <= 0
  })

  // Disabled, the tween sits out (a plot past its morph budget has hundreds of lines) and snaps
  // to the path once re-enabled instead of morphing from where it was left
  const tweened_line = create_settling_tween(() => line_path, default_tween, {
    live: () => line_tween,
    enabled: () => !tween_disabled,
  })

  const line_d = $derived(tween_disabled ? line_path : tweened_line.current)
</script>

<path
  d={line_d}
  stroke={line_color}
  stroke-width={line_width}
  stroke-dasharray={line_dash && line_dash !== `solid` ? line_dash : null}
  fill="none"
  {...rest}
/>

<style>
  path {
    /* Geometry belongs to create_settling_tween; never CSS-transition `d`. */
    transition: var(
      --line-transition,
      stroke 0.2s,
      stroke-width 0.2s,
      stroke-dasharray 0.2s,
      stroke-opacity 0.2s,
      fill 0.2s,
      fill-opacity 0.2s,
      opacity 0.2s
    );
  }
</style>

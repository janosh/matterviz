<script lang="ts">
  import type { Vec2 } from '$lib/math'
  import { line_curve_factory } from '$lib/plot/core/fill-utils'
  import type { LineCurve } from '$lib/plot/core/types'
  import { DEFAULTS } from '$lib/settings'
  import { extent, min } from 'd3-array'
  import { interpolatePath } from 'd3-interpolate-path'
  import { line } from 'd3-shape'
  import { untrack } from 'svelte'
  import { linear } from 'svelte/easing'
  import type { SVGAttributes } from 'svelte/elements'
  import { Tween, type TweenOptions } from 'svelte/motion'

  let {
    points,
    origin = [0, 0],
    line_color = `rgba(255, 255, 255, 0.5)`,
    line_width = 2,
    area_color = `rgba(255, 255, 255, 0.1)`,
    area_stroke = null,
    line_tween = {},
    line_dash = DEFAULTS.scatter.line.dash,
    curve = `monotone`,
    ...rest
  }: Omit<SVGAttributes<SVGPathElement>, `origin` | `points`> & {
    points: readonly Vec2[]
    origin: Vec2
    line_color?: string
    line_width?: number
    area_color?: string
    area_stroke?: string | null
    line_tween?: TweenOptions<string>
    line_dash?: string
    curve?: LineCurve
  } = $props()

  // falls back to monotone for unknown strings from untyped (Python/JSON) callers
  let curve_fn = $derived(line_curve_factory(curve))
  let lineGenerator = $derived(
    line()
      .x((point) => point[0])
      .y((point) => point[1])
      .curve(curve_fn),
  )

  // Only compute/render/tween the area fill when it is actually visible. Most line
  // plots (e.g. every ScatterPlot line) pass a transparent area, so skipping it
  // avoids a second expensive interpolatePath tween per line.
  let show_area = $derived(
    (Boolean(area_color) && area_color !== `transparent` && area_color !== `none`) ||
      Boolean(area_stroke),
  )

  let [x_min, x_max] = $derived(extent(points.map((point) => point[0])))
  let line_path = $derived(lineGenerator(points) ?? ``)
  let ymin = $derived(origin[1] ?? min(points.map((point) => point[1])))
  // Guard against NaN/Infinity in area_path coords (can happen during scale transitions)
  let area_path = $derived(
    show_area &&
      line_path &&
      isFinite(x_min ?? NaN) &&
      isFinite(x_max ?? NaN) &&
      isFinite(ymin ?? NaN)
      ? `${line_path}L${x_max},${ymin}L${x_min},${ymin}Z`
      : ``,
  )

  const default_tween = {
    duration: 300,
    easing: linear,
    interpolate: interpolatePath,
  }
  // Path morphing via interpolatePath is costly (parse + resample + re-serialize
  // every frame, per line). When the tween is disabled (duration <= 0) bind the
  // path directly and skip the Tween entirely for zero per-frame cost.
  let tween_disabled = $derived.by(() => {
    const duration = line_tween.duration ?? default_tween.duration
    return typeof duration === `number` && duration <= 0
  })

  // Tween objects are stateful - create once, update target via effect
  // untrack() explicitly captures initial tween config (intentional - config set once at mount)
  const tween_opts = untrack(() => ({ ...default_tween, ...line_tween }))
  const tweened_line = new Tween(``, tween_opts)
  const tweened_area = new Tween(``, tween_opts)

  $effect.pre(() => {
    if (tween_disabled) return // paths bind line_path/area_path directly below
    tweened_line.target = line_path
    if (show_area) tweened_area.target = area_path
  })

  let line_d = $derived(tween_disabled ? line_path : tweened_line.current)
  let area_d = $derived(show_area ? (tween_disabled ? area_path : tweened_area.current) : ``)
</script>

<path
  d={line_d}
  stroke={line_color}
  stroke-width={line_width}
  stroke-dasharray={line_dash && line_dash !== `solid` ? line_dash : null}
  fill="none"
  {...rest}
/>
<path d={area_d} fill={area_color} stroke={area_stroke} {...rest} />

<style>
  path {
    transition: var(--line-transition, all 0.2s);
  }
</style>

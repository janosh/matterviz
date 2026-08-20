<script lang="ts">
  import type { Vec2 } from '$lib/math'
  import { line_curve_factory } from '$lib/plot/core/fill-utils'
  import type { LineCurve } from '$lib/plot/core/types'
  import { create_settling_tween } from '$lib/plot/core/settling-tween.svelte'
  import { DEFAULTS } from '$lib/settings'
  import { interpolatePath } from 'd3-interpolate-path'
  import { line } from 'd3-shape'
  import { linear } from 'svelte/easing'
  import type { SVGAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'

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
    origin?: Vec2 // baseline of the area fill; its y defaults to the lowest point
    line_color?: string
    line_width?: number
    area_color?: string
    area_stroke?: string | null
    line_tween?: TweenOptions<string>
    line_dash?: string
    curve?: LineCurve
  } = $props()

  // falls back to monotone for unknown strings from untyped (Python/JSON) callers
  const line_generator = $derived(
    line<Vec2>()
      .x((point) => point[0])
      .y((point) => point[1])
      .curve(line_curve_factory(curve)),
  )

  // Only compute/render/tween the area fill when it is actually visible. Most line
  // plots (e.g. every ScatterPlot line) pass a transparent area, so skipping it
  // avoids a second expensive interpolatePath tween per line.
  let show_area = $derived(
    (Boolean(area_color) && area_color !== `transparent` && area_color !== `none`) ||
      Boolean(area_stroke),
  )

  const line_path = $derived(line_generator(points) ?? ``)
  // Close the area along the baseline between the x extent of the points. Non-finite coords
  // (possible mid scale transition) drop the fill rather than emit an invalid path.
  const area_path = $derived.by(() => {
    if (!show_area || !line_path) return ``
    let [x_min, x_max, y_min] = [Infinity, -Infinity, Infinity]
    for (const [x_val, y_val] of points) {
      if (x_val < x_min) x_min = x_val
      if (x_val > x_max) x_max = x_val
      if (y_val < y_min) y_min = y_val
    }
    const baseline = origin[1] ?? y_min
    if (![x_min, x_max, baseline].every(Number.isFinite)) return ``
    return `${line_path}L${x_max},${baseline}L${x_min},${baseline}Z`
  })

  const default_tween = {
    duration: 300,
    easing: linear,
    interpolate: interpolatePath,
  }
  // Morphing via interpolatePath costs a parse + resample + re-serialize every frame, per
  // line, so `duration <= 0` renders line_path/area_path directly below instead.
  let tween_disabled = $derived.by(() => {
    const duration = line_tween.duration ?? default_tween.duration
    return typeof duration === `number` && duration <= 0
  })

  // Zero duration rather than skipping the retarget while disabled: `current` would otherwise
  // freeze at whatever it last animated to, and re-enabling would jump back there and morph
  // forward again. The area tween is fed unconditionally for the same reason — `area_path` is
  // already `` while hidden, so it stays in step instead of holding a stale path.
  const live = () => (tween_disabled ? { duration: 0 } : line_tween)
  const tweened_line = create_settling_tween(() => line_path, default_tween, { live })
  const tweened_area = create_settling_tween(() => area_path, default_tween, { live })

  const line_d = $derived(tween_disabled ? line_path : tweened_line.current)
  const area_d = $derived(show_area ? (tween_disabled ? area_path : tweened_area.current) : ``)
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

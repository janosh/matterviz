<script lang="ts">
  import type { Vec2 } from '#lib/math.js'
  import { line_curve_factory } from '#lib/plot/core/fill-utils.js'
  import type { LineCurve } from '#lib/plot/core/types.js'
  import { create_settling_tween } from '#lib/plot/core/settling-tween.svelte.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { interpolatePath } from 'd3-interpolate-path'
  import { line } from 'd3-shape'
  import { linear } from 'svelte/easing'
  import type { SVGAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'

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

  // falls back to monotone for unknown strings from untyped (Python/JSON) callers
  const line_generator = $derived(
    line<Vec2>()
      .x((point) => point[0])
      .y((point) => point[1])
      .curve(line_curve_factory(curve)),
  )

  const line_path = $derived(line_generator(points) ?? ``)

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

  // Zero duration rather than skipping the retarget while disabled: `current` would otherwise
  // freeze at whatever it last animated to, and re-enabling would jump back there and morph
  // forward again.
  const live = () => (tween_disabled ? { duration: 0 } : line_tween)
  const tweened_line = create_settling_tween(() => line_path, default_tween, { live })

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

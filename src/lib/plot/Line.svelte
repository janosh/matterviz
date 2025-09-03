<script lang="ts">
  import { extent, min } from 'd3-array'
  import { interpolatePath } from 'd3-interpolate-path'
  import { curveMonotoneX, line } from 'd3-shape'
  import { linear } from 'svelte/easing'
  import type { SVGAttributes } from 'svelte/elements'
  import { Tween, type TweenedOptions } from 'svelte/motion'

  interface Props extends Omit<SVGAttributes<SVGPathElement>, `origin` | `points`> {
    points: readonly [number, number][]
    origin: [number, number]
    line_color?: string
    line_width?: number
    area_color?: string
    area_stroke?: string | null
    line_tween?: TweenedOptions<string>
    line_dash?: string
  }
  let {
    points,
    origin = [0, 0],
    line_color = `rgba(255, 255, 255, 0.5)`,
    line_width = 2,
    area_color = `rgba(255, 255, 255, 0.1)`,
    area_stroke = null,
    line_tween = {},
    line_dash = undefined,
    ...rest
  }: Props = $props()

  const lineGenerator = line()
    .x((point) => point[0])
    .y((point) => point[1])
    .curve(curveMonotoneX)

  let [x_min, x_max] = $derived(extent(points.map((p) => p[0])))
  let line_path = $derived(lineGenerator(points) ?? ``)
  let ymin = $derived(origin[1] ?? min(points.map((p) => p[1])))
  let area_path = $derived(
    line_path ? `${line_path}L${x_max},${ymin}L${x_min},${ymin}Z` : ``,
  )

  const default_tween = {
    duration: 300,
    easing: linear,
    interpolate: interpolatePath,
  }
  const tweened_line = new Tween(``, { ...default_tween, ...line_tween })
  const tweened_area = new Tween(``, { ...default_tween, ...line_tween })

  $effect.pre(() => {
    tweened_line.target = line_path
    tweened_area.target = area_path
  })
</script>

<path
  d={tweened_line.current}
  stroke={line_color}
  stroke-width={line_width}
  stroke-dasharray={line_dash}
  fill="none"
  {...rest}
/>
<path d={tweened_area.current} fill={area_color} stroke={area_stroke} {...rest} />

<style>
  path {
    transition: var(--line-transition, all 0.2s);
  }
</style>

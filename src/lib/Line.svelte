<script lang="ts">
  import { extent, min } from 'd3-array'
  import { interpolatePath } from 'd3-interpolate-path'
  import { curveMonotoneX, line } from 'd3-shape'
  import { cubicOut } from 'svelte/easing'
  import { tweened } from 'svelte/motion'

  export let line_color = `rgba(255, 255, 255, 0.5)`
  export let line_width = 2
  export let area_color = `rgba(255, 255, 255, 0.1)`
  export let area_stroke: string | null = null
  export let tween_duration = 600
  export let origin: [number, number]
  export let points: [number, number][]

  const lineGenerator = line()
    .x((point) => point[0])
    .y((point) => point[1])
    .curve(curveMonotoneX)

  const tween_params = {
    duration: tween_duration,
    easing: cubicOut,
    interpolate: interpolatePath,
  }
  const tweened_line = tweened(``, tween_params)
  const tweened_area = tweened(``, tween_params)

  $: [x_min, x_max] = extent(points.map((p) => p[0]))
  $: line_path = lineGenerator(points)

  $: tweened_line.set(line_path)

  $: ymin = origin[1] ?? min(points.map((p) => p[1]))
  $: area_path = `${line_path}L${x_max},${ymin}L${x_min},${ymin}Z`
  $: tweened_area.set(area_path)
</script>

<path
  d={$tweened_line}
  style:stroke={line_color}
  style:stroke-width={line_width}
  fill="none"
/>
<path d={$tweened_area} style:fill={area_color} style:stroke={area_stroke} />

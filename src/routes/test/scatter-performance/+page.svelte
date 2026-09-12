<script lang="ts">
  import ScatterPlot from '$lib/plot/scatter/ScatterPlot.svelte'
  import type {
    AxisRanges,
    ColorScaleConfig,
    DataSeries,
    SizeScaleConfig,
    StyleOverrides,
  } from '$lib/plot/core/types'
  import { onMount } from 'svelte'

  // Keep the full [0, 1] dataset visible throughout the alternating pan/zoom gestures.
  const initial_view = (): Partial<AxisRanges> => ({ x: [-0.25, 1.25], y: [-0.25, 1.25] })
  let series = $state.raw<DataSeries[]>([])
  let view = $state(initial_view())
  let color_scale = $state<ColorScaleConfig>({ scheme: `interpolateViridis` })
  let size_scale = $state<SizeScaleConfig>({ radius_range: [1, 3] })
  let styles = $state<StyleOverrides>({ show_lines: false })

  function reset(): void {
    view = initial_view()
    color_scale = { scheme: `interpolateViridis` }
    size_scale = { radius_range: [1, 3] }
  }

  onMount(() => {
    const count = Number(new URLSearchParams(location.search).get(`points`) ?? 100_000)
    if (![100_000, 500_000].includes(count)) throw new Error(`Invalid point count: ${count}`)
    let seed = 20260912
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    series = [
      {
        x: Array.from({ length: count }, random),
        y: Array.from({ length: count }, random),
        color_values: Array.from({ length: count }, random),
        size_values: Array.from({ length: count }, random),
      },
    ]
  })
</script>

<button onclick={reset}>Reset</button>
<button
  onclick={() =>
    (color_scale = {
      scheme:
        color_scale.scheme === `interpolateViridis`
          ? `interpolatePlasma`
          : `interpolateViridis`,
    })}>Color</button
>
<button
  onclick={() =>
    (size_scale = {
      radius_range: size_scale.radius_range?.[1] === 3 ? [2, 5] : [1, 3],
    })}>Size</button
>
<output data-testid="scatter-state" hidden>
  {JSON.stringify({
    points: series[0]?.x.length,
    mode: import.meta.env.DEV ? `dev` : `production`,
    view,
    color_scale,
    size_scale,
  })}
</output>

{#if series.length}
  <ScatterPlot
    {series}
    bind:view
    bind:styles
    {color_scale}
    {size_scale}
    marker_renderer="canvas"
    show_controls={false}
    show_legend={false}
    color_bar={null}
    fullscreen_toggle={false}
    point_tween={{ duration: 0 }}
    line_tween={{ duration: 0 }}
    style="width: 1000px; height: 600px;"
  />
{/if}

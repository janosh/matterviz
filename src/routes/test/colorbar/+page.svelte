<script lang="ts">
  import { ColorBar } from '#lib'
  import type { Vec2 } from '#lib/math.js'
  import { scaleSequentialLog } from 'd3-scale'
  import { interpolateCool } from 'd3-scale-chromatic'

  let nice_range_output: Vec2 = [0, 1]
  const custom_color_scale = scaleSequentialLog(interpolateCool).domain([0.1, 10])
</script>

<svelte:head>
  <title>ColorBar Test Page</title>
</svelte:head>

<h1 id="colorbar-component-playwright-tests">ColorBar Component Playwright Tests</h1>

<h2 id="horizontal-primary-ticks-top-title">Horizontal, Primary Ticks, Top Title</h2>
<ColorBar
  id="horizontal-primary"
  title="Temperature (°C)"
  scale="interpolatePlasma"
  tick_labels={[0, 25, 50, 75, 100]}
  range={[0, 100]}
  tick_side="primary"
  title_side="top"
/>

<h2 id="vertical-secondary-ticks-right-title">Vertical, Secondary Ticks, Right Title</h2>
<ColorBar
  id="vertical-secondary"
  orientation="vertical"
  title="Pressure (Pa)"
  scale="interpolateBlues"
  range={[-10, 10]}
  tick_labels={5}
  tick_side="secondary"
  title_side="right"
  bar_style="height: 300px"
/>

<h2 id="horizontal-inside-ticks-turbo-scale">Horizontal, Inside Ticks, Turbo Scale</h2>
<ColorBar
  id="horizontal-inside"
  title="Intensity"
  scale="interpolateTurbo"
  range={[0, 1]}
  tick_labels={5}
  snap_ticks={false}
  tick_side="inside"
  title_side="left"
/>

<h2 id="vertical-inside-ticks-log-scale">Vertical, Inside Ticks, Log Scale</h2>
<ColorBar
  id="vertical-log"
  orientation="vertical"
  title="Frequency (Hz)"
  scale="interpolateViridis"
  range={[1, 1000]}
  tick_labels={4}
  tick_side="inside"
  scale_type="log"
  bar_style="height: 300px"
/>

<h2 id="horizontal-date-ticks">Horizontal, Date Ticks</h2>
<ColorBar
  id="horizontal-date"
  title="Timestamp"
  scale="interpolateCividis"
  range={[new Date(2023, 0, 1).getTime(), new Date(2023, 11, 31).getTime()]}
  tick_labels={4}
  tick_format="%b %d, %Y"
  snap_ticks={false}
  tick_side="primary"
/>

<h2 id="vertical-no-snap-numeric-format">Vertical, No Snap, Numeric Format</h2>
<ColorBar
  id="vertical-no-snap"
  orientation="vertical"
  title="Ratio"
  scale="interpolateMagma"
  range={[0.1, 0.9]}
  tick_labels={5}
  snap_ticks={false}
  tick_format=".1%"
  tick_side="primary"
  bar_style="height: 300px"
/>

<h2 id="horizontal-custom-styles-1">Horizontal, Custom Styles</h2>
<ColorBar
  id="horizontal-custom-styles"
  title="Custom Styled"
  scale="interpolateWarm"
  range={[0, 5]}
  tick_labels={6}
  bar_style="border: 2px solid red; border-radius: 0"
  title_style="color: blue; font-style: italic;"
  wrapper_style="background-color: lightgrey; padding: 10px;"
/>

<h2 id="vertical-custom-scale-function-domain">Vertical, Custom Scale Function & Domain</h2>
<ColorBar
  id="vertical-custom-fn"
  orientation="vertical"
  title="Custom Log Scale"
  scale={{ fn: custom_color_scale, domain: [0.1, 10] }}
  range={[-5, 15]}
  tick_labels={5}
  scale_type="linear"
  bar_style="height: 300px"
/>

<h2 id="horizontal-bind-nice-range-snap-true">Horizontal, Bind Nice Range (Snap=true)</h2>
<ColorBar
  id="horizontal-nice-range"
  title="Nice Range Output"
  range={[0.1, 0.9]}
  bind:nice_range={nice_range_output}
  snap_ticks
  tick_labels={4}
/>
<p data-testid="nice-range-output">
  Bound Nice Range: [{nice_range_output[0]}, {nice_range_output[1]}]
</p>

<h3 id="vertical-log-scale-inside-ticks-zero-min">
  Vertical Log Scale Inside Ticks (Zero Min)
</h3>
<ColorBar
  id="vertical-log-zero-min"
  range={[0, 1000]}
  scale_type="log"
  snap_ticks
  tick_labels={4}
  tick_side="inside"
  orientation="vertical"
  bar_style="height: 300px"
/>

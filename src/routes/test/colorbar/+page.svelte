<script lang="ts">
  import { ColorBar } from '$lib'
  import { scaleSequentialLog } from 'd3-scale'
  import { interpolateCool } from 'd3-scale-chromatic'

  let horizontal_primary_ticks: (string | number)[] = [0, 25, 50, 75, 100]
  let vertical_secondary_range: [number, number] = [-10, 10]
  let horizontal_inside_range: [number, number] = [0, 1]
  let vertical_log_range: [number, number] = [1, 1000]
  let horizontal_date_range: [number, number] = [
    new Date(2023, 0, 1).getTime(),
    new Date(2023, 11, 31).getTime(),
  ]
  let vertical_no_snap_range: [number, number] = [0.1, 0.9]
  let nice_range_output: [number, number] = [0, 1]

  // Custom color scale function
  const custom_color_scale = scaleSequentialLog(interpolateCool).domain([0.1, 10])
</script>

<svelte:head>
  <title>ColorBar Test Page</title>
</svelte:head>

<h1>ColorBar Component Playwright Tests</h1>

<div id="horizontal-primary" style="margin-bottom: 40px; width: 300px">
  <h2>Horizontal, Primary Ticks, Top Title</h2>
  <ColorBar
    title="Temperature (°C)"
    color_scale="Plasma"
    tick_labels={horizontal_primary_ticks}
    range={[0, 100]}
    tick_side="primary"
    title_side="top"
  />
</div>

<div id="vertical-secondary" style="margin-bottom: 40px; height: 300px">
  <h2>Vertical, Secondary Ticks, Right Title</h2>
  <ColorBar
    orientation="vertical"
    title="Pressure (Pa)"
    color_scale="Blues"
    range={vertical_secondary_range}
    tick_labels={5}
    tick_side="secondary"
    title_side="right"
  />
</div>

<div id="horizontal-inside" style="margin-bottom: 40px; width: 300px">
  <h2>Horizontal, Inside Ticks, Turbo Scale</h2>
  <ColorBar
    title="Intensity"
    color_scale="Turbo"
    range={horizontal_inside_range}
    tick_labels={5}
    snap_ticks={false}
    tick_side="inside"
    title_side="left"
  />
</div>

<div id="vertical-log" style="margin-bottom: 40px; height: 300px">
  <h2>Vertical, Inside Ticks, Log Scale</h2>
  <ColorBar
    orientation="vertical"
    title="Frequency (Hz)"
    color_scale="Viridis"
    range={vertical_log_range}
    tick_labels={4}
    tick_side="inside"
    scale_type="log"
  />
</div>

<div id="horizontal-date" style="margin-bottom: 40px; width: 400px">
  <h2>Horizontal, Date Ticks</h2>
  <ColorBar
    title="Timestamp"
    color_scale="Cividis"
    range={horizontal_date_range}
    tick_labels={4}
    tick_format="%b %d, %Y"
    snap_ticks={false}
    tick_side="primary"
  />
</div>

<div id="vertical-no-snap" style="margin-bottom: 40px; height: 250px">
  <h2>Vertical, No Snap, Numeric Format</h2>
  <ColorBar
    orientation="vertical"
    title="Ratio"
    color_scale="Magma"
    range={vertical_no_snap_range}
    tick_labels={5}
    snap_ticks={false}
    tick_format=".1%"
    tick_side="primary"
  />
</div>

<div id="horizontal-custom-styles" style="margin-bottom: 40px; width: 350px">
  <h2>Horizontal, Custom Styles</h2>
  <ColorBar
    title="Custom Styled"
    color_scale="Warm"
    range={[0, 5]}
    tick_labels={6}
    style="border: 2px solid red; border-radius: 0"
    title_style="color: blue; font-style: italic;"
    wrapper_style="background-color: lightgrey; padding: 10px;"
  />
</div>

<div id="vertical-custom-fn" style="margin-bottom: 40px; height: 300px">
  <h2>Vertical, Custom Scale Function & Domain</h2>
  <ColorBar
    orientation="vertical"
    title="Custom Log Scale"
    color_scale_fn={custom_color_scale}
    color_scale_domain={[0.1, 10]}
    range={[-5, 15]}
    tick_labels={5}
    scale_type="linear"
  />
</div>

<div id="horizontal-nice-range" style="margin-bottom: 40px; width: 300px">
  <h2>Horizontal, Bind Nice Range (Snap=true)</h2>
  <ColorBar
    title="Nice Range Output"
    range={[0.1, 0.9]}
    bind:nice_range={nice_range_output}
    snap_ticks={true}
    tick_labels={4}
  />
  <p data-testid="nice-range-output">
    Bound Nice Range: [{nice_range_output[0]}, {nice_range_output[1]}]
  </p>
</div>

<div id="vertical-log-zero-min">
  <h3>Vertical Log Scale Inside Ticks (Zero Min)</h3>
  <ColorBar
    range={[0, 1000]}
    scale_type="log"
    snap_ticks={true}
    tick_labels={4}
    tick_side="inside"
    orientation="vertical"
  />
</div>

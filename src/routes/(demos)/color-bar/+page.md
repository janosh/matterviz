`ColorBar.svelte`

Here's a `ColorBar` with tick labels, using the new `tick_align` prop:

```svelte example stackblitz
<script>
  import { ColorBar } from '$lib'
</script>

<div style="border: 0.1px dashed white;">
  {#each [
    // [color_scale, tick_align, tick_labels, range, label_text]
    [`Viridis`, `primary`, [0, 0.25, 0.5, 0.75, 1], [0, 1]],
    [`Magma`, `secondary`, 10, [100, 1631]],
    [`Cividis`, `primary`, 4, [-99.9812, -10]],
  ] as [color_scale, tick_align, tick_labels, range]}
    <ColorBar
      title="color_scale={color_scale} &emsp; tick_align={tick_align} &emsp; range={range}"
      {color_scale}
      {tick_align}
      {tick_labels}
      {range}
      tick_format=".2f"
      title_style="padding: 1em;"
      --cbar-padding="3em"
    />
  {/each}
</div>
```

You can make fat and skinny bars:

```svelte example stackblitz
<script>
  import { ColorBar } from '$lib'

  const wrapper_style = 'place-items: center;'
</script>

<ColorBar {wrapper_style} style="width: 10em; height: 1ex;" />
<br />
<ColorBar title="Viridis" {wrapper_style} style="width: 3em; height: 2em;" />
<br />
<ColorBar {wrapper_style} --cbar-width="8em" --cbar-height="2em" />
```

`PeriodicTable.svelte` heatmap example with `ColorBar` inside `TableInset`

```svelte example stackblitz code_above
<script>
  import {
    ColorBar,
    ColorScaleSelect,
    element_data,
    PeriodicTable,
    PropertySelect,
    TableInset,
  } from '$lib'

  let color_scale = $state(`Viridis`)
  let heatmap_key = $state(``)
  let heatmap_values = $derived(heatmap_key ? element_data.map((el) => el[heatmap_key]) : [])
  let heat_range = $derived(heatmap_key ? [Math.min(...heatmap_values), Math.max(...heatmap_values)] : [0,1])
</script>

<form>
  <ColorScaleSelect bind:value={color_scale} minSelect={1} />
  <PropertySelect bind:key={heatmap_key} />
</form>

<PeriodicTable
  {heatmap_values}
  style="margin: 2em auto 4em;"
  bind:color_scale
  color_scale_range={heat_range}
  links="name"
  lanth_act_tiles={false}
>
  {#snippet inset()}
  <TableInset  style="place-items: center; padding: 2em;">
    <ColorBar
      {color_scale}
      title={heatmap_key}
      range={heat_range}
      tick_labels={5}
      tick_align="primary"
      --cbar-width="calc(100% - 2em)"
      />
    </TableInset>
  {/snippet}
</PeriodicTable>

<style>
  form {
    display: flex;
    place-items: center;
    place-content: center;
    gap: 1em;
    margin: 2em auto;
  }
</style>
```

Example demonstrating `title_side` and `tick_align` interaction:

```svelte example stackblitz
<script>
  import { ColorBar } from '$lib'

  const title_sides = [`top`, `bottom`, `left`, `right`]
  const tick_sides = [`primary`, `secondary`, `inside`]
</script>

<section>
  {#each title_sides as title_side, l_idx}
    {#each tick_sides as tick_side, t_idx}
      {@const orientation =
        title_side === `top` || title_side === `bottom` ? `horizontal` : `vertical`}
      {@const bar_style = orientation === `horizontal` ? `width: 150px; height: 20px;` : `width: 20px; height: 150px;`}
      {@const num_ticks = l_idx + t_idx + 2}
      {@const current_range = [l_idx * 10, (l_idx + 1) * 10 + t_idx * 20]}
      <div>
        <code>title={title_side}<br />tick={tick_side}</code>
        <ColorBar
          {title_side}
          {tick_side}
          {orientation}
          style={bar_style}
          title="Label"
          tick_labels={num_ticks}
          range={current_range}
          --cbar-tick-overlap-offset="10px"
          --cbar-tick-label-color="{tick_side === `inside` ? `white` : `currentColor`}"
        />
      </div>
    {/each}
  {/each}
</section>

<style>
  section {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); /* Adjusted minmax */
    gap: 2.5em; /* Increased gap slightly */
    margin-top: 2em;
    align-items: center; /* Align items vertically */
    justify-items: center; /* Center items horizontally */
  }
  section > div {
    border: 1px solid #ccc;
    padding: 1em;
    display: flex;
    flex-direction: column;
    gap: 1em; /* Increased gap */
    align-items: center;
    min-height: 200px; /* Ensure consistent div height */
  }
  code {
    font-size: 0.8em;
    text-align: center;
  }
</style>
```

## Date/Time Ranges

You can format tick labels for date/time ranges by providing a D3 format string via the `tick_format` prop. The color bar accepts ranges as milliseconds since the epoch (standard JavaScript `Date.getTime()`).

```svelte example stackblitz
<script>
  import { ColorBar } from '$lib'

  // Example date range (e.g., start and end of 2024)
  const date_range = [
    new Date(2024, 0, 1).getTime(), // Jan 1, 2024
    new Date(2024, 11, 31).getTime(), // Dec 31, 2024
  ]
</script>

<div style="display: flex; column; gap: 2em; align-items: center;">
  <ColorBar
    title="Year 2024 (YYYY-MM-DD)"
    range={date_range}
    tick_format="%Y-%m-%d"
    tick_labels={2} />

  <ColorBar
    title="Year 2024 (Month Day)"
    range={date_range}
    style="width: 500px;"
    tick_format="%b %d"
    tick_labels={7} />

  <ColorBar
    title="Year 2024 (Vertical - Mmm DD, YY)"
    range={date_range}
    tick_format="%b %d, '%y"
    tick_labels={4}
    orientation="vertical"
    wrapper_style="height: 200px;" />
</div>
```

# Color Bar

Here's a `ColorBar` with tick labels, using the new `tick_side` prop:

```svelte example
<script>
  import { ColorBar } from 'matterviz'
</script>

{#each [
    // [color_scale, tick_side, tick_labels, range, label_text]
    [`Viridis`, `primary`, [0, 0.25, 0.5, 0.75, 1], [0, 1]],
    [`Magma`, `secondary`, 10, [100, 1631]],
    [`Cividis`, `primary`, 4, [-99.9812, -10]],
  ] as
  [color_scale, tick_side, tick_labels, range]
}
  <ColorBar
    title="color_scale={color_scale} &emsp; tick_side={tick_side} &emsp; range={range}"
    {color_scale}
    {tick_side}
    {tick_labels}
    {range}
    tick_format=".4"
    title_style="padding: 3pt;"
    --cbar-padding="3em"
  />
{/each}
```

You can make fat and skinny bars:

```svelte example
<script>
  import { ColorBar } from 'matterviz'

  const wrapper_style = 'margin: auto;'
</script>

<ColorBar {wrapper_style} bar_style="width: 10em; height: 8pt" />
<br />
<ColorBar
  title="Viridis"
  {wrapper_style}
  bar_style="width: 4em; height: 2em"
  tick_labels={2}
/>
<br />
<ColorBar {wrapper_style} --cbar-width="10em" --cbar-height="2em" tick_labels={3} />
<br />
```

`PeriodicTable.svelte` now automatically shows a `ColorBar` when `heatmap_values` is provided!

```svelte example code_above
<script>
  import { element_data } from 'matterviz/element'
  import { ColorScaleSelect } from 'matterviz/plot'
  import { PeriodicTable, PropertySelect } from 'matterviz/periodic-table'

  let color_scale = $state(`interpolateCividis`)
  let heatmap_key = $state(``)
  let heat_label = $state(``)
  let heatmap_values = $derived(
    heatmap_key ? element_data.map((el) => el[heatmap_key]) : [],
  )
</script>

<form>
  <ColorScaleSelect bind:value={color_scale} minSelect={1} selected={[color_scale]} />
  <PropertySelect bind:key={heatmap_key} bind:value={heat_label} />
</form>

<PeriodicTable
  {heatmap_values}
  style="margin: 2em auto 4em"
  bind:color_scale
  color_bar_props={{ title: heat_label }}
  links="name"
/>

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

For more control, you can also manually add a `ColorBar` inside a custom `TableInset` (which overrides the automatic color bar):

```svelte example
<script>
  import { element_data } from 'matterviz/element'
  import { ColorBar } from 'matterviz/plot'
  import { PeriodicTable, TableInset } from 'matterviz/periodic-table'

  const heatmap_values = element_data.map((el) => el.atomic_mass)
  const heat_range = [Math.min(...heatmap_values), Math.max(...heatmap_values)]
</script>

<PeriodicTable
  {heatmap_values}
  style="margin: 2em auto"
  color_scale="interpolateInferno"
  color_scale_range={heat_range}
>
  {#snippet inset()}
    <TableInset style="place-items: center; padding: 2em">
      <ColorBar
        color_scale="interpolateInferno"
        title="Atomic Mass (u)"
        range={heat_range}
        tick_labels={5}
        tick_side="primary"
        --cbar-width="calc(100% - 2em)"
      />
    </TableInset>
  {/snippet}
</PeriodicTable>
```

Example demonstrating `title_side` and `tick_side` interaction:

```svelte example
<script>
  import { ColorBar } from 'matterviz'

  const title_sides = [`top`, `bottom`, `left`, `right`]
  const tick_sides = [`primary`, `secondary`, `inside`]
</script>

<section>
  {#each title_sides as title_side, l_idx}
    {#each tick_sides as tick_side, t_idx}
      {@const orientation = title_side === `top` || title_side === `bottom`
      ? `horizontal`
      : `vertical`}
      {@const bar_style = orientation === `horizontal`
      ? `width: 150px; height: 20px;`
      : `width: 20px; height: 150px;`}
      {@const num_ticks = l_idx + t_idx + 2}
      {@const current_range = [l_idx * 10, (l_idx + 1) * 10 + t_idx * 20]}
      <div>
        <code>title={title_side}<br />tick={tick_side}</code>
        <ColorBar
          {title_side}
          {tick_side}
          {orientation}
          {bar_style}
          title="Label"
          tick_labels={num_ticks}
          range={current_range}
          --cbar-tick-overlap-offset="10px"
          --cbar-tick-label-color={tick_side === `inside` ? `white` : `currentColor`}
        />
      </div>
    {/each}
  {/each}
</section>

<style>
  section {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 2em;
    place-items: center;
  }
  section > div {
    padding: 1em;
    display: grid;
    gap: 1em;
    align-items: center;
    height: 200px;
  }
  code {
    font-size: 0.8em;
    text-align: center;
  }
</style>
```

## Date/Time Ranges

You can format tick labels for date/time ranges by providing a D3 format string via the `tick_format` prop. The color bar accepts ranges as milliseconds since the epoch (standard JavaScript `Date.getTime()`).

```svelte example
<script>
  import { ColorBar } from 'matterviz'

  // Example date range (e.g., start and end of 2024)
  const date_range = [
    new Date(2024, 0, 1).getTime(), // Jan 1, 2024
    new Date(2024, 11, 31).getTime(), // Dec 31, 2024
  ]
</script>

<div style="display: flex; column; gap: 2em; align-items: center;">
  <ColorBar
    title="YYYY-MM-DD"
    range={date_range}
    tick_format="%Y-%m-%d"
    bar_style="width: 200px; margin-left: 3em;"
    tick_labels={2}
  />

  <ColorBar
    title="Month Day"
    range={date_range}
    bar_style="width: 500px; margin-left: 3em;"
    tick_format="%b %d"
    tick_labels={7}
  />

  <ColorBar
    title="Vertical - Mmm DD, YY"
    range={date_range}
    tick_format="%b %d, '%y"
    tick_labels={4}
    orientation="vertical"
    bar_style="height: 200px;"
  />
</div>
```

## Large Value Ranges (Linear and Log)

Demonstrating the color bar with large numeric ranges, using both linear and logarithmic scales (`scale_type='log'`). Log scales require a positive range (both min and max > 0). Scientific notation is used for tick labels via `tick_format='.0e'`.

```svelte example
<script>
  import { ColorBar } from 'matterviz'
</script>

<div
  style="display: grid; grid-template-columns: 1fr 1fr; gap: 4em; place-items: center; margin: 2em 0"
>
  <ColorBar
    title="Large Linear Range (0 to 1e6)"
    range={[0, 1e6]}
    tick_labels={5}
    tick_format=".1s"
  />

  <ColorBar
    title="Large Log Range (1 to 1e9)"
    range={[1, 1e9]}
    scale_type="log"
    bar_style="width: 400px"
    tick_labels={10}
  />

  <ColorBar
    title="Vertical Log Range (10 to 1e7)"
    range={[10, 1e7]}
    scale_type="log"
    orientation="vertical"
  />

  <ColorBar
    title="Vertical Linear Range<br>(10 to 1e7) with line breaks"
    title_style="margin: 1em;"
    range={[10, 1e7]}
    orientation="vertical"
  />

  <ColorBar
    title="Small Log Range (0.01 to 100)"
    range={[0.01, 100]}
    scale_type="log"
    tick_format=".3"
    bar_style="width: 400px"
    tick_labels={5}
  />
</div>
```

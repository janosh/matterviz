`ColorBar.svelte`

Here's a `ColorBar` with tick labels, using the new `tick_align` prop:

```svelte example stackblitz
<script>
  import { ColorBar } from '$lib'

  const bars = [
    // [color_scale, tick_align, tick_labels, range, label_text]
    [`Viridis`, `primary`, [0, 0.25, 0.5, 0.75, 1], [0, 1], `bottom/right (primary)`],
    [`Magma`, `secondary`, [], [100, 1631], `top/left (secondary)`],
    [`Cividis`, `primary`, [], [-99.9812, -10], `bottom/right (primary)`],
  ]
</script>

<div style="border: 0.1px dashed white;">
  {#each bars as [color_scale, tick_align, tick_labels, range, align_desc]}
    <ColorBar
      label="{color_scale}<br>&bull; tick align={align_desc}<br>&bull; range={range}"
      {color_scale}
      {tick_align}
      {tick_labels}
      {range}
      label_style="white-space: nowrap; padding-right: 1em;"
      --cbar-width="100%"
      --cbar-padding="2em"
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
<ColorBar label="Viridis" {wrapper_style} style="width: 3em; height: 2em;" />
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
      label={heatmap_key}
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

Example demonstrating `label_side` and `tick_align` interaction:

```svelte example stackblitz
<script>
  import { ColorBar } from '$lib'

  const label_sides = [`top`, `bottom`, `left`, `right`]
  const tick_sides = [`primary`, `secondary`, `inside`]
</script>

<section>
  {#each label_sides as label_side, l_idx}
    {#each tick_sides as tick_side, t_idx}
      {@const orientation =
        label_side === `top` || label_side === `bottom` ? `horizontal` : `vertical`}
      {@const bar_style = orientation === `horizontal` ? `width: 150px; height: 20px;` : `width: 20px; height: 150px;`}
      {@const num_ticks = l_idx + t_idx + 2}
      {@const current_range = [l_idx * 10, (l_idx + 1) * 10 + t_idx * 20]}
      <div>
        <code>label={label_side}<br />tick={tick_side}</code>
        <ColorBar
          {label_side}
          {tick_side}
          {orientation}
          style={bar_style}
          label="Label"
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

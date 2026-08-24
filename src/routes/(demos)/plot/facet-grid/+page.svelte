<script lang="ts">
  import {
    BarPlot,
    BinnedScatterPlot,
    BoxPlot,
    FacetGrid,
    Histogram,
    ScatterPlot,
  } from 'matterviz'
  import type { Component } from 'svelte'

  const strain_values = [-6, -4, -2, 0, 2, 4, 6]
  const method_configs = [
    { label: `PBE`, color: `#4c6ef5`, phase: 0 },
    { label: `r2SCAN`, color: `#f59f00`, phase: 0.7 },
  ]
  const panel_specs = [
    { key: `silicon`, title: `Silicon`, offset: 0.01, curvature: 0.0018 },
    { key: `gallium-arsenide`, title: `Gallium arsenide`, offset: 0.04, curvature: 0.0025 },
    { key: `magnesium-oxide`, title: `Magnesium oxide`, offset: 0.08, curvature: 0.0032 },
    { key: `lithium-fluoride`, title: `Lithium fluoride`, offset: 0.12, curvature: 0.004 },
  ]
  type FacetPlot = Component<Record<string, unknown>>
  const plot_config = (component: unknown, props: Record<string, unknown>) => ({
    component: component as FacetPlot,
    props,
  })
  const strain_axis = { label: `Isotropic strain (%)`, format: `.0f` }
  const energy_axis = { label: `Relative energy (eV/atom)` }
  const standard_props = { legend: null, show_controls: false }
  const plot_configs = {
    scatter: plot_config(ScatterPlot, {
      x_axis: strain_axis,
      y_axis: energy_axis,
      range_padding: 0.04,
      legend: null,
      show_controls: false,
      point_tween: { duration: 0 },
      line_tween: { duration: 0 },
    }),
    bar: plot_config(BarPlot, { x_axis: strain_axis, y_axis: energy_axis, ...standard_props }),
    box: plot_config(BoxPlot, {
      x_axis: { label: `Method` },
      y_axis: energy_axis,
      ...standard_props,
    }),
    histogram: plot_config(Histogram, {
      x_axis: energy_axis,
      y_axis: { label: `Count` },
      ...standard_props,
    }),
    binned: plot_config(BinnedScatterPlot, {
      x_axis: strain_axis,
      y_axis: energy_axis,
      color_bar: null,
    }),
  }

  let point_radius = $state(4)
  // below this width two side-by-side panels leave no room for axis titles; stack them
  // and move the shared legend from its side band to below the grid
  let demo_width = $state(1000)
  const columns = $derived(demo_width < 640 ? 1 : 2)
  let plot_type = $state<keyof typeof plot_configs>(`scatter`)
  let panels = $derived(
    panel_specs.map(({ key, title, offset, curvature }, panel_idx) => ({
      key,
      data: {
        title,
        series: method_configs.map(({ label, color, phase }, method_idx) => ({
          x: strain_values,
          y: strain_values.map(
            (strain) =>
              offset +
              curvature * strain ** 2 +
              method_idx * 0.018 +
              0.006 * Math.sin(strain * 0.8 + phase + panel_idx),
          ),
          label,
          color,
          markers: `line+points` as const,
          line_style: { stroke: color, stroke_width: 2 },
          point_style: {
            fill: color,
            radius: point_radius,
            stroke: `white`,
            stroke_width: 0.7,
          },
        })),
      },
    })),
  )
</script>

<svelte:head>
  <title>Facet Grid Plot Demo</title>
</svelte:head>

<h1>Facet Grid</h1>
<p>
  <code>FacetGrid</code> coordinates Cartesian child plots without hiding their APIs. Each plot
  reports intrinsic ranges and padding through <code>facet_layout</code>; the grid reconciles
  them, renders only outer axes, and propagates pan, zoom, and reset updates across shared axis
  groups.
</p>

<div class="demo-controls">
  <label
    >Plot type
    <select bind:value={plot_type}>
      <option value="scatter">Scatter</option>
      <option value="bar">Bar</option>
      <option value="box">Box</option>
      <option value="histogram">Histogram</option>
      <option value="binned">Binned scatter</option>
    </select>
  </label>
  {#if plot_type === `scatter`}
    <label
      >Point radius: {point_radius}px
      <input type="range" bind:value={point_radius} min="2" max="8" step="0.5" /></label
    >
  {/if}
</div>

{#snippet shared_legend()}
  <div class={[`shared-legend`, { below: columns === 1 }]} aria-label="Shared method legend">
    <strong>Method</strong>
    {#each method_configs as { label, color } (label)}
      <span><i style:background={color}></i>{label}</span>
    {/each}
    <small style="opacity: 0.7"
      >Drag to zoom; focus and Shift+wheel to pan; double-click to reset all linked panels.</small
    >
  </div>
{/snippet}

<div
  data-testid="facet-grid-demo"
  style:height="{columns === 1 ? 1100 : 720}px"
  style="min-width: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 1em"
  bind:clientWidth={demo_width}
>
  <FacetGrid
    {panels}
    {columns}
    gap={8}
    axis_modes={{ x: `shared`, y: `shared` }}
    axis_visibility={{ x: `outer`, x2: `none`, y: `outer`, y2: `none` }}
    shared_bands={{ title_height: 62, legend_width: 126, gap: 10 }}
    legend={columns === 1 ? undefined : shared_legend}
  >
    {#snippet title()}
      <div class="shared-title">
        <strong style="font-size: 1.15em">Equation-of-state comparison · {plot_type}</strong>
        <span style="opacity: 0.7"
          >Shared x/y ranges, padding, and linked zoom across four materials</span
        >
      </div>
    {/snippet}
    {#snippet children(context)}
      {@const Plot = plot_configs[plot_type].component}
      <div class="facet-panel">
        <strong style="text-align: center">{context.data.title}</strong>
        <Plot
          series={context.data.series}
          facet_layout={context}
          fullscreen_toggle={false}
          style="height: 100%; min-height: 0"
          {...plot_configs[plot_type].props}
        />
      </div>
    {/snippet}
  </FacetGrid>
  {#if columns === 1}
    {@render shared_legend()}
  {/if}
</div>

<style>
  .shared-title {
    display: grid;
    place-content: center;
    height: 100%;
    text-align: center;
  }
  .shared-legend {
    display: grid;
    align-content: center;
    gap: 0.7em;
    height: 100%;
    padding-inline: 0.3em;
  }
  .shared-legend.below {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5em 1.5em;
  }
  .shared-legend span {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }
  .shared-legend i {
    inline-size: 1.4em;
    block-size: 3px;
    border-radius: 2px;
  }
  .facet-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
</style>

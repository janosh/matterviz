<script lang="ts">
  import { FacetGrid, ScatterPlot } from 'matterviz'

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

  let point_radius = $state(4)
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
  <code>FacetGrid</code> coordinates child plots without hiding their APIs. Each
  <code>ScatterPlot</code>
  reports intrinsic ranges and padding through <code>facet_layout</code>; the grid reconciles
  them, renders only outer axes, and propagates pan, zoom, and reset updates across the shared
  axis groups.
</p>

<label class="point-size"
  >Point radius: {point_radius}px
  <input type="range" bind:value={point_radius} min="2" max="8" step="0.5" /></label
>

<div data-testid="facet-grid-demo" style="height: 720px; min-width: 0">
  <FacetGrid
    {panels}
    columns={2}
    rows={2}
    gap={8}
    axis_modes={{ x: `shared`, y: `shared` }}
    axis_visibility={{ x: `outer`, x2: `none`, y: `outer`, y2: `none` }}
    shared_bands={{ title_height: 62, legend_width: 126, gap: 10 }}
  >
    {#snippet title()}
      <div class="shared-title">
        <strong style="font-size: 1.15em">Equation-of-state comparison</strong>
        <span style="opacity: 0.7"
          >Shared x/y ranges, padding, and linked zoom across four materials</span
        >
      </div>
    {/snippet}
    {#snippet legend()}
      <div class="shared-legend" aria-label="Shared method legend">
        <strong>Method</strong>
        {#each method_configs as { label, color } (label)}
          <span><i style:background={color}></i>{label}</span>
        {/each}
        <small style="opacity: 0.7"
          >Wheel or drag in any panel; double-click to reset all linked panels.</small
        >
      </div>
    {/snippet}
    {#snippet children(context)}
      <div class="facet-panel">
        <strong style="text-align: center">{context.data.title}</strong>
        <ScatterPlot
          series={context.data.series}
          facet_layout={context}
          x_axis={{ label: `Isotropic strain (%)`, format: `.0f` }}
          y_axis={{ label: `Relative energy after full electronic relaxation (eV/atom)` }}
          range_padding={0.04}
          legend={null}
          controls={{ show: false }}
          fullscreen_toggle={false}
          point_tween={{ duration: 0 }}
          line_tween={{ duration: 0 }}
          style="height: 100%; min-height: 0"
        />
      </div>
    {/snippet}
  </FacetGrid>
</div>

<style>
  .point-size {
    display: flex;
    align-items: center;
    gap: 0.6em;
    margin-block: 1em;
  }
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
  .shared-legend span {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }
  .shared-legend i {
    width: 1.4em;
    height: 3px;
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

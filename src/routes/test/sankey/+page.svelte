<script lang="ts">
  import type { SankeyData } from '#lib/plot/index.js'
  import { Sankey } from '#lib/plot/index.js'

  // Three-layer flow: sources -> hubs -> sinks
  const flow: SankeyData = {
    nodes: [
      { label: `Coal` },
      { label: `Gas` },
      { label: `Solar` },
      { label: `Grid` },
      { label: `Homes` },
      { label: `Industry` },
    ],
    links: [
      { source: `Coal`, target: `Grid`, value: 20 },
      { source: `Gas`, target: `Grid`, value: 15 },
      { source: `Solar`, target: `Grid`, value: 10 },
      { source: `Grid`, target: `Homes`, value: 25 },
      { source: `Grid`, target: `Industry`, value: 20 },
    ],
  }

  let hover_msg = $state(`Hover over a node`)
</script>

<svelte:head>
  <title>Sankey Test Page</title>
</svelte:head>

<h1 id="sankey-component-playwright-tests">Sankey Component Playwright Tests</h1>

<section id="basic-sankey">
  <h2 id="basic-horizontal">Basic (horizontal)</h2>
  <Sankey data={flow} style="height: 360px" />
</section>

<section id="vertical-sankey">
  <h2 id="vertical">Vertical</h2>
  <Sankey
    data={flow}
    orientation="vertical"
    controls_toggle_props={{ class: `sankey-controls-toggle` }}
    style="height: 420px"
  />
</section>

<section id="gradient-sankey">
  <h2 id="gradient-links-legend">Gradient links + legend</h2>
  <Sankey data={flow} link_color_mode="gradient" show_legend style="height: 360px" />
</section>

<section id="handlers-sankey">
  <h2 id="with-handlers">With handlers</h2>
  <Sankey
    data={flow}
    on_node_hover={(data) =>
      (hover_msg = data ? `Node: ${data.label} = ${data.value}` : `Hover over a node`)}
    style="height: 360px"
  />
  <p class="handler-info">{hover_msg}</p>
</section>

<style>
  section {
    margin-block: 2em;
  }
</style>

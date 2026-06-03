<script lang="ts">
  import type { SankeyData } from '$lib/plot'
  import { Sankey, sankey_from_links } from '$lib/plot'

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

  // Bipartite (matbench spacegroup-style) data via the flat-array helper
  const bipartite = sankey_from_links(
    [0, 1, 2, 0, 1],
    [3, 3, 4, 4, 4],
    [120, 80, 60, 30, 20],
    [`P1`, `P2/m`, `Fm-3m`, `Pnma`, `R-3m`],
  )

  let hover_msg = $state(`Hover over a node or link`)
  let click_msg = $state(`Click a node`)
</script>

<svelte:head>
  <title>Sankey Test Page</title>
</svelte:head>

<h1>Sankey Component Playwright Tests</h1>

<section id="basic-sankey">
  <h2>Basic (horizontal)</h2>
  <Sankey
    data={flow}
    controls_open={false}
    controls_toggle_props={{ class: `sankey-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="vertical-sankey">
  <h2>Vertical</h2>
  <Sankey
    data={flow}
    orientation="vertical"
    controls_toggle_props={{ class: `sankey-controls-toggle` }}
    style="height: 420px"
  />
</section>

<section id="gradient-sankey">
  <h2>Gradient links + legend</h2>
  <Sankey
    data={flow}
    link_color_mode="gradient"
    show_legend
    controls_toggle_props={{ class: `sankey-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="bipartite-sankey">
  <h2>Bipartite (from flat arrays)</h2>
  <Sankey
    data={bipartite}
    node_align="left"
    controls_toggle_props={{ class: `sankey-controls-toggle` }}
    style="height: 360px"
  />
</section>

<section id="handlers-sankey">
  <h2>With handlers</h2>
  <Sankey
    data={flow}
    on_node_hover={(data) => {
      hover_msg = data ? `Node: ${data.label} = ${data.value}` : `Hover over a node or link`
    }}
    on_link_hover={(data) => {
      if (data) hover_msg = `Link: ${data.source_label} -> ${data.target_label} = ${data.value}`
    }}
    on_node_click={(data) => {
      click_msg = `Clicked node: ${data.label}`
    }}
    controls_toggle_props={{ class: `sankey-controls-toggle` }}
    style="height: 360px"
  />
  <div class="handler-info">
    <p>{hover_msg}</p>
    <p>{click_msg}</p>
  </div>
</section>

<style>
  section {
    margin-block: 2em;
  }
</style>

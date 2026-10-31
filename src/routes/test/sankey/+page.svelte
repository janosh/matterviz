<script lang="ts">
  import type { SankeyData } from '#lib/plot/index.js'
  import { Sankey } from '#lib/plot/index.js'
  import TestSection from '../TestSection.svelte'
  import TestStatus from '../TestStatus.svelte'

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

<h1>Sankey test page</h1>

<TestSection title="With handlers" id="handlers-sankey">
  <Sankey
    data={flow}
    on_node_hover={(data) =>
      (hover_msg = data ? `Node: ${data.label} = ${data.value}` : `Hover over a node`)}
    style="height: 360px"
  />
  <div class="handler-info"><TestStatus values={{ 'sankey-hover': hover_msg }} /></div>
</TestSection>

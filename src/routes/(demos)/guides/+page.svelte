<script lang="ts">
  import SubpageGrid from 'svelte-widgets/SubpageGrid.svelte'
  import { Code, Globe, Heart } from 'svelte-widgets/icons'
  import { to_subpages } from '#site/overview'

  // oxfmt-ignore
  const subpages = to_subpages([
    [`/how-to/use-without-svelte`, `Use Without Svelte`, Code, `Embed MatterViz in React, Vue, and plain HTML with custom elements.`],
    [`/how-to/hook-up-to-external-api`, `Connect to External APIs`, Globe, `Fetch and visualize crystal structures from materials databases using OPTIMADE.`],
    [`/acknowledgements`, `Acknowledgements`, Heart, `The open-source projects, data sources, and contributors behind MatterViz.`],
  ])
</script>

<SubpageGrid
  title="Guides"
  subtitle="Integrate MatterViz into your projects and connect it to your data."
  {subpages}
/>

<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { SubpageGrid } from 'svelte-widgets'
  import { Code, Globe, Heart } from 'svelte-widgets/icons'

  const subpages: ComponentProps<typeof SubpageGrid>[`subpages`] = [
    [
      `Use Without Svelte`,
      `/how-to/use-without-svelte`,
      `Embed MatterViz in React, Vue, and plain HTML with custom elements.`,
      Code,
    ],
    [
      `Connect to External APIs`,
      `/how-to/hook-up-to-external-api`,
      `Fetch and visualize crystal structures from materials databases using OPTIMADE.`,
      Globe,
    ],
    [
      `Acknowledgements`,
      `/acknowledgements`,
      `The open-source projects, data sources, and contributors behind MatterViz.`,
      Heart,
    ],
  ]
</script>

<SubpageGrid
  title="Guides"
  subtitle="Integrate MatterViz into your projects and connect it to your data."
  {subpages}
/>

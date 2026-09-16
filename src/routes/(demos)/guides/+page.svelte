<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { SubpageGrid } from 'svelte-widgets'
  import { Code, Globe, Heart } from 'svelte-widgets/icons'

  const subpages: ComponentProps<typeof SubpageGrid>[`subpages`] = [
    {
      label: `Use Without Svelte`,
      href: `/how-to/use-without-svelte`,
      description: `Embed MatterViz in React, Vue, and plain HTML with custom elements.`,
      icon: Code,
    },
    {
      label: `Connect to External APIs`,
      href: `/how-to/hook-up-to-external-api`,
      description: `Fetch and visualize crystal structures from materials databases using OPTIMADE.`,
      icon: Globe,
    },
    {
      label: `Acknowledgements`,
      href: `/acknowledgements`,
      description: `The open-source projects, data sources, and contributors behind MatterViz.`,
      icon: Heart,
    },
  ]
</script>

<SubpageGrid
  title="Guides"
  subtitle="Integrate MatterViz into your projects and connect it to your data."
  {subpages}
/>

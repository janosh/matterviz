<script lang="ts">
  import { API, Code } from 'svelte-widgets/icons'
  import SubpageGrid from '$site/SubpageGrid.svelte'

  const subpages = [
    {
      href: `/how-to/hook-up-to-external-api`,
      title: `Hook up to External API`,
      description: `Fetch phase diagram data from the Materials Project API and render interactive convex hulls.`,
      icon: API,
    },
    {
      href: `/how-to/use-without-svelte`,
      title: `Use without Svelte`,
      description: `Embed matterviz components in vanilla JS, React, Vue, or any framework via web components.`,
      icon: Code,
    },
  ]
</script>

<SubpageGrid
  title="How-To Guides"
  subtitle="Practical recipes for common integration patterns."
  {subpages}
/>

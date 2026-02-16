<script lang="ts">
  import type { IconName } from '$lib/icons'
  import { SubpageGrid } from '$lib/layout'

  const subpages: {
    href: string
    title: string
    description: string
    icon: IconName
  }[] = [
    {
      href: `/how-to/hook-up-to-external-api`,
      title: `Hook up to External API`,
      description:
        `Fetch phase diagram data from the Materials Project API and render interactive convex hulls.`,
      icon: `API`,
    },
    {
      href: `/how-to/use-without-svelte`,
      title: `Use without Svelte`,
      description:
        `Embed matterviz components in vanilla JS, React, Vue, or any framework via web components.`,
      icon: `Code`,
    },
  ]
</script>

<SubpageGrid
  title="How-To Guides"
  subtitle="Practical recipes for common integration patterns."
  {subpages}
/>

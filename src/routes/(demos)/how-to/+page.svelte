<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { API, Code } from 'svelte-widgets/icons'
  import { SubpageGrid } from 'svelte-widgets'

  const subpages: ComponentProps<typeof SubpageGrid>[`subpages`] = [
    [
      `Hook up to External API`,
      `/how-to/hook-up-to-external-api`,
      `Fetch phase diagram data from the Materials Project API and render interactive convex hulls.`,
      API,
    ],
    [
      `Use without Svelte`,
      `/how-to/use-without-svelte`,
      `Embed matterviz components in vanilla JS, React, Vue, or any framework via web components.`,
      Code,
    ],
  ]
</script>

<SubpageGrid
  title="How-To Guides"
  subtitle="Practical recipes for common integration patterns."
  {subpages}
/>

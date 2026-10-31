<script lang="ts">
  import { page } from '$app/state'
  import type { Snippet } from 'svelte'

  let { children }: { children?: Snippet<[]> } = $props()

  const slug = $derived(page.url.pathname.split(`/`).findLast(Boolean))
</script>

<svelte:head>
  <title>{slug === `test` ? `E2E test pages` : `${slug} test`} · MatterViz</title>
</svelte:head>

<!-- No wrapper element: the root layout's heading-anchor selector matches headings at
     most one level below <main>, so an extra div here would silently drop the anchors -->
{@render children?.()}

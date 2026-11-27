<script lang="ts">
  // oxlint-disable-next-line import/no-unassigned-import -- styles shared by all demo pages
  import './demo.css'
  import { page } from '$app/state'
  import { page_components } from '#site/state.svelte'
  import type { Snippet } from 'svelte'
  import PropsTable from 'svelte-widgets/PropsTable.svelte'
  import loaders from 'virtual:prop-docs'

  let { children }: { children?: Snippet<[]> } = $props()
  let names = $derived(page_components(page.route.id ?? ``))
</script>

<!-- No wrapper element: the root layout's heading-anchor selector matches headings at
     most one level below <main>, so an extra div here would silently drop the anchors -->
{@render children?.()}
<!-- page-wide (up to 1400px) like the demos, so long types and descriptions wrap in their
columns; the wrapper scrolls on screens too narrow for the table's minimum -->
{#each names as name (name)}
  <PropsTable {name} {loaders} scroll_props={{ class: `bleed-1400` }} />
{/each}

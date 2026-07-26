<script lang="ts">
  // oxlint-disable-next-line import/no-unassigned-import -- styles shared by all demo pages
  import './demo.css'
  import type { Snippet } from 'svelte'

  let { children }: { children?: Snippet<[]> } = $props()
</script>

<!-- No wrapper element: the root layout's heading-anchor selector matches headings at
     most one level below <main>, so an extra div here would silently drop the anchors -->
{@render children?.()}

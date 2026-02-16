<script lang="ts">
  // Scene wrapper that enables Threlte pointer events for hover tooltips.
  // Must be rendered inside <Canvas>, mirroring ScatterPlot3DScene / StructureScene pattern.
  import { interactivity } from '@threlte/extras'
  import type { Snippet } from 'svelte'

  let { children }: { children?: Snippet } = $props()
  interactivity()
</script>

{@render children?.()}

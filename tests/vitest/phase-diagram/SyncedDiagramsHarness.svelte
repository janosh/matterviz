<script lang="ts">
  import { IsobaricBinaryPhaseDiagram } from '#lib/phase-diagram/index.js'
  import type { BinaryPhaseDiagram, DiagramCursor } from '#lib/phase-diagram/types.js'

  // Two diagrams bound to one cursor; the first can be unmounted mid-hover
  let { diagrams }: { diagrams: [BinaryPhaseDiagram, BinaryPhaseDiagram] } = $props()
  let cursor = $state<DiagramCursor | null>(null)
  let show_first = $state(true)
</script>

<button type="button" data-testid="hide-first" onclick={() => (show_first = false)}>
  Hide first
</button>
<span data-testid="cursor"
  >{cursor ? `${cursor.composition},${cursor.temperature}` : `none`}</span
>
{#if show_first}
  <IsobaricBinaryPhaseDiagram
    data={diagrams[0]}
    bind:cursor
    class="first"
    style="width: 500px; height: 400px"
  />
{/if}
<IsobaricBinaryPhaseDiagram
  data={diagrams[1]}
  bind:cursor
  class="second"
  style="width: 500px; height: 400px"
/>

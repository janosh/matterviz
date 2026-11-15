<script lang="ts">
  import { IsobaricBinaryPhaseDiagram } from '#lib/phase-diagram/index.js'
  import type { BinaryPhaseDiagram, DiagramRegion } from '#lib/phase-diagram/types.js'

  let { loaded_data }: { loaded_data: BinaryPhaseDiagram } = $props()
  let data = $state.raw<BinaryPhaseDiagram | undefined>()
  let hovered_region = $state.raw<DiagramRegion | null>(null)
</script>

<button type="button" data-testid="load-phase-data" onclick={() => (data = loaded_data)}>
  Load Data
</button>
<button type="button" data-testid="clear-phase-data" onclick={() => (data = undefined)}>
  Clear Data
</button>
<span data-testid="hovered-region">{hovered_region?.phases.join(`+`) ?? `none`}</span>
<IsobaricBinaryPhaseDiagram
  {data}
  bind:hovered_region
  editor_open
  export_formats={[]}
  fullscreen_toggle={false}
  show_controls={{ hidden: [`controls`] }}
>
  <!-- destructured sized snippet: svelte-check fails here if the wrapper div's own plain
  children type leaks back into the prop -->
  {#snippet children({ width, height, fullscreen })}
    <span data-testid="children-size">{width}x{height} {fullscreen}</span>
  {/snippet}
</IsobaricBinaryPhaseDiagram>

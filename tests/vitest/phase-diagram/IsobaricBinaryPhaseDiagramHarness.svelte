<script lang="ts">
  import { IsobaricBinaryPhaseDiagram } from '$lib/phase-diagram'
  import type { PhaseDiagramData, PhaseRegion } from '$lib/phase-diagram/types'

  let { loaded_data }: { loaded_data: PhaseDiagramData } = $props()
  let data = $state.raw<PhaseDiagramData | undefined>()
  let hovered_region = $state.raw<PhaseRegion | null>(null)
</script>

<button type="button" data-testid="load-phase-data" onclick={() => (data = loaded_data)}>
  Load Data
</button>
<button type="button" data-testid="clear-phase-data" onclick={() => (data = undefined)}>
  Clear Data
</button>
<span data-testid="hovered-region">{hovered_region?.id ?? `none`}</span>
<IsobaricBinaryPhaseDiagram
  {data}
  bind:hovered_region
  editor_open
  enable_export={false}
  fullscreen_toggle={false}
  show_controls={false}
/>

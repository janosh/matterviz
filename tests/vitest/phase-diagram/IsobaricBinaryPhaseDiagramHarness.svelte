<script lang="ts">
  import { IsobaricBinaryPhaseDiagram } from '$lib/phase-diagram'
  import type { PhaseDiagramData } from '$lib/phase-diagram/types'

  let { loaded_data }: { loaded_data: PhaseDiagramData } = $props()
  let data = $state<PhaseDiagramData | undefined>()
  // Deliberately violate the required prop at runtime to exercise temporary missing data.
  const runtime_data = $derived(data as PhaseDiagramData)
</script>

<button type="button" data-testid="load-phase-data" onclick={() => (data = loaded_data)}>
  Load Data
</button>
<button type="button" data-testid="clear-phase-data" onclick={() => (data = undefined)}>
  Clear Data
</button>
<IsobaricBinaryPhaseDiagram data={runtime_data} show_controls={false} />

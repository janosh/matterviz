<script lang="ts">
  import { RdfPlot } from '$lib'
  import type { RdfPattern } from '$lib/rdf'

  let { pattern }: { pattern: RdfPattern } = $props()
  let x_label = $state(`Initial r`)
</script>

<button class="change-rdf-axis" onclick={() => (x_label = `Updated r`)}>
  Update RDF axis
</button>
<RdfPlot
  patterns={{ label: `Test`, pattern }}
  x_axis={{ label: x_label }}
  style="width: 400px; height: 300px;"
/>

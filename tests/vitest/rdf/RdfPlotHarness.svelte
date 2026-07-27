<script lang="ts">
  import { PdfPlot, RdfPlot } from '$lib'
  import type { RdfPattern } from '$lib/rdf'
  import type { Crystal } from '$lib/structure'

  let { pattern, pdf_structure }: { pattern: RdfPattern; pdf_structure?: Crystal } = $props()
  let x_label = $state(`Initial r`)
  // mirrors PdfPlot's bindable error_msg back out so a test can see it reach the parent
  let pdf_error = $state<string | undefined>()
</script>

<button class="change-rdf-axis" onclick={() => (x_label = `Updated r`)}>
  Update RDF axis
</button>
<RdfPlot
  patterns={{ label: `Test`, pattern }}
  x_axis={{ label: x_label }}
  style="width: 400px; height: 300px;"
/>
{#if pdf_structure}
  <PdfPlot
    structures={pdf_structure}
    radiation="neutron"
    cutoff={6}
    n_bins={200}
    bind:error_msg={pdf_error}
  />
  <p class="pdf-error-mirror">{pdf_error ?? `none`}</p>
{/if}

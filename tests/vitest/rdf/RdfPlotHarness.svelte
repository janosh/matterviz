<script lang="ts">
  import { PdfPlot, RdfPlot } from '#lib'
  import type { RdfPattern } from '#lib/rdf/index.js'
  import type { Crystal } from '#lib/structure/index.js'

  let {
    pattern,
    pdf_structure,
    structures: init_structures,
    rdf_error: init_rdf_error,
    pdf_error: init_pdf_error,
  }: {
    pattern: RdfPattern
    pdf_structure?: Crystal | Record<string, Crystal>
    structures?: { good: Crystal; broken?: Crystal }
    rdf_error?: string
    pdf_error?: string
  } = $props()
  let structures = $derived(init_structures)
  let x_label = $state(`Initial r`)
  let cutoff = $state(8)
  // mirrors RdfPlot's bindable error_msg, seeded with a parent message when given
  let rdf_error = $derived(init_rdf_error)
  // mirrors PdfPlot's bindable error_msg back out so a test can see it reach the parent
  let pdf_error = $derived(init_pdf_error)
</script>

<button class="change-rdf-axis" onclick={() => (x_label = `Updated r`)}>
  Update RDF axis
</button>
<button class="drop-broken" onclick={() => (structures &&= { good: structures.good })}>
  Keep only the good structure
</button>
<button class="restore-structures" onclick={() => (structures = init_structures)}>
  Restore the initial structures
</button>
<button class="change-cutoff" onclick={() => (cutoff = 6)}>Change cutoff</button>
<RdfPlot
  patterns={{ label: `Test`, pattern }}
  {structures}
  {cutoff}
  x_axis={{ label: x_label }}
  bind:error_msg={rdf_error}
  style="width: 400px; height: 300px;"
/>
<p class="rdf-error-mirror">{rdf_error ?? `none`}</p>
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

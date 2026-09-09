<script lang="ts">
  import { Structure, make_site, structure_host_tool, type Crystal } from '$lib/structure'
  import {
    calc_lattice_params,
    create_frac_to_cart,
    type Matrix3x3,
    type Vec3,
  } from '$lib/math'
  import { onMount } from 'svelte'
  import DemoHostTool from './DemoHostTool.svelte'

  const matrix: Matrix3x3 = [
    [0, 1.805, 1.805],
    [1.805, 0, 1.805],
    [1.805, 1.805, 0],
  ]
  const to_cart = create_frac_to_cart(matrix)
  const positions: Vec3[] = [
    [0.13, 0.27, 0.41],
    [0.63, 0.77, 0.91],
  ]
  const structure: Crystal = {
    lattice: { matrix, pbc: [true, true, true], ...calc_lattice_params(matrix) },
    sites: positions.map((abc) => make_site(`Cu`, abc, to_cart(abc), `Cu`)),
  }
  let ready = $state(false)
  onMount(() => {
    const previous = structure_host_tool.component
    structure_host_tool.component = DemoHostTool
    ready = true
    return () => {
      structure_host_tool.component = previous
    }
  })
</script>

<svelte:head><title>Host prediction tools | MatterViz</title></svelte:head>
<h1>Host prediction tools</h1>
<p>
  This runnable example adds deterministic charges, dipole arrows, density and a six-frame
  trajectory to an unchanged input crystal in a Web Worker. Set a delay to try cancelling or
  restarting work, or enable failure to verify that the previous result remains available. No
  model download or server is needed.
</p>
{#if ready}
  <Structure
    {structure}
    show_controls="always"
    scene_props={{ camera_position: [7, 5, 6], camera_target: [1.5, 1.5, 1.5] }}
    style="height: 650px"
  />
{/if}
<h2>Integrate a host tool</h2>
<p>
  Import <code>structure_host_tool</code> and <code>StructureToolProps</code> from
  <code>matterviz/structure</code>
  (also exported from <code>matterviz</code>). Register your Svelte component before mounting
  viewers, and restore the registration when your host unmounts.
</p>
<pre><code
    >{`const run = start_run({
  model: 'my-model', version: '1.0',
  units: { charge: 'e', density: 'e/A^3' },
  settings: { seed: 0 },
})
const result = await predict(run.structure, { signal: run.signal })
run.on_overlay({
  result: { schema: 'my-model-result-v1', energy: result.energy },
  site_properties: result.site_properties,
  volumes: result.volumes, // each field needs a stable, unique id
  color_property: 'charge',
})`}</code
  ></pre>
<p>
  Each run receives a snapshot of its input; treat it as read-only. Each new run aborts the
  previous run. Its callbacks cannot change or clear newer results, and input changes or viewer
  unmounting invalidate it. Use <code>run.cancel()</code> to abort and clear,
  <code>run.clear()</code>
  to clear its outputs, and <code>run.on_view(null)</code> to return from a host view. Supply
  <code>show_host_tool: false</code> to nested structure viewers.
</p>
<p>
  Publish complete JSON-safe calculation data in <code>result</code> with a host-defined
  schema. The <code>prediction</code> prop includes imported results.
  <code>set_overlay_visible(false)</code> hides visuals while retaining results and surface
  settings;
  <code>run.on_overlay(null)</code> deletes the result.
</p>
<p>
  Set <code>structure_host_tool.input_key</code> to select calculation inputs, including atom order.
  Unrelated annotations can then change without cancelling runs; replacing the document always cancels.
</p>
<p>
  Use the export pane to download the prediction JSON, including the captured input,
  properties, density grids and provenance, or export the original structure in the usual
  formats. Reuse a field ID only while its physical quantity, units and normalization stay
  compatible; change the ID when those semantics change. Labels, order and grid resolution can
  change without losing surface appearance, including extra or deliberately removed layers. <strong
    >Reset prediction surfaces</strong
  > restores defaults. Hidden-density notices offer direct cell and supercell recovery actions.
</p>

<p>
  Prediction metadata must contain plain JSON objects, arrays, strings, booleans, finite
  numbers or null. Undefined object fields are omitted. Convert Maps, Sets, Dates and typed
  arrays explicitly; unsupported values report their field path. Density values use
  Float64Array, are copied on publication, and must not be written concurrently while copying
  shared storage. Grid geometry is validated and cached statistics are recomputed.
</p>
<p>
  Drop an exported prediction JSON onto any Structure viewer to reopen its input, properties,
  density and provenance. Hosts can also import <code>prediction_from_json</code> from
  <code>matterviz/structure</code> and pass its result as the viewer's <code>prediction</code>
  prop. Import accepts version 1 only and restores the original cell and 1×1×1 scaling.
</p>
<p>
  To measure larger grids locally, open <code>/test/isosurface-performance?size=128</code> and
  click <strong>Benchmark prediction</strong>. The page records three publication timings,
  export time and bytes, alongside the existing geometry/render timings and heap sampling.
</p>

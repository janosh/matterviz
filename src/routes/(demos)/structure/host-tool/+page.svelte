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
  trajectory to an unchanged input crystal. No model download or server is needed.
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
  site_properties: result.site_properties,
  volumes: result.volumes, // each field needs a stable, unique field_id
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
  Use the export pane to download the prediction JSON, including the captured input,
  properties, density grids and provenance, or export the original structure in the usual
  formats. Reuse a field ID only while its physical quantity, units and normalization stay
  compatible; change the ID when those semantics change. Labels, order and grid resolution can
  change without losing surface appearance, including extra or deliberately removed layers. <strong
    >Reset prediction surfaces</strong
  > restores defaults. Hidden-density notices offer direct cell and supercell recovery actions.
</p>

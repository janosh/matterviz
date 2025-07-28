<script lang="ts">
  import { get_electro_neg_formula, Structure } from '$lib'
  import { FilePicker, PeriodicTableDemo } from '$site'
  import { structure_files } from '$site/structures'

  let scene_props = $state({ auto_rotate: 0.5 })
</script>

<h1>MatterViz</h1>

<p>
  <code>matterviz</code> is a toolkit for building interactive web UIs for materials
  science: periodic tables, 3d crystal structures (and molecules), Bohr atoms, nuclei,
  heatmaps, scatter plots. Check out some of the examples in the navigation bar above.
</p>

<h2>Structure Viewers</h2>

<div class="structure-viewers">
  {#each [[`Li4Fe3Mn1(PO4)4.cif`], [`mp-756175.json`, `Zr2Bi2O7`]] as
    [file_url, formula]
    (file_url)
  }
    <div style="flex: 1">
      <h3 style="margin: 0 0 1ex">
        {@html get_electro_neg_formula(formula ?? file_url.split(`.`)[0], false, ``)}
      </h3>
      <Structure data_url="/structures/{file_url}" bind:scene_props style="flex: 1" />
    </div>
  {/each}
</div>

<h3>Try dragging files onto the structure viewers</h3>

<p>
  Either from the set of example files below or drag a local file in <code>extXYZ</code>,
  <code>POSCAR</code>, <code>CIF</code>, <code>YAML</code>, <code>OPTIMADE</code> JSON,
  <code>pymatgen</code> JSON format onto either structure viewer. Compressed versions of
  these structure formats are also supported.
</p>

<FilePicker
  files={structure_files}
  show_category_filters
  category_labels={{ '🔷': `🔷 Crystal`, '🧬': `🧬 Molecule`, '❓': `❓ Unknown` }}
  style="max-width: var(--max-text-width); margin: 0 auto"
/>

<p>
  The 3d structure viewer is built on the declarative <a href="https://threejs.org"
  >three.js</a>
  wrapper <a href="https://threlte.xyz"><code>threlte</code></a>. It gets Svelte-compiled
  for great performance (even on supercells with 100+ atoms), is split up into
  <code>Bond</code>, <code>Lattice</code>, <code>Scene</code> and <code>Site</code>
  components for easy extensibility. You can pass various click, drag and touch event
  handlers for rich interactivity as well as inject custom HTML into tooltips using child
  components. These show
  <a href="https://materialsproject.org">Materials Project</a>
  structure for <a href="https://materialsproject.org/materials/mp-756175">mp-756175</a>
  and a lithium iron manganese phosphate structure from a CIF file.
</p>

<h2>Periodic Table</h2>

<PeriodicTableDemo />

<style>
  h1 {
    text-align: center;
    font-size: clamp(20pt, 5.5vw, 42pt);
  }
  :is(h2, h3) {
    text-align: center;
    transform: scale(1.1);
  }
  p {
    max-width: var(--max-text-width);
    margin: 1em auto;
    text-align: center;
  }
  .structure-viewers {
    display: flex;
    flex-wrap: wrap;
    gap: 2em;
    max-width: 1400px;
    margin-inline: auto;
    min-width: 300px;
  }
</style>

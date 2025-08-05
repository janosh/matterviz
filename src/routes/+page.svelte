<script lang="ts">
  import { get_electro_neg_formula, Structure } from '$lib'
  import { CompositionDemo, FilePicker, PeriodicTableDemo } from '$site'
  import { molecule_files } from '$site/molecules'
  import { structure_files } from '$site/structures'
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
      <Structure data_url="/structures/{file_url}" style="flex: 1" />
    </div>
  {/each}
</div>

<h3>Try dragging files onto the structure viewers</h3>

<p>
  Pick one of the example files below, or drag a local structure file onto a viewer:
  <code>.xyz</code>/<code>EXTXYZ</code>, <code>POSCAR</code>, <code>.cif</code>,
  <code>.yaml</code>, <code>OPTIMADE&nbsp;JSON</code>, or <code>pymatgen&nbsp;JSON</code>.
  Compressed variants (e.g.&nbsp;<code>.gz</code>, <code>.bz2</code>) are supported as
  well.
</p>

<FilePicker
  files={[...structure_files, ...molecule_files]}
  show_category_filters
  category_labels={{ '🔷': `🔷 Crystal`, '🧬': `🧬 Molecule`, '❓': `❓ Unknown` }}
  style="margin: 2em auto"
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

<h2>Composition</h2>

<CompositionDemo show_interactive />

<style>
  h1 {
    font-size: clamp(20pt, 5.5vw, 42pt);
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

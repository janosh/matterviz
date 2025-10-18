<script lang="ts">
  import { FilePicker, Icon, Structure, Trajectory } from '$lib'
  import type { TrajHandlerData } from '$lib/trajectory'
  import { CompositionDemo, PeriodicTableDemo } from '$site'
  import { molecule_files } from '$site/molecules'
  import { structure_files } from '$site/structures'
  import { get_trajectory_type, trajectory_files } from '$site/trajectories'
  import { CopyButton, tooltip } from 'svelte-multiselect'

  // Track the currently loaded trajectory file
  let active_trajectory_file = $state(`Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`)
  let structure_filenames = $state([`Li4Fe3Mn1(PO4)4.cif`, `mp-756175.json`])
  let vscode_ext_url =
    `https://marketplace.visualstudio.com/items?itemName=Janosh.matterviz`
  let open_vsx_ext_url = `https://open-vsx.org/extension/janosh/matterviz`
</script>

<h1 style="font-size: clamp(20pt, 5.5vw, 42pt)">MatterViz</h1>

<p>
  <code>matterviz</code> is a toolkit for building interactive web UIs for materials
  science: periodic tables, 3d crystal structures (and molecules), Bohr atoms, nuclei,
  heatmaps, scatter plots. Check out some of the examples in the navigation bar above.
</p>

<h2 style="margin-block: 1em">Installation</h2>
<p class="install">
  <span>
    {#each [[`VSCode`, vscode_ext_url], [`Cursor`, open_vsx_ext_url]] as const as
      [ext_name, ext_url]
      (ext_name)
    }
      {#if ext_name !== `VSCode`}/{/if}
      <a
        href={ext_url}
        title="Install the {ext_name} extension to view structure/trajectory files directly in your IDE."
        {@attach tooltip()}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon icon={ext_name} /> {ext_name}
      </a>
    {/each}
    extension
  </span>

  or

  <span>
    <code
      {@attach tooltip()}
      title="For use in JavaScript/TypeScript/NodeJS."
      style="display: inline-flex; gap: 4pt; line-height: 1.3"
    >
      <a href="https://www.npmjs.com/package/matterviz">
        <Icon icon="NPM" style="transform: scale(2.4); padding-inline: 12pt" />
      </a>
      install matterviz
      <CopyButton content="npm install matterviz" style="background: transparent" />
    </code>
  </span>
</p>

<h2><a href="/structure">Structure Viewer</a></h2>

<div class="full-bleed" style="display: flex; flex-wrap: wrap; gap: 2em">
  {#each [`Li4Fe3Mn1(PO4)4.cif`, `mp-756175.json`] as file_name, idx (file_name)}
    <div style="flex: 1">
      <h3 style="margin: 0 0 1ex; text-align: center; font-family: monospace">
        {structure_filenames[idx]}
      </h3>
      <Structure
        data_url="/structures/{file_name}"
        style="flex: 1"
        on_file_load={(data) => {
          if (data.filename) structure_filenames[idx] = data.filename
        }}
      />
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
  style="margin: 2em auto"
/>

<p>
  The 3d structure viewer is built on the declarative <a href="https://threejs.org"
  >three.js</a>
  wrapper <a href="https://threlte.xyz"><code>threlte</code></a>. It gets Svelte-compiled
  for better performance, is split up into <code>Bond</code>, <code>Lattice</code>, <code
  >Scene</code> and atom components for easy extensibility. You can pass various click,
  drag and touch event handlers for rich interactivity as well as inject custom HTML into
  tooltips using child components. These show <a href="https://materialsproject.org"
  >Materials Project</a> structure for <a
    href="https://materialsproject.org/materials/mp-756175"
  >mp-756175</a> and a lithium iron manganese phosphate structure from a CIF file.
</p>

<h2><a href="/trajectory">Trajectory Viewer</a></h2>

<Trajectory
  data_url="/trajectories/{active_trajectory_file}"
  class="full-bleed"
  on_file_load={(data: TrajHandlerData) => {
    if (data.filename) active_trajectory_file = data.filename
  }}
  style="max-height: 700px"
/>

<p style="margin: 2em auto; text-align: center">
  Drag any of these trajectory files onto a viewer above to load them:
</p>

<FilePicker
  files={Object.keys(trajectory_files).map((file_path) => ({
    name: file_path.split(`/`).pop() || file_path,
    url: file_path.split(`/site`).at(-1) || ``,
  }))}
  show_category_filters={false}
  type_mapper={get_trajectory_type}
  active_files={[active_trajectory_file]}
/>

<h2><a href="/periodic-table">Periodic Table</a></h2>

<PeriodicTableDemo />

<h2><a href="/composition">Composition</a></h2>

<CompositionDemo show_interactive />

<style>
  h2 {
    margin-top: 2em;
  }
  p.install {
    display: flex;
    gap: 1em;
    place-content: center;
    margin: 1em;
    font-size: clamp(1em, 2vw, 1.2em);
    place-items: center;
    flex-wrap: wrap;
  }
  p.install :is(span, span a) {
    display: inline-flex;
    gap: 6pt;
    place-items: center;
  }
</style>

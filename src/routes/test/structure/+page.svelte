<script lang="ts">
  import type { Atoms } from '$lib'
  import Structure from '$lib/structure/Structure.svelte'
  import initial_structure from '$site/structures/mp-1.json'

  let test_structure = $state(initial_structure as unknown as Atoms)

  let controls_open = $state(false)
  let canvas = $state({ width: 600, height: 400 })
  let background_color = $state(`#1e1e1e`)
  let gizmo = $state(true)

  // Lattice properties for testing
  let lattice_props = $state({
    cell_color: `white`,
    cell_opacity: 0.4,
    cell_line_width: 1,
    show_cell: `wireframe` as `surface` | `wireframe` | null,
    show_vectors: true,
  })

  // React to URL parameters for testing
  $effect(() => {
    if (typeof window !== `undefined`) {
      const url_params = new URLSearchParams(window.location.search)

      if (url_params.has(`cell_color`)) {
        lattice_props.cell_color = url_params.get(`cell_color`) || `white`
      }
      if (url_params.has(`cell_opacity`)) {
        const opacity = parseFloat(url_params.get(`cell_opacity`) || `0.4`)
        if (!isNaN(opacity)) lattice_props.cell_opacity = opacity
      }
      if (url_params.has(`cell_line_width`)) {
        const line_width = parseInt(url_params.get(`cell_line_width`) || `1`)
        if (!isNaN(line_width)) lattice_props.cell_line_width = line_width
      }
      if (url_params.has(`show_cell`)) {
        const show_cell = url_params.get(`show_cell`)
        if (
          show_cell === `wireframe` ||
          show_cell === `surface` ||
          show_cell === `null`
        ) {
          lattice_props.show_cell = show_cell === `null` ? null : show_cell
        }
      }
    }
  })

  // Listen for custom events from tests
  $effect(() => {
    if (typeof window !== `undefined`) {
      const handle_lattice_props = (event: CustomEvent) => {
        const { detail } = event
        if (detail.cell_color !== undefined) lattice_props.cell_color = detail.cell_color
        if (detail.cell_opacity !== undefined)
          lattice_props.cell_opacity = detail.cell_opacity
        if (detail.cell_line_width !== undefined)
          lattice_props.cell_line_width = detail.cell_line_width
        if (detail.show_cell !== undefined) lattice_props.show_cell = detail.show_cell
        if (detail.show_vectors !== undefined)
          lattice_props.show_vectors = detail.show_vectors
      }

      window.addEventListener(`setLatticeProps`, handle_lattice_props as EventListener)

      return () => {
        window.removeEventListener(`setLatticeProps`, handle_lattice_props)
      }
    }
  })
</script>

<svelte:head>
  <title>Structure Component Test</title>
</svelte:head>

<h1>Structure Component Test Page</h1>

<section>
  <h2>Controls for Test Page</h2>
  <label>
    Controls Open:
    <input type="checkbox" bind:checked={controls_open} />
  </label>
  <br />
  <label>
    Structure ID (read-only):
    <input type="text" readonly value={test_structure?.id ?? `N/A`} />
  </label>
  <br />
  <label>
    Canvas Width:
    <input type="number" bind:value={canvas.width} />
  </label>
  <br />
  <label>
    Canvas Height:
    <input type="number" bind:value={canvas.height} />
  </label>
  <br />
  <label>
    Background Color:
    <input type="color" bind:value={background_color} />
  </label>
  <br />
  <label>
    Show Gizmo:
    <input type="checkbox" bind:checked={gizmo} />
  </label>
</section>

<hr />

<div
  id="structure-wrapper"
  style="width: {canvas.width}px; height: {canvas.height}px; border: 1px solid #ccc; margin-top: 20px;"
>
  <Structure
    bind:structure={test_structure}
    bind:controls_open
    bind:width={canvas.width}
    bind:height={canvas.height}
    {background_color}
    reveal_buttons={true}
    scene_props={{ gizmo }}
    {lattice_props}
  />
</div>

<div data-testid="controls-open-status" style="margin-top: 10px;">
  Controls Open Status: {controls_open}
</div>
<div data-testid="structure-id-status">
  Structure ID Status: {test_structure?.id ?? `undefined`}
</div>
<div data-testid="canvas-width-status">Canvas Width Status: {canvas.width}</div>
<div data-testid="canvas-height-status">Canvas Height Status: {canvas.height}</div>
<div data-testid="gizmo-status">Gizmo Status: {gizmo}</div>

<style>
  section {
    margin-bottom: 20px;
    padding: 10px;
    border: 1px solid lightgray;
    border-radius: 5px;
  }
  label {
    display: inline-block;
    margin-bottom: 5px;
    margin-right: 15px;
  }
  input[type='number'] {
    width: 60px;
  }
</style>

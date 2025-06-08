<script lang="ts">
  import type { AnyStructure } from '$lib'
  import Structure from '$lib/structure/Structure.svelte'
  import initial_structure from '$site/structures/mp-1.json'

  let test_structure = $state(initial_structure as unknown as AnyStructure)

  let controls_open = $state(false)
  let canvas = $state({ width: 600, height: 400 })
  let background_color = $state(`#1e1e1e`)
  let gizmo = $state(true)

  // Lattice properties for testing - using new dual opacity controls
  let lattice_props = $state({
    cell_edge_color: `white`,
    cell_surface_color: `white`,
    cell_edge_opacity: 0.4,
    cell_surface_opacity: 0.01, // Very subtle surface visibility
    cell_line_width: 1.5,
    show_vectors: true,
  })

  // React to URL parameters for testing
  $effect(() => {
    if (typeof window !== `undefined`) {
      const url_params = new URLSearchParams(window.location.search)

      if (url_params.has(`cell_edge_color`)) {
        lattice_props.cell_edge_color = url_params.get(`cell_edge_color`) || `white`
      }
      if (url_params.has(`cell_surface_color`)) {
        lattice_props.cell_surface_color = url_params.get(`cell_surface_color`) || `white`
      }
      if (url_params.has(`cell_edge_opacity`)) {
        const opacity = parseFloat(url_params.get(`cell_edge_opacity`) || `0.4`)
        if (!isNaN(opacity)) lattice_props.cell_edge_opacity = opacity
      }
      if (url_params.has(`cell_surface_opacity`)) {
        const opacity = parseFloat(url_params.get(`cell_surface_opacity`) || `0.01`)
        if (!isNaN(opacity)) lattice_props.cell_surface_opacity = opacity
      }
      if (url_params.has(`cell_line_width`)) {
        const line_width = parseInt(url_params.get(`cell_line_width`) || `1`)
        if (!isNaN(line_width)) lattice_props.cell_line_width = line_width
      }
    }
  })

  // Listen for custom events from tests
  $effect(() => {
    if (typeof window !== `undefined`) {
      const handle_lattice_props = (event: Event) => {
        const customEvent = event as CustomEvent
        const { detail } = customEvent
        if (detail.cell_edge_color !== undefined)
          lattice_props.cell_edge_color = detail.cell_edge_color
        if (detail.cell_surface_color !== undefined)
          lattice_props.cell_surface_color = detail.cell_surface_color
        if (detail.cell_edge_opacity !== undefined)
          lattice_props.cell_edge_opacity = detail.cell_edge_opacity
        if (detail.cell_surface_opacity !== undefined)
          lattice_props.cell_surface_opacity = detail.cell_surface_opacity
        if (detail.cell_line_width !== undefined)
          lattice_props.cell_line_width = detail.cell_line_width
        if (detail.show_vectors !== undefined)
          lattice_props.show_vectors = detail.show_vectors
      }

      window.addEventListener(`setLatticeProps`, handle_lattice_props)

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

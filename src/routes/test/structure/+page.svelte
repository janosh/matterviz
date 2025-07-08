<script lang="ts">
  import type { PymatgenStructure } from '$lib'
  import Structure from '$lib/structure/Structure.svelte'
  import mp1_struct from '$site/structures/mp-1.json'

  let controls_open = $state(false)
  let info_open = $state(false)
  let canvas = $state({ width: 600, height: 400 })
  let background_color = $state(`#1e1e1e`)
  let gizmo = $state(true)
  let show_buttons = $state<boolean | number>(true)

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
        lattice_props.cell_surface_color = url_params.get(`cell_surface_color`) ||
          `white`
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
      if (url_params.has(`show_buttons`)) {
        const show_buttons_param = url_params.get(`show_buttons`)
        if (show_buttons_param === `false`) {
          show_buttons = false
        } else if (show_buttons_param === `true`) {
          show_buttons = true
        } else {
          const num = parseInt(show_buttons_param || ``)
          if (!isNaN(num)) show_buttons = num
        }
      }
    }
  })

  // Listen for custom events from tests
  $effect(() => {
    if (typeof window !== `undefined`) {
      const handle_lattice_props = (event: Event) => {
        const customEvent = event as CustomEvent
        const { detail } = customEvent
        if (detail.cell_edge_color !== undefined) {
          lattice_props.cell_edge_color = detail.cell_edge_color
        }
        if (detail.cell_surface_color !== undefined) {
          lattice_props.cell_surface_color = detail.cell_surface_color
        }
        if (detail.cell_edge_opacity !== undefined) {
          lattice_props.cell_edge_opacity = detail.cell_edge_opacity
        }
        if (detail.cell_surface_opacity !== undefined) {
          lattice_props.cell_surface_opacity = detail.cell_surface_opacity
        }
        if (detail.cell_line_width !== undefined) {
          lattice_props.cell_line_width = detail.cell_line_width
        }
        if (detail.show_vectors !== undefined) {
          lattice_props.show_vectors = detail.show_vectors
        }
      }

      const handle_show_buttons = (event: Event) => {
        const customEvent = event as CustomEvent
        const { detail } = customEvent
        if (detail.show_buttons !== undefined) {
          show_buttons = detail.show_buttons
        }
      }

      window.addEventListener(`setLatticeProps`, handle_lattice_props)
      window.addEventListener(`setShowButtons`, handle_show_buttons)

      return () => {
        window.removeEventListener(`setLatticeProps`, handle_lattice_props)
        window.removeEventListener(`setShowButtons`, handle_show_buttons)
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
    Canvas Width:
    <input type="number" bind:value={canvas.width} data-testid="canvas-width-input" />
  </label>
  <br />
  <label>
    Canvas Height:
    <input type="number" bind:value={canvas.height} data-testid="canvas-height-input" />
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
  <br />
  <label>
    Show Buttons:
    <select bind:value={show_buttons}>
      <option value={true}>Always (true)</option>
      <option value={false}>Never (false)</option>
      <option value={400}>When width > 400px</option>
      <option value={600}>When width > 600px</option>
      <option value={800}>When width > 800px</option>
    </select>
  </label>
</section>

<hr />

<div
  id="structure-wrapper"
  style="border: 1px solid #ccc; margin-top: 20px"
  style:width="{canvas.width}px"
  style:height="{canvas.height}px"
>
  <Structure
    structure={mp1_struct as unknown as PymatgenStructure}
    bind:controls_open
    bind:info_open
    bind:width={canvas.width}
    bind:height={canvas.height}
    {background_color}
    {show_buttons}
    scene_props={{ gizmo, show_atoms: true }}
    {lattice_props}
  />
</div>

<div data-testid="panel-open-status" style="margin-top: 10px">
  Controls Open Status: {controls_open}
</div>

<div data-testid="canvas-width-status">Canvas Width Status: {canvas.width}</div>
<div data-testid="canvas-height-status">Canvas Height Status: {canvas.height}</div>
<div data-testid="gizmo-status">Gizmo Status: {gizmo}</div>
<div data-testid="show-buttons-status">Show Buttons Status: {show_buttons}</div>

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

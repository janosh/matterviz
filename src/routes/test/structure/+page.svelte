<script lang="ts">
  import type { PymatgenStructure } from '$lib'
  import Structure from '$lib/structure/Structure.svelte'
  import mp1_struct from '$site/structures/mp-1.json'

  let controls_open = $state(false)
  let info_panel_open = $state(false)
  let canvas = $state({ width: 600, height: 400 })
  let background_color = $state(`#1e1e1e`)
  let show_controls = $state<boolean | number>(true)
  let scene_props = $state({ gizmo: true, show_atoms: true })
  let performance_mode = $state<`quality` | `speed`>(`quality`)

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
    if (typeof window === `undefined`) return
    const url_params = new URLSearchParams(window.location.search)

    // Lattice properties
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

    // Component properties
    if (url_params.has(`show_controls`)) {
      const param = url_params.get(`show_controls`)
      if (param === `false`) show_controls = false
      else if (param === `true`) show_controls = true
      else {
        const num = parseInt(param || ``)
        if (!isNaN(num)) show_controls = num
      }
    }
    if (url_params.has(`performance_mode`)) {
      const mode = url_params.get(`performance_mode`)
      if (mode === `speed` || mode === `quality`) performance_mode = mode
    }
  })

  $effect(() => { // Listen for custom events from tests
    if (typeof window === `undefined`) return

    const handle_lattice_props = (event: Event) => {
      const { detail } = event as CustomEvent
      Object.assign(lattice_props, detail)
    }

    const handle_show_controls = (event: Event) => {
      const { detail } = event as CustomEvent
      if (detail.show_controls !== undefined) show_controls = detail.show_controls
    }

    window.addEventListener(`set-lattice-props`, handle_lattice_props)
    window.addEventListener(`set-show-buttons`, handle_show_controls)

    return () => {
      window.removeEventListener(`set-lattice-props`, handle_lattice_props)
      window.removeEventListener(`set-show-buttons`, handle_show_controls)
    }
  })
</script>

<svelte:head>
  <title>Structure Component Test</title>
</svelte:head>

<h1>Structure Component Test Page</h1>

<section>
  <h2>Controls for Test Page</h2>
  <label>Controls Open: <input
      type="checkbox"
      bind:checked={controls_open}
    /></label><br />
  <label>Canvas Width: <input
      type="number"
      bind:value={canvas.width}
      data-testid="canvas-width-input"
    /></label><br />
  <label>Canvas Height: <input
      type="number"
      bind:value={canvas.height}
      data-testid="canvas-height-input"
    /></label><br />
  <label>Background Color: <input
      type="color"
      bind:value={background_color}
    /></label><br />
  <label>Show Gizmo: <input
      type="checkbox"
      bind:checked={scene_props.gizmo}
    /></label><br />
  <label>Show Atoms: <input
      type="checkbox"
      bind:checked={scene_props.show_atoms}
    /></label><br />
  <label>
    Show Buttons:
    <select bind:value={show_controls}>
      <option value={true}>Always (true)</option>
      <option value={false}>Never (false)</option>
      <option value={400}>When width > 400px</option>
      <option value={600}>When width > 600px</option>
      <option value={800}>When width > 800px</option>
    </select>
  </label><br />
  <label>
    Performance Mode:
    <select bind:value={performance_mode}>
      <option value="quality">Quality</option>
      <option value="speed">Speed</option>
    </select>
  </label>
</section>

<div
  id="structure-wrapper"
  style:width="{canvas.width}px"
  style:height="{canvas.height}px"
>
  <Structure
    structure={mp1_struct as unknown as PymatgenStructure}
    bind:controls_open
    bind:info_panel_open
    bind:width={canvas.width}
    bind:height={canvas.height}
    {background_color}
    {show_controls}
    bind:scene_props
    {lattice_props}
    {performance_mode}
  />
</div>

<div data-testid="panel-open-status" style="margin-top: 10px">
  Controls Open Status: {controls_open}
</div>
<div data-testid="canvas-width-status">Canvas Width Status: {canvas.width}</div>
<div data-testid="canvas-height-status">Canvas Height Status: {canvas.height}</div>
<div data-testid="gizmo-status">Gizmo Status: {scene_props.gizmo}</div>
<div data-testid="show-buttons-status">Show Buttons Status: {show_controls}</div>
<div data-testid="performance-mode-status">
  Performance Mode Status: {performance_mode}
</div>

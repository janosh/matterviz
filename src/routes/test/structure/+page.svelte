<script lang="ts">
  import { DEFAULTS, type PymatgenStructure, Structure, StructureScene } from '$lib'
  import mp1_struct from '$site/structures/mp-1.json' with { type: 'json' }
  import type { ComponentProps } from 'svelte'

  let controls_open = $state(false)
  let info_pane_open = $state(false)
  let canvas = $state({ width: 600, height: 400 })
  let background_color = $state(`#1e1e1e`)
  let show_controls = $state<boolean | number>(true)
  let scene_props: ComponentProps<typeof StructureScene> & { show_gizmo: boolean } =
    $state(DEFAULTS.structure)
  let performance_mode = $state<`quality` | `speed`>(`quality`)
  // expose selection state for tests
  let selected_sites = $state<number[]>([])
  let measured_sites = $state<number[]>([])
  let enable_measure_mode = $state(true)
  let supercell_scaling = $state(`1x1x1`)
  let show_image_atoms = $state(true)
  let fullscreen = $state(false)

  // capture event data for testing
  let event_calls = $state<{ event: string; data: unknown }[]>([])

  // Structure state - can be overridden by data_url
  let structure = $state(mp1_struct as unknown as PymatgenStructure)

  // Lattice properties for testing - using new dual opacity controls
  let lattice_props = $state({
    cell_edge_color: `white`,
    cell_surface_color: `white`,
    cell_edge_opacity: 0.4,
    cell_surface_opacity: 0.01, // Very subtle surface visibility
    cell_edge_width: DEFAULTS.structure.cell_edge_width,
    show_cell_vectors: true,
  })

  const create_event_handler = (event_name: string) => (data: unknown) => {
    event_calls = [...event_calls, { event: event_name, data }]
  }

  // React to URL parameters for testing
  $effect(() => {
    if (typeof window === `undefined`) return
    const url_params = new URLSearchParams(window.location.search)

    // Data URL for loading external structures
    if (url_params.has(`data_url`)) {
      const data_url = url_params.get(`data_url`)
      if (data_url) { // Clear the static structure to allow data_url loading
        structure = undefined
      }
    }

    if (url_params.has(`camera_projection`)) {
      const cam_projection = url_params.get(`camera_projection`)
      if (cam_projection === `perspective` || cam_projection === `orthographic`) {
        scene_props.camera_projection = cam_projection
      }
    }

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
    if (url_params.has(`cell_edge_width`)) {
      const line_width = parseInt(url_params.get(`cell_edge_width`) || `1`)
      if (!isNaN(line_width)) lattice_props.cell_edge_width = line_width
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

    if (url_params.has(`enable_measure_mode`)) {
      const param = url_params.get(`enable_measure_mode`)
      if (param === `true`) enable_measure_mode = true
      else if (param === `false`) enable_measure_mode = false
    }

    // Site labeling parameters
    if (url_params.has(`show_site_labels`)) {
      const param = url_params.get(`show_site_labels`)
      scene_props.show_site_labels = param === `true`
    }
    if (url_params.has(`show_site_indices`)) {
      const param = url_params.get(`show_site_indices`)
      scene_props.show_site_indices = param === `true`
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
    ;(globalThis as Record<string, unknown>).event_calls = event_calls

    return () => {
      window.removeEventListener(`set-lattice-props`, handle_lattice_props)
      window.removeEventListener(`set-show-buttons`, handle_show_controls)
    }
  })
</script>

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
      bind:checked={scene_props.show_gizmo}
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
  <label>
    Supercell Scaling:
    <input
      type="text"
      bind:value={supercell_scaling}
      data-testid="supercell-input"
    />
  </label><br />
  <label>Show Image Atoms:
    <input
      type="checkbox"
      bind:checked={show_image_atoms}
      data-testid="image-atoms-checkbox"
    />
  </label>
  <label>
    Fullscreen:
    <input
      type="checkbox"
      bind:checked={fullscreen}
      data-testid="fullscreen-checkbox"
    />
  </label>
  <div style="margin-top: 0.5em">
    {#each [
        [`set-selected`, () => selected_sites = [0, 1]],
        [`clear-selected`, () => selected_sites = []],
        [`set-measured`, () => measured_sites = [0, 1, 2]],
        [`clear-measured`, () => measured_sites = []],
      ] as const as
      [btn_type, onclick]
      (btn_type)
    }
      <button type="button" data-testid="btn-{btn_type}" {onclick}>
        {btn_type}
      </button>
    {/each}
  </div>
</section>

<Structure
  id="test-structure"
  {structure}
  data_url={typeof window !== `undefined`
  ? new URLSearchParams(window.location.search).get(`data_url`) || undefined
  : undefined}
  bind:controls_open
  bind:info_pane_open
  bind:width={canvas.width}
  bind:height={canvas.height}
  {background_color}
  {show_controls}
  bind:scene_props
  bind:lattice_props
  {performance_mode}
  on_file_load={create_event_handler(`on_file_load`)}
  on_error={create_event_handler(`on_error`)}
  on_fullscreen_change={create_event_handler(`on_fullscreen_change`)}
  on_camera_move={create_event_handler(`on_camera_move`)}
  on_camera_reset={create_event_handler(`on_camera_reset`)}
  bind:selected_sites
  bind:measured_sites
  {enable_measure_mode}
  bind:supercell_scaling
  bind:show_image_atoms
  bind:fullscreen
/>

<div data-testid="pane-open-status" style="margin-top: 10px">
  Info Pane Open Status: {info_pane_open}
  <!-- Optionally keep controls status for debugging -->
  <!-- Controls Open Status: {controls_open} -->
</div>
<div data-testid="canvas-width-status">Canvas Width Status: {canvas.width}</div>
<div data-testid="canvas-height-status">Canvas Height Status: {canvas.height}</div>
<div data-testid="gizmo-status">Gizmo Status: {scene_props.show_gizmo}</div>
<div data-testid="show-buttons-status">Show Buttons Status: {show_controls}</div>
<div data-testid="fullscreen-status">Fullscreen Status: {fullscreen}</div>
<div data-testid="performance-mode-status">
  Performance Mode Status: {performance_mode}
</div>
<div data-testid="camera-projection-status">
  Camera Projection Status: {
    scene_props.camera_projection || DEFAULTS.structure.camera_projection
  }
</div>

<div data-testid="event-calls-status" style="max-height: 50vh; overflow-y: auto">
  <h3>Event Calls ({event_calls.length})</h3>
  <pre>{JSON.stringify(event_calls, null, 2)}</pre>
</div>

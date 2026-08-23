<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import type { Crystal } from '$lib'
  import { DEFAULTS } from '$lib/settings'
  import type {
    BondEditMode,
    BondOrder,
    MeasureMode,
    StructureBond,
    StructurePane,
  } from '$lib/structure'
  import Structure from '$lib/structure/Structure.svelte'
  import StructureScene from '$lib/structure/StructureScene.svelte'
  import mp1_struct from '$site/structures/mp-1.json' with { type: 'json' }
  import type { ComponentProps } from 'svelte'

  let active_pane = $state<StructurePane | null>(null)
  let background_color = $state(`#1e1e1e`)
  let show_controls = $state<`always` | `hover` | `never`>(`hover`)
  // cell rendering tuned for the screenshot tests: dual edge/surface opacity, subtle surface
  let scene_props: ComponentProps<typeof StructureScene> & { gizmo: boolean } = $state({
    ...DEFAULTS.structure,
    gizmo: true,
    cell_edge_color: `white`,
    cell_surface_color: `white`,
    cell_edge_opacity: 0.4,
    cell_surface_opacity: 0.01,
    show_cell_vectors: true,
  })
  // expose selection state for tests
  let selected_sites = $state<number[]>([])
  let measured_sites = $state<number[]>([])
  let enable_measure_mode = $state(true)
  let measure_mode = $state<MeasureMode>(`distance`)
  let bond_edit_mode = $state<BondEditMode>(`add`)
  let bond_edit_order = $state<BondOrder>(1)
  let supercell_scaling = $state(`1x1x1`)
  let show_image_atoms = $state(true)
  let bonds = $state<StructureBond[] | undefined>()
  // ?data_url= loads an external structure in place of the static one
  const url_params = browser ? page.url.searchParams : new URLSearchParams()
  const data_url = url_params.get(`data_url`) || undefined
  const comparison_mode = url_params.get(`comparison`) === `true`
  let structure = $state<Crystal | undefined>(
    data_url ? undefined : (mp1_struct as unknown as Crystal),
  )

  // capture event data for testing
  let event_calls = $state<{ event: string; data: unknown }[]>([])
  const create_event_handler = (event_name: string) => (data: unknown) => {
    // camera moves arrive in bursts; dropping the structure keeps the log cheap to serialize
    const recorded_data =
      event_name === `on_camera_move`
        ? { ...(data as Record<string, unknown>), structure: undefined }
        : data
    event_calls.push({ event: event_name, data: recorded_data })
  }

  // Component props the specs set via URL parameters
  const show_controls_param = url_params.get(`show_controls`)
  if ([`always`, `hover`, `never`].includes(show_controls_param ?? ``)) {
    show_controls = show_controls_param as typeof show_controls
  }
  if (url_params.has(`enable_measure_mode`)) {
    enable_measure_mode = url_params.get(`enable_measure_mode`) === `true`
  }
  for (const key of [`show_site_labels`, `show_site_indices`] as const) {
    if (url_params.has(key)) scene_props[key] = url_params.get(key) === `true`
  }

  // Custom-event hooks the specs dispatch on window (see tests/playwright/helpers.ts)
  $effect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const on = (name: string, handler: (detail: Record<string, unknown>) => void) =>
      window.addEventListener(name, (event) => handler((event as CustomEvent).detail), {
        signal,
      })
    on(`set-scene-props`, (detail) => Object.assign(scene_props, detail))
    on(`set-structure`, (detail) => {
      structure = detail.structure as Crystal
      Object.assign(scene_props, { vector_configs: detail.vector_configs ?? {} })
    })
    on(`set-bonds`, (detail) => (bonds = detail.bonds as StructureBond[] | undefined))
    return () => controller.abort()
  })

  $effect(() => {
    Reflect.set(globalThis, `event_calls`, event_calls)
    Reflect.set(globalThis, `structure_bonds`, bonds)
  })
</script>

<h1>Structure Component Test Page</h1>

<section>
  <h2>Controls for Test Page</h2>
  <label>
    Controls Open: <input
      type="checkbox"
      bind:checked={
        () => active_pane === `controls`, (open) => (active_pane = open ? `controls` : null)
      }
    />
  </label><br />
  <label>Background Color: <input type="color" bind:value={background_color} /></label><br />
  <label>
    Supercell Scaling:
    <input type="text" bind:value={supercell_scaling} data-testid="supercell-input" />
  </label><br />
  <label
    >Show Image Atoms:
    <input
      type="checkbox"
      bind:checked={show_image_atoms}
      data-testid="image-atoms-checkbox"
    />
  </label>
  <div style="margin-top: 0.5em">
    {#each [[`select-site-0`, () => (selected_sites = [0])], [`set-selected`, () => (selected_sites = [0, 1])], [`clear-selected`, () => (selected_sites = [])], [`set-measured`, () => (measured_sites = [0, 1, 2])], [`clear-measured`, () => (measured_sites = [])], [`set-edit-atoms`, () => (measure_mode = `edit-atoms`)], [`set-edit-bonds`, () => (measure_mode = `edit-bonds`)], [`set-bond-add`, () => (bond_edit_mode = `add`)], [`set-bond-delete`, () => (bond_edit_mode = `delete`)]] as const as [btn_type, onclick] (btn_type)}
      <button type="button" data-testid="btn-{btn_type}" {onclick}>
        {btn_type}
      </button>
    {/each}
  </div>
</section>

<div class:comparison={comparison_mode} class="structure-test-layout">
  <Structure
    id="test-structure"
    {structure}
    {data_url}
    bind:active_pane
    {background_color}
    {show_controls}
    bind:scene_props
    on_file_load={create_event_handler(`on_file_load`)}
    on_error={create_event_handler(`on_error`)}
    on_fullscreen_change={create_event_handler(`on_fullscreen_change`)}
    on_camera_move={create_event_handler(`on_camera_move`)}
    on_camera_reset={create_event_handler(`on_camera_reset`)}
    bind:selected_sites
    bind:measured_sites
    {enable_measure_mode}
    bind:measure_mode
    bind:bond_edit_mode
    bind:bond_edit_order
    bind:supercell_scaling
    bind:show_image_atoms
    bind:bonds
  />
  {#if comparison_mode}
    <Structure
      id="comparison-structure"
      {structure}
      show_controls="always"
      allow_file_drop={false}
      performance_mode="speed"
      style="--struct-min-width: 0"
    />
  {/if}
</div>

<div data-testid="pane-open-status" style="margin-top: 10px">
  Info Pane Open Status: {active_pane === `info`}
</div>
<div data-testid="controls-open-status">
  Controls Open Status: {active_pane === `controls`}
</div>
<div data-testid="bond-edit-mode-status">Bond Edit Mode: {bond_edit_mode}</div>

<div data-testid="event-calls-status" style="max-height: 50vh; overflow-y: auto">
  <h3>Event Calls ({event_calls.length})</h3>
  <pre>{JSON.stringify(event_calls, null, 2)}</pre>
</div>

<style>
  .structure-test-layout {
    display: contents;
    &.comparison {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
  }
</style>

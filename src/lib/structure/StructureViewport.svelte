<script lang="ts">
  // A single subcanvas (one Threlte <Canvas> + <StructureScene>) used by Structure.svelte
  // for both the regular single view and each pane of the 2x2 multi-side view.
  //
  // Each viewport owns its camera: move tracking, reset (on reset_token), and orbit-target
  // recentering on structure change. The primary pane (index 0) additionally binds out
  // scene/camera for the export pane and receives the on_camera_move/on_camera_reset
  // callbacks so it drives Structure's external camera API. Camera state is per-pane:
  // the primary pane binds it back to Structure's scene_props, while side panes keep it local.
  import type { ElementSymbol } from '$lib/element'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import type { Vec3 } from '$lib/math'
  import type { CameraProjection } from '$lib/settings'
  import type {
    AnyStructure,
    BondEditMode,
    BondOrder,
    MeasureMode,
    StructureBond,
    StructureHandlerData,
  } from '$lib/structure'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps } from 'svelte'
  import { untrack } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { WebGLRenderer, type Camera, type OrthographicCamera, type Scene } from 'three'
  import type { AtomColorConfig } from './atom-properties'
  import StructureScene from './StructureScene.svelte'

  // WebGL contexts survive renderer.dispose() unless explicitly released.
  class StructureRenderer extends WebGLRenderer {
    constructor(parameters: ConstructorParameters<typeof WebGLRenderer>[0]) {
      super(parameters)
      globalThis.addEventListener(`pagehide`, this.release_context, { once: true })
    }

    private release_context = (): void => {
      if (!this.getContext().isContextLost()) this.forceContextLoss()
    }

    override dispose() {
      globalThis.removeEventListener(`pagehide`, this.release_context)
      super.dispose()
      this.release_context()
    }
  }

  const create_renderer = (canvas: HTMLCanvasElement) =>
    new StructureRenderer({
      canvas,
      powerPreference: `high-performance`,
      antialias: true,
      alpha: true,
    })

  let {
    // Multi-view chrome
    in_grid = false,
    active = false,
    label = undefined,
    reset_token = 0,
    interactive = true,
    onactivate = undefined,
    report_moved = undefined,
    on_camera_move = undefined,
    on_camera_reset = undefined,

    // Shared scene inputs (one-way)
    structure = undefined,
    base_structure = undefined,
    scene_props = {},
    gizmo = false,
    lattice_props = {},
    volumetric_data = undefined,
    isosurface_settings = undefined,
    active_volume_idx = 0,
    volume_scaling = [1, 1, 1],
    bond_edits_enabled = true,
    bond_edit_order = 1,
    measure_mode = `distance`,
    atom_color_config = undefined,
    sym_data = null,
    active_sites = [],
    camera_direction = undefined,
    camera_projection = `orthographic`,
    camera_position = $bindable([0, 0, 0]),
    camera_target = $bindable(undefined),

    // Edit-mode callbacks
    on_sites_moved = undefined,
    on_operation_start = undefined,
    on_bond_edit_start = undefined,
    on_add_atom = undefined,

    // scene + camera are bound out for the primary pane (consumed by the export pane)
    scene = $bindable(undefined),
    camera = $bindable(undefined),

    // Shared two-way scene state
    selected_sites = $bindable([]),
    measured_sites = $bindable([]),
    hovered_site_idx = $bindable(null),
    hidden_elements = $bindable(new SvelteSet<ElementSymbol>()),
    hidden_prop_vals = $bindable(new SvelteSet<number | string>()),
    element_radius_overrides = $bindable({}),
    site_radius_overrides = $bindable(new SvelteMap<number, number>()),
    added_bonds = $bindable([]),
    removed_bonds = $bindable([]),
    bond_order_overrides = $bindable([]),
    bond_edit_mode = $bindable(`add`),
    add_atom_mode = $bindable(false),
    add_element = $bindable(`C`),
    dragging_atoms = $bindable(false),
    polyhedra_rendered_elements = $bindable([]),
  }: {
    in_grid?: boolean
    active?: boolean
    label?: string
    reset_token?: number
    interactive?: boolean
    onactivate?: () => void
    report_moved?: (moved: boolean) => void
    on_camera_move?: (data: StructureHandlerData) => void
    on_camera_reset?: (data: StructureHandlerData) => void
    structure?: AnyStructure
    base_structure?: AnyStructure
    scene_props?: ComponentProps<typeof StructureScene>
    gizmo?: boolean | ComponentProps<typeof StructureScene>[`gizmo`]
    lattice_props?: ComponentProps<typeof StructureScene>[`lattice_props`]
    volumetric_data?: VolumetricData | VolumetricData[]
    isosurface_settings?: IsosurfaceSettings
    active_volume_idx?: number
    volume_scaling?: Vec3
    bond_edits_enabled?: boolean
    bond_edit_order?: BondOrder
    measure_mode?: MeasureMode
    atom_color_config?: Partial<AtomColorConfig>
    sym_data?: MoyoDataset | null
    active_sites?: number[]
    camera_direction?: Vec3
    camera_projection?: CameraProjection
    camera_position?: Vec3
    camera_target?: Vec3
    on_sites_moved?: (scene_indices: number[], delta: Vec3) => void
    on_operation_start?: () => void
    on_bond_edit_start?: () => void
    on_add_atom?: (xyz: Vec3, element: ElementSymbol) => void
    scene?: Scene
    camera?: Camera
    selected_sites?: number[]
    measured_sites?: number[]
    hovered_site_idx?: number | null
    hidden_elements?: Set<ElementSymbol>
    hidden_prop_vals?: Set<number | string>
    element_radius_overrides?: Partial<Record<ElementSymbol, number>>
    site_radius_overrides?: Map<number, number> | SvelteMap<number, number>
    added_bonds?: StructureBond[]
    removed_bonds?: StructureBond[]
    bond_order_overrides?: StructureBond[]
    bond_edit_mode?: BondEditMode
    add_atom_mode?: boolean
    add_element?: ElementSymbol
    dragging_atoms?: boolean
    polyhedra_rendered_elements?: string[]
  } = $props()

  // Cell-local dimensions (each pane is responsible for its own zoom sizing) and cursor
  let width = $state(0)
  let height = $state(0)
  let cursor = $state(`default`)

  // Multi-view panes are ~half the viewer, so shrink the (fixed 86px) viewport gizmo to
  // stay proportional. Single view keeps the default size.
  let gizmo_prop = $derived.by(() => {
    if (!gizmo || !in_grid) return gizmo
    const fifth_of_min_dim = Math.min(width, height) * 0.2
    const size = Math.round(Math.max(34, Math.min(72, fifth_of_min_dim)))
    return { ...(typeof gizmo === `object` ? gizmo : {}), size }
  })

  // Internal orbit controls are bound from StructureScene; camera_position/target are
  // bindable above so the primary viewport can persist moves into scene_props.
  let orbit_controls =
    $state<ComponentProps<typeof StructureScene>[`orbit_controls`]>(undefined)
  let rotation_target_ref = $state<Vec3 | undefined>(undefined)
  let initial_computed_zoom = $state<number | undefined>(undefined)
  let camera_is_moving = $state(false)

  const read_orbit_target = (): Vec3 | undefined => {
    if (!orbit_controls?.target) return
    const { x, y, z } = orbit_controls.target
    return [x, y, z]
  }

  const read_camera_position = (): Vec3 | undefined =>
    camera ? [camera.position.x, camera.position.y, camera.position.z] : camera_position

  // Reset this pane's camera. The primary pane is given on_camera_reset, so it also emits.
  function reset_camera() {
    camera_position = [0, 0, 0]
    camera_target = rotation_target_ref
    report_moved?.(false)
    if (orbit_controls && camera) {
      if (`reset` in orbit_controls && typeof orbit_controls.reset === `function`) {
        orbit_controls.reset()
      }
      if (orbit_controls.target && rotation_target_ref) {
        orbit_controls.target.set(...rotation_target_ref)
      }
      if (`zoom` in camera && initial_computed_zoom !== undefined) {
        const ortho_camera = camera as OrthographicCamera
        ortho_camera.zoom = initial_computed_zoom
        ortho_camera.updateProjectionMatrix()
      }
      if (typeof orbit_controls.update === `function`) orbit_controls.update()
      camera_position = read_camera_position() ?? camera_position
      camera_target = read_orbit_target()
    }
    on_camera_reset?.({ structure, camera_has_moved: false, camera_position, camera_target })
  }

  // Track camera movement: keep camera_target in sync with the orbit controls and emit
  // on_camera_move (primary pane only) while the controls are active.
  $effect(() => {
    if (!camera_is_moving) return
    report_moved?.(true)
    const sync = () => {
      const pos = read_camera_position()
      if (!pos) return
      const target = read_orbit_target()
      camera_position = pos
      camera_target = target
      on_camera_move?.({
        structure,
        camera_has_moved: true,
        camera_position: pos,
        camera_target: target,
      })
    }
    sync()
    const interval = setInterval(sync, 200)
    return () => clearInterval(interval)
  })

  // Reset on parent request (reset-all button bumps reset_token for every pane)
  let last_reset_token: number | undefined
  $effect(() => {
    const token = reset_token
    if (last_reset_token !== undefined && token !== last_reset_token) {
      untrack(reset_camera)
    }
    last_reset_token = token
  })

  // Clear stale camera state on structure change so each pane re-frames the new cell
  // along its configured direction.
  let viewport_first_run = true
  $effect(() => {
    void structure
    if (viewport_first_run) {
      viewport_first_run = false
      return
    }
    untrack(() => {
      // Preserve explicit camera props supplied alongside a structure change.
      if (camera_target !== undefined || camera_position.some((coord) => coord !== 0)) return
      camera_position = [0, 0, 0]
      camera_target = undefined
    })
  })

  function handle_dblclick(event: MouseEvent) {
    const target = event.target
    if (
      target instanceof HTMLElement &&
      [`BUTTON`, `INPUT`, `SELECT`].includes(target.tagName)
    )
      return
    reset_camera()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="viewport-cell"
  class:active
  class:multi={in_grid}
  style:--canvas-cursor={cursor}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onpointerenter={onactivate}
  ondblclick={handle_dblclick}
>
  {#if label}<span class="viewport-label">{label}</span>{/if}
  <Canvas createRenderer={create_renderer}>
    <StructureScene
      {structure}
      {base_structure}
      {...scene_props}
      {...in_grid ? { auto_rotate: 0 } : {}}
      {camera_position}
      {camera_target}
      {camera_projection}
      {camera_direction}
      {interactive}
      gizmo={gizmo_prop}
      {lattice_props}
      {volumetric_data}
      {isosurface_settings}
      {active_volume_idx}
      {volume_scaling}
      bind:camera_is_moving
      bind:selected_sites
      {active_sites}
      bind:hovered_idx={hovered_site_idx}
      bind:measured_sites
      bind:scene
      bind:camera
      bind:orbit_controls
      bind:rotation_target_ref
      bind:initial_computed_zoom
      bind:hidden_elements
      bind:hidden_prop_vals
      bind:element_radius_overrides
      bind:site_radius_overrides
      bind:added_bonds
      bind:removed_bonds
      bind:bond_order_overrides
      {bond_edits_enabled}
      bind:bond_edit_mode
      {bond_edit_order}
      {measure_mode}
      {width}
      {height}
      {atom_color_config}
      {sym_data}
      {on_sites_moved}
      {on_operation_start}
      {on_bond_edit_start}
      {on_add_atom}
      bind:add_atom_mode
      bind:add_element
      bind:cursor
      bind:dragging_atoms
      bind:polyhedra_rendered_elements
    />
  </Canvas>
</div>

<style>
  .viewport-cell {
    position: relative;
    overflow: hidden;
    box-sizing: border-box;
    height: 100%;
    width: 100%;
    min-width: 0;
    min-height: 0;
  }
  /* In multi-view, give each pane a subtle separator and highlight the active one */
  .viewport-cell.multi {
    border: 1px solid var(--struct-viewport-border, rgba(128, 128, 128, 0.35));
  }
  /* Let the active pane's hover tooltip overflow into neighboring panes instead of
    being clipped, and raise it above sibling panes so it paints on top. The WebGL
    canvas is sized to the cell by JS, so only HTML overlays (the tooltip) overflow. */
  .viewport-cell.multi.active {
    border-color: var(--struct-viewport-active-border, var(--accent-color, #4a9eff));
    overflow: visible;
    z-index: 1;
  }
  .viewport-label {
    position: absolute;
    top: 3px;
    left: 5px;
    z-index: 1;
    pointer-events: none;
    font-size: var(--struct-viewport-label-font-size, 0.8em);
    font-weight: 500;
    padding: 1px 5px;
    border-radius: var(--border-radius, 3pt);
    color: var(--struct-viewport-label-color, var(--text-color, currentColor));
    background: var(
      --struct-viewport-label-bg,
      color-mix(in srgb, var(--page-bg, Canvas) 65%, transparent)
    );
  }
  .viewport-cell :global(canvas) {
    cursor: var(--canvas-cursor, default);
  }
</style>

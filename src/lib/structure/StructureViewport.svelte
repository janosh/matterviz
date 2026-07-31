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
  import { StatusMessage } from '$lib/feedback'
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
  import type { DisplacementSummary } from '$lib/structure/measure'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps } from 'svelte'
  import { untrack } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { create_renderer, responsive_gizmo_size } from '$lib/scene'
  import type { Camera, OrthographicCamera, Scene } from 'three/webgpu'
  import type { AtomColorConfig } from './atom-properties'
  import StructureScene from './StructureScene.svelte'

  // Self-heal a lost GPU device (driver reset, resource pressure): unlike WebGL there is no
  // "restored" event, so recovery means remounting the <Canvas> for a fresh renderer.
  let canvas_remount_token = $state(0)
  let remount_timer: ReturnType<typeof setTimeout> | undefined
  let recovery_reset_timer: ReturnType<typeof setTimeout> | undefined
  let recovery_attempts = 0
  let recovery_failed = $state(false)

  const create_viewport_renderer = (canvas: HTMLCanvasElement) =>
    create_renderer(canvas, {
      // three suppresses losses caused by our own dispose(), so this only fires on real ones.
      on_device_lost: () => {
        // Recovery rebuilds the <Canvas> and a fresh scene re-derives the default camera, so
        // capture the live view first and resume there rather than discarding the user's orbit.
        camera_position = read_camera_position() ?? camera_position
        camera_target = read_orbit_target() ?? camera_target
        clearTimeout(recovery_reset_timer)
        if (recovery_attempts >= 3) {
          recovery_failed = true
          return
        }
        recovery_attempts += 1
        // Losses can arrive in bursts (e.g. both panes of a grid evicted at once); keep a
        // single pending remount so the burst doesn't tear down the renderer it just built.
        clearTimeout(remount_timer)
        remount_timer = setTimeout(() => (canvas_remount_token += 1), 1000)
        // Reset only after a stable remount; an immediate reset would allow endless
        // eviction ping-pong while the page exceeds its GPU budget.
        recovery_reset_timer = setTimeout(() => (recovery_attempts = 0), 5000)
      },
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
    reference_structure = undefined,
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
    // One-shot fly-to, routed to the primary pane only: `scene_props` is spread into every
    // pane, so putting the request there would collapse all four fixed multi-view directions
    // onto one axis. Bindable because StructureScene clears it as it starts the flight.
    fly_to_request = $bindable(undefined),
    displacement_summary = $bindable(null),

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
    reference_structure?: AnyStructure // comparison geometry for displacement arrows
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
    fly_to_request?: Vec3
    displacement_summary?: DisplacementSummary | null
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

  // Multi-view panes are ~half the viewer, so shrink the gizmo to stay proportional
  let gizmo_prop = $derived.by(() => {
    if (!gizmo || !in_grid) return gizmo
    const size = responsive_gizmo_size(width, height)
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
      self_written = { position: camera_position, target: camera_target, zoom: read_zoom() }
    }
    on_camera_reset?.({ structure, camera_has_moved: false, camera_position, camera_target })
  }

  // The view this pane last wrote into the bindable props; anything else appearing there came
  // from the caller. That is the only way to tell the two apart, since both arrive as props.
  // Zoom rides along unpropped: it is the only thing an orthographic wheel changes, so pose
  // alone cannot tell whether the view moved.
  let self_written: { position?: Vec3; target?: Vec3; zoom?: number } = {}
  const same_pose = (pose_a?: Vec3, pose_b?: Vec3): boolean =>
    pose_a === pose_b ||
    Boolean(pose_a && pose_b && pose_a.every((coord, idx) => coord === pose_b[idx]))
  const read_zoom = (): number | undefined =>
    camera && `zoom` in camera ? (camera as OrthographicCamera).zoom : undefined

  const sync_camera = () => {
    const pos = read_camera_position()
    if (!pos) return
    const [target, zoom] = [read_orbit_target(), read_zoom()]
    // Interactions that end where they started (a click, or the effect cleanup below running
    // after the end listener already synced) would otherwise emit a second, identical move.
    const unmoved =
      same_pose(pos, self_written.position) &&
      same_pose(target, self_written.target) &&
      zoom === self_written.zoom
    if (unmoved) return
    camera_position = pos
    camera_target = target
    self_written = { position: pos, target, zoom }
    on_camera_move?.({
      structure,
      camera_has_moved: true,
      camera_position: pos,
      camera_target: target,
    })
  }

  const mark_moved = () => {
    report_moved?.(true)
    sync_camera()
  }

  // A wheel zoom dispatches start and end in the same tick, so the effect below never observes
  // `camera_is_moving` as true. Without this listener a zoom would leave the pose unpersisted
  // and the reset control (gated on report_moved) unreachable.
  $effect(() => {
    const controls = orbit_controls
    if (!controls) return
    controls.addEventListener(`end`, mark_moved)
    return () => controls.removeEventListener(`end`, mark_moved)
  })

  // Track camera movement: keep camera_target in sync with the orbit controls and emit
  // on_camera_move (primary pane only) while the controls are active.
  $effect(() => {
    if (!camera_is_moving) return
    mark_moved()
    const interval = setInterval(sync_camera, 200)
    return () => {
      clearInterval(interval)
      // Movement always stops between ticks (mouse release, fly-to landing), so the final
      // pose needs one more sync. Skipped when the effect re-runs for any other reason —
      // e.g. a structure swap mid-drag, where the pose is about to be reset anyway.
      if (!camera_is_moving) sync_camera()
    }
  })

  // Push a caller-supplied pose onto the live camera and orbit target instead of leaving it
  // to the declarative <T.PerspectiveCamera position>: while the controls settle (damping,
  // auto-rotate) the move sync above writes the live pose back over the prop, losing the
  // caller's. Poses this pane wrote itself are skipped — re-applying them would fight the
  // controls that produced them.
  $effect(() => {
    const [next_position, next_target] = [camera_position, camera_target]
    untrack(() => {
      if (!camera || !orbit_controls?.target) return
      const move_camera =
        next_position.some((coord) => coord !== 0) &&
        !same_pose(next_position, self_written.position)
      const target =
        next_target && !same_pose(next_target, self_written.target) ? next_target : undefined
      if (!move_camera && !target) return
      if (move_camera) camera.position.set(...next_position)
      if (target) orbit_controls.target.set(...target)
      orbit_controls.update?.()
      self_written = {
        position: read_camera_position(),
        target: read_orbit_target(),
        zoom: read_zoom(),
      }
    })
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

  $effect(() => () => {
    clearTimeout(remount_timer)
    clearTimeout(recovery_reset_timer)
  })
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
  {#if recovery_failed}
    <div class="context-recovery-error">
      <StatusMessage
        message="Unable to restore the 3D view after repeated GPU device loss. Reload the page to retry."
        type="error"
      />
    </div>
  {/if}
  {#key canvas_remount_token}
    <Canvas createRenderer={create_viewport_renderer}>
      <StructureScene
        {structure}
        {base_structure}
        {reference_structure}
        {...scene_props}
        {...in_grid ? { auto_rotate: 0 } : {}}
        bind:camera_position
        bind:camera_target
        bind:fly_to_request
        bind:displacement_summary
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
  {/key}
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
    z-index: var(--z-index-viewer-label, 1);
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
  .context-recovery-error {
    position: absolute;
    inset: 0;
    z-index: var(--z-index-viewer-tooltip, 1000);
    display: grid;
    place-items: center;
    padding: 1em;
    pointer-events: none;
    will-change: transform;
  }
  .viewport-cell :global(canvas) {
    cursor: var(--canvas-cursor, default);
  }
</style>

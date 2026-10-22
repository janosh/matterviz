<script lang="ts">
  import { numeric_sites, get_site, site_count } from './site'
  import type { ColorScale } from '#lib/plot/core/types.js'
  import { resolve_color_token } from '#lib/colors/backdrop.svelte.js'
  import { HIGHLIGHT } from '#lib/colors/index.js'
  import type { ElementSymbol } from '#lib/element/index.js'
  import Isosurface from '#lib/isosurface/Isosurface.svelte'
  import SlicePlane from '#lib/isosurface/SlicePlane.svelte'
  import type { IsosurfaceSettings, VolumetricData } from '#lib/isosurface/types.js'
  import { DEFAULT_ISOSURFACE_SETTINGS } from '#lib/isosurface/types.js'
  import type { Vec2, Vec3 } from '#lib/math.js'
  import * as math from '#lib/math.js'
  import type { AtomColorField } from './atom-color-field'
  import { AtomGroupBuilder, site_anchor, tooltip_fill } from './atom-groups'
  import ColorFieldVolume from './ColorFieldVolume.svelte'
  import type { CutawayInput } from './cutaway'
  import { cutaway_contains, resolve_cutaway, StructureCutawayGroup } from './cutaway'
  import {
    bind_renderer,
    brighten_hex,
    clear_pan_offset,
    create_fit_zoom,
    create_fly_to,
    create_scene_camera,
    DEFAULT_FLY_TO_DURATION_MS,
    flight_holds,
    HOVER_SHELL_SCALE,
    perspective_distance_for_zoom,
    scene_interactivity,
    scene_key_walk,
    SceneCamera,
    SceneLights,
  } from '#lib/scene/index.js'
  import type { SceneControlProps, TapEvent } from '#lib/scene/index.js'
  import type { ShowBonds, VectorColorMode, VectorLayerConfig } from '#lib/settings.js'
  import { DEFAULTS, SETTINGS_CONFIG } from '#lib/settings.js'
  import { applies_to_structure, resolve_cell_vectors } from './settings'
  import { create_pulse_animation, pulsing_highlight_opacity } from '#lib/effects.svelte.js'
  import { resolve_theme_text_color } from '#lib/state.svelte.js'
  import { get_element_palette } from './element-palette.svelte'
  import type {
    AnyStructure,
    BondEditMode,
    BondOrder,
    BondPair,
    MeasureMode,
    Site,
    StructureBond,
  } from '#lib/structure/index.js'
  import {
    camera_needs_fit,
    camera_position_for_target,
    characteristic_atom_spacing,
    get_center_of_mass,
    get_orig_site_idx,
    is_image_site,
    Lattice,
    ortho_zoom_for_extent,
    perspective_distance_for_extent,
    site_base_radius,
    structure_fit_frame,
    follow_center,
    outgrows_view,
  } from '#lib/structure/index.js'
  import { build_vector_layers, pack_arrows, type VectorLayer } from './arrow-instances'
  import { resolve_arrow_size } from './vectors'
  import ArrowInstances from './ArrowInstances.svelte'
  import BondContextMenu from './BondContextMenu.svelte'
  import BondEditTargets from './BondEditTargets.svelte'
  import InstancedStructure from './InstancedStructure.svelte'
  import type { LatticePlane } from './lattice-planes'
  import LatticePlanes from './LatticePlanes.svelte'
  import MeasurementOverlays from './MeasurementOverlays.svelte'
  import SiteHighlights, { type HighlightTarget } from './SiteHighlights.svelte'
  import SiteLabels from './SiteLabels.svelte'
  import SiteTooltip from './SiteTooltip.svelte'
  import type { AtomPropertyColors } from '#lib/structure/atom-properties.js'
  import type { SymmetryElement } from '#lib/symmetry/index.js'
  import { has_visible_symmetry_overlay } from '#lib/symmetry/symmetry-elements.js'
  import SymmetryElements from '#lib/symmetry/SymmetryElements.svelte'
  import * as measure from '#lib/structure/measure.js'
  import { is_crystal } from '#lib/structure/validation.js'
  import { to_error } from 'svelte-widgets/utils'
  import { merge_split_partial_sites } from './partial-occupancy'
  import {
    bond_menu_position,
    instance_handlers,
    is_shift_click,
    next_site_selection,
    scene_cursor,
    ScenePointer,
    type PickState,
  } from './scene-picking.svelte'
  import { T, useTask, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { type ComponentProps, type Snippet, untrack } from 'svelte'
  import type { TooltipProp } from '#lib/tooltip/index.js'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { Euler, OrthographicCamera, Vector3 } from 'three/webgpu'
  import type { Mesh, WebGPURenderer } from 'three/webgpu'
  import { bond_neighbor_summary, bond_records, type BondData } from './bond-rendering'
  import type { BondEditResult, BondingStrategy, BondKeyTarget } from './bonding'
  import {
    add_or_restore_bond,
    canonicalize_bond_target,
    get_bond_data,
    delete_bond as apply_delete_bond,
    get_explicit_bond_metadata,
    rendered_bond_key_for,
    set_bond_order as apply_set_bond_order,
    structure_bond_to_bond_pair,
  } from './bonding'
  import { compose_perceived_bonds, perceive_bond_orders } from './index'
  import type { PolyhedraColorMode, PolyhedraNeighborMode, Polyhedron } from './polyhedra'
  import { compute_polyhedra } from './polyhedra'
  import TrajectoryLines from './TrajectoryLines.svelte'
  import type {
    TrajectoryLineColorMode,
    TrajectoryLinesStats,
    TrajectoryLineWrapMode,
  } from './trajectory-lines'
  import { trajectory_trail_anchors } from './trajectory-lines'
  import type { TrajectoryPositionStream } from '#lib/trajectory/index.js'

  type BondMenuTarget = BondKeyTarget & { position: Vec3 }

  let {
    structure = undefined,
    base_structure = undefined,
    to_base_site_idx = get_orig_site_idx,
    render_token,
    on_rendered,
    atom_radius = DEFAULTS.structure.atom_radius,
    atom_opacity = 1,
    same_size_atoms = false,
    // bindable: the auto-placement effect below assigns the position it computes, which a
    // plain prop would strand here, leaving the parent to re-push its stale value
    camera_position = $bindable(undefined),
    camera_target = $bindable(undefined),
    camera_direction = undefined,
    camera_up = undefined,
    camera_projection = DEFAULTS.structure.camera_projection,
    rotation_damping = DEFAULTS.structure.rotation_damping,
    max_zoom = DEFAULTS.structure.max_zoom,
    min_zoom = DEFAULTS.structure.min_zoom,
    rotate_speed = DEFAULTS.structure.rotate_speed,
    zoom_speed = DEFAULTS.structure.zoom_speed,
    pan_speed = DEFAULTS.structure.pan_speed,
    zoom_to_cursor = DEFAULTS.structure.zoom_to_cursor,
    show_atoms = DEFAULTS.structure.show_atoms,
    show_bonds = DEFAULTS.structure.show_bonds,
    defer_expensive_geometry = false,
    show_site_labels = DEFAULTS.structure.show_site_labels,
    show_site_indices = DEFAULTS.structure.show_site_indices,
    site_label_size = DEFAULTS.structure.site_label_size,
    site_label_offset = DEFAULTS.structure.site_label_offset,
    site_label_bg_color = DEFAULTS.structure.site_label_bg_color,
    site_label_color = DEFAULTS.structure.site_label_color,
    site_label_padding = DEFAULTS.structure.site_label_padding,
    vector_configs = {},
    vector_scale = DEFAULTS.structure.vector_scale,
    vector_color = DEFAULTS.structure.vector_color,
    vector_color_mode = DEFAULTS.structure.vector_color_mode as VectorColorMode,
    vector_color_scale = DEFAULTS.structure.vector_color_scale,
    vector_normalize = DEFAULTS.structure.vector_normalize,
    vector_uniform_thickness = DEFAULTS.structure.vector_uniform_thickness,
    vector_origin_gap = DEFAULTS.structure.vector_origin_gap,
    vector_shaft_radius = DEFAULTS.structure.vector_shaft_radius,
    vector_arrow_head_radius = DEFAULTS.structure.vector_arrow_head_radius,
    vector_arrow_head_length = DEFAULTS.structure.vector_arrow_head_length,
    gizmo = DEFAULTS.structure.gizmo,
    hovered_idx = $bindable(null),
    auto_rotate = DEFAULTS.structure.auto_rotate,
    bond_thickness = DEFAULTS.structure.bond_thickness,
    bond_color = DEFAULTS.structure.bond_color,
    bonding_strategy = DEFAULTS.structure.bonding_strategy,
    auto_bond_order = DEFAULTS.structure.auto_bond_order,
    aromatic_display = DEFAULTS.structure.aromatic_display,
    bonding_options = {},
    show_polyhedra = DEFAULTS.structure.show_polyhedra,
    polyhedra_neighbor_mode = DEFAULTS.structure.polyhedra_neighbor_mode,
    polyhedra_opacity = DEFAULTS.structure.polyhedra_opacity,
    polyhedra_show_edges = DEFAULTS.structure.polyhedra_show_edges,
    polyhedra_color_mode = DEFAULTS.structure.polyhedra_color_mode,
    polyhedra_color = DEFAULTS.structure.polyhedra_color,
    polyhedra_hide_center_atoms = DEFAULTS.structure.polyhedra_hide_center_atoms,
    polyhedra_min_neighbors = DEFAULTS.structure.polyhedra_min_neighbors,
    polyhedra_max_neighbors = DEFAULTS.structure.polyhedra_max_neighbors,
    polyhedra_excluded_elements = DEFAULTS.structure.polyhedra_excluded_elements,
    polyhedra_included_elements = DEFAULTS.structure.polyhedra_included_elements,
    polyhedra_rendered_elements = $bindable<string[]>([]),
    fov = DEFAULTS.structure.fov,
    initial_zoom = DEFAULTS.structure.initial_zoom,
    ambient_light = DEFAULTS.structure.ambient_light,
    directional_light = DEFAULTS.structure.directional_light,
    sphere_segments = DEFAULTS.structure.sphere_segments,
    cell_edge_color = DEFAULTS.structure.cell_edge_color,
    cell_surface_color = DEFAULTS.structure.cell_surface_color,
    cell_edge_width = DEFAULTS.structure.cell_edge_width,
    cell_edge_opacity = DEFAULTS.structure.cell_edge_opacity,
    cell_surface_opacity = DEFAULTS.structure.cell_surface_opacity,
    show_cell_vectors = undefined,
    lattice_planes = [],
    symmetry_elements = [],
    symmetry_elements_props = {},
    symmetry_declutter = true,
    atom_label,
    tooltip,
    camera_is_moving = $bindable(false),
    series_key = undefined,
    width = 0,
    height = 0,
    measure_mode = `distance`,
    selected_sites = $bindable([]),
    measured_sites = $bindable([]),
    added_bonds = $bindable([]),
    removed_bonds = $bindable([]),
    bond_order_overrides = $bindable([]),
    bond_edits_enabled = true,
    bond_edit_mode = $bindable<BondEditMode>(`add`),
    bond_edit_order = 1,
    selection_highlight_color = HIGHLIGHT.select,
    // Active highlight group with different color
    active_sites = [],
    active_highlight_color = `var(--struct-active-highlight-color, #2563eb)`,
    rotation = DEFAULTS.structure.rotation,
    scene = $bindable(),
    camera = $bindable(),
    orbit_controls = $bindable(),
    get_reset_target = $bindable(),
    initial_computed_zoom = $bindable(),
    hidden_elements = new SvelteSet(),
    hidden_prop_vals = $bindable(new SvelteSet<number | string>()),
    element_radius_overrides = $bindable<Partial<Record<ElementSymbol, number>>>({}),
    site_radius_overrides = $bindable<SvelteMap<number, number>>(new SvelteMap()),
    property_colors = null,
    atom_color_field,
    volume_color_field,
    volume_opacity = 0.35,
    cutaway: cutaway_input,
    // Edit-atoms mode callbacks
    on_sites_moved,
    on_operation_start,
    on_bond_edit_start,
    on_add_atom,
    add_atom_mode = $bindable(false),
    add_element = $bindable(`C`),
    cursor = $bindable(`default`),
    dragging_atoms = $bindable(false),
    volumetric_data = undefined,
    isosurface_settings = DEFAULT_ISOSURFACE_SETTINGS,
    slice_polygon = [],
    supercell_tiling = [1, 1, 1],
    interactive = true,
    fly_to_request = $bindable(undefined),
    reference_structure = undefined,
    show_displacement_arrows = DEFAULTS.structure.show_displacement_arrows,
    displacement_arrow_scale = DEFAULTS.structure.displacement_arrow_scale,
    displacement_arrow_color = DEFAULTS.structure.displacement_arrow_color,
    displacement_summary = $bindable(null),
    trajectory_position_stream = null,
    show_trajectory_lines = DEFAULTS.structure.show_trajectory_lines,
    trajectory_line_end_frame = undefined,
    trajectory_line_trail_frames = DEFAULTS.structure.trajectory_line_trail_frames,
    trajectory_line_frame_stride = DEFAULTS.structure.trajectory_line_frame_stride,
    trajectory_line_elements = null,
    trajectory_line_color_mode = DEFAULTS.structure
      .trajectory_line_color_mode as TrajectoryLineColorMode,
    trajectory_line_wrap_mode = DEFAULTS.structure
      .trajectory_line_wrap_mode as TrajectoryLineWrapMode,
    trajectory_lines_emphasis = false,
    trajectory_lines_result = $bindable(null),
  }: SceneControlProps & {
    structure?: AnyStructure
    render_token?: unknown
    on_rendered?: (token: unknown) => void
    base_structure?: AnyStructure // untransformed cell: supplies the drawn lattice and the displacement reference
    // Index into base_structure of a displayed site; Structure passes its session's rule, which
    // ignores unit_cell_idx from a supercell built outside the viewer
    to_base_site_idx?: (site: Site, site_idx: number) => number
    atom_radius?: number // scale factor for atomic radii
    same_size_atoms?: boolean // uniform radius for all atoms (else per-element atomic radii)
    camera_position?: [x: number, y: number, z: number] // initial camera position; unset fits the structure
    camera_target?: Vec3 // orbit-controls target (pans offset the camera, not this)
    // When set (and camera_position is unset), auto-place the camera along this
    // direction from the structure center (used by the multi-side view for fixed angles)
    camera_direction?: Vec3
    camera_up?: Vec3 // world direction drawn as screen up (default +y); not along camera_direction
    show_atoms?: boolean
    show_bonds?: ShowBonds
    defer_expensive_geometry?: boolean
    show_site_labels?: boolean
    show_site_indices?: boolean
    vector_configs?: Record<string, VectorLayerConfig>
    vector_scale?: number
    vector_color?: string
    vector_color_mode?: VectorColorMode
    vector_color_scale?: ColorScale
    vector_normalize?: boolean
    vector_uniform_thickness?: boolean
    vector_origin_gap?: number
    vector_shaft_radius?: number
    vector_arrow_head_radius?: number
    vector_arrow_head_length?: number
    hovered_idx?: number | null
    bond_thickness?: number
    bond_color?: string
    bonding_strategy?: BondingStrategy
    auto_bond_order?: boolean
    aromatic_display?: `aromatic` | `kekule`
    bonding_options?: Record<string, unknown>
    show_polyhedra?: ShowBonds // when to render coordination polyhedra
    polyhedra_neighbor_mode?: PolyhedraNeighborMode
    polyhedra_opacity?: number
    polyhedra_show_edges?: boolean
    polyhedra_color_mode?: PolyhedraColorMode
    polyhedra_color?: string // custom color used when polyhedra_color_mode is 'uniform'
    polyhedra_hide_center_atoms?: boolean
    polyhedra_min_neighbors?: number // min coordination number to form a polyhedron
    polyhedra_max_neighbors?: number // max CN - skips e.g. CN-12 cuboctahedra
    polyhedra_excluded_elements?: readonly string[] // elements never used as polyhedra centers
    polyhedra_included_elements?: readonly string[] // force-include (bypasses spectator hiding)
    polyhedra_rendered_elements?: string[] // (output) elements that currently have polyhedra
    sphere_segments?: number
    // Unit-cell rendering (forwarded to Lattice)
    cell_edge_color?: string
    cell_surface_color?: string
    cell_edge_width?: number
    cell_edge_opacity?: number
    cell_surface_opacity?: number
    show_cell_vectors?: boolean
    // (hkl) lattice planes drawn inside the cell. Miller indices refer to the input cell;
    // like symmetry_elements, StructureViewport hides them when a different cell is shown.
    // Indices are used as given, so (222) draws the half-spacing stack, not the (111) planes.
    lattice_planes?: LatticePlane[]
    // Symmetry elements (from symmetry_elements_from_ops) to overlay on the structure.
    // Fractional coords must refer to the SAME cell as the rendered lattice (moyo
    // operations are in the input-cell frame, i.e. the original untransformed cell).
    symmetry_elements?: SymmetryElement[]
    symmetry_elements_props?: Omit<
      ComponentProps<typeof SymmetryElements>,
      `elements` | `lattice` | `tiling`
    >
    // Auto-reduce visual clutter while a symmetry-element overlay is visible: hides
    // coordination polyhedra and calculated bonds, and shrinks atoms so axes/planes/
    // centers stay readable. Purely derived — toggling the overlay off restores the
    // configured appearance.
    symmetry_declutter?: boolean
    atom_label?: Snippet<[{ site: Site; site_idx: number }]>
    // false hides the hovered-atom tooltip, a snippet adds rows below the built-in site info
    tooltip?: TooltipProp<{ site: Site; site_idx: number }>
    site_label_size?: number
    site_label_offset?: Vec3
    site_label_bg_color?: string
    site_label_color?: string
    site_label_padding?: number
    camera_is_moving?: boolean // bindable: true while orbit controls are active
    series_key?: unknown // changes with a new series (file); frames within one share it
    width?: number // Viewer dimensions for responsive zoom
    height?: number
    // measurement props
    measure_mode?: MeasureMode
    selected_sites?: number[]
    measured_sites?: number[]
    added_bonds?: StructureBond[]
    removed_bonds?: StructureBond[]
    bond_order_overrides?: StructureBond[]
    bond_edits_enabled?: boolean
    bond_edit_mode?: BondEditMode
    bond_edit_order?: BondOrder
    selection_highlight_color?: string
    // Support for active highlight group with different color
    active_sites?: number[]
    active_highlight_color?: string
    rotation?: Vec3 // rotation control prop
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`] // OrbitControls instance
    get_reset_target?: () => Vec3 // Compute bounds only when a reset needs them.
    initial_computed_zoom?: number // the latest fit's zoom, for reset (which then refits)
    hidden_elements?: Set<ElementSymbol>
    hidden_prop_vals?: Set<number | string> // Track hidden property values (e.g. Wyckoff positions, coordination numbers)
    element_radius_overrides?: Partial<Record<ElementSymbol, number>> // Per-element absolute radius in Angstroms
    site_radius_overrides?: SvelteMap<number, number> // Per-site absolute radius in Angstroms
    // Per-site colors/values for the active non-element coloring mode, indexed by the sites of
    // `structure` (see StructureSession.property_colors). Null = color atoms by element.
    property_colors?: AtomPropertyColors | null
    atom_color_field?: AtomColorField
    atom_opacity?: number
    volume_color_field?: AtomColorField
    volume_opacity?: number
    cutaway?: CutawayInput
    // Edit-atoms mode callbacks and state
    on_sites_moved?: (scene_indices: number[], delta: Vec3) => void
    on_operation_start?: () => void
    on_bond_edit_start?: () => void
    on_add_atom?: (xyz: Vec3, element: ElementSymbol) => void
    add_atom_mode?: boolean // whether user is in click-to-place add-atom sub-mode
    add_element?: ElementSymbol // element to add when clicking in add-atom mode
    cursor?: string // cursor style for the 3D canvas
    dragging_atoms?: boolean // true while TransformControls drag is active (skips expensive recalculations)
    // Loaded volumetric datasets for isosurface rendering
    volumetric_data?: VolumetricData[]
    isosurface_settings?: IsosurfaceSettings // Isosurface rendering settings
    slice_polygon?: Vec3[] // where a 2D volume slice cuts the cell (see slice_cell_polygon)
    // How many unit cells the displayed structure spans along a/b/c. Tiles the drawn cell
    // and the isosurface geometry; 1x1x1 until an applied supercell lands.
    supercell_tiling?: Vec3
    // When false, render the scene without hover/edit raycast helpers. Used by multi-side
    // view so inactive panes skip interaction-only work while the active pane stays editable.
    interactive?: boolean
    // One-shot camera command: fly to look along this direction (structure coordinates, need
    // not be normalized). Bindable because the effect below clears it as it starts the
    // flight; asking for the same direction again therefore flies again.
    fly_to_request?: Vec3
    // Comparison overlay: when set, each atom gets an arrow from where it sat in this
    // reference geometry to where it sits now. Must have the same atom count and ordering as
    // the untransformed structure (base_structure when supercells/image atoms are active).
    reference_structure?: AnyStructure
    show_displacement_arrows?: boolean
    displacement_arrow_scale?: number
    displacement_arrow_color?: string
    displacement_summary?: measure.DisplacementSummary | null // (output) readout vs reference
    // Per-atom trajectory trails. Inert unless a caller supplies a whole-trajectory position
    // stream (TrajectoryRun.collect_positions) — a single structure has
    // no path to draw, so nothing changes for plain Structure users.
    trajectory_position_stream?: TrajectoryPositionStream | null
    show_trajectory_lines?: boolean
    // Newest collected frame the trails reach; drive from the playhead for a comet tail
    trajectory_line_end_frame?: number
    trajectory_line_trail_frames?: number // 0 = whole run
    trajectory_line_frame_stride?: number
    trajectory_line_elements?: readonly ElementSymbol[] | null // null = all species
    trajectory_line_color_mode?: TrajectoryLineColorMode
    trajectory_line_wrap_mode?: TrajectoryLineWrapMode
    trajectory_lines_emphasis?: boolean // a host run's short trails (see TrajectoryLines)
    trajectory_lines_result?: TrajectoryLinesStats | null // (output) vertex/segment counts
  } = $props()

  const { autoRenderTask, renderer } = useThrelte<WebGPURenderer>()
  let submitted_token: unknown
  let render_calls = renderer.info.render.calls
  useTask(
    () => {
      const calls = renderer.info.render.calls
      if (calls === render_calls) return
      render_calls = calls
      if (!renderer.initialized || !render_token || submitted_token === render_token) return
      submitted_token = render_token
      on_rendered?.(render_token)
    },
    { after: autoRenderTask, autoInvalidate: false },
  )

  const threlte = bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })
  // Each tick animates a highlight material's opacity, which invalidates the whole scene, so
  // gate on the renderer canvas: a selection left standing would otherwise re-render an
  // off-screen viewport every frame — once per pane in the 2x2 multi-side view.
  const pulse = create_pulse_animation(
    () => selected_sites.length > 0 || active_sites.length > 0,
    { step: 0.012, element: () => threlte.renderer?.domElement },
  )
  let pulse_opacity = $derived(pulsing_highlight_opacity(pulse.unit))

  // Camera fly-to, shared with the orientation gizmo. Driven by `fly_to_request` because the
  // zone-axis control lives in the controls pane, outside the Threlte canvas, and so has no
  // access to the camera or orbit controls. A flight moves the camera without touching the
  // orbit controls' own start/end handlers, so it reports movement through the same
  // camera_is_moving flag those handlers use — else the parent never syncs the new pose.
  const fly_to = create_fly_to({
    camera: () => camera,
    controls: () => orbit_controls,
    duration_ms: () => DEFAULT_FLY_TO_DURATION_MS,
    invalidate: threlte.invalidate,
    on_start: () => (camera_is_moving = true),
    on_end: () => (camera_is_moving = false),
  })
  useTask(Symbol(`matterviz-structure-fly-to`), (delta) => fly_to.step(delta), {
    autoInvalidate: false,
  })

  $effect(() => {
    const direction = fly_to_request
    if (!direction) return
    // Consume the request as it is taken: this component is rebuilt from scratch when the
    // canvas remounts after GPU device loss, and a still-pending request would replay the
    // last flight as part of the recovery.
    fly_to_request = undefined
    // The atoms sit inside a group carrying the manual `rotation`, so a direction expressed in
    // crystal/structure coordinates has to be rotated into world space before the camera flies.
    const world_dir = new Vector3(...direction).applyEuler(new Euler(...rotation))
    untrack(() => fly_to.start([world_dir.x, world_dir.y, world_dir.z]))
  })
  $effect(() => () => fly_to.release())

  // Keep reset centered on the current structure without moving the live camera between
  // trajectory frames. On first mount, an explicit camera pose retains its supplied target.
  // Non-reactive: only compares successive effect runs
  let target_structure: AnyStructure | undefined
  let has_target_structure = false
  $effect(() => {
    const current_structure = structure
    if (has_target_structure && current_structure === target_structure) return
    const is_initial_structure = !has_target_structure
    target_structure = current_structure
    has_target_structure = true
    if (is_initial_structure && camera_position !== undefined) {
      const initial_target = camera_target ?? rotation_target
      get_reset_target = () => initial_target
    } else get_reset_target = () => fit_frame.center
  })

  // Hover and edit-bonds press state; hovered_idx stays the bindable prop the parent reads
  const pointer = new ScenePointer({
    get: () => hovered_idx,
    set: (site_idx) => (hovered_idx = site_idx),
  })
  $effect(() => pointer.dispose)

  // === Edit-atoms mode state ===
  let transform_object = $state<Mesh | undefined>(undefined)
  // Plain variable — only used imperatively in TransformControls drag handlers
  let drag_start_centroid: Vec3 | null = null
  // Frozen centroid set on drag start. While non-null, the TransformControls mesh
  // position stays at this fixed value so Svelte's reactive centroid updates (from
  // PBC wrapping) don't fight TransformControls. Cleared on mouseUp so the mesh
  // snaps to the new wrapped centroid.
  let frozen_centroid = $state<Vec3 | null>(null)

  let bond_context_menu = $state<BondMenuTarget | null>(null)
  // Threlte/HTML pointer events can close the visible menu before a button
  // handler runs, so keep the target bond separately for menu actions.
  let bond_context_target: BondMenuTarget | null = null

  function close_bond_context_menu() {
    bond_context_menu = null
    bond_context_target = null
  }

  const canonical_bond_target = (bond: BondKeyTarget): BondKeyTarget =>
    canonicalize_bond_target(bond, structure?.sites)

  const bond_key_for = (bond: BondKeyTarget): string =>
    rendered_bond_key_for(canonical_bond_target(bond))

  const find_added_bond_by_rendered_key = (key: string): StructureBond | undefined =>
    added_bonds.find((bond) => rendered_bond_key_for(bond) === key)

  // The bond a rendered (or context-menu) bond edit applies to: a manually added bond keeps
  // its own key, a calculated one is addressed by its canonical key
  function resolve_bond_edit_target({
    site_idx_1,
    site_idx_2,
    cell_shift,
  }: BondKeyTarget): BondKeyTarget {
    const rendered_target = { site_idx_1, site_idx_2, cell_shift }
    const rendered_key = rendered_bond_key_for(rendered_target)
    return (
      find_added_bond_by_rendered_key(rendered_key) ?? canonical_bond_target(rendered_target)
    )
  }

  const is_image_site_idx = (site_idx: number): boolean =>
    is_image_site(get_site(structure, site_idx))

  const can_select_bond_site = (site_idx: number): boolean =>
    bond_edits_enabled && get_site(structure, site_idx) != null

  const can_edit_bond = (bond: BondKeyTarget): boolean => {
    const target = canonical_bond_target(bond)
    return (
      bond_edits_enabled &&
      !is_image_site_idx(target.site_idx_1) &&
      !is_image_site_idx(target.site_idx_2)
    )
  }

  function get_current_bond_order(bond: BondKeyTarget): BondOrder | undefined {
    const key = rendered_bond_key_for(bond)
    const matches = (other: BondKeyTarget) => bond_key_for(other) === key
    return (
      find_added_bond_by_rendered_key(key)?.order ??
      bond_order_overrides.find(matches)?.order ??
      added_bonds.find(matches)?.order ??
      bond_records(filtered_bond_pairs).find(matches)?.bond_order
    )
  }

  const pick_state = (): PickState => ({
    measure_mode,
    bond_edit_mode,
    bond_edits_enabled,
    add_atom_mode,
    interactive,
    measured_sites,
    selected_sites,
    hovered_idx,
    hovered_bond_key: pointer.hovered_bond_key,
    can_select_bond_site,
    is_image_site: is_image_site_idx,
  })
  $effect(() => {
    cursor = scene_cursor(pick_state())
  })

  // `position` defaults to the bond midpoint (a menu opened from a completed pair pick)
  function open_bond_context_menu(bond: BondPair, position = bond_menu_position(bond)) {
    if (!can_edit_bond(bond)) return
    const { site_idx_1, site_idx_2, cell_shift } = bond
    bond_context_target = { site_idx_1, site_idx_2, cell_shift, position }
    bond_context_menu = bond_context_target
  }

  const current_bond_edit_state = () => ({
    added_bonds,
    removed_bonds,
    bond_order_overrides,
  })

  function apply_bond_edit_result(result: BondEditResult, close_menu = true) {
    if (!result.changed) return
    on_bond_edit_start?.()
    added_bonds = result.state.added_bonds
    removed_bonds = result.state.removed_bonds
    bond_order_overrides = result.state.bond_order_overrides
    if (close_menu) close_bond_context_menu()
  }

  function add_or_restore_pair(site_idx_1: number, site_idx_2: number) {
    const rendered_target = { site_idx_1, site_idx_2 }
    if (!can_edit_bond(rendered_target)) return
    const edit_state = current_bond_edit_state()
    const canonical_target = canonical_bond_target(rendered_target)
    const canonical_result = add_or_restore_bond(
      edit_state,
      canonical_target,
      editable_perceived_bond_pairs,
      bond_edit_order,
    )
    const use_rendered_target =
      canonical_result.action === `added` &&
      rendered_bond_key_for(canonical_target) !== rendered_bond_key_for(rendered_target)
    const target = use_rendered_target ? rendered_target : canonical_target
    const result = use_rendered_target
      ? add_or_restore_bond(
          edit_state,
          rendered_target,
          editable_perceived_bond_pairs,
          bond_edit_order,
        )
      : canonical_result
    if (result.action === `already-visible`) {
      const [rendered_key, canonical_key] = [
        rendered_bond_key_for(rendered_target),
        bond_key_for(target),
      ]
      const visible_bonds = bond_records(filtered_bond_pairs)
      const bond =
        visible_bonds.find((pair) => rendered_bond_key_for(pair) === rendered_key) ??
        visible_bonds.find((pair) => bond_key_for(pair) === canonical_key)
      if (bond) open_bond_context_menu(bond)
      return
    }
    apply_bond_edit_result(result, false)
  }

  // Order change or deletion of a rendered bond (a null bond is a no-op)
  function edit_bond(
    bond: BondKeyTarget | null,
    edit: (target: BondKeyTarget) => BondEditResult,
  ): void {
    const target = bond && resolve_bond_edit_target(bond)
    if (target && can_edit_bond(target)) apply_bond_edit_result(edit(target))
  }
  const set_context_bond_order = (order: BondOrder) =>
    edit_bond(bond_context_target, (target) =>
      apply_set_bond_order(
        current_bond_edit_state(),
        target,
        editable_perceived_bond_pairs,
        order,
      ),
    )

  const remove_bond = (bond: BondKeyTarget | null) =>
    edit_bond(bond, (target) =>
      apply_delete_bond(current_bond_edit_state(), target, editable_perceived_bond_pairs),
    )

  function select_edit_bonds_site(site_idx: number, event: Event | TapEvent): void {
    toggle_selection(site_idx, event)
    pointer.remember_press(site_idx)
  }

  // Selection handlers shared by instanced atom meshes and per-site hit targets
  // so the edit-bonds click semantics can't drift between the two paths
  const handle_atom_pointerdown = (site_idx: number, event: TapEvent) => {
    if (measure_mode !== `edit-bonds` || bond_edit_mode !== `add`) return
    select_edit_bonds_site(site_idx, event)
  }
  const handle_atom_click = (site_idx: number, event: TapEvent) => {
    if (measure_mode === `edit-bonds`) {
      if (bond_edit_mode !== `add`) return
      if (pointer.skip_pressed_click(site_idx)) return
    }
    toggle_selection(site_idx, event)
  }

  // Pointer handlers for an instanced atom mesh. Inactive grid panes render without
  // raycast handlers (InstancedStructure also skips ghosted edit-mode image atoms). A touch
  // tap shows the atom tooltip besides selecting it (touch_hover).
  const atom_instance_events = (instance_atoms: { site_idx: number }[]) =>
    !interactive
      ? {}
      : touch_hover(
          instance_handlers(instance_atoms, {
            onpointerenter: pointer.set_hover,
            onpointermove: pointer.set_hover,
            onpointerleave: pointer.schedule_hover_clear,
            onpointerdown: handle_atom_pointerdown,
            onclick: handle_atom_click,
          }),
        )

  function toggle_selection(site_index: number, evt?: Event | TapEvent) {
    const next = next_site_selection(site_index, pick_state(), is_shift_click(evt))
    if (!next) return
    measured_sites = next.measured_sites
    selected_sites = next.selected_sites
    if (!next.bond_pair) return
    // When two atoms are selected, add/restore or open order editing.
    add_or_restore_pair(...next.bond_pair)
    measured_sites = []
    selected_sites = []
  }

  $effect(() => {
    void structure
    void measure_mode
    void bond_edit_mode
    void bond_edits_enabled
    untrack(() => {
      close_bond_context_menu()
      pointer.hovered_bond_key = null
    })
  })

  // Pre-effect: drop out-of-range indices before the measurement overlays below index
  // structure.sites with them, not after that render has already run against stale picks.
  $effect.pre(() => {
    const count = site_count(structure)
    if (count <= 0) {
      if (untrack(() => measured_sites.length) > 0) measured_sites = []
      return
    }
    untrack(() => {
      // Only reassign when out-of-range indices were dropped: a fresh (equal)
      // array identity on every structure change would ripple through all
      // measured_sites bindings and their dependents each frame of a trajectory.
      const filtered = measured_sites.filter((idx) => idx >= 0 && idx < count)
      if (filtered.length !== measured_sites.length) measured_sites = filtered
    })
  })

  // One target per pointer event (the front-most atom, bond or hit target), so handlers need no
  // stopPropagation() to keep the ones behind from taking over the hover or selection
  const { set_hover_enabled, touch_hover } = scene_interactivity()
  // No hover raycasts while orbiting or dragging atoms: the highlight and tooltip hopping
  // between atoms under the cursor read as flicker
  $effect(() => set_hover_enabled(!camera_is_moving && !dragging_atoms))
  let hovered_site = $derived(get_site(structure, hovered_idx ?? -1) ?? null)
  // The viewer root walks the drawn atoms in site order (image atoms repeat them), Enter
  // selects like a click. Inactive multi-view panes walk nothing (see scene_key_walk).
  scene_key_walk({
    targets: () =>
      interactive
        ? [...atom_groups.first_by_site.keys()]
            .filter((site_idx) => !is_image_site_idx(site_idx))
            .toSorted((idx_a, idx_b) => idx_a - idx_b)
        : [],
    hover: pointer.set_hover,
    leave: pointer.clear_hover,
    click: (site_idx) => toggle_selection(site_idx),
    hovered: (site_idx) => site_idx === hovered_idx,
    label: (site_idx) => {
      const elements = get_site(structure, site_idx)?.species.map(({ element }) => element)
      return `Site ${site_idx + 1}: ${elements?.join(`, `) ?? ``}`
    },
  })
  let lattice = $derived(structure && `lattice` in structure ? structure.lattice : null)
  // JSON cutaways (movie configs) carry no transform: slice the displayed cell
  const cutaway = $derived(resolve_cutaway(cutaway_input, lattice?.matrix))

  let visual_lattice = $derived(
    base_structure && `lattice` in base_structure ? base_structure.lattice : lattice,
  )

  let rotation_target = $derived(
    lattice
      ? math.scale(math.add(...lattice.matrix), 0.5)
      : ((structure && get_center_of_mass(structure)) ?? ([0, 0, 0] as Vec3)),
  )
  // Negated target for the inner un-translate group (recomputed only on target change)
  let neg_rotation_target = $derived(math.scale(rotation_target, -1) as Vec3)

  // Near/far / skybox — not framing. Lattice avg edge stays stable when images toggle.
  // Edge lengths come from the matrix: raw JSON may omit a/b/c, and a NaN far plane clips
  // every vertex, blanking the canvas.
  let structure_size = $derived.by(() => {
    if (lattice) return lattice.matrix.reduce((sum, vec) => sum + Math.hypot(...vec), 0) / 2
    const count = site_count(structure)
    if (!structure || !count) return 10
    // One pass, no spread: Math.max(...coords) overflows the argument limit past ~1e5 sites
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    const columns = numeric_sites.get(structure)
    const stride = columns?.stride ?? 0
    for (let idx = 0; idx < count; idx++) {
      const values = columns ? columns.coordinates : structure.sites[idx].xyz
      const offset = columns ? idx * stride : 0
      for (let axis = 0; axis < 3; axis++) {
        const value = values[offset + axis]
        if (value < min[axis]) min[axis] = value
        if (value > max[axis]) max[axis] = value
      }
    }
    return Math.max(1, max[0] - min[0], max[1] - min[1], max[2] - min[2])
  })

  // Content AABB fit for ortho zoom / look-at. Frozen while dragging atoms.
  // Snapshot reactive overrides once per change. An empty SvelteMap.get() in the atom
  // loop otherwise allocates a reactive dependency for every atom in a large trajectory.
  const radius_options = $derived({
    same_size_atoms,
    element_radius_overrides: { ...element_radius_overrides },
    site_radius_overrides: site_radius_overrides.size
      ? new Map(site_radius_overrides)
      : undefined,
  })
  const fit_opts = $derived({
    atom_radius_scale: show_atoms ? atom_radius : 0,
    ...radius_options,
    view_up: camera_up,
  })
  let last_fit_frame = { center: [0, 0, 0] as Vec3, extent: 10, spans: [10, 10] as Vec2 }
  // center and orientation-free extent; spans depend on the view, see spans_along
  let fit_frame = $derived.by(() => {
    if (dragging_atoms) return last_fit_frame
    return (last_fit_frame = structure_fit_frame(structure, fit_opts))
  })
  // Screen-aligned spans of `content` seen from `view_dir` (the camera's offset from its target)
  const spans_along = (content: AnyStructure | undefined, view_dir: Vec3 | null | undefined) =>
    structure_fit_frame(content, { ...fit_opts, view_dir }).spans
  // The structure the zoom was last fitted to (initially the mounted one), re-measured by the
  // follow below along wherever the camera looks
  let framed_structure = untrack(() => structure)
  let fit_extent = $derived(fit_frame.extent)

  // Characteristic inter-atomic spacing: cube root of the volume one atom occupies, with any
  // vacuum padding in the cell taken out first (see characteristic_atom_spacing). Excludes PBC
  // image atoms so toggling image atoms doesn't affect arrow sizing.
  let char_atom_spacing = $derived(
    structure ? characteristic_atom_spacing(structure) : structure_size,
  )

  // Compute dynamic camera clipping planes based on structure size
  // This prevents z-fighting and disappearing objects when zooming in close on large supercells
  let camera_near = $derived(Math.max(0.01, structure_size * 0.01))
  let camera_far = $derived(Math.max(1000, structure_size * 100))
  const { minimum: min_fov = 5, maximum: max_fov = 150 } = SETTINGS_CONFIG.structure.fov
  let effective_fov = $derived(
    Number.isFinite(fov) && fov > 0
      ? math.clamp(fov, min_fov, max_fov)
      : DEFAULTS.structure.fov,
  )

  // False until the container has a size; a fit against 0x0 is meaningless
  const measured = () => width > 0 && height > 0
  // The fit follows resizes and the explicit camera (re)fits below only; a trajectory frame
  // never moves it (see create_fit_zoom for why untracking the extent alone is not enough).
  const fit = create_fit_zoom({
    initial_extent: () => spans_along(structure, camera_direction),
    zoom_for: (spans) => ortho_zoom_for_extent(spans, width, height, initial_zoom),
    measured,
    initial_zoom: () => initial_zoom,
  })
  // Mirrored out for StructureViewport's reset button; the sole writer, so a refit below
  // reaches it through this too rather than assigning it a second time.
  $effect(() => {
    initial_computed_zoom = fit.zoom
  })
  // Non-reactive: this only compares successive effect runs and must not schedule another run.
  const camera_fit_cache: { previous_view?: string } = {}
  let camera_view = $derived(`${camera_projection}:${camera_direction?.join(`,`) ?? ``}`)
  const scene_camera = create_scene_camera({
    controls: () => ({
      camera_projection,
      rotate_speed,
      zoom_speed,
      zoom_to_cursor,
      pan_speed,
      auto_rotate,
      rotation_damping,
      min_zoom,
      max_zoom,
    }),
    target: () => camera_target ?? rotation_target,
    fit_zoom: () => fit.zoom,
    measured,
    camera: () => camera,
    // Makes min_zoom/max_zoom bound the perspective camera too: they are pixels per Å, which
    // is a property of the picture, not of the projection (perspective_distance_for_zoom)
    viewport_px: () => height,
    fov: () => effective_fov,
    // Flagged on the first camera change, so presses still reach the meshes
    set_camera_is_moving: (moving) => (camera_is_moving = moving),
    // Close hover tooltips + bond context menu while the camera moves. Only hide the
    // VISIBLE menu (not bond_context_target): clicking a menu button fires this
    // orbit-controls start handler before the button's own handler runs, which still
    // needs the target bond to apply the edit (see bond_context_target comment).
    on_start_extra: () => {
      pointer.drop_hover()
      pointer.hovered_bond_key = null
      bond_context_menu = null
    },
  })

  // Fits the zoom to the current content and places the camera on `target`, looking along
  // `direction` (missing/zero: the default angled view).
  const frame_camera = (target: Vec3, direction: Vec3 | null | undefined): void => {
    // fitted along the direction it frames (a follow refit: the live view)
    framed_structure = structure
    fit.refit(untrack(() => spans_along(structure, direction)))
    scene_camera.reset_to_fit()
    // Orthographic framing is controlled by zoom; its camera only needs a safe standoff.
    const distance =
      camera_projection === `perspective`
        ? perspective_distance_for_extent(
            Math.max(1, fit_extent),
            width,
            height,
            effective_fov,
          )
        : Math.max(1, fit_extent) * 2
    camera_target = target
    get_reset_target = () => target
    camera_position = camera_position_for_target(target, distance, direction)
    // a fresh framing starts unpanned; the pan lives on the camera, not in camera_target
    clear_pan_offset(untrack(() => camera))
  }
  $effect.pre(() => {
    const previous_view = camera_fit_cache.previous_view
    const view_changed = previous_view !== undefined && previous_view !== camera_view
    const should_fit = camera_needs_fit(camera_position, previous_view, camera_view)
    camera_fit_cache.previous_view = camera_view
    if (should_fit && structure && measured())
      frame_camera(
        view_changed ? fit_frame.center : (camera_target ?? fit_frame.center),
        camera_direction,
      )
  })
  // Within a series (series_key), a frame whose orbit pivot moved (a new cell, a dataset's next
  // structure, a molecule's drifting center of mass) carries the camera by that offset, keeping
  // the user's view; fixed-cell MD frames leave it where it is. A new series is framed afresh or
  // keeps the caller's pose (Structure's series effect), so it is never carried; neither are the
  // user's own atom edits or a camera flight, whose poses are absolute. While the user orbits,
  // the frame it follows from is held, so a cell changing every frame (NPT playback) moves the
  // camera once the gesture ends instead of fighting it. Non-reactive: compares successive
  // frames only.
  let followed_frame: { series: unknown; center: Vec3 } | undefined
  $effect.pre(() => {
    if (!structure || dragging_atoms || camera_is_moving) return
    const frame = { series: series_key, center: rotation_target }
    const previous = followed_frame
    followed_frame = frame
    if (
      !previous ||
      previous.series !== frame.series ||
      previous.center.every((coord, axis) => coord === frame.center[axis])
    )
      return
    untrack(() => {
      if (measure_mode === `edit-atoms` || !camera || !orbit_controls) return
      // Nothing framed yet (a viewer mounted at 0x0), or a flight owns the camera
      if (camera_position === undefined || flight_holds(orbit_controls)) return
      // The live pose, not the props: auto-rotate and a damped glide move the camera without
      // syncing them, and a stale prop pose would snap the camera back
      const pose = {
        target: orbit_controls.target.toArray(),
        position: camera.position.toArray(),
      }
      // A structure that left the view (a bigger supercell) or shrank far below it is framed
      // afresh, seen from where the user was looking. All three spans are measured along that
      // live view: camera_direction misreads an orbited camera (a cell doubled along the line of
      // sight is no bigger on screen). A hidden (0x0) viewer only follows.
      const view_dir = math.subtract(pose.position, pose.target)
      const px_per_angstrom =
        camera instanceof OrthographicCamera
          ? camera.zoom
          : // the zoom-distance relation solved for the zoom at the target distance
            perspective_distance_for_zoom(
              math.euclidean_dist(pose.position, pose.target),
              height,
              effective_fov,
            )
      const visible: Vec2 = [width / px_per_angstrom, height / px_per_angstrom] // Å
      const [spans, fitted] = [structure, framed_structure].map((content) =>
        spans_along(content, view_dir),
      )
      if (measured() && outgrows_view(spans, fitted, visible))
        return frame_camera(fit_frame.center, view_dir)
      const moved = follow_center(pose, previous.center, frame.center)
      camera_target = moved.target
      camera_position = moved.position
    })
  })

  // Declutter while a symmetry-element overlay actually draws something (elements present
  // AND an enabled kind among them): hide coordination polyhedra/bonds and shrink atoms so
  // axes/planes/centers stay readable. Gating on visibility (not just `symmetry_elements`)
  // avoids hiding everything when nothing renders in its place — e.g. an inversion-only
  // cell under the rotation-only default. Pure derived overrides: the configured
  // appearance returns untouched the moment the overlay goes away.
  const declutter_active = $derived(
    symmetry_declutter &&
      has_visible_symmetry_overlay(symmetry_elements, symmetry_elements_props.show_kinds),
  )
  const effective_show_polyhedra: ShowBonds = $derived(
    declutter_active ? `never` : show_polyhedra,
  )
  // Calculated bonds are hidden in declutter mode (only their cylinders — bond_pairs
  // stay computed so tooltips and manually added bonds keep working)
  const effective_show_bonds: ShowBonds = $derived(declutter_active ? `never` : show_bonds)
  const effective_atom_radius = $derived(declutter_active ? atom_radius * 0.6 : atom_radius)

  // Derived (not effect + state) so downstream consumers (filtering, polyhedra,
  // instanced bond buffers) recompute exactly once per structure change instead
  // of once with stale bonds and again after an effect flush.
  // Bonds are computed when either bond rendering or polyhedra need them. The
  // raw/effective mix is deliberate: RAW show_bonds keeps bond_pairs available
  // during symmetry declutter (cylinders hide via effective_show_bonds in
  // bonds_to_render, but tooltips + manually added bonds still need the data),
  // while EFFECTIVE show_polyhedra skips computing bonds whose only consumer —
  // the polyhedra $derived below, gated on the same effective value — won't run.
  let bond_pairs: BondData = $derived.by(() => {
    const want_bonds = applies_to_structure(show_bonds, Boolean(lattice))
    const want_polyhedra = applies_to_structure(effective_show_polyhedra, Boolean(lattice))
    return structure && (want_bonds || want_polyhedra)
      ? get_bond_data(structure, bonding_strategy, bonding_options)
      : []
  })

  // Disordered sites are often stored as separate split sites (one species each)
  // at the same position; merge_split_partial_sites groups them into one render
  // site whose `species` holds every element. Shared by atom rendering and the
  // hover tooltip so it lists all elements, not just the majority one.
  let render_sites = $derived(
    structure?.sites ? merge_split_partial_sites(structure.sites, hidden_elements) : [],
  )

  // Whole-atom cutaways select centers, then retain their complete coordination shells.
  // Selecting spheres separately from clipped cylinders leaves dangling bond fragments.
  let cutaway_centers = $derived.by(() => {
    if (!cutaway?.whole_atoms || cutaway.mode === `off`) return undefined
    return new Set(
      render_sites
        .filter(({ site }) => cutaway_contains(cutaway, site.xyz))
        .map(({ site_idx }) => site_idx),
    )
  })
  let cutaway_visible_sites = $derived.by(() => {
    if (!cutaway_centers || !structure) return undefined
    const visible = new Map<number, Vec3[]>()
    const add_position = (site_idx: number, position: Vec3) => {
      const positions = visible.get(site_idx)
      if (!positions) visible.set(site_idx, [position])
      else if (!positions.some((other) => math.same_position(other, position)))
        positions.push(position)
    }
    for (const site_idx of cutaway_centers) {
      const site = get_site(structure, site_idx)
      if (site) add_position(site_idx, site.xyz)
    }
    for (const bond of bond_records(bonds_to_render)) {
      add_position(bond.site_idx_1, bond.pos_1)
      add_position(bond.site_idx_2, bond.pos_2)
    }
    for (const poly of polyhedra) {
      for (const [vertex_idx, site_idx] of poly.vertex_site_idxs.entries()) {
        add_position(site_idx, poly.vertices[vertex_idx])
      }
    }
    return visible
  })

  // One reactive read per palette entry instead of one proxy access per atom/bond.
  const element_palette = get_element_palette()
  const palette = $derived({ ...element_palette.colors })
  // Function bindings can invalidate equal override objects on every trajectory frame.
  // Compare their values so coordinate updates keep the existing atom records.
  const atom_appearance = $derived(
    JSON.stringify([
      palette,
      radius_options.same_size_atoms,
      radius_options.element_radius_overrides,
      [...(radius_options.site_radius_overrides ?? [])],
      effective_atom_radius,
    ]),
  )
  const atom_group_builder = new AtomGroupBuilder()
  let atom_groups = $derived.by(() =>
    show_atoms
      ? atom_group_builder.build({
          structure,
          render_sites: () => render_sites,
          palette,
          property_colors,
          hidden_prop_vals,
          hidden_elements,
          hide_completion_images:
            !applies_to_structure(effective_show_bonds, Boolean(lattice)) &&
            !applies_to_structure(effective_show_polyhedra, Boolean(lattice)),
          radius_scale: effective_atom_radius,
          radius_options,
          hidden_centers: polyhedra_hide_center_atoms ? polyhedra_center_site_idxs : null,
          cutaway_sites: cutaway_visible_sites,
          appearance: atom_appearance,
        })
      : atom_group_builder.reset(),
  )

  // Shared visibility check: site has at least one non-hidden element and
  // its property value (if any) isn't hidden. Used by both bond and vector filtering.
  const is_site_visible = (site_idx: number): boolean => {
    const site = get_site(structure, site_idx)
    if (!site) return false
    // `.size` guards first: with nothing hidden (the default) this skips the per-species
    // SvelteSet lookups, which would otherwise run for every bond endpoint in a supercell
    if (hidden_elements.size > 0) {
      if (!site.species.some(({ element }) => !hidden_elements.has(element))) return false
    } else if (site.species.length === 0) return false
    if (hidden_prop_vals.size === 0) return true
    const prop_val = property_colors?.values[site_idx]
    return prop_val === undefined || !hidden_prop_vals.has(prop_val)
  }

  // Perception layer: bond_pairs with optional bond-order perception applied.
  // Off by default (pass-through). Manual overrides are applied downstream in
  // filtered_bond_pairs, so they still win over perceived orders.
  let perceived_bond_pairs: BondData = $derived.by(() => {
    if (!auto_bond_order || !structure || bond_pairs.length === 0) {
      return bond_pairs
    }
    const total_charge = structure.charge ?? 0
    const perceived = perceive_bond_orders(structure.sites, bond_records(bond_pairs), {
      total_charge,
    })
    // Explicit structure.properties.bonds are user-authoritative and must
    // never be clobbered by perception. Composition + precedence is a pure,
    // unit-tested helper (see compose_perceived_bonds).
    return compose_perceived_bonds(
      perceived,
      get_explicit_bond_metadata(structure),
      aromatic_display,
      structure.sites,
    )
  })

  // Only the edit-bonds handlers read these, so outside that mode skip the per-bond
  // canonicalisation pass a trajectory would otherwise pay on every frame
  let editing_bonds = $derived(
    interactive && bond_edits_enabled && measure_mode === `edit-bonds`,
  )
  let editable_perceived_bond_pairs = $derived(
    editing_bonds
      ? bond_records(perceived_bond_pairs).map((bond) => ({
          ...bond,
          ...canonical_bond_target(bond),
        }))
      : [],
  )

  let filtered_bond_pairs = $derived.by(() => {
    if (!structure) return perceived_bond_pairs

    // Default state (nothing hidden, no manual edits) keeps every calculated bond as-is.
    // Returning the input array skips building a canonical key per bond, which was the
    // single most expensive step of this pass on large supercells.
    if (
      hidden_elements.size === 0 &&
      hidden_prop_vals.size === 0 &&
      removed_bonds.length + added_bonds.length + bond_order_overrides.length === 0
    )
      return perceived_bond_pairs

    // Build set of removed bond keys for efficient lookup
    const removed_keys = new Set(removed_bonds.map(bond_key_for))
    const added_keys = new Set(added_bonds.map(bond_key_for))
    const order_overrides = new Map(
      bond_order_overrides.map((bond) => [bond_key_for(bond), bond.order]),
    )

    // Filter calculated bonds: exclude removed, replaced by manual additions, and hidden.
    // one bond_key_for per bond: canonicalizing costs two image-shift lookups and a Vec3
    const needs_key = removed_keys.size > 0 || added_keys.size > 0 || order_overrides.size > 0
    const calculated: BondPair[] = []
    for (const bond of bond_records(perceived_bond_pairs)) {
      if (!is_site_visible(bond.site_idx_1) || !is_site_visible(bond.site_idx_2)) continue
      if (!needs_key) {
        calculated.push(bond)
        continue
      }
      const key = bond_key_for(bond)
      if (removed_keys.has(key) || added_keys.has(key)) continue
      const override = order_overrides.get(key)
      calculated.push(override === undefined ? bond : { ...bond, bond_order: override })
    }

    // Create BondPair objects for manually added bonds
    const added: BondPair[] = []
    for (const added_bond of added_bonds) {
      const { site_idx_1: idx_i, site_idx_2: idx_j } = added_bond
      if (!is_site_visible(idx_i) || !is_site_visible(idx_j)) continue
      added.push(structure_bond_to_bond_pair(structure, added_bond))
    }

    return [...calculated, ...added]
  })

  // Bonds drawn as cylinders. When show_bonds doesn't apply, calculated bonds are
  // hidden but manually added bonds stay visible (bond_pairs may still be computed
  // for polyhedra, so this can't rely on bond_pairs being empty).
  let bonds_to_render = $derived.by(() => {
    let bonds = filtered_bond_pairs
    if (!applies_to_structure(effective_show_bonds, Boolean(lattice))) {
      const added_keys = new Set(added_bonds.map(bond_key_for))
      bonds = bond_records(bonds).filter((bond) => added_keys.has(bond_key_for(bond)))
    }
    const centers = cutaway_centers
    if (!centers || !structure) return bonds
    // A periodic bond runs from site_idx_1's own position to an image of site_idx_2, so a
    // center at site_idx_2 gets the mirrored copy anchored at the center itself
    return bond_records(bonds).flatMap((bond): BondPair[] => {
      const shifted = Boolean(bond.cell_shift?.some(Boolean))
      const kept: BondPair[] = []
      if (centers.has(bond.site_idx_1) || (!shifted && centers.has(bond.site_idx_2))) {
        kept.push(bond)
      }
      const center =
        shifted && centers.has(bond.site_idx_2) && get_site(structure, bond.site_idx_2)
      if (center) {
        kept.push({
          ...bond,
          site_idx_1: bond.site_idx_2,
          site_idx_2: bond.site_idx_1,
          pos_1: center.xyz,
          pos_2: center.xyz.map(
            (val, axis) => val + bond.pos_1[axis] - bond.pos_2[axis],
          ) as Vec3,
          cell_shift: bond.cell_shift?.map((val) => -val) as Vec3,
        })
      }
      return kept
    })
  })

  // Open bond cylinders halve their triangles, but their hollow ends show wherever no opaque
  // sphere covers a bond end: hidden or translucent atoms, vacancy gaps, cutaways, or an atom
  // smaller than a bond's reach (2.35 x thickness: a triple bond's outer copy, offset + radius)
  let bonds_capped = $derived.by(() => {
    if (!show_atoms || atom_opacity < 1 || atom_groups.partial.length > 0) return true
    if (cutaway && cutaway.mode !== `off` && !cutaway.whole_atoms) return true
    // Centers hidden inside their polyhedra drop the sphere, not the bonds to it
    if (polyhedra_hide_center_atoms && polyhedra_center_site_idxs.size > 0) return true
    const reach = 2.35 * bond_thickness
    return [atom_groups.base, atom_groups.image].some((atoms) =>
      atoms.some((atom) => atom.radius < reach),
    )
  })

  let editable_bond_pairs = $derived(
    editing_bonds ? bond_records(bonds_to_render).filter(can_edit_bond) : [],
  )

  // Coordination polyhedra around cation-like centers, derived from the same
  // (edited, filtered) bond graph as rendered bonds so the two never disagree.
  // Colors are resolved in InstancedStructure, so color-scheme/mode changes
  // never recompute the hull geometry.
  let last_polyhedra: Polyhedron[] = []
  let polyhedra: Polyhedron[] = $derived.by(() => {
    // Deferred geometry keeps the last hulls
    if (!defer_expensive_geometry)
      last_polyhedra =
        structure &&
        !dragging_atoms &&
        applies_to_structure(effective_show_polyhedra, Boolean(lattice)) &&
        filtered_bond_pairs.length > 0
          ? compute_polyhedra(structure, filtered_bond_pairs, {
              neighbor_mode: polyhedra_neighbor_mode,
              min_neighbors: polyhedra_min_neighbors,
              // The two sliders have overlapping ranges (min goes to 12, max down to 4), so
              // they can be dragged past each other. Widening the cap instead of honoring an
              // empty window keeps polyhedra on screen rather than silently rendering none.
              max_neighbors: Math.max(polyhedra_min_neighbors, polyhedra_max_neighbors),
              excluded_center_elements: polyhedra_excluded_elements,
              included_center_elements: polyhedra_included_elements,
            })
          : []
    const centers = last_polyhedra.length > 0 ? cutaway_centers : undefined
    return centers
      ? last_polyhedra.filter((poly) => centers.has(poly.center_site_idx))
      : last_polyhedra
  })

  let polyhedra_center_site_idxs = $derived(
    new Set(polyhedra.map((poly) => poly.center_site_idx)),
  )

  // Publish which elements currently anchor polyhedra (consumed by controls so
  // per-element toggles reflect the actual render state incl. spectator hiding)
  $effect(() => {
    if (!interactive) return
    const elems = [...new Set(polyhedra.map((poly) => poly.center_element))].toSorted()
    if (elems.join(`,`) !== polyhedra_rendered_elements.join(`,`)) {
      polyhedra_rendered_elements = elems
    }
  })

  let editable_atom_hit_targets = $derived(
    editing_bonds && bond_edit_mode === `add`
      ? [...atom_groups.first_by_site.values()]
          .filter((atom) => can_select_bond_site(atom.site_idx))
          .map(site_anchor)
      : [],
  )

  // Radius of a site that atom_groups may have filtered out (highlight fallback)
  const get_site_radius = (site: Site, site_idx: number): number =>
    site_base_radius(site, site_idx, radius_options) * effective_atom_radius

  // The default active color is a CSS custom property, which THREE.Color cannot parse (it
  // warns and keeps its previous color), so let the browser resolve it where the canvas sits
  const active_color = $derived(
    active_sites.length > 0 && renderer.domElement.parentElement
      ? resolve_color_token(renderer.domElement.parentElement, active_highlight_color)
      : active_highlight_color,
  )
  // The drawn hovered atom (its first wedge)
  const hovered_atom = $derived(atom_groups.first_by_site.get(hovered_idx ?? -1))

  // Shells around the hovered, selected and active sites. Pulse-independent: SiteHighlights
  // applies the per-frame opacity, so this list only rebuilds when highlighted sites change.
  let highlight_targets: HighlightTarget[] = $derived.by(() => {
    const targets: HighlightTarget[] = []
    const add = (kind: HighlightTarget[`kind`], site_idx: number, color: string) => {
      const site = get_site(structure, site_idx)
      if (!site) return
      const radius =
        atom_groups.first_by_site.get(site_idx)?.radius ?? get_site_radius(site, site_idx)
      targets.push({ kind, site, site_idx, color, radius })
    }
    if (hovered_idx !== null) {
      const hover_color =
        hovered_atom?.color ??
        (hovered_site?.species[0] && palette[hovered_site.species[0].element])
      add(`hover`, hovered_idx, brighten_hex(hover_color))
    }
    for (const idx of selected_sites) add(`selected`, idx, selection_highlight_color)
    for (const idx of active_sites) add(`active`, idx, active_color)
    return targets
  })

  let previous_vector_layers: VectorLayer[] = []
  let vector_layers = $derived(
    (previous_vector_layers = build_vector_layers(
      structure,
      {
        vector_configs,
        nothing_hidden: hidden_elements.size === 0 && hidden_prop_vals.size === 0,
        is_site_visible,
        vector_color_mode,
        vector_color,
        vector_normalize,
        palette,
        char_atom_spacing,
        vector_scale,
        vector_origin_gap,
        get_site_radius,
        vector_color_scale,
        vector_uniform_thickness,
        vector_shaft_radius,
        vector_arrow_head_radius,
        vector_arrow_head_length,
      },
      previous_vector_layers,
    )),
  )

  // Displacement overlay. Computed against base_structure (the untransformed cell) rather than
  // the displayed one so supercell copies and PBC image atoms don't have to exist in the
  // reference: every rendered atom looks its displacement up by original site index, the same
  // mapping property colors use.
  // Sole owner of the comparison: the readout the controls pane shows is bound out of here
  // (displacement_summary) rather than recomputed alongside, so both can never disagree.
  let displacement_field = $derived.by(() => {
    if (!reference_structure) return null
    const compare_to = base_structure ?? structure
    if (!compare_to?.sites) return null
    const compare_lattice = is_crystal(compare_to) ? compare_to.lattice : null
    try {
      const { vectors, rmsd, max_displacement } = measure.compute_displacements(
        reference_structure.sites,
        compare_to.sites,
        compare_lattice?.matrix ?? null,
        compare_lattice?.pbc,
      )
      return { vectors, summary: { rmsd, max_displacement, error: null } }
    } catch (error) {
      // Loud, not silent: a mismatched reference is a user mistake worth surfacing, and
      // pairing up unrelated atoms would draw plausible-looking nonsense.
      const { message } = to_error(error)
      console.error(`[displacement overlay] ${message}`)
      return { vectors: null, summary: { error: message } }
    }
  })
  $effect(() => {
    displacement_summary = displacement_field?.summary ?? null
    // Clear on teardown: the scene stops tracking the structure when it unmounts (slice mode,
    // no GPU adapter), and a readout frozen at the last comparison would go quietly stale.
    return () => (displacement_summary = null)
  })

  // Anchor unwrapped trails to wrapped displayed sites only while atom identities still match.
  let trajectory_line_anchors = $derived(
    trajectory_position_stream
      ? trajectory_trail_anchors(structure?.sites, trajectory_position_stream.n_atoms)
      : undefined,
  )

  let displacement_arrows = $derived.by(() => {
    const vectors = displacement_field?.vectors
    if (!vectors || !show_displacement_arrows || !structure) return pack_arrows([], 0, 0, 0)
    // Accumulate the largest magnitude over VISIBLE sites only (as vector_layers does), so
    // hiding the element carrying the biggest displacement doesn't shrink every other arrow.
    let max_mag = 0
    const visible = structure.sites.flatMap((site, site_idx) => {
      if (!is_site_visible(site_idx)) return []
      const vector = vectors[to_base_site_idx(site, site_idx)]
      if (!vector) return []
      const magnitude = Math.hypot(vector[0], vector[1], vector[2])
      if (magnitude < math.EPS) return []
      max_mag = Math.max(max_mag, magnitude)
      return [{ position: site.xyz, vector, magnitude }]
    })
    // Auto-scale the largest displacement to a fixed fraction of the characteristic atom
    // spacing, as the site-vector layers do. Relaxation displacements are typically well under
    // an atomic radius, so drawing them at true length buries every arrow inside its own atom
    // sphere. True magnitudes stay available in the RMSD/max readout, and
    // displacement_arrow_scale multiplies on top of this.
    const auto_scale = max_mag > math.EPS ? (char_atom_spacing * 0.9) / max_mag : 1
    const scale = auto_scale * displacement_arrow_scale
    // Uniform thickness turns negative (length-relative) sizes into absolute ones scaled by
    // the inter-atomic spacing; positive (already absolute) values pass through
    const size = (value: number): number =>
      vector_uniform_thickness ? resolve_arrow_size(value, char_atom_spacing) : value
    return pack_arrows(
      visible.map((arrow) => ({ ...arrow, scale, color: displacement_arrow_color })),
      size(vector_shaft_radius),
      size(vector_arrow_head_radius),
      size(vector_arrow_head_length),
    )
  })

  // One label anchor per visible site
  let label_entries = $derived(
    show_site_labels || show_site_indices
      ? [...atom_groups.first_by_site.values()]
          // Whole-atom mode already selected these atoms, endpoints outside the slice included
          .filter((atom) => cutaway?.whole_atoms || cutaway_contains(cutaway, atom.position))
          .map(site_anchor)
      : [],
  )

  const cutaway_group = new StructureCutawayGroup()
  const atom_cutaway_group = new StructureCutawayGroup()
  $effect(() => {
    // Overlays (arrows, trails, highlights, lattice, volumes) always keep surface clipping
    cutaway_group.set_cutaway(cutaway)
    atom_cutaway_group.set_cutaway(cutaway?.whole_atoms ? undefined : cutaway)
    // Pointer position has not moved when a slider hides the currently hovered atom.
    if (cutaway && cutaway.mode !== `off`) pointer.drop_hover()
    threlte.invalidate()
  })

  let measure_line_color = $derived(resolve_theme_text_color() ?? `#808080`)
</script>

<SceneCamera
  {camera_projection}
  position={camera_position}
  fov={effective_fov}
  zoom={scene_camera.zoom}
  near={camera_near}
  far={camera_far}
  up={camera_up}
  orbit_props={scene_camera.orbit_props}
  {gizmo}
  bind:orbit_controls
/>

<SceneLights ambient={ambient_light} directional={directional_light} />

<!-- Apply manual rotation around center: translate to origin, rotate, translate back -->
<T.Group position={rotation_target}>
  <T.Group {rotation}>
    <T is={atom_cutaway_group} position={neg_rotation_target}>
      <!-- Bonds and polyhedra complete the atoms' shells, so they share the atoms' cutaway:
        surface clipping, or none when whole-atom mode selects sites instead -->
      <InstancedStructure
        {structure}
        {palette}
        {property_colors}
        {atom_groups}
        {atom_opacity}
        {atom_color_field}
        {sphere_segments}
        ghost_images={measure_mode === `edit-atoms`}
        atom_events={atom_instance_events}
        bonds={bonds_to_render}
        {bond_color}
        {bond_thickness}
        {bonds_capped}
        {ambient_light}
        {directional_light}
        {polyhedra}
        {polyhedra_color_mode}
        {polyhedra_color}
        {polyhedra_opacity}
        {polyhedra_show_edges}
      />

      <!-- Site labels/indices: single overlay for all labels (one DOM container
        + one per-frame position pass instead of one threlte <HTML> per label) -->
      {#if label_entries.length > 0}
        <SiteLabels
          entries={label_entries}
          {structure}
          bonds={bonds_to_render}
          show_labels={show_site_labels}
          show_indices={show_site_indices}
          size={site_label_size}
          offset={site_label_offset}
          bg_color={site_label_bg_color}
          color={site_label_color}
          padding={site_label_padding}
          {atom_label}
          on_select={toggle_selection}
        />
      {/if}
      <!-- selection order labels and measurement lines/readouts for the picked sites, clipped
        like the bonds a measured pair tints -->
      {#if structure && measured_sites.length > 0}
        <MeasurementOverlays
          sites={structure.sites}
          {measured_sites}
          {measure_mode}
          {lattice}
          label_offset={site_label_offset}
          line_color={measure_line_color}
          bonds={bonds_to_render}
          {bond_thickness}
          {pulse_opacity}
          site_radius={(site_idx) =>
            0.5 * (atom_groups.first_by_site.get(site_idx)?.radius ?? 0)}
        />
      {/if}
    </T>

    <T is={cutaway_group} position={neg_rotation_target}>
      <!-- Per-site vector arrows (forces, magmoms, ...) as instanced meshes:
        2 draw calls per layer instead of 2 meshes per site -->
      {#each vector_layers as layer (layer.key)}
        <ArrowInstances arrows={layer.arrows} />
      {/each}

      <!-- Displacement overlay: a sibling arrow layer, kept off the force/magmom vector path
        so the legend never mislabels relaxation displacements as forces -->
      {#if displacement_arrows.placements.count > 0}
        <ArrowInstances arrows={displacement_arrows} />
      {/if}

      <!-- Per-atom trajectory trails: every atom's whole path in one indexed
        LineSegments (1 draw call no matter how many atoms or frames) -->
      {#if interactive && show_trajectory_lines && trajectory_position_stream}
        <TrajectoryLines
          position_stream={trajectory_position_stream}
          end_frame={trajectory_line_end_frame}
          trail_frames={trajectory_line_trail_frames}
          frame_stride={trajectory_line_frame_stride}
          elements={trajectory_line_elements}
          color_mode={trajectory_line_color_mode}
          element_colors={palette}
          wrap_mode={trajectory_line_wrap_mode}
          anchor_positions={trajectory_line_anchors}
          emphasis={trajectory_lines_emphasis}
          bind:build_result={trajectory_lines_result}
        />
      {/if}

      <!-- Clickable bond and atom hit targets in edit-bonds mode -->
      <BondEditTargets
        bonds={editable_bond_pairs}
        atom_targets={editable_atom_hit_targets}
        sites={structure?.sites}
        mode={bond_edit_mode}
        {bond_thickness}
        bind:hovered_bond_key={pointer.hovered_bond_key}
        atom_events={(site_idx) =>
          touch_hover({
            ...pointer.hover_props(site_idx),
            onpointerdown: (event) => select_edit_bonds_site(site_idx, event),
          })}
        on_select_site={select_edit_bonds_site}
        on_delete_bond={(bond) => {
          remove_bond(bond)
          measured_sites = []
          selected_sites = []
        }}
        on_bond_menu={open_bond_context_menu}
      />

      {#if interactive && measure_mode === `edit-bonds` && bond_context_menu}
        <BondContextMenu
          position={bond_context_menu.position}
          current_order={get_current_bond_order(bond_context_menu)}
          on_set_order={set_context_bond_order}
          on_remove={() => remove_bond(bond_context_target)}
          on_close={close_bond_context_menu}
        />
      {/if}

      <!-- highlight hovered, active and selected sites -->
      <SiteHighlights targets={highlight_targets} {pulse_opacity} />

      <!-- hovered site tooltip -->
      {#if hovered_site && tooltip !== false && !camera_is_moving && (pointer.tooltip_active || active_sites.includes(hovered_idx ?? -1))}
        {@const site_idx = hovered_idx ?? -1}
        {@const hover_shell = highlight_targets.find(({ kind }) => kind === `hover`)}
        <!-- keeps clear of the hover shell (radius 0.5 scaled, see SiteHighlights) -->
        <SiteTooltip
          site={hovered_site}
          {site_idx}
          species={hovered_atom?.species ?? hovered_site.species}
          bg_color={tooltip_fill(
            hovered_atom,
            atom_color_field,
            property_colors,
            hidden_elements,
          )}
          bond_summary={bond_neighbor_summary(filtered_bond_pairs, site_idx, structure)}
          anchor_radius={0.5 * HOVER_SHELL_SCALE * (hover_shell?.radius ?? 0)}
          extra_rows={tooltip}
        />
      {/if}

      {#if visual_lattice}
        <Lattice
          matrix={visual_lattice.matrix}
          tiling={supercell_tiling}
          {cell_edge_color}
          {cell_surface_color}
          {cell_edge_width}
          {cell_edge_opacity}
          {cell_surface_opacity}
          show_cell_vectors={resolve_cell_vectors(show_cell_vectors, structure)}
        />
        {#if lattice_planes.length > 0}
          <LatticePlanes
            planes={lattice_planes}
            lattice={visual_lattice.matrix}
            tiling={supercell_tiling}
          />
        {/if}
        {#if symmetry_elements.length > 0}
          <SymmetryElements
            elements={symmetry_elements}
            lattice={visual_lattice.matrix}
            tiling={supercell_tiling}
            {...symmetry_elements_props}
          />
        {/if}
      {/if}

      <!-- TransformControls for editing atoms in edit-atoms mode -->
      {#if interactive && measure_mode === `edit-atoms` && selected_sites.length > 0 && structure?.sites}
        {@const selected_atoms = selected_sites
          .map((idx) => structure?.sites?.[idx])
          .filter((site): site is Site => site != null)}
        {#if selected_atoms.length > 0}
          {@const centroid = math
            .add(...selected_atoms.map(({ xyz }) => xyz))
            .map((sum) => sum / selected_atoms.length) as Vec3}
          <!-- Invisible mesh at centroid for TransformControls to manipulate.
               During drag, use frozen_centroid so Svelte doesn't override TransformControls
               with the wrapped centroid (which jumps on PBC boundary crossings). -->
          <T.Mesh position={frozen_centroid ?? centroid} bind:ref={transform_object}>
            <T.SphereGeometry args={[0.01, 4, 4]} />
            <T.MeshBasicMaterial transparent opacity={0} />
          </T.Mesh>
          <extras.TransformControls
            object={transform_object}
            translationSnap={0.1}
            size={1.2}
            space="world"
            onobjectChange={() => {
              if (!transform_object?.position || !drag_start_centroid) return
              const position = transform_object.position.toArray()
              const delta = math.subtract(position, drag_start_centroid)
              // Update reference point so deltas are incremental, not cumulative.
              // Without this, each frame compounds: sites already moved by previous
              // delta get the full cumulative delta re-applied.
              drag_start_centroid = position
              on_sites_moved?.(selected_sites, delta)
            }}
            onmouseDown={() => {
              dragging_atoms = true
              pointer.drop_hover()
              drag_start_centroid = frozen_centroid = [...centroid] as Vec3
              on_operation_start?.()
            }}
            onmouseUp={() => {
              dragging_atoms = false
              frozen_centroid = null
              drag_start_centroid = null
            }}
          />
        {/if}
      {/if}

      <!-- Invisible plane for click-to-place atom in add-atom mode -->
      <!-- Uses onBeforeRender to orient normal toward camera so raycasts always hit; its negative
      pick_rank keeps it from shadowing the atoms behind it, so clicking an atom selects it -->
      {#if interactive && measure_mode === `edit-atoms` && add_atom_mode}
        <T.Mesh
          position={rotation_target}
          onBeforeRender={(mesh: Mesh) => {
            if (camera) mesh.lookAt(camera.position)
          }}
          onclick={(event: { point: Vector3 }) =>
            on_add_atom?.(event.point.toArray(), add_element)}
          userData={{ pick_rank: -1 }}
        >
          <T.PlaneGeometry
            args={[Math.max(200, structure_size * 4), Math.max(200, structure_size * 4)]}
          />
          <T.MeshBasicMaterial transparent opacity={0} side={2} depthWrite={false} />
        </T.Mesh>
      {/if}

      <!-- Isosurface rendering from volumetric data (CHGCAR, .cube files) -->
      {#if volumetric_data && isosurface_settings}
        <Isosurface
          volumes={volumetric_data}
          settings={isosurface_settings}
          tiling={supercell_tiling}
        />
      {/if}
      <SlicePlane polygon={slice_polygon} />
    </T>
    {#if volume_color_field}
      <T.Group position={neg_rotation_target}>
        <ColorFieldVolume
          field={volume_color_field}
          opacity={volume_opacity}
          {cutaway}
          tiling={supercell_tiling}
        />
      </T.Group>
    {/if}
  </T.Group>
</T.Group>

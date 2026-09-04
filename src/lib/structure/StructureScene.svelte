<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { get_d3_interpolator } from '$lib/colors'
  import type { ElementSymbol } from '$lib/element'
  import { element_by_symbol } from '$lib/element'
  import Isosurface from '$lib/isosurface/Isosurface.svelte'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import { DEFAULT_ISOSURFACE_SETTINGS } from '$lib/isosurface/types'
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import {
    bind_renderer,
    brighten_hex,
    clear_pan_offset,
    create_fit_zoom,
    create_fly_to,
    create_scene_camera,
    DEFAULT_FLY_TO_DURATION_MS,
    SceneCamera,
    SceneLights,
  } from '$lib/scene'
  import type { SceneControlProps } from '$lib/scene'
  import type { ShowBonds, VectorColorMode, VectorLayerConfig } from '$lib/settings'
  import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
  import { create_pulse_animation, pulsing_highlight_opacity } from '$lib/effects.svelte'
  import { colors, theme_state } from '$lib/state.svelte'
  import type {
    AnyStructure,
    BondEditMode,
    BondOrder,
    BondPair,
    MeasureMode,
    Site,
    StructureBond,
  } from '$lib/structure'
  import {
    camera_needs_fit,
    camera_position_for_target,
    characteristic_atom_spacing,
    Cylinder,
    get_all_site_vectors,
    get_center_of_mass,
    get_orig_site_idx,
    get_structure_vector_keys,
    is_image_site,
    Lattice,
    ortho_zoom_for_extent,
    perspective_distance_for_extent,
    site_base_radius,
    structure_fit_frame,
    vector_display_defaults,
    VECTOR_PALETTE,
  } from '$lib/structure'
  import ArrowInstances from './ArrowInstances.svelte'
  import InstancedAtoms from './InstancedAtoms.svelte'
  import type { LatticePlane } from './lattice-planes'
  import LatticePlanes from './LatticePlanes.svelte'
  import SiteLabels from './SiteLabels.svelte'
  import type { AtomPropertyColors } from '$lib/structure/atom-properties'
  import type { SymmetryElement } from '$lib/symmetry'
  import { has_visible_symmetry_overlay } from '$lib/symmetry/symmetry-elements'
  import SymmetryElements from '$lib/symmetry/SymmetryElements.svelte'
  import * as measure from '$lib/structure/measure'
  import { is_crystal } from '$lib/structure/validation'
  import { to_error } from '$lib/utils'
  import {
    compute_slice_geometry,
    merge_split_partial_sites,
    CAP_ARC_LENGTH,
    CAP_ARC_START,
  } from '$lib/structure/partial-occupancy'
  import { T, useTask } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { rgb } from 'd3-color'
  import { type ComponentProps, type Snippet, untrack } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import {
    BufferAttribute,
    BufferGeometry,
    Color,
    CylinderGeometry,
    DoubleSide,
    Euler,
    MeshBasicMaterial,
    SphereGeometry,
    Vector3,
  } from 'three/webgpu'
  import type { Mesh, Object3D } from 'three/webgpu'
  import Bond from './Bond.svelte'
  import { write_bond_transform } from './bond-rendering'
  import type { BondEditResult, BondingStrategy, BondKeyTarget } from './bonding'
  import {
    add_or_restore_bond,
    BOND_ORDER_OPTIONS,
    canonicalize_bond_target,
    compute_bonds,
    delete_bond as apply_delete_bond,
    get_bond_key,
    get_explicit_bond_metadata,
    get_majority_element,
    rendered_bond_key_for,
    set_bond_order as apply_set_bond_order,
    structure_bond_to_bond_pair,
  } from './bonding'
  import { CanvasTooltip, compose_perceived_bonds, perceive_bond_orders } from './index'
  import { choose_site_label_offset, LABEL_OFFSET_EPS } from './atom-label-placement'
  import type { PolyhedraColorMode, Polyhedron } from './polyhedra'
  import { compute_polyhedra, merge_polyhedra_buffers } from './polyhedra'
  import TrajectoryLines from './TrajectoryLines.svelte'
  import type {
    TrajectoryLineColorMode,
    TrajectoryLinesStats,
    TrajectoryLineWrapMode,
  } from './trajectory-lines'
  import { trajectory_trail_anchors } from './trajectory-lines'
  import type { TrajectoryPositionStream } from '$lib/trajectory'

  type EditableAtomHitTarget = {
    site_idx: number
    position: Vec3
    radius: number
  }

  type BondContextMenu = {
    site_idx_1: number
    site_idx_2: number
    cell_shift?: Vec3
    position: Vec3
  }

  // Threlte wraps the DOM event and adds the intersection (hit object and world point)
  type ThrelteEvent<DomEvent extends Event> = DomEvent & {
    nativeEvent?: DomEvent
    object?: Object3D
    point?: Vector3
  }
  type BondPointerEvent = ThrelteEvent<PointerEvent>
  type BondContextMenuEvent = ThrelteEvent<MouseEvent>

  let {
    structure = undefined,
    base_structure = undefined,
    atom_radius = DEFAULTS.structure.atom_radius,
    same_size_atoms = false,
    // bindable: the auto-placement effect below assigns the position it computes, which a
    // plain prop would strand here, leaving the parent to re-push its stale value
    camera_position = $bindable(DEFAULTS.structure.camera_position),
    camera_target = $bindable(undefined),
    camera_direction = undefined,
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
    polyhedra_opacity = DEFAULTS.structure.polyhedra_opacity,
    polyhedra_show_edges = DEFAULTS.structure.polyhedra_show_edges,
    polyhedra_edge_color = DEFAULTS.structure.polyhedra_edge_color,
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
    show_cell_vectors = DEFAULTS.structure.show_cell_vectors,
    lattice_planes = [],
    symmetry_elements = [],
    symmetry_elements_props = {},
    symmetry_declutter = true,
    atom_label,
    camera_is_moving = $bindable(false),
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
    selection_highlight_color = `#6cf0ff`,
    // Active highlight group with different color
    active_sites = [],
    active_highlight_color = `var(--struct-active-highlight-color, #2563eb)`,
    rotation = DEFAULTS.structure.rotation,
    scene = $bindable(),
    camera = $bindable(),
    orbit_controls = $bindable(),
    rotation_target_ref = $bindable(),
    initial_computed_zoom = $bindable(),
    hidden_elements = new SvelteSet(),
    hidden_prop_vals = $bindable(new SvelteSet<number | string>()),
    element_radius_overrides = $bindable<Partial<Record<ElementSymbol, number>>>({}),
    site_radius_overrides = $bindable<SvelteMap<number, number>>(new SvelteMap()),
    property_colors = null,
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
    active_volume_idx = 0,
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
    trajectory_lines_result = $bindable(null),
  }: SceneControlProps & {
    structure?: AnyStructure
    base_structure?: AnyStructure // untransformed cell: supplies the drawn lattice and the displacement reference
    atom_radius?: number // scale factor for atomic radii
    same_size_atoms?: boolean // uniform radius for all atoms (else per-element atomic radii)
    camera_position?: [x: number, y: number, z: number] // initial camera position from which to render the scene
    camera_target?: Vec3 // external orbit-controls target for pan synchronization
    // When set (and camera_position is unset/zero), auto-place the camera along this
    // direction from the structure center (used by the multi-side view for fixed angles)
    camera_direction?: Vec3
    show_atoms?: boolean
    show_bonds?: ShowBonds
    defer_expensive_geometry?: boolean
    show_site_labels?: boolean
    show_site_indices?: boolean
    vector_configs?: Record<string, VectorLayerConfig>
    vector_scale?: number
    vector_color?: string
    vector_color_mode?: VectorColorMode
    vector_color_scale?: D3InterpolateName
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
    polyhedra_opacity?: number
    polyhedra_show_edges?: boolean
    polyhedra_edge_color?: string
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
    site_label_size?: number
    site_label_offset?: Vec3
    site_label_bg_color?: string
    site_label_color?: string
    site_label_padding?: number
    camera_is_moving?: boolean // bindable: true while orbit controls are active
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
    rotation_target_ref?: Vec3 // Expose rotation target for reset
    initial_computed_zoom?: number // Expose initial zoom for reset
    hidden_elements?: Set<ElementSymbol>
    hidden_prop_vals?: Set<number | string> // Track hidden property values (e.g. Wyckoff positions, coordination numbers)
    element_radius_overrides?: Partial<Record<ElementSymbol, number>> // Per-element absolute radius in Angstroms
    site_radius_overrides?: SvelteMap<number, number> // Per-site absolute radius in Angstroms
    // Per-site colors/values for the active non-element coloring mode, indexed by the sites of
    // `structure` (see StructureSession.property_colors). Null = color atoms by element.
    property_colors?: AtomPropertyColors | null
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
    active_volume_idx?: number // Volume implicit single-isovalue settings apply to
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
    trajectory_lines_result?: TrajectoryLinesStats | null // (output) vertex/segment counts
  } = $props()

  // Tooltip / measurement readout precision (coordinates in Å, angles in degrees)
  const FLOAT_FMT = `.3~f`
  const threlte = bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })
  // Each tick animates a highlight material's opacity, which invalidates the whole scene, so
  // gate on the renderer canvas: a selection left standing would otherwise re-render an
  // off-screen viewport every frame — once per pane in the 2x2 multi-side view.
  const pulse = create_pulse_animation(
    () => selected_sites.length > 0 || active_sites.length > 0,
    { step: 0.015, element: () => threlte.renderer?.domElement },
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
  let target_structure = $state.raw<AnyStructure | null | undefined>()
  let has_target_structure = $state(false)
  $effect(() => {
    const current_structure = structure
    const current_fit_target = fit_frame.center
    if (has_target_structure && current_structure === target_structure) return
    const is_initial_structure = !has_target_structure
    target_structure = current_structure
    has_target_structure = true
    rotation_target_ref =
      is_initial_structure && camera_position.some((coordinate) => coordinate !== 0)
        ? (camera_target ?? rotation_target)
        : current_fit_target
  })

  let atom_tooltip_active = $state(false)
  let hovered_bond_key = $state<string | null>(null)
  const ATOM_HOVER_CLEAR_DELAY_MS = 200
  let clear_atom_hover_timeout: ReturnType<typeof setTimeout> | null = null

  function cancel_atom_hover_clear(): void {
    if (clear_atom_hover_timeout == null) return
    clearTimeout(clear_atom_hover_timeout)
    clear_atom_hover_timeout = null
  }
  $effect(() => cancel_atom_hover_clear)

  function set_atom_hover(site_idx: number): void {
    cancel_atom_hover_clear()
    if (hovered_idx !== site_idx) hovered_idx = site_idx
    if (!atom_tooltip_active) atom_tooltip_active = true
  }

  function schedule_atom_hover_clear(site_idx: number): void {
    cancel_atom_hover_clear()
    clear_atom_hover_timeout = setTimeout(() => {
      clear_atom_hover_timeout = null
      if (hovered_idx !== site_idx) return
      hovered_idx = null
      atom_tooltip_active = false
    }, ATOM_HOVER_CLEAR_DELAY_MS)
  }

  const atom_hover_props = (site_idx: number | null) =>
    !interactive || site_idx == null
      ? {}
      : {
          onpointerenter: () => set_atom_hover(site_idx),
          onpointermove: () => set_atom_hover(site_idx),
          onpointerleave: () => schedule_atom_hover_clear(site_idx),
        }

  // Cursor style for the canvas, derived from mode and hover state
  let canvas_cursor = $derived.by(() => {
    if (!interactive) return `default`
    if (measure_mode === `edit-atoms` && add_atom_mode) return `crosshair`
    if (measure_mode === `edit-bonds` && hovered_bond_key != null) {
      return bond_edits_enabled ? `pointer` : `not-allowed`
    }
    if (hovered_idx != null) {
      if (measure_mode === `edit-bonds`) {
        return bond_edit_mode === `add` && can_select_bond_site(hovered_idx)
          ? `pointer`
          : `not-allowed`
      }
      if (measure_mode === `edit-atoms`) {
        if (is_image_site(structure?.sites?.[hovered_idx])) return `not-allowed`
      }
      return `pointer`
    }
    return `default`
  })

  // Desaturate a color by blending it toward gray (for ghosting image atoms in edit mode)
  const gray = new Color(0x999999)
  const desaturate = (hex: string | undefined, amount = 0.4): string =>
    `#${new Color(hex ?? 0x999999).lerp(gray, amount).getHexString()}`

  // === Edit-atoms mode state ===
  let transform_object = $state<Mesh | undefined>(undefined)
  // Plain variable — only used imperatively in TransformControls drag handlers
  let drag_start_centroid: Vec3 | null = null
  // Frozen centroid set on drag start. While non-null, the TransformControls mesh
  // position stays at this fixed value so Svelte's reactive centroid updates (from
  // PBC wrapping) don't fight TransformControls. Cleared on mouseUp so the mesh
  // snaps to the new wrapped centroid.
  let frozen_centroid = $state<Vec3 | null>(null)

  let bond_context_menu = $state<BondContextMenu | null>(null)
  // Threlte/HTML pointer events can close the visible menu before a button
  // handler runs, so keep the target bond separately for menu actions.
  let bond_context_target: BondContextMenu | null = null

  function close_bond_context_menu() {
    bond_context_menu = null
    bond_context_target = null
  }

  // Shared handlers for bond context-menu buttons: act on pointerdown (a click would
  // arrive after orbit-controls' start handler already closed the menu) or Enter/Space
  const menu_action_props = (action: () => void) => {
    const run = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      action()
    }
    return {
      onpointerdown: run,
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === `Enter` || event.key === ` `) run(event)
      },
    }
  }

  const canonical_bond_target = (bond: BondKeyTarget): BondKeyTarget =>
    canonicalize_bond_target(bond, structure?.sites)

  const bond_key_for = (bond: BondKeyTarget): string =>
    rendered_bond_key_for(canonical_bond_target(bond))

  const matches_bond_key = (bond: BondKeyTarget, key: string): boolean =>
    bond_key_for(bond) === key

  const find_added_bond_by_rendered_key = (key: string): StructureBond | undefined =>
    added_bonds.find((bond) => rendered_bond_key_for(bond) === key)

  function resolve_bond_edit_target(
    site_idx_1: number,
    site_idx_2: number,
    cell_shift?: Vec3,
  ): BondKeyTarget {
    const rendered_target = { site_idx_1, site_idx_2, cell_shift }
    const rendered_key = rendered_bond_key_for(rendered_target)
    return (
      find_added_bond_by_rendered_key(rendered_key) ?? canonical_bond_target(rendered_target)
    )
  }

  const is_image_bond_site = (site_idx: number): boolean =>
    is_image_site(structure?.sites?.[site_idx])

  const can_select_bond_site = (site_idx: number): boolean =>
    bond_edits_enabled && structure?.sites?.[site_idx] != null

  const can_edit_bond = (bond: BondKeyTarget): boolean => {
    const target = canonical_bond_target(bond)
    return (
      bond_edits_enabled &&
      !is_image_bond_site(target.site_idx_1) &&
      !is_image_bond_site(target.site_idx_2)
    )
  }

  function get_current_bond_order(
    site_idx_1: number,
    site_idx_2: number,
    cell_shift?: Vec3,
  ): BondOrder | undefined {
    const key = get_bond_key(site_idx_1, site_idx_2, cell_shift)
    return (
      find_added_bond_by_rendered_key(key)?.order ??
      bond_order_overrides.find((bond) => matches_bond_key(bond, key))?.order ??
      added_bonds.find((bond) => matches_bond_key(bond, key))?.order ??
      filtered_bond_pairs.find((bond) => matches_bond_key(bond, key))?.bond_order
    )
  }

  const BOND_ENDPOINT_HIT_FRACTION = 0.3
  const BOND_ENDPOINT_SITE_MATCH_TOLERANCE = 1e-6
  const EDITABLE_ATOM_HIT_RADIUS_SCALE = 1.15
  // Outer translucent shell around hover/selection. Atom meshes use the same
  // SphereGeometry(0.5) × radius scale, so this is a pure radial margin (1.2 was a bulky 20%).
  const HIGHLIGHT_SHELL_SCALE = 1.08
  const editable_bond_matrix = new Float32Array(16)

  // Shared by every invisible hit target and highlight shell: per-mesh <T.SphereGeometry>
  // would allocate and upload one sphere per hovered/selected/partial-occupancy site
  // (hundreds when the Wyckoff table highlights an orbit) and rebuild them all on every
  // selection change. Hit targets are never drawn, so a coarse sphere raycasts identically.
  const hit_sphere_geometry = new SphereGeometry(0.5, 12, 12)
  const highlight_sphere_geometry = new SphereGeometry(0.5, 22, 22)
  const bond_hit_geometry = new CylinderGeometry(1, 1, 1, 6)
  const invisible_material = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  $effect(() => () => {
    hit_sphere_geometry.dispose()
    highlight_sphere_geometry.dispose()
    bond_hit_geometry.dispose()
    invisible_material.dispose()
  })

  function apply_bond_transform(mesh: Mesh, bond: BondPair, radius: number): void {
    write_bond_transform(editable_bond_matrix, 0, bond.pos_1, bond.pos_2, radius)
    mesh.matrix.fromArray(editable_bond_matrix)
    mesh.matrixWorldNeedsUpdate = true
  }

  function disable_raycast(mesh: Mesh): void {
    mesh.raycast = () => undefined
  }

  // scratch: the endpoint search below runs per pointer event over every site
  const site_world_pos = new Vector3()

  function get_bond_endpoint_site_idx(
    site_idx: number,
    world_position: Vector3,
    parent: Object3D,
  ): number {
    if (!structure?.sites) return site_idx
    const site = structure.sites[site_idx]
    if (!site) return site_idx

    const matches_world_position = (candidate_site: Site): boolean =>
      parent
        .localToWorld(site_world_pos.set(...candidate_site.xyz))
        .distanceTo(world_position) <= BOND_ENDPOINT_SITE_MATCH_TOLERANCE

    if (matches_world_position(site)) {
      return site_idx
    }

    const image_site_idx = structure.sites.findIndex(
      (candidate_site) =>
        candidate_site.properties?.orig_site_idx === site_idx &&
        matches_world_position(candidate_site),
    )
    return image_site_idx === -1 ? site_idx : image_site_idx
  }

  function get_bond_endpoint_hit_site_idx(
    bond: BondPair,
    event: BondPointerEvent,
  ): number | null {
    if (!event.point) return null
    const parent = event.object?.parent
    if (!parent) return null

    const world_pos_1 = new Vector3(...bond.pos_1)
    const world_pos_2 = new Vector3(...bond.pos_2)
    parent.localToWorld(world_pos_1)
    parent.localToWorld(world_pos_2)

    const bond_vec = world_pos_2.clone().sub(world_pos_1)
    const length_sq = bond_vec.lengthSq()
    if (length_sq <= math.EPS) return null

    const hit_vec = event.point.clone().sub(world_pos_1)
    const bond_fraction = hit_vec.dot(bond_vec) / length_sq
    if (bond_fraction <= BOND_ENDPOINT_HIT_FRACTION) {
      return get_bond_endpoint_site_idx(bond.site_idx_1, world_pos_1, parent)
    }
    if (bond_fraction >= 1 - BOND_ENDPOINT_HIT_FRACTION) {
      return get_bond_endpoint_site_idx(bond.site_idx_2, world_pos_2, parent)
    }
    return null
  }

  let label_screen_margin = $derived(site_label_size * 10 + site_label_padding)

  function get_bond_context_menu_position(bond: BondPair, event?: BondContextMenuEvent): Vec3 {
    const parent = event?.object?.parent
    if (!event?.point || !parent) return math.lerp_vec3(bond.pos_1, bond.pos_2, 0.5)

    const local_point = event.point.clone()
    parent.worldToLocal(local_point)
    return [local_point.x, local_point.y, local_point.z]
  }

  function open_bond_context_menu(bond: BondPair, event?: BondContextMenuEvent) {
    if (!can_edit_bond(bond)) return
    bond_context_target = {
      site_idx_1: bond.site_idx_1,
      site_idx_2: bond.site_idx_2,
      cell_shift: bond.cell_shift,
      position: get_bond_context_menu_position(bond, event),
    }
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
    if (!interactive) return // inactive panes must not mutate shared bond state
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
      const bond =
        filtered_bond_pairs.find((pair) => rendered_bond_key_for(pair) === rendered_key) ??
        filtered_bond_pairs.find((pair) => bond_key_for(pair) === canonical_key)
      if (bond) open_bond_context_menu(bond)
      return
    }
    apply_bond_edit_result(result, false)
  }

  function set_bond_order(
    site_idx_1: number,
    site_idx_2: number,
    order: BondOrder,
    cell_shift?: Vec3,
  ) {
    const target = resolve_bond_edit_target(site_idx_1, site_idx_2, cell_shift)
    if (!can_edit_bond(target)) return
    apply_bond_edit_result(
      apply_set_bond_order(
        current_bond_edit_state(),
        target,
        editable_perceived_bond_pairs,
        order,
      ),
    )
  }

  function set_context_bond_order(order: BondOrder) {
    const menu = bond_context_target ?? bond_context_menu
    if (!menu) return
    set_bond_order(menu.site_idx_1, menu.site_idx_2, order, menu.cell_shift)
  }

  function remove_bond(site_idx_1: number, site_idx_2: number, cell_shift?: Vec3) {
    const target = resolve_bond_edit_target(site_idx_1, site_idx_2, cell_shift)
    if (!can_edit_bond(target)) return
    apply_bond_edit_result(
      apply_delete_bond(current_bond_edit_state(), target, editable_perceived_bond_pairs),
    )
  }

  function remove_context_bond() {
    const menu = bond_context_target ?? bond_context_menu
    if (!menu) return
    remove_bond(menu.site_idx_1, menu.site_idx_2, menu.cell_shift)
  }

  // Deduplicate clicks: when a highlight sphere and the underlying atom both
  // intercept the same native click, only the first intersection should fire.
  // All threlte intersection events from one click share the same nativeEvent ref.
  let last_native_event: Event | null = null
  // Instanced-atom raycasts do not always emit pointerdown, so edit-bonds also
  // falls back to click. When pointerdown did fire, skip the matching click once.
  let last_edit_bonds_pointerdown_site_idx: number | null = null
  let clear_edit_bonds_pointerdown_site_timeout: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(clear_edit_bonds_pointerdown_site_timeout))

  function remember_edit_bonds_pointerdown_site(site_idx: number) {
    last_edit_bonds_pointerdown_site_idx = site_idx
    clearTimeout(clear_edit_bonds_pointerdown_site_timeout)
    clear_edit_bonds_pointerdown_site_timeout = setTimeout(() => {
      last_edit_bonds_pointerdown_site_idx = null
    }, 250)
  }

  function select_edit_bonds_site(site_idx: number, event: Event): void {
    toggle_selection(site_idx, event)
    remember_edit_bonds_pointerdown_site(site_idx)
  }

  function skip_duplicate_edit_bonds_click(site_idx: number) {
    if (last_edit_bonds_pointerdown_site_idx !== site_idx) return false
    last_edit_bonds_pointerdown_site_idx = null
    clearTimeout(clear_edit_bonds_pointerdown_site_timeout)
    return true
  }

  // Selection handlers shared by instanced atom meshes and per-site hit targets
  // so the edit-bonds click semantics can't drift between the two paths
  const handle_atom_pointerdown = (site_idx: number, event: PointerEvent) => {
    if (measure_mode !== `edit-bonds` || bond_edit_mode !== `add`) return
    select_edit_bonds_site(site_idx, event)
  }
  const handle_atom_click = (site_idx: number, event: MouseEvent) => {
    // Touch cannot hover, so a tap is the only way to surface the atom tooltip; it stays
    // until the next orbit or tap (the pointerleave-driven clear never fires for touch).
    // On click rather than pointerdown: OrbitControls' `start` fires on pointerdown and
    // wipes the hover. Threlte wraps the DOM event, so pointerType lives on nativeEvent.
    const native_event = (event as BondContextMenuEvent).nativeEvent ?? event
    if ((native_event as PointerEvent).pointerType === `touch`) set_atom_hover(site_idx)
    if (measure_mode === `edit-bonds`) {
      if (bond_edit_mode !== `add`) return
      if (skip_duplicate_edit_bonds_click(site_idx)) {
        event.stopPropagation()
        return
      }
    }
    toggle_selection(site_idx, event)
  }

  // Pointer handlers for an instanced atom mesh: intersection events carry the
  // hit `instanceId`, which indexes into the mesh's `atoms` array. One handler
  // set per mesh instead of one per atom. Inactive grid panes render without
  // raycast handlers; ghosted edit-mode image atoms are non-interactive.
  type InstanceEvent = { instanceId?: number }
  const atom_instance_events = (
    instance_atoms: { site_idx: number }[],
    is_edit_image: boolean,
  ) => {
    if (!interactive || is_edit_image) return {}
    const wrap =
      <Event_ extends InstanceEvent>(handler: (site_idx: number, event: Event_) => void) =>
      (event: Event_) => {
        const site_idx = instance_atoms[event.instanceId ?? -1]?.site_idx
        if (site_idx != null) handler(site_idx, event)
      }
    return {
      onpointerenter: wrap(set_atom_hover),
      onpointermove: wrap(set_atom_hover),
      onpointerleave: wrap(schedule_atom_hover_clear),
      onpointerdown: wrap<PointerEvent & InstanceEvent>(handle_atom_pointerdown),
      onclick: wrap<MouseEvent & InstanceEvent>(handle_atom_click),
    }
  }

  // Pointer props (hover + select) for per-site hit-target meshes (partial-occupancy
  // sites), with the same interactivity gating as atom_instance_events
  const atom_pointer_props = (site_idx: number, is_edit_image: boolean) =>
    !interactive || is_edit_image
      ? {}
      : {
          ...atom_hover_props(site_idx),
          onpointerdown: (event: PointerEvent) => handle_atom_pointerdown(site_idx, event),
          onclick: (event: MouseEvent) => handle_atom_click(site_idx, event),
        }

  function toggle_selection(site_index: number, evt?: Event) {
    evt?.stopPropagation?.()
    const event_with_native = evt as (Event & { nativeEvent?: unknown }) | undefined
    const native_event = event_with_native?.nativeEvent ?? evt
    if (native_event instanceof Event) {
      if (native_event === last_native_event) return
      last_native_event = native_event
    }

    if (measure_mode === `edit-bonds`) {
      // Only the active pane edits: inactive panes keep selection/hover overlays visible
      // but must not change selection or add/restore bonds in shared state.
      if (!interactive) return
      if (bond_edit_mode === `delete`) {
        measured_sites = []
        selected_sites = []
        return
      }
      if (!can_select_bond_site(site_index)) return
      // In Add mode, select atom pairs without making existing bonds destructive.
      const new_sites = measured_sites.includes(site_index)
        ? measured_sites.filter((idx) => idx !== site_index)
        : [...measured_sites, site_index]

      measured_sites = new_sites
      selected_sites = new_sites

      // When two atoms are selected, add/restore or open order editing.
      if (new_sites.length === 2) {
        add_or_restore_pair(new_sites[0], new_sites[1])
        measured_sites = []
        selected_sites = []
      }
      return
    }

    if (measure_mode === `edit-atoms`) {
      // Inactive panes don't drive edit-atoms selection (gizmo/add-plane are interactive-gated)
      if (!interactive) return
      // Block image atoms (detected by orig_site_idx property from PBC)
      if (is_image_site(structure?.sites?.[site_index])) return

      const is_selected = selected_sites.includes(site_index)
      // threlte dispatches plain objects wrapping the DOM event, so read shift
      // from the extracted native event (evt itself is never a MouseEvent for 3D hits)
      const is_shift = native_event instanceof MouseEvent && native_event.shiftKey

      // In edit-atoms mode, selected_sites and measured_sites always stay in sync
      let new_sites: number[]
      if (is_shift) {
        // Multi-select: toggle this site in/out of selection
        new_sites = is_selected
          ? selected_sites.filter((idx) => idx !== site_index)
          : [...selected_sites, site_index]
      } else {
        // Single-select: replace selection (or deselect if already selected)
        new_sites = is_selected ? [] : [site_index]
      }
      selected_sites = new_sites
      measured_sites = new_sites
      return
    }

    const site_cap = measure.max_measured_sites(measure_mode)
    if (!measured_sites.includes(site_index) && measured_sites.length >= site_cap) {
      if (!measure.rolls_measured_sites(measure_mode)) {
        console.warn(
          `Selection size limit reached (${measure.MAX_SELECTED_SITES}). Deselect some sites first.`,
        )
        return
      }
      const dropped = measured_sites[0]
      measured_sites = [...measured_sites.slice(1), site_index]
      selected_sites = [...selected_sites.filter((idx) => idx !== dropped), site_index]
      return
    }

    measured_sites = measured_sites.includes(site_index)
      ? measured_sites.filter((idx) => idx !== site_index)
      : [...measured_sites, site_index]
    selected_sites = selected_sites.includes(site_index)
      ? selected_sites.filter((idx) => idx !== site_index)
      : [...selected_sites, site_index]
  }

  $effect(() => {
    void structure
    void measure_mode
    void bond_edit_mode
    void bond_edits_enabled
    untrack(() => {
      close_bond_context_menu()
      hovered_bond_key = null
    })
  })

  // Pre-effect: drop out-of-range indices before the measurement overlays below index
  // structure.sites with them, not after that render has already run against stale picks.
  $effect.pre(() => {
    const count = structure?.sites?.length ?? 0
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

  $effect(() => {
    cursor = canvas_cursor
  })

  const { enabled: hover_enabled } = extras.interactivity()
  let hovered_site = $derived(structure?.sites?.[hovered_idx ?? -1] ?? null)
  let lattice = $derived(structure && `lattice` in structure ? structure.lattice : null)

  let visual_lattice = $derived(
    base_structure && `lattice` in base_structure ? base_structure.lattice : lattice,
  )

  let rotation_target = $derived(
    lattice
      ? math.scale(math.add(...lattice.matrix), 0.5)
      : structure
        ? get_center_of_mass(structure)
        : ([0, 0, 0] as Vec3),
  )
  // Negated target for the inner un-translate group (recomputed only on target change)
  let neg_rotation_target = $derived(math.scale(rotation_target, -1) as Vec3)

  // Near/far / skybox — not framing. Lattice avg edge stays stable when images toggle.
  let structure_size = $derived.by(() => {
    if (lattice) return (lattice.a + lattice.b + lattice.c) / 2
    if (!structure?.sites?.length) return 10
    // One pass, no spread: Math.max(...coords) overflows the argument limit past ~1e5 sites
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const { xyz } of structure.sites) {
      for (let axis = 0; axis < 3; axis++) {
        if (xyz[axis] < min[axis]) min[axis] = xyz[axis]
        if (xyz[axis] > max[axis]) max[axis] = xyz[axis]
      }
    }
    return Math.max(1, max[0] - min[0], max[1] - min[1], max[2] - min[2])
  })

  // Content AABB fit for ortho zoom / look-at. Frozen while dragging atoms.
  let last_fit_frame = { center: [0, 0, 0] as Vec3, extent: 10 }
  let fit_frame = $derived.by(() => {
    if (dragging_atoms) return last_fit_frame
    return (last_fit_frame = structure_fit_frame(structure, {
      atom_radius_scale: show_atoms ? atom_radius : 0,
      same_size_atoms,
      element_radius_overrides,
      site_radius_overrides,
    }))
  })
  let fit_extent = $derived(fit_frame.extent)

  // Characteristic inter-atomic spacing: cube root of the volume one atom occupies, with any
  // vacuum padding in the cell taken out first (see characteristic_atom_spacing). Excludes PBC
  // image atoms so toggling image atoms doesn't affect arrow sizing.
  let char_atom_spacing = $derived(
    structure ? characteristic_atom_spacing(structure) : structure_size,
  )

  // Uniform thickness turns negative (length-relative) arrow sizes into absolute ones scaled
  // by the inter-atomic spacing; positive (already absolute) values pass through
  const uniform_arrow_size = (size: number): number =>
    vector_uniform_thickness && size < 0 ? char_atom_spacing * -size : size
  let eff_shaft_radius = $derived(uniform_arrow_size(vector_shaft_radius))
  let eff_head_radius = $derived(uniform_arrow_size(vector_arrow_head_radius))
  let eff_head_length = $derived(uniform_arrow_size(vector_arrow_head_length))

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
    extent: () => fit_extent,
    zoom_for: (extent) => ortho_zoom_for_extent(extent, width, height, initial_zoom),
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
    // No hover raycasts while orbiting: the highlight hopping between atoms under the cursor
    // reads as flicker. Pointerdown reaches the meshes before OrbitControls' start, so presses work
    set_camera_is_moving: (moving) => {
      camera_is_moving = moving
      hover_enabled.set(!moving)
    },
    // Close hover tooltips + bond context menu while the camera moves. Only hide the
    // VISIBLE menu (not bond_context_target): clicking a menu button fires this
    // orbit-controls start handler before the button's own handler runs, which still
    // needs the target bond to apply the edit (see bond_context_target comment).
    on_start_extra: () => {
      cancel_atom_hover_clear()
      hovered_idx = null
      hovered_bond_key = null
      bond_context_menu = null
    },
  })

  $effect.pre(() => {
    const previous_view = camera_fit_cache.previous_view
    const view_changed = previous_view !== undefined && previous_view !== camera_view
    const should_fit = camera_needs_fit(camera_position, previous_view, camera_view)
    camera_fit_cache.previous_view = camera_view
    // Auto-place at content center; missing/zero camera_direction → default angled view.
    if (should_fit && structure && measured()) {
      fit.refit()
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
      const target = view_changed ? fit_frame.center : (camera_target ?? fit_frame.center)
      if (view_changed || camera_target === undefined) camera_target = target
      rotation_target_ref = target
      camera_position = camera_position_for_target(target, distance, camera_direction)
      // a fresh framing starts unpanned; the pan lives on the camera, not in camera_target
      clear_pan_offset(untrack(() => camera))
    }
  })
  // Whether a never|always|crystals|molecules setting applies to the current structure
  const applies_to_structure = (when: ShowBonds): boolean =>
    when === `always` ||
    (when === `crystals` && Boolean(lattice)) ||
    (when === `molecules` && !lattice)

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
  let bond_pairs: BondPair[] = $derived.by(() => {
    const want_bonds = applies_to_structure(show_bonds)
    const want_polyhedra = applies_to_structure(effective_show_polyhedra)
    return structure && (want_bonds || want_polyhedra)
      ? compute_bonds(structure, bonding_strategy, bonding_options)
      : []
  })

  // Disordered sites are often stored as separate split sites (one species each)
  // at the same position; merge_split_partial_sites groups them into one render
  // site whose `species` holds every element. Shared by atom rendering and the
  // hover tooltip so it lists all elements, not just the majority one.
  let render_sites = $derived(
    structure?.sites ? merge_split_partial_sites(structure.sites, hidden_elements) : [],
  )

  let atom_data = $derived.by(() => {
    if (!show_atoms) return []
    // Hoist everything constant across sites: this loop runs >10k times for a 3x3x3
    // supercell, and the collections below live on a $state object or are SvelteMap/
    // SvelteSet, whose get/has allocate a signal per key.
    const element_colors = colors.element
    const { values: prop_values, colors: prop_colors } = property_colors ?? {}
    const filter_prop_vals = hidden_prop_vals.size > 0
    const filter_elements = hidden_elements.size > 0
    const hide_completion_images =
      !applies_to_structure(effective_show_bonds) &&
      !applies_to_structure(effective_show_polyhedra)
    // Props arrive through two spread layers (Structure → Viewport → here), so every read
    // inside the loop would walk that proxy chain per site: read them once
    const radius_scale = effective_atom_radius
    const radius_opts = { same_size_atoms, element_radius_overrides, site_radius_overrides }
    const hidden_centers = polyhedra_hide_center_atoms ? polyhedra_center_site_idxs : null

    const atoms = []
    for (const { site_idx, site, is_image_atom } of render_sites) {
      // Skip sites with hidden property values
      if (filter_prop_vals) {
        const prop_val = prop_values?.[site_idx]
        if (prop_val !== undefined && hidden_prop_vals.has(prop_val)) continue
      }

      // Optionally hide atoms at the center of a rendered polyhedron
      if (hidden_centers?.has(site_idx)) continue

      // Phase-2 PBC images exist only to complete bonds/coordination polyhedra at
      // cell faces. When neither renders (polyhedra toggled off, symmetry declutter,
      // …) they'd float disconnected outside the cell — hide them.
      if (site.properties?.completion_image && hide_completion_images) continue

      // All radii scale uniformly with atom_radius for consistent slider behavior
      const radius = site_base_radius(site, site_idx, radius_opts) * radius_scale

      // Use property color if available (e.g. coordination number, Wyckoff position)
      // Otherwise, each species gets its own element color (important for disordered sites)
      const site_property_color = prop_colors?.[site_idx]

      const visible_species = filter_elements
        ? site.species.filter(({ element }) => !hidden_elements.has(element))
        : site.species
      for (const slice_data of compute_slice_geometry(visible_species)) {
        atoms.push({
          site_idx,
          element: slice_data.element,
          occupancy: slice_data.occupancy,
          position: site.xyz,
          radius,
          color: site_property_color ?? element_colors?.[slice_data.element],
          has_partial_occupancy: slice_data.occupancy < 1,
          start_phi: slice_data.start_phi,
          end_phi: slice_data.end_phi,
          phi_length: slice_data.phi_length,
          render_start_cap: slice_data.render_start_cap,
          render_end_cap: slice_data.render_end_cap,
          is_image_atom,
        })
      }
    }
    return atoms
  })

  // Shared visibility check: site has at least one non-hidden element and
  // its property value (if any) isn't hidden. Used by both bond and vector filtering.
  const is_site_visible = (site_idx: number): boolean => {
    const site = structure?.sites?.[site_idx]
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
  let perceived_bond_pairs: BondPair[] = $derived.by(() => {
    if (!auto_bond_order || !structure?.sites || bond_pairs.length === 0) {
      return bond_pairs
    }
    const total_charge = (`charge` in structure ? structure.charge : 0) ?? 0
    const perceived = perceive_bond_orders(structure.sites, bond_pairs, {
      total_charge,
    })
    // Explicit structure.properties.bonds are user-authoritative and must
    // never be clobbered by perception. Composition + precedence is a pure,
    // unit-tested helper (see compose_perceived_bonds).
    return compose_perceived_bonds(
      perceived,
      get_explicit_bond_metadata(structure),
      aromatic_display,
    )
  })

  // Only the edit-bonds handlers read these, so outside that mode skip the per-bond
  // canonicalisation pass a trajectory would otherwise pay on every frame
  let editable_perceived_bond_pairs = $derived(
    interactive && bond_edits_enabled && measure_mode === `edit-bonds`
      ? perceived_bond_pairs.map((bond) => ({ ...bond, ...canonical_bond_target(bond) }))
      : [],
  )

  let filtered_bond_pairs = $derived.by(() => {
    if (!structure?.sites) return perceived_bond_pairs

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
    for (const bond of perceived_bond_pairs) {
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
    if (applies_to_structure(effective_show_bonds)) return filtered_bond_pairs
    const added_keys = new Set(added_bonds.map(bond_key_for))
    return filtered_bond_pairs.filter((bond) => added_keys.has(bond_key_for(bond)))
  })

  let editable_bond_pairs = $derived(
    interactive && bond_edits_enabled && measure_mode === `edit-bonds`
      ? bonds_to_render.filter(can_edit_bond)
      : [],
  )

  // Coordination polyhedra around cation-like centers, derived from the same
  // (edited, filtered) bond graph as rendered bonds so the two never disagree.
  // Colors are resolved in polyhedra_buffers below, so color-scheme/mode changes
  // never recompute the hull geometry.
  let last_polyhedra: Polyhedron[] = []
  let polyhedra: Polyhedron[] = $derived.by(() => {
    if (defer_expensive_geometry) return last_polyhedra
    if (
      !structure?.sites ||
      dragging_atoms ||
      !applies_to_structure(effective_show_polyhedra) ||
      filtered_bond_pairs.length === 0
    ) {
      last_polyhedra = []
      return last_polyhedra
    }
    last_polyhedra = compute_polyhedra(structure, filtered_bond_pairs, {
      min_neighbors: polyhedra_min_neighbors,
      // The two sliders have overlapping ranges (min goes to 12, max down to 4), so they can
      // be dragged past each other. Widening the cap instead of honoring an empty window
      // keeps polyhedra on screen rather than silently rendering none.
      max_neighbors: Math.max(polyhedra_min_neighbors, polyhedra_max_neighbors),
      excluded_center_elements: polyhedra_excluded_elements,
      included_center_elements: polyhedra_included_elements,
    })
    return last_polyhedra
  })

  // Color of a site: property color (coordination/Wyckoff modes) or element color
  const polyhedra_site_color = (site_idx: number): string => {
    const element = get_majority_element(structure?.sites[site_idx])
    return (
      property_colors?.colors[site_idx] ?? (element && colors.element?.[element]) ?? `#808080`
    )
  }

  // Separate derived so material-only changes (opacity, edge color) don't rebuild
  // buffers and color changes don't rebuild hulls
  let polyhedra_buffers = $derived.by(() => {
    if (polyhedra.length === 0) return null
    const get_vertex_color = (poly: Polyhedron, vertex_idx: number): string => {
      if (polyhedra_color_mode === `uniform`) return polyhedra_color
      if (polyhedra_color_mode === `center`) {
        return polyhedra_site_color(poly.center_site_idx)
      }
      // 'vertex' (default): each corner takes the color of the atom that forms it
      return polyhedra_site_color(poly.vertex_site_idxs[vertex_idx])
    }
    return merge_polyhedra_buffers(polyhedra, get_vertex_color)
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

  // Geometries with proper disposal on dependency change (same pattern as ReferencePlane)
  const buffer_geometry = (attrs: Record<string, Float32Array>): BufferGeometry => {
    const geo = new BufferGeometry()
    for (const [name, array] of Object.entries(attrs)) {
      geo.setAttribute(name, new BufferAttribute(array, 3))
    }
    return geo
  }
  let polyhedra_geometry: BufferGeometry | null = $state(null)
  $effect(() => {
    let geo: BufferGeometry | null = null
    if (polyhedra_buffers && polyhedra_buffers.triangle_count > 0) {
      const { positions: position, colors: color } = polyhedra_buffers
      geo = buffer_geometry({ position, color })
      geo.computeVertexNormals() // non-indexed -> per-face normals (flat shading)
    }
    polyhedra_geometry = geo
    return () => geo?.dispose()
  })

  let polyhedra_edge_geometry: BufferGeometry | null = $state(null)
  $effect(() => {
    const geo =
      polyhedra_show_edges && polyhedra_buffers && polyhedra_buffers.edge_count > 0
        ? buffer_geometry({ position: polyhedra_buffers.edge_positions })
        : null
    polyhedra_edge_geometry = geo
    return () => geo?.dispose()
  })

  let smart_site_label_offsets = $derived.by(() => {
    // Plain Maps: built and consumed inside deriveds, so per-entry reactivity
    // (SvelteMap) would only add signal overhead for potentially thousands of sites
    const offsets = new Map<number, Vec3>()
    // Only SiteLabels reads these, so skip the bond walk while no labels are shown
    if (bonds_to_render.length === 0 || (!show_site_labels && !show_site_indices))
      return offsets

    const bond_directions_by_site = new Map<number, Vec3[]>()
    const add_bond_direction = (site_idx: number, pos_1: Vec3, pos_2: Vec3) => {
      const direction = math.normalize_vec(math.subtract(pos_2, pos_1), [0, 0, 0])
      if (Math.hypot(...direction) < LABEL_OFFSET_EPS) return
      const directions = bond_directions_by_site.get(site_idx)
      if (directions) directions.push(direction)
      else bond_directions_by_site.set(site_idx, [direction])
    }

    for (const { site_idx_1, site_idx_2, pos_1, pos_2 } of bonds_to_render) {
      add_bond_direction(site_idx_1, pos_1, pos_2)
      add_bond_direction(site_idx_2, pos_2, pos_1)
    }
    for (const [site_idx, bond_directions] of bond_directions_by_site) {
      offsets.set(site_idx, choose_site_label_offset(bond_directions, site_label_offset))
    }
    return offsets
  })

  let bond_site_colors = $derived.by(() => {
    if (!structure?.sites || bonds_to_render.length === 0) return []

    // Resolve once per site, not once per bond endpoint. Bond writes these values directly
    // into its persistent instance-color buffers without allocating per-cylinder objects.
    const [element_colors, fallback_color] = [colors.element, bond_color]
    return structure.sites.map((site) => {
      const element = get_majority_element(site)
      return (element && element_colors?.[element]) || fallback_color
    })
  })

  // One pass over atom_data (>10k entries for a 3x3x3 supercell, rebuilt every trajectory
  // frame) splits it for rendering and keeps each site's first entry: a partial-occupancy
  // site contributes one wedge per species, but labels, hit targets and highlight lookups
  // want one anchor per site. Full-occupancy atoms render as ONE InstancedMesh per set
  // (per-atom color/radius live in instance buffers); image atoms get their own mesh because
  // they ghost (desaturate + translucent) and lose interactivity in edit-atoms mode.
  let atom_groups = $derived.by(() => {
    const first_by_site = new Map<number, (typeof atom_data)[number]>()
    const base: typeof atom_data = []
    const image: typeof atom_data = []
    const partial: typeof atom_data = []
    for (const atom of atom_data) {
      if (!first_by_site.has(atom.site_idx)) first_by_site.set(atom.site_idx, atom)
      if (atom.has_partial_occupancy) partial.push(atom)
      else (atom.is_image_atom ? image : base).push(atom)
    }
    return { first_by_site, base, image, partial }
  })
  const site_anchor = ({ site_idx, position, radius }: (typeof atom_data)[number]) => ({
    site_idx,
    position,
    radius,
  })

  // Partial-occupancy atoms render as separate wedge (lune) meshes that converge
  // to a point at the sphere's poles, leaving the ball hard to hover from some
  // angles. Give each such site one invisible full-sphere hit target so it's as
  // reliably hoverable as an ordered atom (single solid sphere). One per site.
  let partial_hit_targets = $derived(
    interactive
      ? [...atom_groups.first_by_site.values()]
          .filter((atom) => atom.has_partial_occupancy)
          .map((atom) => ({ ...site_anchor(atom), is_image_atom: atom.is_image_atom }))
      : [],
  )

  let editable_atom_hit_targets = $derived(
    interactive &&
      measure_mode === `edit-bonds` &&
      bond_edit_mode === `add` &&
      bond_edits_enabled
      ? [...atom_groups.first_by_site.values()]
          .filter((atom) => can_select_bond_site(atom.site_idx))
          .map(site_anchor)
      : [],
  )

  // Radius of a site that atom_data may have filtered out (highlight fallback)
  const get_site_radius = (site: Site, site_idx: number): number =>
    site_base_radius(site, site_idx, {
      same_size_atoms,
      element_radius_overrides,
      site_radius_overrides,
    }) * effective_atom_radius

  // Sites to outline with a translucent sphere: hovered + all selected/active sites. Kept
  // independent of the pulse animation so this list (with its per-site radius lookups) only
  // rebuilds when highlighted sites change; pulsing opacity is applied per-frame in the
  // template instead, avoiding a rebuild every frame in every multi-view pane.
  type HighlightTarget = {
    kind: `hover` | `selected` | `active`
    site: Site
    site_idx: number
    color: string
    radius: number
  }
  let highlight_targets: HighlightTarget[] = $derived.by(() => {
    const targets: HighlightTarget[] = []
    const add = (kind: HighlightTarget[`kind`], site_idx: number, color: string) => {
      const site = structure?.sites?.[site_idx]
      if (!site) return
      const radius =
        atom_groups.first_by_site.get(site_idx)?.radius ?? get_site_radius(site, site_idx)
      targets.push({ kind, site, site_idx, color, radius })
    }
    if (hovered_idx !== null) {
      const hover_color =
        atom_groups.first_by_site.get(hovered_idx)?.color ??
        (hovered_site?.species[0] && colors.element?.[hovered_site.species[0].element])
      add(`hover`, hovered_idx, brighten_hex(hover_color))
    }
    for (const idx of selected_sites) add(`selected`, idx, selection_highlight_color)
    for (const idx of active_sites) add(`active`, idx, active_highlight_color)
    return targets
  })

  // sRGB blend from spin-down blue to spin-up red by the z-component direction of a magnetic
  // vector (0 = down, 1 = up; a zero vector sits in the middle)
  const [spin_down_rgb, spin_up_rgb] = [rgb(`#3498db`), rgb(`#e74c3c`)]
  function spin_direction_color(vec: Vec3): string {
    const mag = Math.hypot(...vec)
    const z_frac = mag > 1e-10 ? (vec[2] / mag + 1) / 2 : 0.5
    return rgb(
      math.lerp(spin_down_rgb.r, spin_up_rgb.r, z_frac),
      math.lerp(spin_down_rgb.g, spin_up_rgb.g, z_frac),
      math.lerp(spin_down_rgb.b, spin_up_rgb.b, z_frac),
    ).formatHex()
  }

  // Build one arrow layer per visible vector key. Auto-scales the longest
  // vector to 1.8× char_atom_spacing (cube root of volume per atom).
  // When vector_normalize is on, effective_max is 1 so all arrows get equal length.
  // Single active key preserves legacy coloring (element for force,
  // spin-direction for magmom/spin). Multiple keys use flat palette colors.
  let vector_layers = $derived.by(() => {
    if (!structure?.sites) return []
    const keys = get_structure_vector_keys(structure)
    const active_keys = keys.filter((key) => vector_configs[key]?.visible !== false)
    if (active_keys.length === 0) return []

    // Build per-site lookup; skip hidden sites so they don't contribute
    // arrows or affect autoscaling. null entries = hidden site.
    const active_set = new Set(active_keys)
    let max_mag = 0
    // Per-site prop reads walk the Structure → Viewport → scene spread chain; read once
    const nothing_hidden = hidden_elements.size === 0 && hidden_prop_vals.size === 0
    const [color_mode, uniform_color, normalize_arrows, element_colors] = [
      vector_color_mode,
      vector_color,
      vector_normalize,
      colors.element,
    ]
    const site_vec_maps = structure.sites.map((site, site_idx) => {
      if (nothing_hidden ? site.species.length === 0 : !is_site_visible(site_idx)) return null
      const map = new Map<string, Vec3>()
      for (const { key, vec } of get_all_site_vectors(site, false)) {
        map.set(key, vec)
        if (active_set.has(key)) {
          max_mag = Math.max(max_mag, Math.hypot(...vec))
        }
      }
      return map
    })

    // When normalize is on, treat all magnitudes as 1 so arrows have equal length
    const effective_max = vector_normalize ? 1 : max_mag
    const auto_scale = effective_max > 1e-10 ? (char_atom_spacing * 1.8) / effective_max : 1
    const is_single = active_keys.length === 1
    const effective_global_scale = auto_scale * vector_scale

    // When vector_origin_gap > 0 and multiple vectors exist at a site,
    // arrange arrow origins on a regular polygon centered on the atom, in a
    // plane perpendicular to the mean vector direction. The gap is a fraction
    // of the visual atom radius (0 = center, 0.5 = halfway to surface).
    // get_site_radius() returns the uniform scale applied to SphereGeometry(0.5),
    // so visual_radius = get_site_radius() * 0.5.
    const site_offsets =
      vector_origin_gap > 0 && !is_single
        ? structure.sites.map((site, site_idx) => {
            const vec_map = site_vec_maps[site_idx]
            if (!vec_map) return null
            const site_keys = active_keys.filter((key) => vec_map.has(key))
            const n_keys = site_keys.length
            if (n_keys <= 1) return null
            const visual_radius = get_site_radius(site, site_idx) * 0.5
            const gap_abs = vector_origin_gap * visual_radius
            let mean: Vec3 = [0, 0, 0]
            for (const key of site_keys) {
              const vec = vec_map.get(key)
              if (vec) mean = math.add(mean, math.normalize_vec(vec)) as Vec3
            }
            const mean_dir = math.normalize_vec(mean, [0, 1, 0] as Vec3)
            const [u_vec, v_vec] = math.compute_in_plane_basis(mean_dir)
            const offsets = new Map<string, Vec3>()
            for (const [idx, key] of site_keys.entries()) {
              const angle = (2 * Math.PI * idx) / n_keys
              const dx = math.scale(u_vec, gap_abs * Math.cos(angle))
              const dy = math.scale(v_vec, gap_abs * Math.sin(angle))
              offsets.set(key, math.add(dx, dy))
            }
            return offsets
          })
        : null

    const mag_interpolator = get_d3_interpolator(vector_color_scale)

    return active_keys.map((key, layer_idx) => {
      const layer_cfg = vector_configs[key]
      const display_defaults = vector_display_defaults(key)
      const layer_scale = effective_global_scale * (layer_cfg?.scale ?? 1.0)
      const layer_color = layer_cfg?.color ?? VECTOR_PALETTE[layer_idx % VECTOR_PALETTE.length]

      const arrows = structure.sites
        .map((site, site_idx) => {
          const vec_map = site_vec_maps[site_idx]
          if (!vec_map) return null
          const vec = vec_map.get(key)
          if (!vec) return null

          // Resolve color mode: explicit per-key color always wins,
          // then multi-key uses palette, then mode-based coloring
          let arrow_color: string
          if (layer_cfg?.color) {
            arrow_color = layer_cfg.color
          } else if (!is_single) arrow_color = layer_color
          else {
            const effective_mode =
              color_mode === `auto`
                ? key.startsWith(`magmom`) || key.startsWith(`spin`)
                  ? `spin_direction`
                  : `element`
                : color_mode
            if (effective_mode === `magnitude`) {
              const mag = Math.hypot(...vec)
              const norm = max_mag > 1e-10 ? mag / max_mag : 0
              arrow_color = mag_interpolator(norm)
            } else if (effective_mode === `spin_direction`) {
              arrow_color = spin_direction_color(vec)
            } else if (effective_mode === `uniform`) {
              arrow_color = uniform_color
            } else {
              const majority_element = get_majority_element(site)
              arrow_color =
                (majority_element && element_colors?.[majority_element]) || uniform_color
            }
          }

          const offset = site_offsets?.[site_idx]?.get(key)
          const position = offset ? math.add(site.xyz, offset) : site.xyz
          const arrow_vec = normalize_arrows ? math.normalize_vec(vec) : vec

          return {
            site_idx,
            position,
            vector: arrow_vec,
            scale: layer_scale,
            color: arrow_color,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)

      return {
        key,
        arrows,
        shaft_radius: eff_shaft_radius * display_defaults.shaft_radius,
        arrow_head_radius: eff_head_radius * display_defaults.arrow_head_radius,
        arrow_head_length: eff_head_length * display_defaults.arrow_head_length,
      }
    })
  })

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
    trajectory_trail_anchors(structure?.sites, trajectory_position_stream?.n_atoms),
  )

  let displacement_arrows = $derived.by(() => {
    const vectors = displacement_field?.vectors
    if (!vectors || !show_displacement_arrows || !structure?.sites) return []
    // Accumulate the largest magnitude over VISIBLE sites only (as vector_layers does), so
    // hiding the element carrying the biggest displacement doesn't shrink every other arrow.
    let max_mag = 0
    const visible = structure.sites.flatMap((site, site_idx) => {
      if (!is_site_visible(site_idx)) return []
      const vector = vectors[get_orig_site_idx(site, site_idx)]
      if (!vector) return []
      const magnitude = Math.hypot(vector[0], vector[1], vector[2])
      if (magnitude < math.EPS) return []
      max_mag = Math.max(max_mag, magnitude)
      return [{ position: site.xyz, vector }]
    })
    // Auto-scale the largest displacement to a fixed fraction of the characteristic atom
    // spacing, as the site-vector layers do. Relaxation displacements are typically well under
    // an atomic radius, so drawing them at true length buries every arrow inside its own atom
    // sphere. True magnitudes stay available in the RMSD/max readout, and
    // displacement_arrow_scale multiplies on top of this.
    const auto_scale = max_mag > math.EPS ? (char_atom_spacing * 0.9) / max_mag : 1
    const scale = auto_scale * displacement_arrow_scale
    return visible.map((arrow) => ({ ...arrow, scale, color: displacement_arrow_color }))
  })

  // One label anchor per visible site
  let label_entries = $derived(
    show_site_labels || show_site_indices
      ? [...atom_groups.first_by_site.values()].map(site_anchor)
      : [],
  )

  // Hovered site's bonded neighbours for the tooltip, e.g. `3 (N: 2, O: 1)`; null when none
  let hovered_bond_summary = $derived.by((): string | null => {
    if (hovered_idx === null || !structure?.sites) return null
    const counts: Record<string, number> = {}
    let total = 0
    for (const { site_idx_1, site_idx_2 } of filtered_bond_pairs) {
      if (site_idx_1 !== hovered_idx && site_idx_2 !== hovered_idx) continue
      const neighbor_idx = site_idx_1 === hovered_idx ? site_idx_2 : site_idx_1
      const element = structure.sites[neighbor_idx]?.species[0]?.element ?? `?`
      counts[element] = (counts[element] ?? 0) + 1
      total += 1
    }
    if (total === 0) return null
    const parts = Object.entries(counts)
      .toSorted(([elem_a], [elem_b]) => elem_a.localeCompare(elem_b))
      .map(([elem, count]) => `${elem}: ${count}`)
    return `${total} (${parts.join(`, `)})`
  })

  let measure_line_color = $derived.by(() => {
    // re-resolve --text-color when the light/dark theme flips
    void theme_state.mode
    if (typeof window === `undefined`) return
    const root_styles = getComputedStyle(document.documentElement)
    const text_color = root_styles.getPropertyValue(`--text-color`).trim()
    return text_color || `#808080`
  })
</script>

{#snippet site_label_snippet(site_idx: number)}
  {@const site = structure?.sites[site_idx]}
  {#if site}
    {#if atom_label}
      {@render atom_label({ site, site_idx })}
    {:else}
      <button
        type="button"
        class="atom-label"
        style="font-size: {site_label_size *
          0.85}em; background: {site_label_bg_color}; padding: {site_label_padding}px; color: {site_label_color}"
        onpointerdown={(event) => {
          event.preventDefault()
          event.stopImmediatePropagation()
          toggle_selection(site_idx, event)
        }}
        onclick={(event) => {
          event.preventDefault()
          event.stopImmediatePropagation()
        }}
        onkeydown={(event) => {
          if (event.key !== `Enter` && event.key !== ` `) return
          event.preventDefault()
          event.stopPropagation()
          toggle_selection(site_idx, event)
        }}
      >
        {#if show_site_labels}
          {#if site.species.length === 1}
            {site.species[0].element}{#if show_site_indices}-{site_idx + 1}{/if}
          {:else}
            {#each site.species as { element, occu, oxidation_state } (`${element}-${occu}-${oxidation_state}`)}
              {element}<sub>{format_num(occu, `.3~`).replace(`0.`, `.`)}</sub>
            {/each}
            {#if show_site_indices}-{site_idx + 1}{/if}
          {/if}
        {:else if show_site_indices}
          {site_idx + 1}
        {/if}
      </button>
    {/if}
  {/if}
{/snippet}

<SceneCamera
  {camera_projection}
  position={camera_position}
  fov={effective_fov}
  zoom={scene_camera.zoom}
  near={camera_near}
  far={camera_far}
  orbit_props={scene_camera.orbit_props}
  {gizmo}
  bind:orbit_controls
/>

<SceneLights ambient={ambient_light} directional={directional_light} />

<!-- Apply manual rotation around center: translate to origin, rotate, translate back -->
<T.Group position={rotation_target}>
  <T.Group {rotation}>
    <T.Group position={neg_rotation_target}>
      {#if show_atoms}
        <!-- Instanced rendering for full-occupancy atoms: one InstancedMesh for
          base atoms and one for PBC image atoms (which ghost + lose interaction
          in edit-atoms mode). Pointer events are resolved via raycast instanceId. -->
        {#if atom_groups.base.length > 0}
          <InstancedAtoms
            atoms={atom_groups.base}
            {sphere_segments}
            positions_only={defer_expensive_geometry}
            {...atom_instance_events(atom_groups.base, false)}
          />
        {/if}
        {#if atom_groups.image.length > 0}
          {@const edit_mode_image = measure_mode === `edit-atoms`}
          <InstancedAtoms
            atoms={atom_groups.image}
            {sphere_segments}
            ghost={edit_mode_image}
            positions_only={defer_expensive_geometry}
            {...atom_instance_events(atom_groups.image, edit_mode_image)}
          />
        {/if}

        <!-- Regular rendering for partial occupancy atoms -->
        {#each atom_groups.partial as atom (atom.site_idx + atom.element + atom.occupancy)}
          {@const partial_edit_image = measure_mode === `edit-atoms` && atom.is_image_atom}
          {@const ghost_opacity = partial_edit_image ? 0.5 : 1}
          <!-- Visual only: pointer interaction handled by the invisible full-sphere
            hit targets below (wedge meshes leave gaps at the poles). -->
          <T.Group position={atom.position} scale={atom.radius}>
            {@const partial_color = partial_edit_image ? desaturate(atom.color) : atom.color}
            <T.Mesh>
              <T.SphereGeometry
                args={[0.5, sphere_segments, sphere_segments, atom.start_phi, atom.phi_length]}
              />
              <T.MeshStandardMaterial
                color={partial_color}
                opacity={ghost_opacity}
                transparent={partial_edit_image}
              />
            </T.Mesh>

            <!-- Flat caps closing the wedge at its start/end azimuthal angles -->
            {#each [[atom.render_start_cap, atom.start_phi], [atom.render_end_cap, atom.end_phi]] as const as [render_cap, phi], cap_idx (cap_idx)}
              {#if render_cap}
                <T.Mesh rotation={[0, phi, 0]}>
                  <T.CircleGeometry
                    args={[0.5, sphere_segments, CAP_ARC_START, CAP_ARC_LENGTH]}
                  />
                  <T.MeshStandardMaterial
                    color={partial_color}
                    side={2}
                    opacity={ghost_opacity}
                    transparent={partial_edit_image}
                  />
                </T.Mesh>
              {/if}
            {/each}
          </T.Group>
        {/each}

        <!-- Invisible full-sphere hit targets for partial-occupancy sites so the
          whole ball is hoverable/clickable (wedge meshes leave gaps at the poles). -->
        {#each partial_hit_targets as hit (hit.site_idx)}
          {@const hit_edit_image = measure_mode === `edit-atoms` && hit.is_image_atom}
          <T.Mesh
            geometry={hit_sphere_geometry}
            material={invisible_material}
            position={hit.position}
            scale={hit.radius}
            {...atom_pointer_props(hit.site_idx, hit_edit_image)}
          />
        {/each}

        <!-- Site labels/indices: single overlay for all labels (one DOM container
          + one per-frame position pass instead of one threlte <HTML> per label) -->
        {#if label_entries.length > 0}
          <SiteLabels
            entries={label_entries}
            get_offset={(site_idx) =>
              smart_site_label_offsets.get(site_idx) ?? site_label_offset}
            screen_margin={label_screen_margin}
          >
            {#snippet label({ site_idx })}
              {@render site_label_snippet(site_idx)}
            {/snippet}
          </SiteLabels>
        {/if}
      {/if}

      <!-- Per-site vector arrows (forces, magmoms, ...) as instanced meshes:
        2 draw calls per layer instead of 2 meshes per site -->
      {#each vector_layers as layer (layer.key)}
        <ArrowInstances
          arrows={layer.arrows}
          shaft_radius={layer.shaft_radius}
          arrow_head_radius={layer.arrow_head_radius}
          arrow_head_length={layer.arrow_head_length}
        />
      {/each}

      <!-- Displacement overlay: a sibling arrow layer, kept off the force/magmom vector path
        so the legend never mislabels relaxation displacements as forces -->
      {#if displacement_arrows.length > 0}
        <ArrowInstances
          arrows={displacement_arrows}
          shaft_radius={eff_shaft_radius}
          arrow_head_radius={eff_head_radius}
          arrow_head_length={eff_head_length}
        />
      {/if}

      {#if bonds_to_render.length > 0}
        <Bond
          bonds={bonds_to_render}
          site_colors={bond_site_colors}
          thickness={bond_thickness}
          {ambient_light}
          {directional_light}
        />
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
          element_colors={colors.element}
          wrap_mode={trajectory_line_wrap_mode}
          anchor_positions={trajectory_line_anchors}
          bind:build_result={trajectory_lines_result}
        />
      {/if}

      <!-- Coordination polyhedra: all faces in one merged mesh, edges in one
        LineSegments (1-2 draw calls regardless of supercell size) -->
      {#if polyhedra_geometry}
        <T.Mesh geometry={polyhedra_geometry} frustumCulled={false} raycast={() => null}>
          <!-- depthWrite when mostly opaque: VESTA-like occlusion between polyhedra;
            fully translucent settings fall back to see-through blending -->
          <T.MeshStandardMaterial
            vertexColors
            transparent={polyhedra_opacity < 1}
            opacity={polyhedra_opacity}
            side={DoubleSide}
            depthWrite={polyhedra_opacity >= 0.65}
            flatShading
          />
        </T.Mesh>
        {#if polyhedra_edge_geometry}
          <T.LineSegments
            geometry={polyhedra_edge_geometry}
            frustumCulled={false}
            raycast={() => null}
          >
            <T.LineBasicMaterial color={polyhedra_edge_color} />
          </T.LineSegments>
        {/if}
      {/if}

      <!-- Clickable bond hit-test cylinders in edit-bonds mode -->
      {#if interactive && measure_mode === `edit-bonds` && editable_bond_pairs.length > 0}
        {#each editable_bond_pairs as bond (`bond-hit-${bond_edit_mode}-${rendered_bond_key_for(bond)}`)}
          {@const bond_key = rendered_bond_key_for(bond)}
          {@const is_hovered = hovered_bond_key === bond_key}
          {@const is_delete_mode = bond_edit_mode === `delete`}
          {@const bond_hit_radius = bond_thickness * (is_delete_mode ? 5 : 1.25)}
          {@const bond_hover_radius = bond_thickness * 1.1}
          <T.Mesh
            geometry={bond_hit_geometry}
            material={invisible_material}
            matrixAutoUpdate={false}
            oncreate={(ref) => apply_bond_transform(ref, bond, bond_hit_radius)}
            onpointerdown={(event: BondPointerEvent) => {
              if (event.nativeEvent?.button === 2) return
              event.stopPropagation()
              if (is_delete_mode) {
                remove_bond(bond.site_idx_1, bond.site_idx_2, bond.cell_shift)
                measured_sites = []
                selected_sites = []
                hovered_bond_key = null
              } else {
                const endpoint_site_idx = get_bond_endpoint_hit_site_idx(bond, event)
                if (endpoint_site_idx != null) {
                  select_edit_bonds_site(endpoint_site_idx, event)
                }
              }
            }}
            oncontextmenu={(event: BondContextMenuEvent) => {
              event.nativeEvent?.preventDefault()
              event.stopPropagation?.()
              open_bond_context_menu(bond, event)
            }}
            onpointerenter={() => (hovered_bond_key = bond_key)}
            onpointermove={() => (hovered_bond_key = bond_key)}
            onpointerleave={() => (hovered_bond_key = null)}
          />
          {#if is_hovered}
            <T.Mesh
              geometry={bond_hit_geometry}
              matrixAutoUpdate={false}
              oncreate={(ref) => {
                apply_bond_transform(ref, bond, bond_hover_radius)
                disable_raycast(ref)
              }}
            >
              <T.MeshBasicMaterial
                transparent
                opacity={0.25}
                color={is_delete_mode ? `#ff4444` : `#6cf0ff`}
                depthWrite={false}
              />
            </T.Mesh>
          {/if}
        {/each}
      {/if}

      {#if interactive && editable_atom_hit_targets.length > 0}
        {#each editable_atom_hit_targets as atom_hit (atom_hit.site_idx)}
          <T.Mesh
            geometry={hit_sphere_geometry}
            material={invisible_material}
            position={atom_hit.position}
            scale={atom_hit.radius * EDITABLE_ATOM_HIT_RADIUS_SCALE}
            {...atom_hover_props(atom_hit.site_idx)}
            onpointerdown={(event: PointerEvent) => {
              select_edit_bonds_site(atom_hit.site_idx, event)
            }}
          />
        {/each}
      {/if}

      {#if interactive && measure_mode === `edit-bonds` && bond_context_menu}
        {@const current_order = get_current_bond_order(
          bond_context_menu.site_idx_1,
          bond_context_menu.site_idx_2,
          bond_context_menu.cell_shift,
        )}
        <extras.HTML autoRender={false} position={bond_context_menu.position}>
          <div class="bond-context-menu">
            <strong>Bond Order ({current_order ?? 1})</strong>
            {#each BOND_ORDER_OPTIONS as { order, label } (label)}
              <button
                type="button"
                {...menu_action_props(() => set_context_bond_order(order))}
              >
                {label}
              </button>
            {/each}
            <button type="button" class="remove" {...menu_action_props(remove_context_bond)}>
              Remove
            </button>
            <button type="button" {...menu_action_props(close_bond_context_menu)}>
              Close
            </button>
          </div>
        </extras.HTML>
      {/if}

      <!-- highlight hovered, active and selected sites. The target list is a pulse-
        independent $derived; only the opacity reads the per-frame pulse value so the
        array isn't rebuilt every animation frame. -->
      {#each highlight_targets as entry (`${entry.kind}-${entry.site_idx}`)}
        {@const is_pulsing = entry.kind !== `hover`}
        <T.Mesh
          geometry={highlight_sphere_geometry}
          position={entry.site.xyz}
          scale={HIGHLIGHT_SHELL_SCALE * entry.radius}
          oncreate={disable_raycast}
        >
          <T.MeshStandardMaterial
            color={entry.color}
            transparent
            opacity={is_pulsing ? pulse_opacity : 0.42}
            emissive={entry.color}
            emissiveIntensity={is_pulsing ? 0.7 : 0.55}
            depthTest={false}
            depthWrite={false}
          />
        </T.Mesh>
      {/each}

      <!-- selection order labels (1, 2, 3, ...) for measurements and bond editing -->
      {#if structure?.sites && (measured_sites?.length ?? 0) > 0 && (measure_mode === `distance` || measure_mode === `angle` || measure_mode === `dihedral` || measure_mode === `edit-bonds`)}
        {#each measured_sites as site_index, loop_idx (site_index)}
          {@const site = structure.sites[site_index]}
          {#if site}
            <!-- shift selected site labels down to avoid overlapping regular site labels-->
            {@const selection_offset = math.add<Vec3>(site_label_offset, [0, -0.5, 0])}
            {@const pos = math.add(site.xyz, selection_offset)}
            <extras.HTML center position={pos}>
              <span class="selection-label">{loop_idx + 1}</span>
            </extras.HTML>
          {/if}
        {/each}
      {/if}

      <!-- hovered site tooltip -->
      {#if hovered_site && !camera_is_moving && (atom_tooltip_active || active_sites.includes(hovered_idx ?? -1))}
        {@const abc = hovered_site.abc.map((val) => format_num(val, FLOAT_FMT)).join(`, `)}
        {@const xyz = hovered_site.xyz.map((val) => format_num(val, FLOAT_FMT)).join(`, `)}
        {@const tooltip_species =
          render_sites.find((rs) => rs.site_idx === hovered_idx)?.site.species ??
          hovered_site.species}
        <CanvasTooltip position={hovered_site.xyz}>
          <!-- Element symbols with occupancies for disordered sites -->
          <div class="elements" style="margin-bottom: var(--canvas-tooltip-elements-margin)">
            {#each tooltip_species as { element, occu, oxidation_state: oxi_state }, idx (`${element ?? ``}-${occu ?? ``}-${oxi_state ?? ``}-${idx}`)}
              {@const element_name =
                element_by_symbol.get(element as ElementSymbol)?.name ?? ``}
              <span class="species">
                {#if occu !== 1}<span class="occupancy">{format_num(occu, `.3~f`)}</span>{/if}
                <strong>
                  {element}{#if oxi_state != null && oxi_state !== 0}<sup
                      >{Math.abs(oxi_state)}{oxi_state > 0 ? `+` : `−`}</sup
                    >{/if}
                </strong>
                {#if element_name}<span class="elem-name">{element_name}</span>{/if}
              </span>
            {/each}
          </div>
          <div class="coordinates">abc: ({abc})</div>
          <div class="coordinates">xyz: ({xyz}) Å</div>
          {#if hovered_bond_summary}
            <div class="coordinates">Bonds: {hovered_bond_summary}</div>
          {/if}
        </CanvasTooltip>
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
          {show_cell_vectors}
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
          {@const avg = (dim: number) =>
            selected_atoms.reduce((sum, atom) => sum + atom.xyz[dim], 0) /
            selected_atoms.length}
          {@const centroid = [avg(0), avg(1), avg(2)] as Vec3}
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
              const { x: tx, y: ty, z: tz } = transform_object.position
              const delta: Vec3 = [
                tx - drag_start_centroid[0],
                ty - drag_start_centroid[1],
                tz - drag_start_centroid[2],
              ]
              // Update reference point so deltas are incremental, not cumulative.
              // Without this, each frame compounds: sites already moved by previous
              // delta get the full cumulative delta re-applied.
              drag_start_centroid = [tx, ty, tz]
              on_sites_moved?.(selected_sites, delta)
            }}
            onmouseDown={() => {
              dragging_atoms = true
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
      <!-- Uses onBeforeRender to orient normal toward camera so raycasts always hit -->
      {#if interactive && measure_mode === `edit-atoms` && add_atom_mode}
        {@const center = rotation_target ?? [0, 0, 0]}
        <T.Mesh
          position={center}
          onBeforeRender={(mesh: Mesh) => {
            if (camera) {
              mesh.lookAt(camera.position)
            }
          }}
          onclick={(event: { point: { x: number; y: number; z: number } }) => {
            const { x, y, z } = event.point
            on_add_atom?.([x, y, z] as Vec3, add_element as ElementSymbol)
          }}
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
          {active_volume_idx}
          tiling={supercell_tiling}
        />
      {/if}

      <!-- Measurement overlays for measured sites -->
      {#if structure?.sites && (measured_sites?.length ?? 0) > 0}
        {#if measure_mode === `distance`}
          {#each measured_sites as idx_i, loop_idx (idx_i)}
            {#each measured_sites.slice(loop_idx + 1) as idx_j (idx_i + `-` + idx_j)}
              {@const site_i = structure.sites[idx_i]}
              {@const site_j = structure.sites[idx_j]}
              <!-- indices can outlive their sites (image atoms toggled off, supercell
                shrunk); skip rather than throw mid-render like the angle/dihedral branches -->
              {#if site_i && site_j}
                {@const pos_i = site_i.xyz}
                {@const pos_j = site_j.xyz}
                <Cylinder
                  from={pos_i}
                  to={pos_j}
                  thickness={0.12}
                  color={measure_line_color}
                />
                {@const mid_pos = math.lerp_vec3(pos_i, pos_j, 0.5)}
                {@const direct = math.euclidean_dist(pos_i, pos_j)}
                {@const pbc = lattice
                  ? math.pbc_dist(pos_i, pos_j, lattice.matrix, undefined, lattice.pbc)
                  : direct}
                {@const differ = lattice ? Math.abs(pbc - direct) > 1e-6 : false}
                <extras.HTML center position={mid_pos}>
                  <span class="measure-label">
                    {#if differ}
                      PBC: {format_num(pbc, FLOAT_FMT)} Å<br /><small>
                        Direct: {format_num(direct, FLOAT_FMT)} Å</small
                      >
                    {:else}
                      {format_num(pbc, FLOAT_FMT)} Å
                    {/if}
                  </span>
                </extras.HTML>
              {/if}
            {/each}
          {/each}
        {:else if measure_mode === `angle` && measured_sites.length === 3}
          <!-- ordered triple A-B-C: the second pick is the vertex, same selection-order
            convention as the torsion below -->
          {@const [idx_a, idx_center, idx_b] = measured_sites}
          {@const center = structure.sites[idx_center]}
          {@const site_a = structure.sites[idx_a]}
          {@const site_b = structure.sites[idx_b]}
          {#if center && site_a && site_b}
            {@const disp = (to: Vec3) =>
              measure.displacement_pbc(
                center.xyz,
                to,
                lattice?.matrix,
                undefined,
                lattice?.pbc,
              )}
            {@const v1 = disp(site_a.xyz)}
            {@const v2 = disp(site_b.xyz)}
            {@const n1 = Math.hypot(v1[0], v1[1], v1[2])}
            {@const n2 = Math.hypot(v2[0], v2[1], v2[2])}
            {@const angle_deg = measure.angle_between_vectors(v1, v2, `degrees`)}
            {#if n1 > math.EPS && n2 > math.EPS}
              <!-- rays end on the minimum-image positions the angle was measured from, not
                the raw in-cell ones, so the drawn wedge matches the reported number -->
              {@const ray_ends = [math.add(center.xyz, v1), math.add(center.xyz, v2)]}
              {#each ray_ends as ray_end, ray_idx (ray_idx)}
                <Cylinder
                  from={center.xyz}
                  to={ray_end}
                  thickness={0.05}
                  color={measure_line_color}
                />
              {/each}
              {@const bisector = math.add(math.scale(v1, 1 / n1), math.scale(v2, 1 / n2))}
              {@const bis_norm = Math.hypot(...bisector) || 1}
              {@const offset_dir = math.scale(bisector, 1 / bis_norm)}
              {@const label_pos = math.add(center.xyz, math.scale(offset_dir, 0.6))}
              <extras.HTML center position={label_pos}>
                <span class="measure-label">{format_num(angle_deg, FLOAT_FMT)}°</span>
              </extras.HTML>
            {/if}
          {/if}
        {:else if measure_mode === `dihedral` && measured_sites.length === 4}
          <!-- a torsion is defined by exactly four atoms in sequence, so unlike distance
            and angle this renders nothing until the fourth site is picked -->
          {@const [pos_1, pos_2, pos_3, pos_4] = measured_sites.map(
            (idx) => structure.sites[idx]?.xyz,
          )}
          {#if pos_1 && pos_2 && pos_3 && pos_4}
            <!-- draw the same unwrapped chain dihedral_angle measures, so a torsion whose
              atoms straddle a cell face isn't drawn through the box -->
            {@const [draw_1, draw_2, draw_3, draw_4] = measure.pbc_chain_positions(
              [pos_1, pos_2, pos_3, pos_4],
              lattice?.matrix,
              lattice?.pbc,
            )}
            {#each [[draw_1, draw_2], [draw_2, draw_3], [draw_3, draw_4]] as [from, to], seg_idx (seg_idx)}
              <Cylinder {from} {to} thickness={0.05} color={measure_line_color} />
            {/each}
            {@const torsion_deg = measure.dihedral_angle(
              pos_1,
              pos_2,
              pos_3,
              pos_4,
              lattice?.matrix,
              lattice?.pbc,
            )}
            <!-- label sits on the central bond, the axis the torsion is measured about -->
            <extras.HTML center position={math.lerp_vec3(draw_2, draw_3, 0.5)}>
              <span class="measure-label">{format_num(torsion_deg, FLOAT_FMT)}°</span>
            </extras.HTML>
          {/if}
        {/if}
      {/if}
    </T.Group>
  </T.Group>
</T.Group>

<style>
  .atom-label {
    background: var(--struct-atom-label-bg, rgba(0, 0, 0, 0.1));
    border: 0;
    border-radius: var(--struct-atom-label-border-radius, var(--border-radius, 3pt));
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: var(--struct-atom-label-padding, 0 3px);
    white-space: nowrap;
  }
  .species {
    display: inline-block;
    white-space: nowrap;
    &:not(:first-child) {
      margin-left: var(--canvas-tooltip-species-gap, 0.5em);
    }
  }
  .occupancy {
    font-size: var(--canvas-tooltip-occu-font-size);
    opacity: var(--canvas-tooltip-occu-opacity);
    margin-right: var(--canvas-tooltip-occu-margin);
  }
  .elem-name {
    font-size: var(--canvas-tooltip-elem-name-font-size, 0.85em);
    opacity: var(--canvas-tooltip-elem-name-opacity, 0.7);
    margin: var(--canvas-tooltip-elem-name-margin, 0 0 0 0.3em);
    font-weight: var(--canvas-tooltip-elem-name-font-weight, normal);
  }
  .coordinates {
    font-size: var(--canvas-tooltip-coords-font-size);
    margin: var(--canvas-tooltip-coords-margin);
  }
  .measure-label {
    background: var(--measure-label-bg, var(--surface-bg));
    color: var(--measure-label-color, var(--text-color));
    border-radius: var(--border-radius, 3pt);
    padding: 0 5px;
    user-select: none;
    white-space: pre;
    display: grid;
    place-items: center;
    line-height: 1.2;
    font-size: var(--canvas-tooltip-font-size, clamp(8pt, 2cqmin, 18pt));
    box-shadow: var(--measure-label-shadow, 0 1px 6px rgba(0, 0, 0, 0.2));
  }
  .bond-context-menu {
    display: grid;
    min-width: 8rem;
    gap: 2pt;
    padding: 3pt 5pt;
    border-radius: var(--border-radius, 3pt);
    /* Pair with light-dark so a dark host's --text-color can't bleach a light menu. */
    background: var(--surface-bg, var(--menu-bg));
    color: var(--struct-context-menu-color, var(--menu-color));
    border: 1px solid var(--struct-context-menu-border, var(--menu-border));
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    pointer-events: auto;
    strong {
      font-size: 0.85em;
      padding: 0 2pt 2pt;
      white-space: nowrap;
    }
    button {
      border: none;
      border-radius: var(--border-radius, 3pt);
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 2pt 5pt;
      text-align: left;
    }
    button:hover {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    button.remove {
      color: var(--error-color, #f44336);
    }
  }
  .selection-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.2em;
    height: 1.2em;
    padding: 0 0.25em;
    border-radius: 999px;
    background: var(--btn-bg-hover);
    color: var(--text-color);
    font-size: 0.85em;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
</style>

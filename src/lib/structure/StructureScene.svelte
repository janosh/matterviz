<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { AXIS_COLORS, get_d3_interpolator, NEG_AXIS_COLORS } from '$lib/colors'
  import type { ElementSymbol } from '$lib/element'
  import { element_data } from '$lib/element'
  import Isosurface from '$lib/isosurface/Isosurface.svelte'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import { DEFAULT_ISOSURFACE_SETTINGS } from '$lib/isosurface/types'
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import type {
    CameraProjection,
    ShowBonds,
    VectorColorMode,
    VectorLayerConfig,
  } from '$lib/settings'
  import { DEFAULTS } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
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
    Arrow,
    atomic_radii,
    Cylinder,
    get_all_site_vectors,
    get_center_of_mass,
    get_structure_vector_keys,
    Lattice,
    VECTOR_PALETTE,
  } from '$lib/structure'
  import type { AtomColorConfig } from '$lib/structure/atom-properties'
  import {
    get_orig_site_idx,
    get_property_colors,
  } from '$lib/structure/atom-properties'
  import * as measure from '$lib/structure/measure'
  import {
    compute_slice_geometry,
    merge_split_partial_sites,
    PARTIAL_OCCUPANCY_CAP_ARC,
  } from '$lib/structure/partial-occupancy'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import { T, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { type ComponentProps, type Snippet, untrack } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { type Camera, Color, type Mesh, type Object3D, type Scene, Vector3 } from 'three'
  import Bond from './Bond.svelte'
  import type { BondEditResult, BondingStrategy, BondKeyTarget } from './bonding'
  import {
    add_or_restore_bond,
    BONDING_STRATEGIES,
    BOND_ORDER_OPTIONS,
    canonicalize_bond_target,
    delete_bond as apply_delete_bond,
    get_bond_key,
    get_bond_render_matrices,
    get_explicit_bond_metadata,
    set_bond_order as apply_set_bond_order,
    structure_bond_to_bond_pair,
  } from './bonding'
  import {
    CanvasTooltip,
    compose_perceived_bonds,
    perceive_bond_orders,
  } from './index'
  import {
    choose_site_label_offset,
    LABEL_OFFSET_EPS,
    make_label_position_calculator,
  } from './label-placement'

  type InstancedAtomGroup = {
    element: string
    radius: number
    color: string
    is_image_atom: boolean
    atoms: (typeof atom_data)[number][]
  }

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

  type BondPointerEvent = PointerEvent & {
    nativeEvent?: PointerEvent
    object?: Object3D
    point?: Vector3
  }

  type BondContextMenuEvent = MouseEvent & {
    nativeEvent?: MouseEvent
    object?: Object3D
    point?: Vector3
  }

  let pulse_time = $state(0)
  let pulse_opacity = $derived(0.15 + 0.25 * Math.sin(pulse_time * 5))
  $effect(() => {
    if (!selected_sites?.length && !active_sites?.length) return
    if (typeof globalThis === `undefined`) return
    const reduce = globalThis.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches
    if (reduce) return
    let frame_id = 0
    const animate = () => {
      pulse_time += 0.015
      frame_id = requestAnimationFrame(animate)
    }
    frame_id = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame_id)
  })

  let {
    structure = undefined,
    base_structure = undefined,
    atom_radius = DEFAULTS.structure.atom_radius,
    same_size_atoms = false,
    camera_position = DEFAULTS.structure.camera_position,
    camera_target = undefined,
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
    show_site_labels = DEFAULTS.structure.show_site_labels,
    show_site_indices = DEFAULTS.structure.show_site_indices,
    site_label_size = DEFAULTS.structure.site_label_size,
    site_label_offset = $bindable(DEFAULTS.structure.site_label_offset),
    site_label_bg_color = DEFAULTS.structure.site_label_bg_color,
    site_label_color = DEFAULTS.structure.site_label_color,
    site_label_padding = DEFAULTS.structure.site_label_padding,
    vector_configs = $bindable<Record<string, VectorLayerConfig>>({}),
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
    gizmo = DEFAULTS.structure.show_gizmo,
    hovered_idx = $bindable(null),
    hovered_site = $bindable(null),
    float_fmt = `.3~f`,
    auto_rotate = DEFAULTS.structure.auto_rotate,
    bond_thickness = DEFAULTS.structure.bond_thickness,
    bond_color = DEFAULTS.structure.bond_color,
    bonding_strategy = DEFAULTS.structure.bonding_strategy,
    auto_bond_order = DEFAULTS.structure.auto_bond_order,
    aromatic_display = DEFAULTS.structure.aromatic_display,
    bonding_options = {},
    fov = DEFAULTS.structure.fov,
    initial_zoom = DEFAULTS.structure.initial_zoom,
    ambient_light = DEFAULTS.structure.ambient_light,
    directional_light = DEFAULTS.structure.directional_light,
    sphere_segments = DEFAULTS.structure.sphere_segments,
    lattice_props = {},
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
    active_sites = $bindable([]),
    active_highlight_color = `var(--struct-active-highlight-color, #2563eb)`,
    rotation = DEFAULTS.structure.rotation,
    scene = $bindable(),
    camera = $bindable(),
    orbit_controls = $bindable(),
    rotation_target_ref = $bindable(),
    initial_computed_zoom = $bindable(),
    hidden_elements = $bindable(new SvelteSet()),
    hidden_prop_vals = $bindable(new SvelteSet<number | string>()),
    element_radius_overrides = $bindable<Partial<Record<ElementSymbol, number>>>({}),
    site_radius_overrides = $bindable<SvelteMap<number, number>>(new SvelteMap()),
    atom_color_config = {
      mode: DEFAULTS.structure.atom_color_mode,
      scale: DEFAULTS.structure.atom_color_scale as D3InterpolateName,
      scale_type: DEFAULTS.structure.atom_color_scale_type,
    },
    sym_data = null,
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
  }: {
    structure?: AnyStructure
    base_structure?: AnyStructure // The original structure without image atoms, used for property color calculation
    atom_radius?: number // scale factor for atomic radii
    same_size_atoms?: boolean // whether to use the same radius for all atoms. if not, the radius will be
    // determined by the atomic radius of the element
    camera_position?: [x: number, y: number, z: number] // initial camera position from which to render the scene
    camera_target?: Vec3 // external orbit-controls target for pan synchronization
    camera_projection?: CameraProjection // camera projection type
    rotation_damping?: number // rotation damping factor (how quickly the rotation comes to rest after mouse release)
    // zoom level of the camera
    max_zoom?: number
    min_zoom?: number
    rotate_speed?: number // rotation speed. set to 0 to disable rotation.
    zoom_speed?: number // zoom speed. set to 0 to disable zooming.
    pan_speed?: number // pan speed. set to 0 to disable panning.
    zoom_to_cursor?: boolean // zoom toward cursor position instead of scene center
    show_atoms?: boolean
    show_bonds?: ShowBonds
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
    gizmo?: boolean | ComponentProps<typeof extras.Gizmo>
    hovered_idx?: number | null
    hovered_site?: Site | null
    float_fmt?: string
    auto_rotate?: number
    initial_zoom?: number
    bond_thickness?: number
    bond_color?: string
    bonding_strategy?: BondingStrategy
    auto_bond_order?: boolean
    aromatic_display?: `aromatic` | `kekule`
    bonding_options?: Record<string, unknown>
    fov?: number
    ambient_light?: number
    directional_light?: number
    sphere_segments?: number
    lattice_props?: ComponentProps<typeof Lattice>
    atom_label?: Snippet<[{ site: Site; site_idx: number }]>
    site_label_size?: number
    site_label_offset?: Vec3
    site_label_bg_color?: string
    site_label_color?: string
    site_label_padding?: number
    camera_is_moving?: boolean // used to prevent tooltip from showing while camera is moving
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
    // Expose scene and camera for external use (e.g. export pane)
    scene?: Scene
    camera?: Camera
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`] // OrbitControls instance
    rotation_target_ref?: Vec3 // Expose rotation target for reset
    initial_computed_zoom?: number // Expose initial zoom for reset
    hidden_elements?: Set<ElementSymbol>
    hidden_prop_vals?: Set<number | string> // Track hidden property values (e.g. Wyckoff positions, coordination numbers)
    element_radius_overrides?: Partial<Record<ElementSymbol, number>> // Per-element absolute radius in Angstroms
    site_radius_overrides?: Map<number, number> | SvelteMap<number, number> // Per-site absolute radius in Angstroms
    atom_color_config?: Partial<AtomColorConfig> // Atom coloring configuration
    sym_data?: MoyoDataset | null // Symmetry data for Wyckoff coloring
    // Edit-atoms mode callbacks and state
    on_sites_moved?: (scene_indices: number[], delta: Vec3) => void
    on_operation_start?: () => void
    on_bond_edit_start?: () => void
    on_add_atom?: (xyz: Vec3, element: ElementSymbol) => void
    add_atom_mode?: boolean // whether user is in click-to-place add-atom sub-mode
    add_element?: ElementSymbol // element to add when clicking in add-atom mode
    cursor?: string // cursor style for the 3D canvas
    dragging_atoms?: boolean // true while TransformControls drag is active (skips expensive recalculations)
    volumetric_data?: VolumetricData // Active volumetric data for isosurface rendering
    isosurface_settings?: IsosurfaceSettings // Isosurface rendering settings
  } = $props()

  const threlte = useThrelte()
  $effect(() => {
    scene = threlte.scene
    camera = threlte.camera.current
    if (threlte.renderer) {
      Object.assign(threlte.renderer.domElement, { __renderer: threlte.renderer })
    }
  })

  // Expose rotation target for external reset
  $effect(() => {
    rotation_target_ref = rotation_target
  })

  // Track initial computed zoom for reset
  let stored_initial_zoom = $state<number | undefined>(undefined)
  $effect(() => {
    if (stored_initial_zoom === undefined && computed_zoom > 0) {
      stored_initial_zoom = computed_zoom
    }
    initial_computed_zoom = stored_initial_zoom
  })

  let bond_pairs: BondPair[] = $state([])
  let atom_tooltip_active = $state(false)
  let hovered_bond_key = $state<string | null>(null)
  const ATOM_HOVER_CLEAR_DELAY_MS = 200
  let clear_atom_hover_timeout: ReturnType<typeof setTimeout> | null = null

  function cancel_atom_hover_clear(): void {
    if (clear_atom_hover_timeout == null) return
    clearTimeout(clear_atom_hover_timeout)
    clear_atom_hover_timeout = null
  }

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

  const atom_hover_props = (site_idx: number | null, disabled = false) => ({
    onpointerenter: () => {
      if (!disabled && site_idx != null) set_atom_hover(site_idx)
    },
    onpointermove: () => {
      if (!disabled && site_idx != null) set_atom_hover(site_idx)
    },
    onpointerleave: () => {
      if (!disabled && site_idx != null) schedule_atom_hover_clear(site_idx)
    },
  })

  // Cursor style for the canvas, derived from mode and hover state
  let canvas_cursor = $derived.by(() => {
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
        const site = structure?.sites?.[hovered_idx]
        if (site?.properties?.orig_site_idx != null) return `not-allowed`
        return `pointer`
      }
      return `pointer`
    }
    return `default`
  })

  // Desaturate a color by blending it toward gray (for ghosting image atoms in edit mode)
  const gray = new Color(0x999999)
  function desaturate(hex: string | undefined, amount = 0.4): string {
    return `#${new Color(hex ?? 0x999999).lerp(gray, amount).getHexString()}`
  }

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

  const canonical_bond_target = (bond: BondKeyTarget): BondKeyTarget =>
    canonicalize_bond_target(bond, structure?.sites)

  const bond_key_for = (bond: BondKeyTarget): string => {
    const target = canonical_bond_target(bond)
    return get_bond_key(target.site_idx_1, target.site_idx_2, target.cell_shift)
  }
  const rendered_bond_key_for = (bond: BondKeyTarget): string =>
    get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift)

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
    return find_added_bond_by_rendered_key(rendered_key) ??
      canonical_bond_target(rendered_target)
  }

  const is_image_bond_site = (site_idx: number): boolean =>
    structure?.sites?.[site_idx]?.properties?.orig_site_idx != null

  const can_select_bond_site = (site_idx: number): boolean =>
    bond_edits_enabled && structure?.sites?.[site_idx] != null

  const can_edit_bond = (bond: BondKeyTarget): boolean => {
    const target = canonical_bond_target(bond)
    return bond_edits_enabled &&
      !is_image_bond_site(target.site_idx_1) &&
      !is_image_bond_site(target.site_idx_2)
  }

  const format_bond_order = (order: BondOrder | undefined): string =>
    order === undefined ? `1` : `${order}`

  function get_current_bond_order(
    site_idx_1: number,
    site_idx_2: number,
    cell_shift?: Vec3,
  ): BondOrder | undefined {
    const key = get_bond_key(site_idx_1, site_idx_2, cell_shift)
    return find_added_bond_by_rendered_key(key)?.order ??
      bond_order_overrides.find((bond) => matches_bond_key(bond, key))?.order ??
      added_bonds.find((bond) => matches_bond_key(bond, key))?.order ??
      filtered_bond_pairs.find((bond) => matches_bond_key(bond, key))?.bond_order
  }

  const midpoint = (pos_1: Vec3, pos_2: Vec3): Vec3 => [
    (pos_1[0] + pos_2[0]) / 2,
    (pos_1[1] + pos_2[1]) / 2,
    (pos_1[2] + pos_2[2]) / 2,
  ]

  const BOND_ENDPOINT_HIT_FRACTION = 0.3
  const BOND_ENDPOINT_SITE_MATCH_TOLERANCE = 1e-6
  const EDITABLE_ATOM_HIT_RADIUS_SCALE = 1.15
  const skip_raycast = (): void => undefined

  function apply_bond_transform(mesh: Mesh, bond: BondPair): void {
    mesh.matrix.fromArray(bond.transform_matrix)
    mesh.matrixWorldNeedsUpdate = true
  }

  function apply_non_raycastable_bond_hit_transform(mesh: Mesh, bond: BondPair): void {
    apply_bond_transform(mesh, bond)
    disable_raycast(mesh)
  }

  function disable_raycast(mesh: Mesh): void {
    mesh.raycast = skip_raycast
  }

  function site_world_position(parent: Object3D, site: Site): Vector3 {
    const position = new Vector3(...site.xyz)
    return parent.localToWorld(position)
  }

  function get_bond_endpoint_site_idx(
    site_idx: number,
    world_position: Vector3,
    parent: Object3D,
  ): number {
    if (!structure?.sites) return site_idx
    const site = structure.sites[site_idx]
    if (!site) return site_idx

    const matches_world_position = (candidate_site: Site): boolean =>
      site_world_position(parent, candidate_site).distanceTo(world_position) <=
      BOND_ENDPOINT_SITE_MATCH_TOLERANCE

    if (matches_world_position(site)) {
      return site_idx
    }

    const image_site_idx = structure.sites.findIndex((candidate_site) =>
      candidate_site.properties?.orig_site_idx === site_idx &&
      matches_world_position(candidate_site)
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
    const t = hit_vec.dot(bond_vec) / length_sq
    if (t <= BOND_ENDPOINT_HIT_FRACTION) {
      return get_bond_endpoint_site_idx(bond.site_idx_1, world_pos_1, parent)
    }
    if (t >= 1 - BOND_ENDPOINT_HIT_FRACTION) {
      return get_bond_endpoint_site_idx(bond.site_idx_2, world_pos_2, parent)
    }
    return null
  }

  let label_screen_margin = $derived(site_label_size * 10 + site_label_padding)

  function get_bond_context_menu_position(
    bond: BondPair,
    event?: BondContextMenuEvent,
  ): Vec3 {
    const parent = event?.object?.parent
    if (!event?.point || !parent) return midpoint(bond.pos_1, bond.pos_2)

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

  const find_visible_bond = (
    target: BondKeyTarget,
    canonical_target: BondKeyTarget = target,
  ): BondPair | undefined => {
    const rendered_key = rendered_bond_key_for(target)
    const canonical_key = bond_key_for(canonical_target)
    return filtered_bond_pairs.find((bond) => rendered_bond_key_for(bond) === rendered_key) ??
      filtered_bond_pairs.find((bond) => bond_key_for(bond) === canonical_key)
  }

  function open_bond_order_menu_for_target(
    target: BondKeyTarget,
    canonical_target: BondKeyTarget = target,
  ) {
    const bond = find_visible_bond(target, canonical_target)
    if (bond) open_bond_context_menu(bond)
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
      open_bond_order_menu_for_target(rendered_target, target)
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
      apply_delete_bond(
        current_bond_edit_state(),
        target,
        editable_perceived_bond_pairs,
      ),
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
  // extras.Instance does not always emit pointerdown, so edit-bonds also falls
  // back to click. When pointerdown did fire, skip the matching click once.
  let last_edit_bonds_pointerdown_site_idx: number | null = null
  let clear_edit_bonds_pointerdown_site_timeout:
    | ReturnType<typeof setTimeout>
    | null = null

  function remember_edit_bonds_pointerdown_site(site_idx: number) {
    last_edit_bonds_pointerdown_site_idx = site_idx
    if (clear_edit_bonds_pointerdown_site_timeout != null) {
      clearTimeout(clear_edit_bonds_pointerdown_site_timeout)
    }
    clear_edit_bonds_pointerdown_site_timeout = setTimeout(() => {
      last_edit_bonds_pointerdown_site_idx = null
      clear_edit_bonds_pointerdown_site_timeout = null
    }, 250)
  }

  function select_edit_bonds_site(site_idx: number, event: Event): void {
    toggle_selection(site_idx, event)
    remember_edit_bonds_pointerdown_site(site_idx)
  }

  function skip_duplicate_edit_bonds_click(site_idx: number) {
    if (last_edit_bonds_pointerdown_site_idx !== site_idx) return false

    last_edit_bonds_pointerdown_site_idx = null
    if (clear_edit_bonds_pointerdown_site_timeout != null) {
      clearTimeout(clear_edit_bonds_pointerdown_site_timeout)
      clear_edit_bonds_pointerdown_site_timeout = null
    }
    return true
  }

  function toggle_selection(site_index: number, evt?: Event) {
    evt?.stopPropagation?.()
    const event_with_native = evt as Event & { nativeEvent?: unknown } | undefined
    const native_event = event_with_native?.nativeEvent ?? evt
    if (native_event instanceof Event) {
      if (native_event === last_native_event) return
      last_native_event = native_event
    }

    if (measure_mode === `edit-bonds`) {
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
      // Block image atoms (detected by orig_site_idx property from PBC)
      const site = structure?.sites?.[site_index]
      if (site?.properties?.orig_site_idx != null) return

      const is_selected = selected_sites.includes(site_index)
      const is_shift = evt instanceof MouseEvent && evt.shiftKey

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

    if (
      !measured_sites.includes(site_index) &&
      measured_sites.length >= measure.MAX_SELECTED_SITES
    ) {
      console.warn(
        `Selection size limit reached (${measure.MAX_SELECTED_SITES}). Deselect some sites first.`,
      )
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

  $effect(() => {
    const count = structure?.sites?.length ?? 0
    if (count <= 0) {
      measured_sites = []
      return
    }
    untrack(() => {
      measured_sites = measured_sites.filter((idx) => idx >= 0 && idx < count)
    })
  })

  $effect(() => {
    cursor = canvas_cursor
  })

  extras.interactivity()
  $effect.pre(() => {
    hovered_site = structure?.sites?.[hovered_idx ?? -1] ?? null
  })
  let lattice = $derived(
    structure && `lattice` in structure ? structure.lattice : null,
  )

  let visual_lattice = $derived(
    base_structure && `lattice` in base_structure ? base_structure.lattice : lattice,
  )

  let rotation_target = $derived(
    lattice
      ? (math.scale(math.add(...lattice.matrix), 0.5) as Vec3)
      : structure
      ? get_center_of_mass(structure)
      : [0, 0, 0] as Vec3,
  )

  let structure_size = $derived.by(() => {
    if (lattice) return (lattice.a + lattice.b + lattice.c) / 2
    if (!structure?.sites?.length) return 10

    const ranges = [0, 1, 2].map((axis_idx) => {
      const coords = structure.sites.map((site) => site.xyz[axis_idx])
      return Math.max(...coords) - Math.min(...coords)
    })
    return Math.max(1, ...ranges)
  })

  // Characteristic inter-atomic spacing: cube root of volume per atom.
  // Excludes PBC image atoms (orig_site_idx) so toggling image atoms doesn't affect arrow sizing.
  let char_atom_spacing = $derived.by(() => {
    if (!lattice || !structure?.sites?.length) return structure_size
    const n_real = structure.sites.filter((site) =>
      site.properties?.orig_site_idx == null
    ).length
    return n_real > 0 ? Math.cbrt(lattice.volume / n_real) : structure_size
  })

  // When uniform thickness is on, convert negative (length-relative) radii to
  // positive (absolute) values scaled by inter-atomic spacing.
  // Already-positive (absolute) values are preserved as-is.
  let eff_shaft_radius = $derived(
    vector_uniform_thickness && vector_shaft_radius < 0
      ? char_atom_spacing * -vector_shaft_radius
      : vector_shaft_radius,
  )
  let eff_head_radius = $derived(
    vector_uniform_thickness && vector_arrow_head_radius < 0
      ? char_atom_spacing * -vector_arrow_head_radius
      : vector_arrow_head_radius,
  )
  let eff_head_length = $derived(
    vector_uniform_thickness && vector_arrow_head_length < 0
      ? char_atom_spacing * -vector_arrow_head_length
      : vector_arrow_head_length,
  )

  // Compute dynamic camera clipping planes based on structure size
  // This prevents z-fighting and disappearing objects when zooming in close on large supercells
  let camera_near = $derived(Math.max(0.01, structure_size * 0.01))
  let camera_far = $derived(Math.max(1000, structure_size * 100))

  // Using $state because this is mutated in an effect based on viewport/structure size
  let computed_zoom = $state(untrack(() => initial_zoom))
  $effect(() => {
    if (!(width > 0) || !(height > 0)) return
    const structure_max_dim = Math.max(1, untrack(() => structure_size))
    const viewer_min_dim = Math.min(width, height)
    const scale_factor = viewer_min_dim / (structure_max_dim * 50) // 50px per unit
    let new_zoom = initial_zoom * scale_factor
    if (min_zoom && min_zoom > 0) new_zoom = Math.max(min_zoom, new_zoom)
    if (max_zoom && max_zoom > 0) new_zoom = Math.min(max_zoom, new_zoom)
    computed_zoom = new_zoom
  })

  $effect.pre(() => { // Simple initial camera auto-position: proportional to structure size and fov
    if (camera_position.every((val) => val === 0) && structure) {
      stored_initial_zoom = undefined
      const distance = Math.max(1, structure_size) * (60 / fov)
      camera_position = [distance, distance * 0.3, distance * 0.8]
    }
  })
  $effect(() => {
    if (structure && show_bonds !== `never`) {
      // Determine if we should show bonds based on the setting and structure type
      const should_show_bonds = show_bonds === `always` ||
        (show_bonds === `crystals` && lattice) ||
        (show_bonds === `molecules` && !lattice)

      if (should_show_bonds) {
        bond_pairs = BONDING_STRATEGIES[bonding_strategy](structure, bonding_options)
      } else bond_pairs = []
    } else bond_pairs = []
  })

  // Compute property-based colors when not using element coloring
  // Use base_structure (original unit cell) for color calculation
  let property_colors = $derived(
    get_property_colors(
      base_structure || structure,
      atom_color_config,
      bonding_strategy,
      sym_data,
    ),
  )
  // Compute weighted average radius for a site based on species occupancies
  // Normalizes by total occupancy so vacancy-containing sites render at full size
  const calc_weighted_radius = (site: Site): number => {
    const total_occu = site.species.reduce((sum, { occu }) => sum + occu, 0)
    const weighted_sum = site.species.reduce((sum, { element, occu }) => {
      const override = element_radius_overrides?.[element as ElementSymbol]
      return sum + occu * (override ?? atomic_radii[element] ?? 1)
    }, 0)
    return total_occu > 0 ? weighted_sum / total_occu : 1
  }

  let atom_data = $derived.by(() => {
    if (!show_atoms || !structure?.sites) return []
    const render_sites = merge_split_partial_sites(structure.sites, hidden_elements)
    return render_sites.flatMap(({ site_idx, site, is_image_atom }) => {
      const orig_idx = get_orig_site_idx(site, site_idx)

      // Skip sites with hidden property values
      const prop_val = property_colors?.values[orig_idx]
      if (prop_val !== undefined && hidden_prop_vals.has(prop_val)) return []

      // Calculate radius: same_size > site override > element override > default
      // All radii scale uniformly with atom_radius for consistent slider behavior
      const base_radius = same_size_atoms
        ? 1
        : site_radius_overrides?.get(site_idx) ?? calc_weighted_radius(site)
      const radius = base_radius * atom_radius

      // Use property color if available (e.g. coordination number, Wyckoff position)
      // Otherwise, each species gets its own element color (important for disordered sites)
      const site_property_color = property_colors?.colors[orig_idx]

      const visible_species = site.species.filter(({ element }) =>
        !hidden_elements.has(element)
      )
      const slice_geometry = compute_slice_geometry(visible_species)
      return slice_geometry.map((slice_data) => {
        return {
          site_idx,
          element: slice_data.element,
          occupancy: slice_data.occupancy,
          position: site.xyz,
          radius,
          color: site_property_color ?? colors.element?.[slice_data.element],
          has_partial_occupancy: slice_data.occupancy < 1,
          start_phi: slice_data.start_phi,
          end_phi: slice_data.end_phi,
          phi_length: slice_data.phi_length,
          render_start_cap: slice_data.render_start_cap,
          render_end_cap: slice_data.render_end_cap,
          is_image_atom,
        }
      })
    })
  })

  // Shared visibility check: site has at least one non-hidden element and
  // its property value (if any) isn't hidden. Used by both bond and vector filtering.
  const is_site_visible = (site_idx: number): boolean => {
    if (!structure?.sites) return false
    const site = structure.sites[site_idx]
    const has_visible_element = site?.species.some(({ element }) =>
      !hidden_elements.has(element)
    )
    const orig_idx = get_orig_site_idx(site, site_idx)
    const prop_val = property_colors?.values[orig_idx]
    const prop_visible = prop_val === undefined ||
      !hidden_prop_vals.has(prop_val)
    return has_visible_element && prop_visible
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

  let editable_perceived_bond_pairs = $derived(
    perceived_bond_pairs.map((bond) => ({ ...bond, ...canonical_bond_target(bond) })),
  )

  let filtered_bond_pairs = $derived.by(() => {
    if (!structure?.sites) return perceived_bond_pairs

    // Build set of removed bond keys for efficient lookup
    const removed_keys = new Set(
      removed_bonds.map(bond_key_for),
    )
    const added_keys = new Set(
      added_bonds.map(bond_key_for),
    )
    const order_overrides = new Map(
      bond_order_overrides.map((bond) => [bond_key_for(bond), bond.order]),
    )

    // Filter calculated bonds: exclude removed, replaced by manual additions, and hidden.
    const calculated = perceived_bond_pairs
      .filter((bond) => {
        const key = bond_key_for(bond)
        if (removed_keys.has(key) || added_keys.has(key)) return false
        return is_site_visible(bond.site_idx_1) && is_site_visible(bond.site_idx_2)
      })
      .map((bond) => {
        const override = order_overrides.get(bond_key_for(bond))
        return override === undefined ? bond : { ...bond, bond_order: override }
      })

    // Create BondPair objects for manually added bonds
    const added: BondPair[] = []
    for (const added_bond of added_bonds) {
      const { site_idx_1: idx_i, site_idx_2: idx_j } = added_bond
      if (!is_site_visible(idx_i) || !is_site_visible(idx_j)) continue
      added.push(structure_bond_to_bond_pair(structure, added_bond))
    }

    return [...calculated, ...added]
  })

  let editable_bond_pairs = $derived(
    bond_edits_enabled ? filtered_bond_pairs.filter(can_edit_bond) : [],
  )

  let smart_site_label_offsets = $derived.by(() => {
    const offsets = new SvelteMap<number, Vec3>()
    if (filtered_bond_pairs.length === 0) return offsets

    const bond_directions_by_site = new SvelteMap<number, Vec3[]>()
    const add_bond_direction = (site_idx: number, pos_1: Vec3, pos_2: Vec3) => {
      const direction = math.normalize_vec3(
        math.subtract(pos_2, pos_1),
        [0, 0, 0],
      )
      if (Math.hypot(...direction) < LABEL_OFFSET_EPS) return
      bond_directions_by_site.set(site_idx, [
        ...(bond_directions_by_site.get(site_idx) ?? []),
        direction,
      ])
    }

    for (const { site_idx_1, site_idx_2, pos_1, pos_2 } of filtered_bond_pairs) {
      add_bond_direction(site_idx_1, pos_1, pos_2)
      add_bond_direction(site_idx_2, pos_2, pos_1)
    }
    for (const [site_idx, bond_directions] of bond_directions_by_site) {
      offsets.set(site_idx, choose_site_label_offset(bond_directions, site_label_offset))
    }
    return offsets
  })

  let instanced_bond_groups = $derived.by(() => {
    if (!structure?.sites || filtered_bond_pairs.length === 0) return []

    const group = {
      thickness: bond_thickness,
      ambient_light,
      directional_light,
      instances: [] as {
        matrix: Float32Array
        color_start: string
        color_end: string
      }[],
    }

    for (const bond_data of filtered_bond_pairs) {
      const site_a = structure.sites[bond_data.site_idx_1]
      const site_b = structure.sites[bond_data.site_idx_2]

      const get_majority_color = (site: typeof site_a) => {
        if (!site?.species || site.species.length === 0) return bond_color
        const majority_species = site.species.reduce((max, spec) =>
          spec.occu > max.occu ? spec : max
        )
        return colors.element?.[majority_species.element] || bond_color
      }

      const color_start = get_majority_color(site_a)
      const color_end = get_majority_color(site_b)
      for (const matrix of get_bond_render_matrices(bond_data, bond_thickness)) {
        group.instances.push({ matrix, color_start, color_end })
      }
    }

    return group.instances.length > 0 ? [group] : []
  })

  let radius_by_site_idx = $derived.by(() => {
    const map = new SvelteMap<number, number>()
    for (const atom of atom_data) {
      if (!map.has(atom.site_idx)) map.set(atom.site_idx, atom.radius)
    }
    return map
  })

  let editable_atom_hit_targets = $derived.by(() => {
    if (
      measure_mode !== `edit-bonds` ||
      bond_edit_mode !== `add` ||
      !bond_edits_enabled
    ) {
      return []
    }

    const targets = new SvelteMap<number, EditableAtomHitTarget>()
    for (const atom of atom_data) {
      if (!can_select_bond_site(atom.site_idx)) continue
      if (targets.has(atom.site_idx)) continue
      targets.set(atom.site_idx, {
        site_idx: atom.site_idx,
        position: atom.position,
        radius: atom.radius,
      })
    }
    return [...targets.values()]
  })

  // Get radius for a site (for highlight fallback when site is hidden/filtered)
  // Checks site_radius_overrides first for consistency with visible atoms
  const get_site_radius = (site: Site, site_idx: number | null): number => {
    const override = site_idx !== null
      ? site_radius_overrides?.get(site_idx)
      : undefined
    const base_radius = same_size_atoms ? 1 : override ?? calc_weighted_radius(site)
    return base_radius * atom_radius
  }

  // Interpolate between spin-down (#3498db blue) and spin-up (#e74c3c red)
  // based on the z-component direction of a magnetic vector
  function spin_direction_color(vec: Vec3): string {
    const mag = Math.hypot(...vec)
    const z_frac = mag > 1e-10 ? (vec[2] / mag + 1) / 2 : 0.5 // 0=down, 1=up
    const red = Math.round(52 + (231 - 52) * z_frac)
    const grn = Math.round(152 + (76 - 152) * z_frac)
    const blu = Math.round(219 + (60 - 219) * z_frac)
    return `#${red.toString(16).padStart(2, `0`)}${
      grn.toString(16).padStart(2, `0`)
    }${blu.toString(16).padStart(2, `0`)}`
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
    const site_vec_maps = structure.sites.map((site, site_idx) => {
      if (!is_site_visible(site_idx)) return null
      const map = new SvelteMap<string, Vec3>()
      for (const { key, vec } of get_all_site_vectors(site)) {
        map.set(key, vec)
        if (active_set.has(key)) {
          max_mag = Math.max(max_mag, Math.hypot(...vec))
        }
      }
      return map
    })

    // When normalize is on, treat all magnitudes as 1 so arrows have equal length
    const effective_max = vector_normalize ? 1 : max_mag
    const auto_scale = effective_max > 1e-10
      ? (char_atom_spacing * 1.8) / effective_max
      : 1
    const is_single = active_keys.length === 1
    const effective_global_scale = auto_scale * vector_scale

    // When vector_origin_gap > 0 and multiple vectors exist at a site,
    // arrange arrow origins on a regular polygon centered on the atom, in a
    // plane perpendicular to the mean vector direction. The gap is a fraction
    // of the visual atom radius (0 = center, 0.5 = halfway to surface).
    // get_site_radius() returns the uniform scale applied to SphereGeometry(0.5),
    // so visual_radius = get_site_radius() * 0.5.
    const site_offsets = (vector_origin_gap > 0 && !is_single)
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
          if (vec) mean = math.add(mean, math.normalize_vec3(vec)) as Vec3
        }
        const mean_dir = math.normalize_vec3(mean, [0, 1, 0] as Vec3)
        const [u_vec, v_vec] = math.compute_in_plane_basis(mean_dir)
        const offsets = new SvelteMap<string, Vec3>()
        for (const [idx, key] of site_keys.entries()) {
          const angle = (2 * Math.PI * idx) / n_keys
          const dx = math.scale(u_vec, gap_abs * Math.cos(angle)) as Vec3
          const dy = math.scale(v_vec, gap_abs * Math.sin(angle)) as Vec3
          offsets.set(key, math.add(dx, dy) as Vec3)
        }
        return offsets
      })
      : null

    const mag_interpolator = get_d3_interpolator(vector_color_scale)

    return active_keys.map((key, layer_idx) => {
      const layer_cfg = vector_configs[key]
      const layer_scale = effective_global_scale * (layer_cfg?.scale ?? 1.0)
      const layer_color = layer_cfg?.color ??
        VECTOR_PALETTE[layer_idx % VECTOR_PALETTE.length]

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
            const effective_mode = vector_color_mode === `auto`
              ? (key.startsWith(`magmom`) || key.startsWith(`spin`)
                ? `spin_direction`
                : `element`)
              : vector_color_mode
            if (effective_mode === `magnitude`) {
              const mag = Math.hypot(...vec)
              const norm = max_mag > 1e-10 ? mag / max_mag : 0
              arrow_color = mag_interpolator(norm)
            } else if (effective_mode === `spin_direction`) {
              arrow_color = spin_direction_color(vec)
            } else if (effective_mode === `uniform`) {
              arrow_color = vector_color
            } else {
              const majority_element = site.species.length > 0
                ? site.species.reduce((max, spec) =>
                  spec.occu > max.occu ? spec : max
                ).element
                : undefined
              arrow_color =
                (majority_element && colors.element?.[majority_element]) ||
                vector_color
            }
          }

          const offset = site_offsets?.[site_idx]?.get(key)
          const position = offset ? math.add(site.xyz, offset) as Vec3 : site.xyz
          const arrow_vec = vector_normalize ? math.normalize_vec3(vec) : vec

          return {
            site_idx,
            position,
            vector: arrow_vec,
            scale: layer_scale,
            color: arrow_color,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)

      return { key, arrows }
    })
  })

  let instanced_atom_groups = $derived(
    Object.values(
      atom_data
        .filter((atom) => !atom.has_partial_occupancy)
        .reduce(
          (groups, atom) => {
            const { element, radius, color, is_image_atom } = atom
            // Separate image atoms into their own groups for distinct styling in edit-atoms mode
            const key = `${element}-${format_num(radius, `.3~`)}-${color}-${
              is_image_atom ? `img` : `base`
            }`
            const bucket = groups[key] ||
              (groups[key] = { element, radius, color, is_image_atom, atoms: [] })
            bucket.atoms.push(atom)
            return groups
          },
          {} as Record<string, InstancedAtomGroup>,
        ),
    ),
  )

  let unique_instanced_atoms = $derived(
    Object.values(
      instanced_atom_groups
        .flatMap((group) => group.atoms)
        .reduce((acc, atom) => {
          acc[atom.site_idx] = atom
          return acc
        }, {} as Record<number, (typeof atom_data)[number]>),
    ),
  )

  let gizmo_props = $derived.by(() => {
    const axis_options = Object.fromEntries(
      [...AXIS_COLORS, ...NEG_AXIS_COLORS].map(([axis, color, hover_color]) => [
        axis,
        {
          color,
          labelColor: `#111`,
          opacity: axis.startsWith(`n`) ? 0.9 : 0.8,
          hover: {
            color: hover_color,
            labelColor: `#222222`,
            opacity: axis.startsWith(`n`) ? 1 : 0.9,
          },
        },
      ]),
    )
    return {
      background: { enabled: false },
      className: `responsive-gizmo`,
      ...axis_options,
      ...(typeof gizmo === `boolean` ? {} : gizmo),
      offset: { left: 5, bottom: 5 },
    }
  })

  let orbit_controls_props = $derived({
    position: [0, 0, 0],
    enableRotate: rotate_speed > 0,
    rotateSpeed: rotate_speed,
    enableZoom: zoom_speed > 0,
    zoomSpeed: camera_projection === `orthographic` ? zoom_speed * 2 : zoom_speed,
    zoomToCursor: zoom_to_cursor,
    enablePan: pan_speed > 0,
    panSpeed: pan_speed,
    target: camera_target ?? rotation_target,
    maxZoom: max_zoom,
    minZoom: min_zoom,
    autoRotate: Boolean(auto_rotate),
    autoRotateSpeed: auto_rotate,
    enableDamping: Boolean(rotation_damping),
    dampingFactor: rotation_damping,
    onstart: () => {
      camera_is_moving = true
      cancel_atom_hover_clear()
      hovered_idx = null
      bond_context_menu = null
    },
    onend: () => {
      camera_is_moving = false
    },
  })

  let measure_line_color = $derived.by(() => {
    if (typeof window === `undefined`) return
    const root_styles = getComputedStyle(document.documentElement)
    const text_color = root_styles.getPropertyValue(`--text-color`).trim()
    return text_color || `#808080`
  })
</script>

{#snippet bond_instanced_mesh_snippet(
  group: ComponentProps<typeof Bond>[`group`],
)}
  {#key group.instances.length}
    <Bond {group} />
  {/key}
{/snippet}

{#snippet site_label_snippet(position: Vec3, site_idx: number)}
  {@const site = structure!.sites[site_idx]}
  {@const visual_radius = (radius_by_site_idx.get(site_idx) ?? 1) * 0.5}
  <extras.HTML
    center
    position={position}
    calculatePosition={make_label_position_calculator(
      position,
      () => smart_site_label_offsets.get(site_idx) ?? site_label_offset,
      visual_radius,
      label_screen_margin,
    )}
  >
    {#if atom_label}
      {@render atom_label({ site, site_idx })}
    {:else}
      <button
        type="button"
        class="atom-label"
        style:font-size="{site_label_size * 0.85}em"
        style:background={site_label_bg_color}
        style:padding="{site_label_padding}px"
        style:color={site_label_color}
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
            {#each site.species as
              { element, occu, oxidation_state }
              (`${element}-${occu}-${oxidation_state}`)
            }
              {element}<sub>{format_num(occu, `.3~`).replace(`0.`, `.`)}</sub>
            {/each}
            {#if show_site_indices}-{site_idx + 1}{/if}
          {/if}
        {:else if show_site_indices}
          {site_idx + 1}
        {/if}
      </button>
    {/if}
  </extras.HTML>
{/snippet}

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera
    makeDefault
    position={camera_position}
    {fov}
    near={camera_near}
    far={camera_far}
  >
    <extras.OrbitControls bind:ref={orbit_controls} {...orbit_controls_props}>
      {#if gizmo}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
  </T.PerspectiveCamera>
{:else}
  <T.OrthographicCamera
    makeDefault
    position={camera_position}
    zoom={computed_zoom}
    near={-100}
    far={camera_far}
  >
    <extras.OrbitControls bind:ref={orbit_controls} {...orbit_controls_props}>
      {#if gizmo}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
  </T.OrthographicCamera>
{/if}

<T.DirectionalLight position={[3, 10, 10]} intensity={directional_light} />
<T.AmbientLight intensity={ambient_light} />

<!-- Apply manual rotation around center: translate to origin, rotate, translate back -->
<T.Group position={rotation_target}>
  <T.Group {rotation}>
    <T.Group position={math.scale(rotation_target, -1)}>
      {#if show_atoms}
        <!-- Instanced rendering for full occupancy atoms -->
        {#each instanced_atom_groups as
          { element, radius, color, is_image_atom, atoms }
          (`${element}-${radius}-${color}-${is_image_atom ? `img` : `base`}`)
        }
          {@const edit_mode_image = measure_mode === `edit-atoms` && is_image_atom}
          <extras.InstancedMesh
            key="{element}-{format_num(radius, `.3~`)}-{color}-{is_image_atom ? `img` : `base`}-{edit_mode_image}"
            limit={atoms.length}
            range={atoms.length}
            frustumCulled={false}
          >
            <T.SphereGeometry args={[0.5, sphere_segments, sphere_segments]} />
            <T.MeshStandardMaterial
              color={edit_mode_image ? desaturate(color) : color}
              opacity={edit_mode_image ? 0.5 : 1}
              transparent={edit_mode_image}
            />
            {#each atoms as atom (atom.site_idx)}
              <extras.Instance
                position={atom.position}
                scale={atom.radius}
                {...atom_hover_props(atom.site_idx, edit_mode_image)}
                onpointerdown={(event: PointerEvent) => {
                  if (
                    edit_mode_image ||
                    measure_mode !== `edit-bonds` ||
                    bond_edit_mode !== `add`
                  ) {
                    return
                  }
                  select_edit_bonds_site(atom.site_idx, event)
                }}
                onclick={(event: MouseEvent) => {
                  if (edit_mode_image) return
                  if (measure_mode === `edit-bonds`) {
                    if (bond_edit_mode !== `add`) return
                    if (skip_duplicate_edit_bonds_click(atom.site_idx)) {
                      event.stopPropagation()
                      return
                    }
                  }
                  toggle_selection(atom.site_idx, event)
                }}
              />
            {/each}
          </extras.InstancedMesh>
        {/each}

        <!-- Regular rendering for partial occupancy atoms -->
        {#each atom_data.filter((atom) => atom.has_partial_occupancy) as
          atom
          (atom.site_idx + atom.element + atom.occupancy)
        }
          {@const partial_edit_image = measure_mode === `edit-atoms` && atom.is_image_atom}
          {@const ghost_opacity = partial_edit_image ? 0.5 : 1}
          <T.Group
            position={atom.position}
            scale={atom.radius}
            {...atom_hover_props(atom.site_idx, partial_edit_image)}
            onpointerdown={(event: PointerEvent) => {
              if (
                partial_edit_image ||
                measure_mode !== `edit-bonds` ||
                bond_edit_mode !== `add`
              ) {
                return
              }
              select_edit_bonds_site(atom.site_idx, event)
            }}
            onclick={(event: MouseEvent) => {
              if (partial_edit_image) return
              if (measure_mode === `edit-bonds`) {
                if (bond_edit_mode !== `add`) return
                if (skip_duplicate_edit_bonds_click(atom.site_idx)) {
                  event.stopPropagation()
                  return
                }
              }
              toggle_selection(atom.site_idx, event)
            }}
          >
            {@const partial_color = partial_edit_image
            ? desaturate(atom.color)
            : atom.color}
            <T.Mesh>
              <T.SphereGeometry
                args={[
                  0.5,
                  sphere_segments,
                  sphere_segments,
                  atom.start_phi,
                  atom.phi_length,
                ]}
              />
              <T.MeshStandardMaterial
                color={partial_color}
                opacity={ghost_opacity}
                transparent={partial_edit_image}
              />
            </T.Mesh>

            {#if atom.has_partial_occupancy && atom.render_start_cap}
              <T.Mesh rotation={[0, atom.start_phi, 0]}>
                <T.CircleGeometry
                  args={[
                    0.5,
                    sphere_segments,
                    PARTIAL_OCCUPANCY_CAP_ARC.start_cap_arc_start,
                    PARTIAL_OCCUPANCY_CAP_ARC.arc_length,
                  ]}
                />
                <T.MeshStandardMaterial
                  color={partial_color}
                  side={2}
                  opacity={ghost_opacity}
                  transparent={partial_edit_image}
                />
              </T.Mesh>
            {/if}
            {#if atom.has_partial_occupancy && atom.render_end_cap}
              <T.Mesh rotation={[0, atom.end_phi, 0]}>
                <T.CircleGeometry
                  args={[
                    0.5,
                    sphere_segments,
                    PARTIAL_OCCUPANCY_CAP_ARC.end_cap_arc_start,
                    PARTIAL_OCCUPANCY_CAP_ARC.arc_length,
                  ]}
                />
                <T.MeshStandardMaterial
                  color={partial_color}
                  side={2}
                  opacity={ghost_opacity}
                  transparent={partial_edit_image}
                />
              </T.Mesh>
            {/if}
          </T.Group>

          <!-- Render label only for the first species of this site to avoid duplicates -->
          {#if (show_site_labels || show_site_indices) &&
          atom.element === structure!.sites[atom.site_idx].species[0].element}
            {@render site_label_snippet(atom.position, atom.site_idx)}
          {/if}
        {/each}

        <!-- Site labels/indices for instanced atoms -->
        {#if show_site_labels || show_site_indices}
          {#each unique_instanced_atoms as atom (atom.site_idx)}
            {@render site_label_snippet(atom.position, atom.site_idx)}
          {/each}
        {/if}
      {/if}

      {#each vector_layers as layer (layer.key)}
        {#each layer.arrows as arrow (`${layer.key}-${arrow.site_idx}`)}
          <Arrow
            {...arrow}
            shaft_radius={eff_shaft_radius}
            arrow_head_radius={eff_head_radius}
            arrow_head_length={eff_head_length}
          />
        {/each}
      {/each}

      <!-- Instanced bond rendering with gradient colors -->
      {#if instanced_bond_groups.length > 0}
        {#each instanced_bond_groups as group (group.thickness + group.instances.length)}
          {@render bond_instanced_mesh_snippet(group)}
        {/each}
      {/if}

      <!-- Clickable bond hit-test cylinders in edit-bonds mode -->
      {#if measure_mode === `edit-bonds` && editable_bond_pairs.length > 0}
        {#each editable_bond_pairs as
          bond
          (`bond-hit-${bond_edit_mode}-${rendered_bond_key_for(bond)}`)
        }
          {@const bond_key = rendered_bond_key_for(bond)}
          {@const is_hovered = hovered_bond_key === bond_key}
          {@const is_delete_mode = bond_edit_mode === `delete`}
          {@const bond_hit_radius =
            bond_thickness * (is_delete_mode ? 5 : 1.25)}
          {@const bond_hover_radius = bond_thickness * 1.1}
          <T.Mesh
            matrixAutoUpdate={false}
            oncreate={(ref) => apply_bond_transform(ref, bond)}
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
          >
            <T.CylinderGeometry
              args={[
                bond_hit_radius,
                bond_hit_radius,
                1,
                6,
              ]}
            />
            <T.MeshBasicMaterial
              transparent
              opacity={0}
              depthWrite={false}
            />
          </T.Mesh>
          {#if is_hovered}
            <T.Mesh
              matrixAutoUpdate={false}
              oncreate={(ref) => apply_non_raycastable_bond_hit_transform(ref, bond)}
            >
              <T.CylinderGeometry args={[bond_hover_radius, bond_hover_radius, 1, 6]} />
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

      {#if editable_atom_hit_targets.length > 0}
        {#each editable_atom_hit_targets as atom_hit (atom_hit.site_idx)}
          <T.Mesh
            position={atom_hit.position}
            scale={atom_hit.radius * EDITABLE_ATOM_HIT_RADIUS_SCALE}
            {...atom_hover_props(atom_hit.site_idx)}
            onpointerdown={(event: PointerEvent) => {
              select_edit_bonds_site(atom_hit.site_idx, event)
            }}
          >
            <T.SphereGeometry args={[0.5, 12, 12]} />
            <T.MeshBasicMaterial
              transparent
              opacity={0}
              depthWrite={false}
            />
          </T.Mesh>
        {/each}
      {/if}

      {#if measure_mode === `edit-bonds` && bond_context_menu}
        {@const current_order = get_current_bond_order(
          bond_context_menu.site_idx_1,
          bond_context_menu.site_idx_2,
          bond_context_menu.cell_shift,
        )}
        <extras.HTML autoRender={false} position={bond_context_menu.position}>
          <div class="bond-context-menu">
            <strong>Bond Order ({format_bond_order(current_order)})</strong>
            {#each BOND_ORDER_OPTIONS as { order, label } (label)}
              <button
                type="button"
                onpointerdown={(event: PointerEvent) => {
                  event.preventDefault()
                  event.stopPropagation()
                  set_context_bond_order(order)
                }}
                onkeydown={(event: KeyboardEvent) => {
                  if (event.key !== `Enter` && event.key !== ` `) return
                  event.preventDefault()
                  event.stopPropagation()
                  set_context_bond_order(order)
                }}
              >
                {label}
              </button>
            {/each}
            <button
              type="button"
              class="remove"
              onpointerdown={(event: PointerEvent) => {
                event.preventDefault()
                event.stopPropagation()
                remove_context_bond()
              }}
              onkeydown={(event: KeyboardEvent) => {
                if (event.key !== `Enter` && event.key !== ` `) return
                event.preventDefault()
                event.stopPropagation()
                remove_context_bond()
              }}
            >
              Remove
            </button>
            <button
              type="button"
              onpointerdown={(event: PointerEvent) => {
                event.preventDefault()
                event.stopPropagation()
                close_bond_context_menu()
              }}
              onkeydown={(event: KeyboardEvent) => {
                if (event.key !== `Enter` && event.key !== ` `) return
                event.preventDefault()
                event.stopPropagation()
                close_bond_context_menu()
              }}
            >
              Close
            </button>
          </div>
        </extras.HTML>
      {/if}

      <!-- highlight hovered, active and selected sites -->
      {#each [
          {
            kind: `hover`,
            site: hovered_site,
            opacity: 0.28,
            color: `white`,
            site_idx: hovered_idx,
          },
          ...((selected_sites ?? []).map((idx) => ({
            kind: `selected`,
            site: structure?.sites?.[idx] ?? null,
            site_idx: idx,
            opacity: pulse_opacity,
            color: selection_highlight_color,
          }))),
          ...((active_sites ?? []).map((idx) => ({
            kind: `active`,
            site: structure?.sites?.[idx] ?? null,
            site_idx: idx,
            opacity: pulse_opacity, // Let it pulse freely
            color: active_highlight_color,
          }))),
        ] as
        entry
        (`${entry.kind}-${entry.site_idx}`)
      }
        {@const { site, opacity, color, kind, site_idx } = entry}
        {#if site}
          {@const xyz = site.xyz}
          {@const highlight_radius = site_idx !== null
          ? radius_by_site_idx.get(site_idx) ?? get_site_radius(site, site_idx)
          : get_site_radius(site, site_idx)}
          <T.Mesh
            position={xyz}
            scale={1.2 * highlight_radius}
            oncreate={disable_raycast}
          >
            <T.SphereGeometry args={[0.5, 22, 22]} />
            <T.MeshStandardMaterial
              {color}
              transparent
              {opacity}
              emissive={color}
              emissiveIntensity={kind === `selected` || kind === `active` ? 0.7 : 0.2}
              depthTest={false}
              depthWrite={false}
            />
          </T.Mesh>
        {/if}
      {/each}

      <!-- selection order labels (1, 2, 3, ...) for measurements and bond editing -->
      {#if structure?.sites && (measured_sites?.length ?? 0) > 0 &&
        (measure_mode === `distance` || measure_mode === `angle` ||
          measure_mode === `edit-bonds`)}
        {#each measured_sites as site_index, loop_idx (site_index)}
          {@const site = structure.sites[site_index]}
          {#if site}
            <!-- shift selected site labels down to avoid overlapping regular site labels-->
            {@const selection_offset = math.add(site_label_offset, [0, -0.5, 0])}
            {@const pos = math.add(site.xyz, selection_offset) as Vec3}
            <extras.HTML center position={pos}>
              <span class="selection-label">{loop_idx + 1}</span>
            </extras.HTML>
          {/if}
        {/each}
      {/if}

      <!-- hovered site tooltip -->
      {#if hovered_site && !camera_is_moving &&
        (atom_tooltip_active || active_sites.includes(hovered_idx ?? -1))}
        {@const abc = hovered_site.abc.map((val) => format_num(val, float_fmt)).join(
          `, `,
        )}
        {@const xyz = hovered_site.xyz.map((val) => format_num(val, float_fmt)).join(
          `, `,
        )}
        {@const bond_neighbors = (() => {
          if (hovered_idx == null || !structure?.sites) return []
          return filtered_bond_pairs
            .filter((b) =>
              b.site_idx_1 === hovered_idx || b.site_idx_2 === hovered_idx
            )
            .map((b) => {
              const neighbor_idx = b.site_idx_1 === hovered_idx
                ? b.site_idx_2
                : b.site_idx_1
              return structure.sites[neighbor_idx]?.species[0]?.element ?? `?`
            })
        })()}
        {@const bond_summary = (() => {
          if (bond_neighbors.length === 0) return ``
          const counts: Record<string, number> = {}
          for (const elem of bond_neighbors) {
            counts[elem] = (counts[elem] ?? 0) + 1
          }
          const parts = Object.entries(counts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([elem, count]) => `${elem}: ${count}`)
          return ` (${parts.join(`, `)})`
        })()}
        <CanvasTooltip position={hovered_site.xyz}>
          <!-- Element symbols with occupancies for disordered sites -->
          <div class="elements">
            {#each hovered_site.species ?? [] as
              { element, occu, oxidation_state: oxi_state },
              idx
              (`${element ?? ``}-${occu ?? ``}-${oxi_state ?? ``}-${idx}`)
            }
              {@const element_name = element_data.find((elem) =>
              elem.symbol === element
            )?.name ??
              ``}
              {#if idx > 0}&thinsp;{/if}
              {#if occu !== 1}<span class="occupancy">{
                  format_num(occu, `.3~f`)
                }</span>{/if}
              <strong>
                {element}{#if oxi_state != null && oxi_state !== 0}<sup>{Math.abs(
                    oxi_state,
                  )}{oxi_state > 0 ? `+` : `−`}</sup>{/if}
              </strong>
              {#if element_name}<span class="elem-name">{element_name}</span>{/if}
            {/each}
          </div>
          <div class="coordinates fractional">abc: ({abc})</div>
          <div class="coordinates cartesian">xyz: ({xyz}) Å</div>
          {#if bond_neighbors.length > 0}
            <div class="coordinates">Bonds: {bond_neighbors.length}{bond_summary}</div>
          {/if}
        </CanvasTooltip>
      {/if}

      {#if visual_lattice}
        <Lattice matrix={visual_lattice.matrix} {...lattice_props} />
      {/if}

      <!-- TransformControls for editing atoms in edit-atoms mode -->
      {#if measure_mode === `edit-atoms` && selected_sites.length > 0 &&
          structure?.sites}
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
          <T.Mesh
            position={frozen_centroid ?? centroid}
            bind:ref={transform_object}
          >
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
      {#if measure_mode === `edit-atoms` && add_atom_mode}
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
            args={[
              Math.max(200, structure_size * 4),
              Math.max(200, structure_size * 4),
            ]}
          />
          <T.MeshBasicMaterial transparent opacity={0} side={2} depthWrite={false} />
        </T.Mesh>
      {/if}

      <!-- Isosurface rendering from volumetric data (CHGCAR, .cube files) -->
      {#if volumetric_data && isosurface_settings}
        <Isosurface volume={volumetric_data} settings={isosurface_settings} />
      {/if}

      <!-- Measurement overlays for measured sites -->
      {#if structure?.sites && (measured_sites?.length ?? 0) > 0}
        {#if measure_mode === `distance`}
          {#each measured_sites as idx_i, loop_idx (idx_i)}
            {#each measured_sites.slice(loop_idx + 1) as idx_j (idx_i + `-` + idx_j)}
              {@const site_i = structure.sites[idx_i]}
              {@const site_j = structure.sites[idx_j]}
              {@const pos_i = site_i.xyz}
              {@const pos_j = site_j.xyz}
              <Cylinder
                from={pos_i}
                to={pos_j}
                thickness={0.12}
                color={measure_line_color}
              />
              {@const midpoint = [
          (pos_i[0] + pos_j[0]) / 2,
          (pos_i[1] + pos_j[1]) / 2,
          (pos_i[2] + pos_j[2]) / 2,
        ] as Vec3}
              {@const direct = math.euclidean_dist(pos_i, pos_j)}
              {@const pbc = lattice
          ? measure.distance_pbc(pos_i, pos_j, lattice.matrix)
          : direct}
              {@const differ = lattice ? Math.abs(pbc - direct) > 1e-6 : false}
              <extras.HTML center position={midpoint}>
                <span class="measure-label">
                  {#if differ}
                    PBC: {format_num(pbc, float_fmt)} Å<br /><small>
                      Direct: {format_num(direct, float_fmt)} Å</small>
                  {:else}
                    {format_num(pbc, float_fmt)} Å
                  {/if}
                </span>
              </extras.HTML>
            {/each}
          {/each}
        {:else if measure_mode === `angle` && measured_sites.length >= 3}
          {#each measured_sites as idx_center (idx_center)}
            {@const center = structure.sites[idx_center]}
            {#each measured_sites.filter((idx) => idx !== idx_center) as
              idx_a,
              loop_idx
              (idx_center + `-` + idx_a)
            }
              {#each measured_sites.filter((idx) => idx !== idx_center).slice(loop_idx + 1) as
                idx_b
                (idx_center + `-` + idx_a + `-` + idx_b)
              }
                {@const site_a = structure.sites[idx_a]}
                {@const site_b = structure.sites[idx_b]}
                {@const v1 = measure.displacement_pbc(center.xyz, site_a.xyz, lattice?.matrix)}
                {@const v2 = measure.displacement_pbc(center.xyz, site_b.xyz, lattice?.matrix)}
                {@const n1 = Math.hypot(v1[0], v1[1], v1[2])}
                {@const n2 = Math.hypot(v2[0], v2[1], v2[2])}
                {@const angle_deg = measure.angle_between_vectors(v1, v2, `degrees`)}
                {#if n1 > math.EPS && n2 > math.EPS}
                  <!-- draw rays from center to the two sites -->
                  <Cylinder
                    from={center.xyz}
                    to={site_a.xyz}
                    thickness={0.05}
                    color={measure_line_color}
                  />
                  <Cylinder
                    from={center.xyz}
                    to={site_b.xyz}
                    thickness={0.05}
                    color={measure_line_color}
                  />
                  {@const bisector = math.add(math.scale(v1, 1 / n1), math.scale(v2, 1 / n2))}
                  {@const bis_norm = Math.hypot(...bisector) || 1}
                  {@const offset_dir = math.scale(bisector, 1 / bis_norm)}
                  {@const label_pos = math.add(center.xyz, math.scale(offset_dir, 0.6))}
                  <extras.HTML center position={label_pos}>
                    <span class="measure-label">{format_num(angle_deg, float_fmt)}°</span>
                  </extras.HTML>
                {/if}
              {/each}
            {/each}
          {/each}
        {/if}
      {/if}
    </T.Group>
  </T.Group>
</T.Group>

<style>
  :global(.structure .responsive-gizmo) {
    width: clamp(70px, 18cqmin, 100px) !important;
    height: clamp(70px, 18cqmin, 100px) !important;
  }
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
  .elements {
    margin-bottom: var(--canvas-tooltip-elements-margin);
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
    background: var(--surface-bg, Canvas);
    color: var(--text-color, currentColor);
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
    background: var(--pane-btn-bg-hover);
    color: var(--struct-text-color);
    font-size: 0.85em;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
</style>

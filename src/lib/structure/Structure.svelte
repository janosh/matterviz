<script lang="ts">
  // Structure viewer: panes, toolbar, keyboard shortcuts, symmetry and the single/2x2 viewport
  // layout. Acquisition is shared with the other material viewers through open_material.
  import type { ColorSchemeName } from '$lib/colors'
  import { ELEMENT_COLOR_SCHEMES } from '$lib/colors'
  import { DEFAULT_PNG_DPI } from '$lib/constants'
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import type { ElementSymbol } from '$lib/element'
  import { Icon, Spinner, StatusMessage, Toast } from 'svelte-widgets'
  import { create_material_loader } from '$lib/file-viewer/material-loader.svelte'
  import type { FileLoadCallback } from '$lib/io'
  import { ToastStore } from 'svelte-widgets/toast-queue'
  import { BrillouinZone, Grid2x2, HeatmapMatrix, Reset } from 'svelte-widgets/icons'
  import { handle_and_prevent } from '$lib/utils'
  import { is_editable_event_target } from 'svelte-widgets/utils'
  import { webgpu_available } from '$lib/scene'
  import { set_isosurface_error_handler } from '$lib/isosurface/context'
  import type { VolumeSliceSettings } from '$lib/isosurface/slice-settings'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import VolumeSliceView from '$lib/isosurface/VolumeSliceView.svelte'
  import {
    DEFAULT_ISOSURFACE_SETTINGS,
    normalize_active_volume_idx,
  } from '$lib/isosurface/types'
  import { ViewerChrome } from '$lib/layout'
  import { ToolbarMenu } from '$lib/overlays'
  import { DEFAULTS } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import type {
    AnyStructure,
    BondEditMode,
    BondOrder,
    MeasureMode,
    StructureBond,
    StructureDisplayMode,
    StructureHandlerData,
    StructurePane,
    StructureView,
  } from '$lib/structure'
  import {
    DEFAULT_STRUCTURE_VIEWS,
    default_vector_configs,
    get_element_counts,
    get_structure_vector_keys,
    is_crystal,
    RESET_VIEW_TITLE,
  } from '$lib/structure'
  import type { CellType, SymmetryDataset, SymmetrySettings, WyckoffPos } from '$lib/symmetry'
  import * as symmetry from '$lib/symmetry'
  import { OVERLAYS_INPUT_FRAME_NOTE } from './lattice-planes'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { forward_window_keydown, tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import type { Camera, Scene } from 'three/webgpu'
  import type { AtomColorConfig } from './atom-properties'
  import { DEFAULT_ATOM_COLOR_CONFIG, normalize_atom_color_config } from './atom-properties'
  import AtomLegend from './AtomLegend.svelte'
  import CellSelect from './CellSelect.svelte'
  import type { DisplacementSummary } from './measure'
  import { mirror_scene_props } from '$lib/scene/props.svelte'
  import { StructureSession } from './session.svelte'
  import StructureControls from './StructureControls.svelte'
  import StructureEditToolbar from './StructureEditToolbar.svelte'
  import StructureExportPane from './StructureExportPane.svelte'
  import StructureInfoPane from './StructureInfoPane.svelte'
  import type StructureScene from './StructureScene.svelte'
  import StructureViewport from './StructureViewport.svelte'
  import type { TrajectoryLinesStats } from './trajectory-lines'
  import { apply_structure_material } from './material'

  export type StructureControlName =
    | `reset-camera`
    | `fullscreen`
    | `view-mode`
    | `multi-view`
    | `measure-mode`
    | `info-pane`
    | `export-pane`
    | `controls`
  type EventHandler = (data: StructureHandlerData) => void
  type StructureLayoutMode = `single` | `multi` | `slice`
  type SceneProps = ComponentProps<typeof StructureScene> & typeof DEFAULTS.structure

  // Each multi-view pane needs room for orbit controls, labels and atom picking
  const MULTI_VIEW_COLUMNS = 2
  const MULTI_VIEW_MIN_PANE = { width: 300, height: 200, gap: 2 }
  const MULTI_VIEW_MIN_WIDTH =
    MULTI_VIEW_COLUMNS * MULTI_VIEW_MIN_PANE.width +
    (MULTI_VIEW_COLUMNS - 1) * MULTI_VIEW_MIN_PANE.gap
  const STRUCTURE_LAYOUTS = {
    single: { mode: `single`, icon: BrillouinZone, label: `3D single view` },
    multi: { mode: `multi`, icon: Grid2x2, label: `3D 2×2 grid` },
    slice: { mode: `slice`, icon: HeatmapMatrix, label: `2D cross-section` },
  } as const
  // Local scene model (cell rendering included): deep-cloned so UI mutations never leak into
  // the shared defaults
  let scene_props = $state(structuredClone(DEFAULTS.structure) as SceneProps)

  let {
    structure = $bindable(),
    structure_series_key = undefined,
    reference_structure = undefined,
    displacement_rmsd = $bindable(undefined),
    bonds = $bindable(),
    scene_props: scene_props_in = $bindable(),
    // Top-level like show_image_atoms (not a scene_props key): Trajectory binds it to start
    // collecting trail positions when the user toggles it on in the controls pane. Seeded from
    // scene_props once so `scene_props={{ show_trajectory_lines: true }}` is honored.
    show_trajectory_lines = $bindable(
      scene_props_in?.show_trajectory_lines ?? DEFAULTS.structure.show_trajectory_lines,
    ),
    active_pane = $bindable(null),
    multi_view = $bindable(false),
    views = DEFAULT_STRUCTURE_VIEWS,
    enable_measure_mode = true,
    measure_mode = $bindable<MeasureMode>(`distance`),
    bond_edit_mode = $bindable<BondEditMode>(`add`),
    bond_edit_order = $bindable<BondOrder>(1),
    background_color = $bindable(),
    background_opacity = $bindable(DEFAULTS.background_opacity),
    show_controls,
    persist_settings = false,
    fullscreen = $bindable(false),
    fullscreen_toggle = DEFAULTS.structure.fullscreen_toggle,
    wrapper = $bindable(),
    width = $bindable(0),
    height = $bindable(0),
    color_scheme = $bindable(`Vesta`),
    atom_color_config = $bindable<AtomColorConfig>({ ...DEFAULT_ATOM_COLOR_CONFIG }),
    allow_file_drop = true,
    data_url,
    structure_string,
    on_file_drop,
    on_file_load,
    on_error,
    loading = $bindable(false),
    error_msg = $bindable(),
    dragover = $bindable(false),
    enable_info_pane = true,
    analyze_symmetry = true,
    png_dpi = $bindable(DEFAULT_PNG_DPI),
    performance_mode = `quality`,
    show_image_atoms = $bindable(true),
    supercell_scaling = $bindable(`1x1x1`),
    apply_supercell_scaling = true,
    cell_type = $bindable(`original`),
    selected_sites = $bindable([]),
    highlighted_sites = $bindable([]),
    hovered_site_idx = $bindable(null),
    measured_sites = $bindable([]),
    displayed_structure = $bindable(),
    wyckoff_positions = $bindable([]),
    hidden_elements = $bindable(new SvelteSet<ElementSymbol>()),
    sym_data = $bindable(null),
    symmetry_settings = $bindable(symmetry.default_sym_settings),
    volumetric_data = $bindable<VolumetricData[] | undefined>(),
    isosurface_settings = $bindable<IsosurfaceSettings>({ ...DEFAULT_ISOSURFACE_SETTINGS }),
    slice_settings = $bindable<Partial<VolumeSliceSettings>>({}),
    display_mode = $bindable<StructureDisplayMode>(`structure`),
    active_volume_idx = $bindable(0),
    children,
    top_right_controls,
    on_fullscreen_change,
    on_camera_move,
    on_camera_reset,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `children`> & {
    // bindable: the structure on display. Edit-atoms writes edited copies back.
    structure?: AnyStructure
    // Stable identity for coordinate-only updates (trajectory playback): camera and selection
    // persist while it is unchanged and the topology is the same
    structure_series_key?: unknown
    // Comparison overlay: per-atom displacement arrows from this geometry to `structure`
    // (same atom count and order)
    reference_structure?: AnyStructure
    displacement_rmsd?: number // output: RMSD in Angstrom vs reference_structure
    // bindable: explicit bonds. Source for the edit-bonds layer, which writes merged bonds back.
    bonds?: StructureBond[]
    scene_props?: ComponentProps<typeof StructureScene>
    show_trajectory_lines?: boolean
    // bindable: the one floating pane that is open
    active_pane?: StructurePane | null
    // Ovito-style 2x2 grid; collapses to one pane while the viewer is too small for it
    multi_view?: boolean
    // Pane definitions for multi_view (one perspective + three orthographic axis views by default)
    views?: StructureView[]
    enable_measure_mode?: boolean
    measure_mode?: MeasureMode
    bond_edit_mode?: BondEditMode
    bond_edit_order?: BondOrder
    background_color?: string
    background_opacity?: number
    // 'always' | 'hover' | 'never' | { mode, hidden: StructureControlName[], style }
    show_controls?: ShowControlsProp<StructureControlName>
    // Opt-in browser persistence of the controls pane settings
    persist_settings?: boolean
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    wrapper?: HTMLDivElement
    width?: number // output: wrapper width in CSS px
    height?: number // output: wrapper height in CSS px
    color_scheme?: string
    atom_color_config?: AtomColorConfig
    allow_file_drop?: boolean
    data_url?: string // fetched and parsed when no structure is supplied
    structure_string?: string // parsed when neither structure nor data_url is supplied
    // Host takes over dropped/fetched content (and owns `structure`) instead of the parser
    on_file_drop?: FileLoadCallback
    on_file_load?: EventHandler
    on_error?: EventHandler
    loading?: boolean
    error_msg?: string
    dragover?: boolean
    enable_info_pane?: boolean
    // Off for rapidly changing structures whose consumers do not read symmetry data
    analyze_symmetry?: boolean
    png_dpi?: number
    // 'speed' caps sphere tessellation for large structures
    performance_mode?: `quality` | `speed`
    show_image_atoms?: boolean
    supercell_scaling?: string
    // False when `structure` is already expanded to `supercell_scaling`
    apply_supercell_scaling?: boolean
    cell_type?: CellType // original, conventional or primitive (needs symmetry analysis)
    selected_sites?: number[]
    highlighted_sites?: number[]
    hovered_site_idx?: number | null
    measured_sites?: number[] // ordered picks for distance/angle/dihedral overlays
    // Output: the structure as rendered (supercell + image atoms). Writes are overwritten.
    displayed_structure?: AnyStructure
    // Output: Wyckoff rows of the analyzed cell with `site_indices` re-expressed onto
    // `displayed_structure` (empty until symmetry analysis finishes). Writes are overwritten.
    wyckoff_positions?: WyckoffPos[]
    hidden_elements?: Set<ElementSymbol>
    sym_data?: SymmetryDataset | null
    symmetry_settings?: Partial<SymmetrySettings>
    volumetric_data?: VolumetricData[]
    isosurface_settings?: IsosurfaceSettings
    slice_settings?: Partial<VolumeSliceSettings>
    display_mode?: StructureDisplayMode // 3D structure/isosurface or 2D cross-section
    active_volume_idx?: number
    children?: Snippet<[{ structure?: AnyStructure; fullscreen: boolean }]>
    top_right_controls?: Snippet // rendered at the end of the control buttons row
    on_fullscreen_change?: EventHandler
    on_camera_move?: EventHandler
    on_camera_reset?: EventHandler
  } = $props()

  // === toast ===
  // One notice at a time: a newer message replaces the current one rather than queueing
  const toast_store = new ToastStore({ duration_ms: 2000 })
  function show_toast(msg: string): void {
    toast_store.clear()
    toast_store.show(msg)
  }

  // === acquisition: data_url, structure_string, drops ===
  const drop_zone = create_material_loader<AnyStructure>({
    data_url: () => data_url,
    inline_source: () =>
      structure_string ? { data: structure_string, filename: `string` } : undefined,
    current_value: () => structure,
    allow_file_drop: () => allow_file_drop,
    on_file_drop: () => on_file_drop,
    set_loading: (value) => (loading = value),
    set_error: (message) => (error_msg = message),
    set_dragover: (over) => (dragover = over),
    commit: (opened) => {
      const { document, notice } = apply_structure_material(
        { structure, volumetric_data, isosurface_settings, active_volume_idx },
        opened,
      )
      ;({ structure, volumetric_data, isosurface_settings, active_volume_idx } = document)
      if (notice) show_toast(notice)
      on_file_load?.({
        structure: document.structure,
        ...opened.provenance,
        total_atoms: document.structure?.sites.length ?? 0,
      })
    },
    report_error: (message, metadata) => {
      error_msg = message
      on_error?.({ error_msg: message, ...metadata })
    },
  })

  // === session: display pipeline, selection, editing, cameras ===
  // Coordinate-only updates (trajectory frames) share one key; otherwise every structure is new
  let series_key = $derived(structure_series_key ?? structure)
  const session = new StructureSession({
    structure: () => structure,
    set_structure: (value) => (structure = value),
    bonds: () => bonds,
    set_bonds: (value) => (bonds = value),
    series_key: () => series_key,
    selected_sites: () => selected_sites,
    set_selected_sites: (value) => (selected_sites = value),
    measured_sites: () => measured_sites,
    set_measured_sites: (value) => (measured_sites = value),
    highlighted_sites: () => highlighted_sites,
    set_highlighted_sites: (value) => (highlighted_sites = value),
    hovered_site_idx: () => hovered_site_idx,
    set_hovered_site_idx: (value) => (hovered_site_idx = value),
    measure_mode: () => measure_mode,
    set_measure_mode: (value) => (measure_mode = value),
    bond_edit_mode: () => bond_edit_mode,
    set_bond_edit_mode: (value) => (bond_edit_mode = value),
    bond_edit_order: () => bond_edit_order,
    set_bond_edit_order: (value) => (bond_edit_order = value),
    supercell_scaling: () => supercell_scaling,
    apply_supercell_scaling: () => apply_supercell_scaling,
    show_image_atoms: () => show_image_atoms,
    cell_type: () => cell_type,
    set_cell_type: (value) => (cell_type = value),
    sym_data: () => sym_data,
    atom_color_config: () => atom_color_config,
    bonding_strategy: () => scene_props.bonding_strategy,
    on_notice: show_toast,
  })

  // === inputs: mirror caller props into the local models ===
  // JavaScript callers can bypass the TypeScript union with partial JSON; normalize before the
  // first render and again whenever the prop changes
  atom_color_config = normalize_atom_color_config(atom_color_config)
  $effect.pre(() => {
    const normalized = normalize_atom_color_config(atom_color_config)
    if (normalized !== atom_color_config) atom_color_config = normalized
    if (scene_props_in && typeof scene_props_in === `object`) {
      mirror_scene_props(scene_props, scene_props_in)
    }
  })

  // === vectors: auto-populate vector_configs for force/magmom/... site properties ===
  let vector_keys = $derived(
    Array.isArray(structure?.sites) ? get_structure_vector_keys(structure) : [],
  )
  let vector_keys_signature = $derived(vector_keys.join(`\0`))
  let vectors_auto_populated_for = ``
  let last_auto_configs: Record<string, unknown> | undefined
  $effect(() => {
    const signature = vector_keys_signature
    if (!structure?.sites || signature === vectors_auto_populated_for) return
    // Drop the previous structure's auto configs; keep externally supplied ones
    const existing = scene_props.vector_configs
    if (last_auto_configs && existing === last_auto_configs) {
      scene_props.vector_configs = {}
      last_auto_configs = undefined
    } else if (existing && Object.keys(existing).length > 0) {
      vectors_auto_populated_for = signature
      return
    }
    vectors_auto_populated_for = signature
    if (vector_keys.length === 0) return
    scene_props.vector_configs = default_vector_configs(vector_keys)
    // Read the proxied reference back so the identity check above can recognize it
    last_auto_configs = scene_props.vector_configs
    scene_props.vector_scale ??= DEFAULTS.structure.vector_scale
    scene_props.vector_color ??= DEFAULTS.structure.vector_color
  })

  $effect(() => {
    colors.element = ELEMENT_COLOR_SCHEMES[color_scheme as ColorSchemeName]
  })

  // Isosurface geometry-worker failures (chunk 404, OOM): the scene keeps its previous
  // surfaces, so without this notice the user would only see an unchanged view. Isosurface
  // sits several layers down (viewport, scene), so it picks the handler up from context
  let isosurface_error = $state<string>()
  set_isosurface_error_handler((message) => (isosurface_error = message))

  // === symmetry ===
  let symmetry_run_id = 0
  let symmetry_error = $state<string>()
  let last_symmetry_structure: AnyStructure | null = null
  // Skipped during atom drags: moving atoms does not change symmetry and WASM analysis on
  // every drag frame drops frames badly
  $effect(() => {
    if (session.dragging_atoms) return
    if (!analyze_symmetry || !structure || !(`lattice` in structure)) {
      untrack(() => {
        sym_data = null
        symmetry_error = undefined
      })
      last_symmetry_structure = null
      return
    }
    const current_structure = structure
    untrack(() => {
      // Keep previous data while recomputing the same structure so bound consumers
      // (SymmetryStats inputs) do not unmount and lose focus
      if (current_structure !== last_symmetry_structure) sym_data = null
      symmetry_error = undefined
    })
    last_symmetry_structure = current_structure
    const run_id = ++symmetry_run_id
    // Destructure so symprec/algo changes are tracked, not just the object identity
    const { symprec, algo } = symmetry_settings ?? symmetry.default_sym_settings
    // happy-dom cannot fetch WASM assets
    if (typeof process !== `undefined` && process.env?.VITEST) return
    symmetry
      .ensure_moyo_wasm_ready()
      .then(() =>
        run_id === symmetry_run_id
          ? symmetry.analyze_structure_symmetry(current_structure, { symprec, algo })
          : null,
      )
      .then((data) => {
        if (data && run_id === symmetry_run_id) untrack(() => (sym_data = data))
      })
      .catch((err) => {
        if (run_id !== symmetry_run_id) return
        untrack(() => (sym_data = null))
        symmetry_error = `Symmetry analysis failed: ${err?.message || err}`
        console.error(`Symmetry analysis failed:`, err)
      })
  })

  // The symmetry-element and lattice-plane overlays are blanked outside the input frame
  // (StructureViewport), which would otherwise look like the overlay silently vanished: say
  // why whenever an overlay is on and the rendered cell stops being the input cell (cell
  // switch, or overlay enabled while a conventional/primitive cell is shown)
  let overlay_hidden_by_frame = false
  $effect(() => {
    const symmetry_on = symmetry.has_visible_symmetry_overlay(
      scene_props.symmetry_elements ?? [],
      scene_props.symmetry_elements_props?.show_kinds,
    )
    const planes_on = (scene_props.lattice_planes?.length ?? 0) > 0
    const hidden = (symmetry_on || planes_on) && !session.shows_input_frame
    if (hidden && !overlay_hidden_by_frame)
      untrack(() => show_toast(OVERLAYS_INPUT_FRAME_NOTE))
    overlay_hidden_by_frame = hidden
  })

  // === layout ===
  let controls_config = $derived(normalize_show_controls(show_controls))
  let multi_view_min_height = $derived.by(() => {
    const rows = Math.ceil(views.length / MULTI_VIEW_COLUMNS)
    return rows * MULTI_VIEW_MIN_PANE.height + Math.max(0, rows - 1) * MULTI_VIEW_MIN_PANE.gap
  })
  let multi_view_available = $derived(
    views.length > 1 && width >= MULTI_VIEW_MIN_WIDTH && height >= multi_view_min_height,
  )
  // The caller's preference survives while a small viewer temporarily collapses the grid
  let is_multi_view_active = $derived(
    display_mode === `structure` && multi_view && multi_view_available,
  )
  let slice_layout_available = $derived(
    Boolean(volumetric_data?.length || display_mode === `slice`) &&
      controls_config.visible(`view-mode`),
  )
  let multi_layout_available = $derived(
    multi_view_available && controls_config.visible(`multi-view`),
  )
  let layout_control_visible = $derived(
    (display_mode === `slice` && !volumetric_data?.length) ||
      slice_layout_available ||
      (display_mode === `structure` && multi_layout_available),
  )
  let current_layout = $derived(
    STRUCTURE_LAYOUTS[
      display_mode === `slice` ? `slice` : is_multi_view_active ? `multi` : `single`
    ],
  )
  let multi_view_unavailable_reason = $derived(
    views.length < 2
      ? `Configure at least two views to enable multi-view`
      : !multi_view_available
        ? `Requires at least ${MULTI_VIEW_MIN_WIDTH}×${multi_view_min_height} px. Enlarge the viewer or use fullscreen.`
        : undefined,
  )
  let hovered = $state(false)
  let focused = $state(false)
  let viewer_active = $derived(hovered || focused)
  let view_layout_menu_open = $state(false)
  const is_pane_open = (pane: StructurePane): boolean => active_pane === pane
  const set_pane_open = (pane: StructurePane, open: boolean): void => {
    if (open) active_pane = pane
    else if (active_pane === pane) active_pane = null
  }
  function select_structure_layout(mode: StructureLayoutMode): void {
    if (mode === `slice`) display_mode = `slice`
    else {
      display_mode = `structure`
      multi_view = mode === `multi`
    }
    view_layout_menu_open = false
  }

  // === scene inputs ===
  // Speed mode caps tessellation at render time rather than rewriting the user's setting
  let effective_sphere_segments = $derived(
    performance_mode === `speed` && (structure?.sites?.length ?? 0) > 200
      ? Math.min(scene_props.sphere_segments, 12)
      : scene_props.sphere_segments,
  )
  // Keep the gizmo mounted whenever enabled (toggling remounts OrbitControls and resets the
  // camera); reveal it on hover/focus through its own `visible` flag
  let scene_gizmo_props = $derived.by(() => {
    const { gizmo } = scene_props
    if (!gizmo) return gizmo
    const overrides = typeof gizmo === `object` ? gizmo : {}
    // `??` so an explicit `visible: false` is honored
    return { ...overrides, visible: overrides.visible ?? viewer_active }
  })
  let active_scene_sites = $derived([
    ...new Set([...(scene_props.active_sites ?? []), ...session.highlighted_sites]),
  ])
  // Primary-pane outputs: scene/camera for export, readouts for the controls pane
  let scene = $state<Scene | undefined>(undefined)
  let camera = $state<Camera | undefined>(undefined)
  let slice_canvas = $state<HTMLCanvasElement | undefined>(undefined)
  let displacement_summary = $state<DisplacementSummary | null>(null)
  let polyhedra_rendered_elements = $state<string[]>([])
  let trajectory_lines_result = $state<TrajectoryLinesStats | null>(null)
  let reset_camera_available = $derived(
    display_mode === `structure` &&
      session.any_camera_moved &&
      controls_config.visible(`reset-camera`),
  )
  // Inputs shared by every StructureViewport; camera bindings and chrome differ per pane
  const pane_props = (pane_idx: number) => ({
    in_grid: is_multi_view_active,
    active: is_multi_view_active && session.active_pane_idx === pane_idx,
    interactive: !is_multi_view_active || session.active_pane_idx === pane_idx,
    on_activate: () => (session.active_pane_idx = pane_idx),
    reset_token: session.reset_token,
    report_moved: (moved: boolean) => session.report_pane_moved(pane_idx, moved),
  })
  let shared_viewport_props = $derived({
    session,
    view_reset_key: series_key,
    reference_structure,
    scene_props: {
      ...scene_props,
      show_trajectory_lines,
      sphere_segments: effective_sphere_segments,
    },
    gizmo: scene_gizmo_props,
    volumetric_data,
    active_volume_idx,
    isosurface_settings,
    property_colors: session.property_colors,
    active_sites: active_scene_sites,
  })

  // === outputs and clamps ===
  // Own effect: a bound parent re-proxies every write, so writing on unrelated reruns would
  // hand consumers a new identity for the same structure
  $effect(() => {
    displayed_structure = session.displayed_structure
  })
  $effect(() => {
    wyckoff_positions = session.wyckoff_rows
  })
  $effect(() => {
    displacement_rmsd = displacement_summary?.rmsd
  })
  // Stale externally-controlled indices must not blank either volumetric view
  $effect(() => {
    const clamped_idx = normalize_active_volume_idx(
      active_volume_idx,
      volumetric_data?.length ?? 0,
    )
    if (clamped_idx !== active_volume_idx) active_volume_idx = clamped_idx
  })
  // untrack: collapsing reads the moved-pane set, which must not re-run this on camera moves
  $effect(() => {
    if (!is_multi_view_active) untrack(session.collapse_to_primary_pane)
  })

  // === camera context ===
  // A new series (not coordinate-only frames) re-frames the camera unless the caller supplied
  // an explicit pose; supercell/image/cell changes re-center the orbit target on the new cell.
  let previous_series_key: unknown = untrack(() => series_key)
  let previous_transform = untrack(
    () => `${supercell_scaling}\0${show_image_atoms}\0${cell_type}`,
  )
  $effect.pre(() => {
    const transform = `${supercell_scaling}\0${show_image_atoms}\0${cell_type}`
    const series_changed = series_key !== previous_series_key
    const transform_changed = transform !== previous_transform
    previous_series_key = series_key
    previous_transform = transform
    if (!series_changed && !transform_changed) return
    untrack(() => {
      // In edit-atoms mode structure changes are the user's own edits: keep the orbit target
      if (measure_mode !== `edit-atoms`) scene_props.camera_target = undefined
      if (!series_changed) return
      session.clear_moved_panes()
      const explicit_camera =
        scene_props_in?.camera_target !== undefined ||
        scene_props_in?.camera_position?.some((coordinate) => coordinate !== 0)
      if (explicit_camera) return
      scene_props.camera_target = undefined
      scene_props.camera_position = [0, 0, 0]
    })
  })

  $effect(() => () => {
    toast_store.destroy()
    symmetry_run_id += 1 // a run landing after unmount must not write into dead bindings
  })

  // === keyboard ===
  // Returns true when the key was handled so the caller can suppress the browser default
  function handle_keydown(event: KeyboardEvent): boolean {
    // Bound on the root and on the window: a click leaves the viewer focused *and*
    // hovered, so both would run and a toggle would cancel itself out. The root fires
    // first and prevents the default, which makes the window pass a no-op.
    if (event.defaultPrevented) return false
    const is_input_focused = is_editable_event_target(event.target)
    // Escape leaves add-atom mode even from its element input
    if (event.key === `Escape` && measure_mode === `edit-atoms` && session.add_atom_mode) {
      session.add_atom_mode = false
      return true
    }
    if (is_input_focused) return false
    const key = event.key.toLowerCase()
    const has_modifier = event.ctrlKey || event.metaKey
    const plain = !has_modifier && !event.altKey
    // autorepeat must not flip a toggle over and over while a key is held down
    const plain_press = plain && !event.repeat
    const is_undo = has_modifier && key === `z` && !event.shiftKey
    const is_redo = has_modifier && (key === `y` || (key === `z` && event.shiftKey))
    const editing_bonds = measure_mode === `edit-bonds`
    const editing_atoms = measure_mode === `edit-atoms`

    if ((editing_bonds || editing_atoms) && (is_undo || is_redo)) {
      const [step, history, what] = editing_bonds
        ? [
            is_undo ? session.undo_bond_edit : session.redo_bond_edit,
            session.bond_history,
            ` bond edit`,
          ]
        : [is_undo ? session.undo : session.redo, session.history, ``]
      if (!step()) return false
      const left = (is_undo ? history.undo_stack : history.redo_stack).length
      show_toast(`${is_undo ? `Undo` : `Redo`}${what} (${left} left)`)
      return true
    }
    if (editing_bonds && plain && (key === `a` || key === `d`)) {
      bond_edit_mode = key === `a` ? `add` : `delete`
      return true
    }
    if (editing_atoms) {
      if (event.key === `Delete` || event.key === `Backspace`) return session.delete_selected()
      if (key === `a` && plain_press) {
        session.add_atom_mode = !session.add_atom_mode
        return true
      }
      if (key === `e` && plain_press && selected_sites.length > 0) {
        session.change_element_mode = !session.change_element_mode
        return true
      }
      if (key === `d` && has_modifier) return session.duplicate_selected()
      if (event.key === `Escape` && session.change_element_mode) {
        session.change_element_mode = false
        return true
      }
    }
    if (
      (editing_bonds || editing_atoms) &&
      event.key === `Escape` &&
      selected_sites.length > 0
    ) {
      session.clear_selection()
      return true
    }
    // Plain `r` (Cmd/Ctrl+R is browser reload; Shift+R left free)
    if (key === `r` && plain && !event.shiftKey && reset_camera_available) {
      session.reset_all_cameras()
      return true
    }
    // View toggles are plain letters everywhere; typing is already excluded by the editable
    // guard above. `f` is owned by FullscreenButton, which arbitrates it between nested
    // viewers. Chords stay the browser's and the host's.
    if (key === `i` && plain_press && display_mode === `structure` && enable_info_pane) {
      set_pane_open(`info`, !is_pane_open(`info`))
      return true
    }
    if (
      key === `g` &&
      plain_press &&
      display_mode === `structure` &&
      controls_config.visible(`multi-view`) &&
      (multi_view_available || multi_view)
    ) {
      multi_view = !multi_view
      return true
    }
    if (event.key === `Escape`) {
      // Close panes first, then leave edit modes
      if (active_pane !== null) active_pane = null
      else if (measure_mode === `edit-bonds` || measure_mode === `edit-atoms`) {
        measure_mode = `distance`
      } else return false
      return true
    }
    return false
  }
  // Hover (window) path: destructive edit keys require focus, not just a hovering pointer
  const handle_hover_keydown = (event: KeyboardEvent): boolean =>
    measure_mode === `edit-atoms` || measure_mode === `edit-bonds`
      ? false
      : handle_keydown(event)

  // Only override the themed --struct-bg when a color is given; opacity becomes the alpha byte
  let background_override = $derived(
    background_color
      ? `${background_color}${Math.round(background_opacity * 255)
          .toString(16)
          .padStart(2, `0`)}`
      : undefined,
  )
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class:active={active_pane !== null}
  class:multi-view={is_multi_view_active}
  style:--struct-viewport-gap="{MULTI_VIEW_MIN_PANE.gap}px"
  style:--struct-bg-override={background_override}
  role="application"
  tabindex="0"
  aria-label="Structure viewer"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
  onfocusin={() => (focused = true)}
  onfocusout={(event) => {
    if (!(event.relatedTarget instanceof Node) || !wrapper?.contains(event.relatedTarget)) {
      focused = false
    }
  }}
  onkeydown={handle_and_prevent(handle_keydown)}
  {...rest}
  class={[`structure`, rest.class]}
  {@attach drop_zone}
  {@attach forward_window_keydown({ handle: handle_hover_keydown })}
>
  {@render children?.({ structure, fullscreen })}
  {#if loading}
    <Spinner
      text="Loading structure..."
      style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)"
    />
  {:else if error_msg}
    <StatusMessage bind:message={error_msg} type="error" dismissible />
  {:else if (structure?.sites?.length ?? 0) > 0 || (volumetric_data?.length ?? 0) > 0}
    <ViewerChrome
      {controls_config}
      bind:fullscreen
      {fullscreen_toggle}
      {wrapper}
      fullscreen_bg_css_var="--struct-bg-fullscreen"
      on_fullscreen_change={(value) =>
        on_fullscreen_change?.({ structure, fullscreen: value })}
      style="--viewer-buttons-gap: 4pt; --viewer-buttons-btn-padding: 1px 2px; --viewer-buttons-align: stretch; --viewer-buttons-hover-bg: transparent; --viewer-buttons-hover-color: light-dark(#000, #fff)"
    >
      {#if layout_control_visible}
        <ToolbarMenu
          bind:open={view_layout_menu_open}
          label="View layout: {current_layout.label}"
          class="view-layout-dropdown"
        >
          {#snippet button()}<Icon icon={current_layout.icon} />{/snippet}
          {#each Object.values(STRUCTURE_LAYOUTS) as { mode, icon, label } (mode)}
            {#if mode === `single` || (mode === `multi` && multi_layout_available) || (mode === `slice` && slice_layout_available)}
              <button
                type="button"
                class={['view-mode-option', { selected: current_layout.mode === mode }]}
                title={mode === `multi` ? `${label} (G)` : label}
                aria-keyshortcuts={mode === `multi` ? `G` : undefined}
                aria-pressed={current_layout.mode === mode}
                onclick={() => select_structure_layout(mode)}
              >
                <Icon {icon} />
                <span>{label}</span>
              </button>
            {/if}
          {/each}
          {#if reset_camera_available}
            <button
              type="button"
              class="view-mode-option reset-camera"
              title={RESET_VIEW_TITLE}
              aria-keyshortcuts="r"
              onclick={() => {
                session.reset_all_cameras()
                view_layout_menu_open = false
              }}
            >
              <Icon icon={Reset} />
              <span>Reset view <kbd>r</kbd></span>
            </button>
          {/if}
        </ToolbarMenu>
      {/if}

      {#if display_mode === `structure` && enable_measure_mode && controls_config.visible(`measure-mode`)}
        <StructureEditToolbar {session} />
      {/if}

      {#if display_mode === `structure` && enable_info_pane && session.base_structure && session.displayed_structure && controls_config.visible(`info-pane`)}
        <StructureInfoPane
          structure={session.base_structure}
          displayed_structure={session.displayed_structure}
          bonding_strategy={scene_props.bonding_strategy}
          bind:pane_open={() => is_pane_open(`info`), (open) => set_pane_open(`info`, open)}
          bind:highlighted_sites
          bind:hovered_site_idx
          bind:selected_sites
          {sym_data}
          wyckoff_positions={session.wyckoff_rows}
          {@attach tooltip({ content: `Structure info pane` })}
        />
      {/if}

      {#if controls_config.visible(`export-pane`)}
        <StructureExportPane
          bind:export_pane_open={
            () => is_pane_open(`export`), (open) => set_pane_open(`export`, open)
          }
          structure={session.normalized_structure}
          {wrapper}
          {scene}
          {camera}
          image_canvas={display_mode === `slice` ? slice_canvas : undefined}
          image_filename={display_mode === `slice`
            ? `${volumetric_data?.[active_volume_idx]?.label ?? `volume`}-slice`
            : undefined}
          enable_3d_export={display_mode === `structure`}
          bind:png_dpi
          pane_props={{ style: `--pane-max-height: calc(${height}px - 50px)` }}
        />
      {/if}

      {#if controls_config.visible(`controls`)}
        <StructureControls
          bind:controls_open={
            () => is_pane_open(`controls`), (open) => set_pane_open(`controls`, open)
          }
          bind:scene_props
          bind:show_trajectory_lines
          bind:show_image_atoms
          bind:supercell_scaling
          bind:background_color
          bind:background_opacity
          bind:color_scheme
          bind:atom_color_config
          bind:cell_type
          bind:volumetric_data
          bind:isosurface_settings
          bind:slice_settings
          bind:active_volume_idx
          {display_mode}
          bind:multi_view
          multi_view_control_visible={controls_config.visible(`multi-view`)}
          {multi_view_unavailable_reason}
          {structure}
          supercell_loading={session.supercell_loading}
          {sym_data}
          {polyhedra_rendered_elements}
          {displacement_summary}
          {trajectory_lines_result}
          on_reset_camera={reset_camera_available ? session.reset_all_cameras : undefined}
          bind:fly_to_request={session.fly_to_request}
          {persist_settings}
        />
      {/if}

      {@render top_right_controls?.()}
    </ViewerChrome>

    {#if display_mode === `structure` && structure?.sites?.length}
      <AtomLegend
        bind:atom_color_config
        property_colors={session.property_colors}
        elements={get_element_counts(session.supercell_structure ?? structure)}
        bind:hidden_elements
        bind:hidden_prop_vals={session.hidden_prop_vals}
        bind:element_mapping={session.element_mapping}
        bind:element_radius_overrides={session.element_radius_overrides}
        bind:site_radius_overrides={session.site_radius_overrides}
        selected_sites={measure_mode === `edit-atoms` ? session.selected_sites : []}
        structure={session.displayed_structure}
        show_mode_toggle={viewer_active}
        {sym_data}
      >
        {#snippet children({ mode_menu_open })}
          <!-- A lattice is enough: repeating a cell is well defined whatever its pbc flags say
            (the phonon explorer tiles a deliberately aperiodic cell), while the primitive and
            conventional buttons inside gate themselves on sym_data -->
          {#if is_crystal(structure)}
            <CellSelect
              bind:supercell_scaling
              bind:cell_type
              {sym_data}
              loading={session.supercell_loading}
              direction="up"
              suppress_hover={mode_menu_open}
            />
          {/if}
        {/snippet}
      </AtomLegend>
    {/if}

    <!-- One StructureViewport renders the single view; four render the 2x2 grid. The primary
      pane (index 0) carries the external camera API: scene/camera are bound out for export,
      camera_position/target persist into scene_props, and it emits on_camera_move/reset. -->
    {#snippet primary_viewport(view: StructureView)}
      <StructureViewport
        {...pane_props(0)}
        {on_camera_move}
        {on_camera_reset}
        {...shared_viewport_props}
        camera_direction={view.direction}
        camera_projection={view.projection ?? scene_props.camera_projection}
        bind:camera_position={scene_props.camera_position}
        bind:camera_target={scene_props.camera_target}
        bind:fly_to_request={session.fly_to_request}
        bind:displacement_summary
        bind:scene
        bind:camera
        {hidden_elements}
        bind:polyhedra_rendered_elements
        bind:trajectory_lines_result
      />
    {/snippet}

    {#snippet extra_viewport(view: StructureView, pane_idx: number)}
      <StructureViewport
        {...pane_props(pane_idx)}
        label={view.label}
        {...shared_viewport_props}
        camera_direction={view.direction}
        camera_projection={view.projection ?? scene_props.camera_projection}
        {hidden_elements}
      />
    {/snippet}

    {#if display_mode === `slice`}
      <VolumeSliceView
        volume={volumetric_data?.[active_volume_idx]}
        bind:settings={slice_settings}
        bind:canvas={slice_canvas}
      />
      <!-- no GPU adapter in SSR and the vitest runner -->
    {:else if webgpu_available()}
      <div class:multi={is_multi_view_active} class="viewport-stage">
        {@render primary_viewport(is_multi_view_active ? (views[0] ?? {}) : {})}
        {#if is_multi_view_active}
          {#each views.slice(1) as view, idx (idx)}
            {@render extra_viewport(view, idx + 1)}
          {/each}
        {/if}
      </div>
    {/if}

    <Toast
      store={toast_store}
      position="bottom-center"
      dismissible={false}
      pause_on_hover={false}
      focus_hotkey={null}
      class="edit-toast"
    />

    {#if analyze_symmetry && symmetry_error}
      <StatusMessage
        bind:message={symmetry_error}
        type="warning"
        dismissible
        class="symmetry-error"
        style="position: absolute; bottom: 0.5rem; right: 0.5rem; max-width: min(90%, 400px); font-size: 0.75rem; padding: 0.3rem 0.6rem; z-index: var(--z-index-viewer-tooltip, 1000)"
      />
    {/if}
    {#if isosurface_error}
      <StatusMessage
        bind:message={isosurface_error}
        type="warning"
        dismissible
        class="isosurface-error"
        style="position: absolute; top: 0.5rem; left: 50%; transform: translateX(-50%); max-width: 90%; font-size: 0.75rem; padding: 0.3rem 0.6rem; z-index: var(--z-index-viewer-tooltip, 1000)"
      />
    {/if}
  {:else if structure}
    <p class="warn">No sites found in structure</p>
  {:else}
    <p class="warn">No structure provided</p>
  {/if}
</div>

<style>
  .structure {
    position: relative;
    container-type: size; /* enable cqh/cqw for internal panes */
    --ctrl-btn-icon-size: var(--struct-ctrl-btn-icon-size, var(--viewer-chrome-icon-size));
    height: var(--struct-height, 500px);
    width: var(--struct-width, 100%);
    max-width: var(--struct-max-width, 100%);
    min-width: var(--struct-min-width, 300px);
    /* Square by default; opt into rounding with --struct-border-radius. */
    border-radius: var(--struct-border-radius, 0);
    background: var(--struct-bg-override, var(--struct-bg));
    color: var(--text-color);
    display: flex;
  }
  .structure.active {
    z-index: var(--struct-active-z-index, 2);
  }
  .structure:fullscreen {
    background: var(--struct-bg-fullscreen, var(--struct-bg));
    overflow: hidden;
  }
  /* Single view: stretch the lone canvas to the full screen in fullscreen mode.
    In multi-view the grid fills the screen and each canvas fills its 1fr cell. */
  .structure:fullscreen:not(.multi-view) :global(canvas) {
    height: 100vh !important;
    width: 100vw !important;
  }
  .structure.dragover {
    background: var(--struct-dragover-bg, var(--dragover-bg));
    border: var(--struct-dragover-border, var(--dragover-border));
  }
  .viewport-stage {
    height: 100%;
    width: 100%;
  }
  /* Two-column multi-side view grid. Implicit rows divide the available height
    equally, including when a custom `views` array changes the number of panes. */
  .viewport-stage.multi {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: 1fr;
    gap: var(--struct-viewport-gap);
  }
  /* Ensure canvas is transparent so the themed --struct-bg shows through */
  .structure :global(canvas) {
    background: transparent;
    cursor: var(--canvas-cursor, default);
  }
  /* Avoid accidental text selection while interacting with the viewer */
  .structure :global(canvas),
  .structure :global(section.control-buttons) {
    user-select: none;
  }
  p.warn {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
  }
  /* Transient notices sit inside the viewer (so they follow it into fullscreen) and never
    intercept pointer events meant for the canvas beneath */
  .structure :global(.edit-toast) {
    --toast-stack-position: absolute;
    --toast-inset: 3rem;
    --toast-z-index: var(--z-index-viewer-dropdown, 100);
    --toast-font-size: 0.8rem;
    :global(.toast) {
      pointer-events: none;
    }
  }
  /* CellSelect sits left of the legend and, like the legend's mode toggle, only shows while the
    viewer is hovered or focused. Focus matters: the control is tabbable while hidden, and its
    menu opens on focus. ViewerChrome's generic hover-visible rule only covers its own button
    row, so this stays here. */
  .structure :global(.cell-select) {
    order: -1;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  .structure:is(:hover, :focus-within) :global(.cell-select) {
    opacity: 1;
    pointer-events: auto;
  }
</style>

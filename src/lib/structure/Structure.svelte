<script lang="ts">
  // Structure viewer: panes, toolbar, keyboard shortcuts, symmetry and the single/2x2 viewport
  // layout. StructureFileViewer owns URL/text acquisition and file drops.
  import type { ColorSchemeName } from '$lib/colors'
  import { ELEMENT_COLOR_SCHEMES } from '$lib/colors'
  import { DEFAULT_PNG_DPI } from '$lib/constants'
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import type { ElementSymbol } from '$lib/element'
  import { Icon, StatusMessage, Toast } from 'svelte-widgets'
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
    auto_volume_layer,
    DEFAULT_ISOSURFACE_SETTINGS,
    normalize_active_volume_id,
    index_volumes,
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
  import type { CellType, SymmetryDataset, SymmetrySettings } from '$lib/symmetry'
  import * as symmetry from '$lib/symmetry'
  import { OVERLAYS_INPUT_FRAME_NOTE } from './lattice-planes'
  import type { ComponentProps, Snippet } from 'svelte'
  import { onDestroy, untrack } from 'svelte'
  import { forward_window_keydown, tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import type { Camera, Scene } from 'three/webgpu'
  import type { AtomColorConfig } from './atom-properties'
  import { DEFAULT_ATOM_COLOR_CONFIG, normalize_atom_color_config } from './atom-properties'
  import AtomLegend from './AtomLegend.svelte'
  import CellSelect from './CellSelect.svelte'
  import type { DisplacementSummary } from './measure'
  import { StructureSession } from './session.svelte'
  import StructureControls from './StructureControls.svelte'
  import StructureEditToolbar from './StructureEditToolbar.svelte'
  import StructureExportPane from './StructureExportPane.svelte'
  import StructureInfoPane from './StructureInfoPane.svelte'
  import type { StructureSettings } from './settings'
  import type { TrajectoryPositionStream } from '$lib/trajectory'
  import StructureViewport from './StructureViewport.svelte'
  import type { TrajectoryLinesStats } from './trajectory-lines'
  import {
    structure_host_tool,
    create_structure_tool_controller,
    type StructureToolPrediction,
    type StructureToolProvenance,
    type StructureToolView,
  } from './host-tool.svelte'
  import { copy_prediction } from './prediction'
  import { replace_tool_volumes } from './host-tool-volumes'

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
  let {
    structure = $bindable(),
    structure_series_key = undefined,
    show_host_tool = true,
    reference_structure = undefined,

    bonds = $bindable(),
    scene_props = $bindable<StructureSettings>(structuredClone(DEFAULTS.structure)),
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

    prediction,
    trajectory_position_stream,
    trajectory_line_end_frame,
    defer_expensive_geometry = false,

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

    hidden_elements = $bindable(new SvelteSet<ElementSymbol>()),

    symmetry_settings = $bindable(symmetry.default_sym_settings),
    volumetric_data = $bindable<VolumetricData[] | undefined>(),
    isosurface_settings = $bindable<IsosurfaceSettings>({
      ...DEFAULT_ISOSURFACE_SETTINGS,
    }),
    slice_settings = $bindable<Partial<VolumeSliceSettings>>({}),
    display_mode = $bindable<StructureDisplayMode>(`structure`),
    active_volume_id = $bindable<string | undefined>(),
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
    // Disable nested host tools in a host-owned preview.
    show_host_tool?: boolean
    // Comparison overlay: per-atom displacement arrows from this geometry to `structure`
    // (same atom count and order)
    reference_structure?: AnyStructure
    // bindable: explicit bonds. Source for the edit-bonds layer, which writes merged bonds back.
    bonds?: StructureBond[]
    scene_props?: StructureSettings
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
    prediction?: StructureToolPrediction
    trajectory_position_stream?: TrajectoryPositionStream | null
    trajectory_line_end_frame?: number
    defer_expensive_geometry?: boolean
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
    hidden_elements?: Set<ElementSymbol>
    symmetry_settings?: Partial<SymmetrySettings>
    volumetric_data?: VolumetricData[]
    isosurface_settings?: IsosurfaceSettings
    slice_settings?: Partial<VolumeSliceSettings>
    display_mode?: StructureDisplayMode // 3D structure/isosurface or 2D cross-section
    active_volume_id?: string
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

  let sym_data = $state<SymmetryDataset | null>(null)

  // === session: display pipeline, selection, editing, cameras ===
  // Coordinate-only updates (trajectory frames) share one key; otherwise every structure is new
  let series_key = $derived(structure_series_key ?? structure)
  const session: StructureSession = new StructureSession({
    structure: () => structure,
    site_properties: (): Record<string, unknown>[] | undefined =>
      active_overlay?.site_properties,
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
    bonding_strategy: () =>
      scene_props.bonding_strategy ?? DEFAULTS.structure.bonding_strategy,
    on_notice: show_toast,
  })

  let tool_source = $state.raw<AnyStructure | undefined>()
  let tool_source_revision = ``
  let tool_view = $state.raw<StructureToolView | null>(null)
  const active_tool_view = $derived(tool_source === session.tool_input ? tool_view : null)
  let tool_overlay = $state.raw<StructureToolPrediction | null>(null)
  let tool_overlay_visible = $state(true)
  const active_prediction = $derived(tool_source === session.tool_input ? tool_overlay : null)
  const active_overlay = $derived(tool_overlay_visible ? active_prediction : null)
  const tool_structure = $derived(
    session.tool_input && active_prediction?.site_properties
      ? {
          ...session.tool_input,
          sites: session.tool_input.sites.map((site, idx) => ({
            ...site,
            properties: { ...site.properties, ...active_prediction.site_properties?.[idx] },
          })),
        }
      : session.tool_input,
  )
  // Generated fields join the active document registry so imports, exports and controls
  // share stable field IDs, independent of object replacement or array order.
  let owned_volume_ids = $state.raw<string[]>([])
  const owned_volume_set = $derived(new Set(owned_volume_ids))
  const volume_by_id = $derived(index_volumes(volumetric_data ?? []))
  const removed_tool_fields = new Set<string>()
  let original_active_volume_id: string | undefined
  const hidden_volume_ids = $derived(
    new Set(
      (volumetric_data ?? []).flatMap((volume) =>
        owned_volume_set.has(volume.id) &&
        (!active_overlay ||
          !session.shows_input_frame ||
          (session.has_supercell && !volume.periodic))
          ? [volume.id]
          : [],
      ),
    ),
  )
  const tool_volume_notice = $derived(
    tool_overlay_visible && hidden_volume_ids.size > 0
      ? !active_overlay
        ? `Prediction density belongs to a previous input. Run a new prediction.`
        : !session.shows_input_frame
          ? `Prediction density is hidden in standardized cells. Select the original cell to align it with the atoms.`
          : `Finite and partially periodic prediction density is shown only in the input cell. Set supercell scaling to 1x1x1.`
      : ``,
  )
  const display_isosurface_settings = $derived(
    hidden_volume_ids.size > 0
      ? {
          ...isosurface_settings,
          layers: isosurface_settings.layers.filter(
            (layer) =>
              !hidden_volume_ids.has(layer.volume_id) &&
              (layer.color_volume_id === undefined ||
                !hidden_volume_ids.has(layer.color_volume_id)),
          ),
        }
      : isosurface_settings,
  )
  // The active configuration lives in atom_color_config; retain only its hidden counterpart.
  let inactive_tool_color: AtomColorConfig | null = null
  const set_tool_overlay_visible = (visible: boolean): void => {
    if (visible === tool_overlay_visible) return
    if (inactive_tool_color)
      [atom_color_config, inactive_tool_color] = [inactive_tool_color, atom_color_config]
    tool_overlay_visible = visible
  }
  const apply_tool_overlay = (overlay: StructureToolPrediction | null): void => {
    const color_property = overlay?.color_property
    if (color_property) {
      if (tool_overlay_visible) inactive_tool_color ??= atom_color_config
      if (color_property !== active_prediction?.color_property) {
        const config: AtomColorConfig = {
          mode: `property`,
          property_key: color_property,
          scale: `interpolateRdBu`,
          scale_type: `continuous`,
        }
        if (tool_overlay_visible) atom_color_config = config
        else inactive_tool_color = config
      }
    } else {
      if (tool_overlay_visible && inactive_tool_color) atom_color_config = inactive_tool_color
      inactive_tool_color = null
    }
    // A publication is a fresh snapshot; remember user removals by field ID within this run.
    const same_run = tool_overlay?.run_id === overlay?.run_id
    if (!same_run) removed_tool_fields.clear()
    else
      for (const id of owned_volume_ids) if (!volume_by_id.has(id)) removed_tool_fields.add(id)
    tool_overlay = overlay
    tool_source = session.tool_input
    tool_source_revision = overlay ? tool_input_revision : ``
    const restore_active =
      active_volume_id !== undefined && owned_volume_set.has(active_volume_id)
    const preserve_active = restore_active || (same_run && owned_volume_ids.length > 0)
    if (!restore_active) original_active_volume_id = active_volume_id
    const incoming = (overlay?.volumes ?? []).filter(({ id }) => !removed_tool_fields.has(id))
    const result = replace_tool_volumes(
      volumetric_data ?? [],
      isosurface_settings.layers,
      owned_volume_ids,
      incoming,
    )
    volumetric_data = result.volumes
    isosurface_settings = { ...isosurface_settings, layers: result.layers }
    owned_volume_ids = incoming.map(({ id }) => id)
    active_volume_id = normalize_active_volume_id(
      incoming.length
        ? preserve_active
          ? active_volume_id
          : incoming[0].id
        : restore_active
          ? original_active_volume_id
          : active_volume_id,
      volumetric_data,
    )
  }
  // Cached until an input property changes; catches in-place edits without rescanning per callback.
  const tool_input_revision = $derived.by(() => {
    if (!(show_host_tool && structure_host_tool.component) && !tool_overlay) return ``
    const input = session.tool_input
    return input && structure_host_tool.input_key
      ? structure_host_tool.input_key(input)
      : JSON.stringify(input)
  })
  const tool_controller = create_structure_tool_controller(
    () => session.tool_input,
    () => (show_host_tool ? structure_host_tool.component : null),
    apply_tool_overlay,
    (view) => {
      tool_view = view
      if (view) tool_source = session.tool_input
    },
    () => tool_input_revision,
  )
  $effect(() => {
    // Subscribe only to ownership/input changes, not the output mutations in cleanup.
    void [
      tool_input_revision,
      session.tool_input,
      show_host_tool,
      structure_host_tool.component,
      structure_host_tool.input_key,
    ]
    untrack(() => {
      tool_controller.invalidate_if_changed()
      clear_stale_prediction()
    })
  })
  // Imported output has no running computation. Clearing it must not abort a newer run.
  function clear_stale_prediction(): void {
    if (
      tool_overlay &&
      (tool_source !== session.tool_input || tool_source_revision !== tool_input_revision)
    )
      apply_tool_overlay(null)
  }
  function start_tool_run(provenance: StructureToolProvenance) {
    clear_stale_prediction()
    return tool_controller.start_run(provenance)
  }
  onDestroy(() => tool_controller.dispose())
  function load_prediction(source: StructureToolPrediction): void {
    const snapshot = copy_prediction(source)
    structure = snapshot.input
    session.element_mapping = undefined
    cell_type = `original`
    supercell_scaling = `1x1x1`
    // Abort listeners may restart synchronously; they must capture the imported input.
    tool_controller.clear()
    tool_overlay_visible = true
    volumetric_data = []
    isosurface_settings = { ...isosurface_settings, layers: [] }
    active_volume_id = undefined
    apply_tool_overlay(snapshot)
  }
  $effect(() => {
    if (prediction) untrack(() => load_prediction(prediction))
  })
  const reset_prediction_surfaces = (): void => {
    isosurface_settings = {
      ...isosurface_settings,
      layers: [
        ...isosurface_settings.layers.filter(
          (layer) => !owned_volume_set.has(layer.volume_id),
        ),
        ...(volumetric_data ?? []).flatMap((volume) =>
          owned_volume_set.has(volume.id) ? [auto_volume_layer(volume)] : [],
        ),
      ],
    }
  }

  // === inputs ===
  // JavaScript callers can bypass the TypeScript union with partial JSON; normalize before the
  // first render and again whenever the prop changes
  atom_color_config = normalize_atom_color_config(atom_color_config)
  $effect.pre(() => {
    const normalized = normalize_atom_color_config(atom_color_config)
    if (normalized !== atom_color_config) atom_color_config = normalized
  })

  // === vectors: auto-populate vector_configs for force/magmom/... site properties ===
  let vector_keys = $derived(
    Array.isArray(structure?.sites)
      ? get_structure_vector_keys(tool_structure ?? structure)
      : [],
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
    const run_id = ++symmetry_run_id
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
    return () => {
      symmetry_run_id++
    }
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
      ? Math.min(scene_props.sphere_segments ?? DEFAULTS.structure.sphere_segments, 12)
      : (scene_props.sphere_segments ?? DEFAULTS.structure.sphere_segments),
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
  let active_scene_sites = $derived([...new Set(session.highlighted_sites)])
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
  const viewport_states: NonNullable<
    ComponentProps<typeof StructureViewport>[`view_state`]
  >[] = []
  const pane_props = (pane_idx: number) => ({
    view_state: (viewport_states[pane_idx] ??= {
      get_pose_key: () =>
        pane_idx === 0 ? JSON.stringify([camera_position, camera_target]) : ``,
    }),
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
      trajectory_position_stream,
      trajectory_line_end_frame,
      defer_expensive_geometry,
      sphere_segments: effective_sphere_segments,
    },
    gizmo: scene_gizmo_props,
    volumetric_data,
    isosurface_settings: display_isosurface_settings,
    property_colors: session.property_colors,
    active_sites: active_scene_sites,
  })

  // Live read-only results: consumers bind:this and read analysis without copying outputs
  // through effects or exposing setters that the next render would overwrite.
  export const analysis = {
    get displayed_structure() {
      return session.displayed_structure
    },
    get wyckoff_positions() {
      return session.wyckoff_rows
    },
    get sym_data() {
      return sym_data
    },
    get displacement_rmsd() {
      return displacement_summary?.rmsd
    },
  }
  // Selection follows a field ID through replacement/reordering and resets only after removal.
  $effect(() => {
    void volume_by_id
    const selected_id = normalize_active_volume_id(active_volume_id, volumetric_data ?? [])
    if (selected_id !== active_volume_id) active_volume_id = selected_id
  })
  // untrack: collapsing reads the moved-pane set, which must not re-run this on camera moves
  $effect(() => {
    if (!is_multi_view_active) untrack(session.collapse_to_primary_pane)
  })

  let camera_position = $derived(scene_props.camera_position)
  let camera_target = $derived(scene_props.camera_target)

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
      if (series_changed) {
        session.clear_moved_panes()
        // Keep an explicit caller pose intact when replacing the structure.
        if (
          scene_props.camera_target !== undefined ||
          scene_props.camera_position !== undefined
        )
          return
        camera_position = undefined
      }
      // In edit-atoms mode structure changes are the user's own edits: keep the orbit target
      if (measure_mode !== `edit-atoms`) camera_target = undefined
    })
  })

  $effect(() => () => {
    toast_store.destroy()
    symmetry_run_id += 1 // a run landing after unmount must not write into dead bindings
  })

  // === keyboard ===
  // Returns true when the key was handled so the caller can suppress the browser default
  function handle_keydown(event: KeyboardEvent): boolean {
    if (active_tool_view) return false
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
  {@attach forward_window_keydown({ handle: handle_hover_keydown })}
>
  {@render children?.({ structure, fullscreen })}
  {#if show_host_tool && structure_host_tool.component && session.tool_input?.sites.length}
    <div style:display={active_tool_view ? `none` : `contents`}>
      <structure_host_tool.component
        structure={session.tool_input}
        prediction={active_prediction}
        overlay_visible={tool_overlay_visible}
        set_overlay_visible={set_tool_overlay_visible}
        start_run={start_tool_run}
      />
    </div>
  {/if}
  {#if active_tool_view}
    <div class="host-view">
      {@render active_tool_view.content({
        scene_props,
        supercell_scaling,
        show_image_atoms,
      })}
    </div>
  {:else}
    {#if tool_volume_notice}<p
        role="status"
        style="position: absolute; bottom: 1rem; left: 1rem; right: 1rem; z-index: 2; background: var(--pane-bg, #222); padding: 0.6rem; border-radius: 0.4rem"
      >
        {tool_volume_notice}
        {#if active_overlay && !session.shows_input_frame}
          <button onclick={() => (cell_type = `original`)}>Use original cell</button>
        {/if}
        {#if active_overlay && session.has_supercell && (volumetric_data ?? []).some((volume) => owned_volume_set.has(volume.id) && !volume.periodic)}
          <button onclick={() => (supercell_scaling = `1x1x1`)}
            >Reset supercell to 1×1×1</button
          >
        {/if}
        <button onclick={tool_controller.clear}>Clear prediction</button>
      </p>{/if}
    {#if (structure?.sites?.length ?? 0) > 0 || (volumetric_data?.length ?? 0) > 0}
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
            displayed_structure={session.render_structure}
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
            prediction={active_prediction ?? undefined}
            on_clear_prediction={tool_controller.clear}
            on_reset_prediction_surfaces={reset_prediction_surfaces}
            bind:export_pane_open={
              () => is_pane_open(`export`), (open) => set_pane_open(`export`, open)
            }
            structure={session.normalized_structure}
            {wrapper}
            {scene}
            {camera}
            image_canvas={display_mode === `slice` ? slice_canvas : undefined}
            image_filename={display_mode === `slice`
              ? `${volume_by_id.get(active_volume_id ?? ``)?.label ?? `volume`}-slice`
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
            bind:show_trajectory_lines={
              () =>
                scene_props.show_trajectory_lines ?? DEFAULTS.structure.show_trajectory_lines,
              (value) => (scene_props.show_trajectory_lines = value)
            }
            {trajectory_position_stream}
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
            bind:active_volume_id
            {display_mode}
            bind:multi_view
            multi_view_control_visible={controls_config.visible(`multi-view`)}
            {multi_view_unavailable_reason}
            structure={tool_structure}
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
          structure={session.render_structure}
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

      <!-- The primary pane binds scene/camera for export and keeps the camera pose local,
      reporting camera changes through on_camera_move/reset. -->
      {#snippet primary_viewport(view: StructureView)}
        <StructureViewport
          {...pane_props(0)}
          {on_camera_move}
          {on_camera_reset}
          {...shared_viewport_props}
          camera_direction={view.direction}
          camera_projection={view.projection ?? scene_props.camera_projection}
          bind:camera_position
          bind:camera_target
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
          volume={hidden_volume_ids.has(active_volume_id ?? ``)
            ? undefined
            : volume_by_id.get(active_volume_id ?? ``)}
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
  .host-view {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
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

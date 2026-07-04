<script lang="ts">
  import type { ColorSchemeName } from '$lib/colors'
  import { ELEMENT_COLOR_SCHEMES } from '$lib/colors'
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import { coerce_elem_symbol, type ElementSymbol } from '$lib/element'
  import { StatusMessage } from '$lib/feedback'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import Icon from '$lib/Icon.svelte'
  import { create_file_drop_handler, drag_over_handlers, load_from_url } from '$lib/io'
  import { forward_window_keydown, handle_and_prevent } from '$lib/keyboard'
  import { parse_volumetric_file } from '$lib/isosurface/parse'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import {
    auto_isosurface_settings,
    DEFAULT_ISOSURFACE_SETTINGS,
    tile_volumetric_data,
  } from '$lib/isosurface/types'
  import { type FullscreenToggleProp, toggle_fullscreen, ViewerChrome } from '$lib/layout'
  import { sync_fullscreen } from '$lib/layout/fullscreen.svelte'
  import type { Vec3 } from '$lib/math'
  import { create_cart_to_frac, create_frac_to_cart } from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import StructureViewport from './StructureViewport.svelte'
  import type {
    AnyStructure,
    BondEditMode,
    BondOrder,
    Crystal,
    MeasureMode,
    StructureBond,
    StructureView,
  } from '$lib/structure'
  import {
    DEFAULT_STRUCTURE_VIEWS,
    default_vector_configs,
    get_element_counts,
    get_pbc_image_sites,
    get_structure_vector_keys,
  } from '$lib/structure'
  import { wrap_to_unit_cell } from '$lib/structure/pbc'
  import {
    is_valid_supercell_input,
    make_supercell,
    parse_supercell_scaling,
  } from '$lib/structure/supercell'
  import type { CellType, SymmetrySettings } from '$lib/symmetry'
  import * as symmetry from '$lib/symmetry'
  import { transform_cell } from '$lib/symmetry'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { click_outside, tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import type { Camera, Scene } from 'three'
  import type { AtomColorConfig } from './atom-properties'
  import { get_property_colors } from './atom-properties'
  import AtomLegend from './AtomLegend.svelte'
  import CellSelect from './CellSelect.svelte'
  import { BOND_ORDER_OPTIONS, merge_bond_edits, remap_bonds_after_deletion } from './bonding'
  import type { StructureHandlerData } from './index'
  import { MAX_SELECTED_SITES } from './measure'
  import { normalize_fractional_coords, parse_any_structure } from './parse'
  import StructureControls from './StructureControls.svelte'
  import StructureExportPane from './StructureExportPane.svelte'
  import StructureInfoPane from './StructureInfoPane.svelte'
  import StructureScene from './StructureScene.svelte'
  import { to_error } from '$lib/utils'

  // Type alias for event handlers to reduce verbosity
  type EventHandler = (data: StructureHandlerData) => void
  type BondEditContext = {
    structure_identity: AnyStructure | undefined
    source_bond_signature: string
    cell_type: CellType
    supercell_scaling: string
    show_image_atoms: boolean
  }
  type BondEditSnapshot = {
    bonds: StructureBond[] | undefined
    context: BondEditContext
  }
  type BondEditHistorySnapshot = {
    added_bonds: StructureBond[]
    removed_bonds: StructureBond[]
    bond_order_overrides: StructureBond[]
    bond_edit_mode: BondEditMode
    bond_edit_order: BondOrder
  }
  type SceneProps = ComponentProps<typeof StructureScene> & typeof DEFAULTS.structure

  // Local reactive state for scene and lattice props. Deeply reactive so nested mutations propagate.
  // Deep-clone to prevent mutations from leaking to global defaults across component instances.
  let scene_props = $state(structuredClone(DEFAULTS.structure) as SceneProps)
  let lattice_props = $state({
    cell_edge_opacity: DEFAULTS.structure.cell_edge_opacity,
    cell_surface_opacity: DEFAULTS.structure.cell_surface_opacity,
    cell_edge_color: DEFAULTS.structure.cell_edge_color,
    cell_surface_color: DEFAULTS.structure.cell_surface_color,
    cell_edge_width: DEFAULTS.structure.cell_edge_width,
    show_cell_vectors: DEFAULTS.structure.show_cell_vectors,
  })

  let {
    structure = $bindable(),
    bonds = $bindable(),
    scene_props: scene_props_in = $bindable(),
    lattice_props: lattice_props_in = $bindable(),
    controls_open = $bindable(false),
    info_pane_open = $bindable(false),
    multi_view = $bindable(false),
    views = DEFAULT_STRUCTURE_VIEWS,
    enable_measure_mode = $bindable(true),
    measure_mode = $bindable<MeasureMode>(`distance`),
    bond_edit_mode = $bindable<BondEditMode>(`add`),
    bond_edit_order = $bindable<BondOrder>(1),
    background_color = $bindable(),
    background_opacity = $bindable(0.1),
    show_controls,
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    width = $bindable(0),
    height = $bindable(0),
    reset_text = `Reset camera (or double-click)`,
    color_scheme = $bindable(`Vesta`),
    atom_color_config = $bindable({
      mode: DEFAULTS.structure.atom_color_mode,
      scale: DEFAULTS.structure.atom_color_scale,
      scale_type: DEFAULTS.structure.atom_color_scale_type,
    }),
    hovered = $bindable(false),
    dragover = $bindable(false),
    allow_file_drop = true,
    enable_info_pane = true,
    png_dpi = $bindable(150),
    show_image_atoms = $bindable(true),
    supercell_scaling = $bindable(`1x1x1`),
    fullscreen_toggle = DEFAULTS.structure.fullscreen_toggle,
    bottom_left,
    data_url,
    structure_string,
    on_file_drop,
    spinner_props = {},
    loading = $bindable(false),
    error_msg = $bindable(),
    performance_mode = $bindable(`quality`),
    // expose selected site indices for external control/highlighting
    selected_sites = $bindable([]),
    highlighted_sites = $bindable([]),
    hovered_site_idx = $bindable(null),
    // expose measured site indices for overlays/labels
    measured_sites = $bindable([]),
    // expose the displayed structure (with image atoms and supercell) for external use
    displayed_structure = $bindable(),
    // Track hidden elements across component lifecycle
    hidden_elements = $bindable(new SvelteSet<ElementSymbol>()),
    // Track hidden property values (e.g. Wyckoff positions, coordination numbers)
    hidden_prop_vals = $bindable(new SvelteSet<number | string>()),
    // Per-element radius overrides (absolute values in Angstroms)
    element_radius_overrides = $bindable<Partial<Record<ElementSymbol, number>>>({}),
    // Per-site radius overrides (absolute values in Angstroms)
    site_radius_overrides = $bindable<SvelteMap<number, number>>(new SvelteMap()),
    // Symmetry analysis data (bindable for external access)
    sym_data = $bindable(null),
    // Symmetry analysis settings (bindable for external control)
    symmetry_settings = $bindable(symmetry.default_sym_settings),
    // Map element symbols to different elements (e.g. {'H': 'Na', 'He': 'Cl'})
    // Useful for LAMMPS files where atom types are mapped to H, He, Li by default
    element_mapping = $bindable(),
    // Cell type: original, conventional, or primitive (requires symmetry analysis)
    cell_type = $bindable(`original`),
    // Volumetric data for isosurface rendering (parsed from CHGCAR or .cube files)
    volumetric_data = $bindable<VolumetricData[]>(),
    // Isosurface rendering settings
    isosurface_settings = $bindable<IsosurfaceSettings>({
      ...DEFAULT_ISOSURFACE_SETTINGS,
    }),
    // Active volume index when multiple volumes are present
    active_volume_idx = $bindable(0),
    children,
    top_right_controls,
    on_file_load,
    on_error,
    on_fullscreen_change,
    on_camera_move,
    on_camera_reset,
    on_bonds_change,
    ...rest
  }:
    & {
      structure?: AnyStructure
      bonds?: StructureBond[]
      scene_props?: ComponentProps<typeof StructureScene>
      // Controls visibility configuration.
      // - 'always': controls always visible
      // - 'hover': controls visible on component hover (default)
      // - 'never': controls never visible
      // - object: { mode, hidden, style } for fine-grained control
      //
      // Control names: 'reset-camera', 'fullscreen', 'measure-mode', 'info-pane', 'export-pane', 'controls'
      show_controls?: ShowControlsProp
      fullscreen?: boolean
      // bindable width of the canvas
      width?: number
      // bindable height of the canvas
      height?: number
      // Canvas wrapper element (for export pane)
      wrapper?: HTMLDivElement
      // PNG export DPI setting
      png_dpi?: number
      reset_text?: string
      hovered?: boolean
      dragover?: boolean
      allow_file_drop?: boolean
      enable_info_pane?: boolean
      enable_measure_mode?: boolean
      measure_mode?: MeasureMode
      bond_edit_mode?: BondEditMode
      bond_edit_order?: BondOrder
      info_pane_open?: boolean
      // When true, split the canvas into a 2x2 grid showing the structure from
      // different angles (Ovito-style). Each pane has independent orbit controls.
      multi_view?: boolean
      // The 4 (or more) view definitions used by multi_view. Defaults to an
      // Ovito-like set: one perspective + three orthographic axis views.
      views?: StructureView[]
      fullscreen_toggle?: FullscreenToggleProp
      bottom_left?: Snippet<[{ structure?: AnyStructure }]>
      top_right_controls?: Snippet // Additional controls to render at the end of the control buttons row
      data_url?: string // URL to load structure from (alternative to providing structure directly)
      // Generic callback for when files are dropped - receives raw content and filename
      on_file_drop?: (content: string | ArrayBuffer, filename: string) => void
      // spinner props (passed to Spinner component)
      spinner_props?: ComponentProps<typeof Spinner>
      loading?: boolean
      error_msg?: string
      // Performance mode: 'quality' (default) or 'speed' for large structures
      performance_mode?: `quality` | `speed`
      // allow parent components to control highlighted/selected site indices
      selected_sites?: number[]
      highlighted_sites?: number[]
      hovered_site_idx?: number | null
      // explicit measured sites for distance/angle overlays
      measured_sites?: number[]
      // expose the displayed structure (with image atoms and/or supercell) for external use
      displayed_structure?: AnyStructure
      // Track which elements are hidden (bindable across frames in trajectories)
      hidden_elements?: Set<ElementSymbol>
      // Track which property values are hidden (e.g. Wyckoff positions, coordination numbers)
      hidden_prop_vals?: Set<number | string>
      // Per-element radius overrides (absolute values in Angstroms)
      element_radius_overrides?: Partial<Record<ElementSymbol, number>>
      // Per-site radius overrides (absolute values in Angstroms)
      // Accepts Map or SvelteMap for flexibility with external callers
      site_radius_overrides?: Map<number, number> | SvelteMap<number, number>
      // Symmetry analysis data (bindable for external access)
      sym_data?: MoyoDataset | null
      // Symmetry analysis settings (bindable for external control)
      symmetry_settings?: Partial<SymmetrySettings>
      // Map element symbols to different elements (e.g. {'H': 'Na', 'He': 'Cl'})
      element_mapping?: Partial<Record<ElementSymbol, ElementSymbol>>
      // Cell type: original, conventional, or primitive (requires symmetry analysis)
      cell_type?: CellType
      // Volumetric data for isosurface rendering (parsed from CHGCAR or .cube files)
      volumetric_data?: VolumetricData[]
      // Isosurface rendering settings
      isosurface_settings?: IsosurfaceSettings
      // Active volume index when multiple volumes are present
      active_volume_idx?: number
      // structure content as string (alternative to providing structure directly or via data_url)
      structure_string?: string
      // Atom coloring configuration
      atom_color_config?: Partial<AtomColorConfig>
      children?: Snippet<[{ structure?: AnyStructure; fullscreen: boolean }]>
      on_file_load?: EventHandler
      on_error?: EventHandler
      on_fullscreen_change?: EventHandler
      on_camera_move?: EventHandler
      on_camera_reset?: EventHandler
      on_bonds_change?: (bonds: StructureBond[] | undefined) => void
    }
    & Omit<ComponentProps<typeof StructureControls>, `children` | `onclose`>
    & Omit<HTMLAttributes<HTMLDivElement>, `children`> = $props()

  // Initialize models from incoming props; mutations come from UI controls; we mirror into local dicts (NOTE only doing shallow merge)
  $effect.pre(() => {
    if (scene_props_in && typeof scene_props_in === `object`) {
      Object.assign(scene_props, scene_props_in)
    }
    if (lattice_props_in && typeof lattice_props_in === `object`) {
      Object.assign(lattice_props, lattice_props_in)
    }
  })

  // Load structure from URL when data_url is provided. A monotonic load_id ignores stale
  // completions so a newer data_url (or an externally-supplied structure, via the cleanup)
  // can't be clobbered by a slow earlier fetch.
  let data_url_load_id = 0
  $effect(() => {
    if (!data_url || structure) return
    const load_id = ++data_url_load_id
    const is_current = () => load_id === data_url_load_id
    loading = true
    error_msg = undefined

    load_from_url(data_url, (content, filename) => {
      if (!is_current()) return // stale response
      if (on_file_drop) on_file_drop(content, filename)
      else {
        // Parse structure internally when no handler provided
        try {
          const text_content = content instanceof ArrayBuffer
            ? new TextDecoder().decode(content)
            : content
          const parsed = parse_file_content(text_content, filename)
          emit_file_load_event(parsed, filename, content)
        } catch (error) {
          error_msg = `Failed to parse structure: ${to_error(error).message}`
          on_error?.({ error_msg, filename })
        }
      }
    })
      .catch((error: Error) => {
        if (!is_current()) return
        console.error(`Failed to load structure from URL:`, error)
        error_msg = `Failed to load structure: ${error.message}`
        on_error?.({ error_msg, filename: data_url })
      })
      .finally(() => {
        if (is_current()) loading = false
      })

    return () => { // invalidate in-flight load on data_url change / structure arrival / unmount
      if (is_current()) {
        data_url_load_id += 1
        loading = false
      }
    }
  })

  $effect(() => { // Parse structure from string when structure_string is provided
    if (!structure_string || data_url) return
    loading = true
    error_msg = undefined
    clear_camera_state()
    try {
      const parsed = parse_any_structure(structure_string, `string`)
      if (parsed) {
        structure = parsed
        untrack(() => emit_file_load_event(parsed, `string`, structure_string))
      } else {
        throw new Error(`Failed to parse structure from string`)
      }
    } catch (err) {
      error_msg = `Failed to parse structure from string: ${
        to_error(err).message
      }`
      untrack(() => on_error?.({ error_msg, filename: `string` }))
    } finally {
      loading = false
    }
  })

  // Auto-populate vector_configs when structure has vector data (force, magmom, spin, etc.)
  // Skip if configs were externally provided. Clear auto-generated configs on structure change.
  let vectors_auto_populated_for: AnyStructure | undefined = undefined
  let last_auto_configs: Record<string, unknown> | undefined = undefined

  $effect(() => {
    if (!structure?.sites || structure === vectors_auto_populated_for) return
    const keys = get_structure_vector_keys(structure)
    // Clear auto-generated configs from previous structure; preserve externally-modified ones
    const existing = scene_props.vector_configs
    if (last_auto_configs && existing === last_auto_configs) {
      scene_props.vector_configs = {}
      last_auto_configs = undefined
    } else if (existing && Object.keys(existing).length > 0) {
      vectors_auto_populated_for = structure
      return
    }
    vectors_auto_populated_for = structure
    if (keys.length === 0) return
    const configs = default_vector_configs(keys)
    scene_props.vector_configs = configs
    // Read back the proxied reference — Svelte 5 $state wraps objects in
    // proxies, so `scene_props.vector_configs !== configs`. Storing the proxy
    // lets the identity check above detect unmodified auto-configs.
    // See https://svelte.dev/e/state_proxy_equality_mismatch
    last_auto_configs = scene_props.vector_configs
    scene_props.vector_scale ??= DEFAULTS.structure.vector_scale
    scene_props.vector_color ??= DEFAULTS.structure.vector_color
  })

  // Optimize scene props for performance based on structure size and mode
  $effect(() => {
    if (structure?.sites && performance_mode === `speed`) {
      const site_count = structure.sites.length
      const current_sphere_segments = scene_props.sphere_segments || 20

      // Reduce sphere segments for large structures in speed mode
      if (site_count > 200) {
        scene_props.sphere_segments = Math.min(current_sphere_segments, 12)
      }
    }
  })

  $effect(() => {
    colors.element = ELEMENT_COLOR_SCHEMES[color_scheme as ColorSchemeName]
  })

  // Compute property-based colors for legend display
  let property_colors = $derived(
    get_property_colors(
      structure,
      atom_color_config,
      scene_props.bonding_strategy,
      sym_data,
    ),
  )

  let symmetry_run_id = 0
  let symmetry_error = $state<string>()
  let last_symmetry_structure_ref: AnyStructure | null = null

  // Trigger symmetry analysis when structure is loaded or settings change.
  // Skip during atom drags — symmetry doesn't change from moving atoms,
  // and WASM analysis on every drag frame causes severe frame drops.
  $effect(() => {
    if (dragging_atoms) return
    if (!structure || !(`lattice` in structure)) {
      untrack(() => {
        sym_data = null
        symmetry_error = undefined
      })
      last_symmetry_structure_ref = null
      return
    }

    const current_structure = structure
    const structure_changed = current_structure !== last_symmetry_structure_ref
    if (structure_changed) {
      untrack(() => {
        sym_data = null
        symmetry_error = undefined
      })
      last_symmetry_structure_ref = current_structure
    } else {
      // Keep previous symmetry data while recomputing so bound consumers
      // (e.g. SymmetryStats inputs) do not unmount and lose focus.
      untrack(() => symmetry_error = undefined)
    }
    const run_id = ++symmetry_run_id
    // Destructure symmetry_settings to ensure Svelte tracks changes to symprec and algo
    // (reading just the object reference isn't sufficient for fine-grained reactivity)
    const { symprec, algo } = symmetry_settings ?? symmetry.default_sym_settings
    const current_settings = { symprec, algo }
    // Skip symmetry auto-analysis in unit tests; happy-dom can't fetch WASM assets
    if (typeof process !== `undefined` && process.env?.VITEST) return

    symmetry.ensure_moyo_wasm_ready()
      .then(() =>
        run_id === symmetry_run_id
          ? symmetry.analyze_structure_symmetry(current_structure, current_settings)
          : null
      )
      .then((data) => {
        if (data && run_id === symmetry_run_id) {
          untrack(() => sym_data = data)
        }
      })
      .catch((err) => {
        if (run_id === symmetry_run_id) {
          untrack(() => sym_data = null)
          symmetry_error = `Symmetry analysis failed: ${err?.message || err}`
          console.error(`Symmetry analysis failed:`, err)
        }
      })
  })

  let measure_menu_open = $state(false)
  let export_pane_open = $state(false)
  let focused = $state(false)

  // Bond customization state
  let added_bonds = $state<StructureBond[]>([])
  let removed_bonds = $state<StructureBond[]>([])
  let bond_order_overrides = $state<StructureBond[]>([])
  let bond_undo_stack = $state<BondEditHistorySnapshot[]>([])
  let bond_redo_stack = $state<BondEditHistorySnapshot[]>([])
  // These hold object-identity tokens (structure_identity) compared with ===/!==,
  // so they must stay raw — proxying them via $state would break identity comparisons
  // (state_proxy_equality_mismatch) against the raw `structure` prop.
  let bond_history_context = $state.raw<BondEditContext>()
  let last_bond_structure_identity = $state.raw(structure)
  let last_emitted_bond_signature = $state<string>()
  let bond_edit_snapshot = $state.raw<BondEditSnapshot>()
  let has_bond_edits = $derived(
    added_bonds.length > 0 || removed_bonds.length > 0 ||
      bond_order_overrides.length > 0,
  )

  const clone_bonds = (edit_bonds: StructureBond[]): StructureBond[] =>
    edit_bonds.map((bond) => ({
      ...bond,
      cell_shift: bond.cell_shift && ([...bond.cell_shift] as Vec3),
    }))

  const snapshot_bond_edits = (): BondEditHistorySnapshot => ({
    added_bonds: clone_bonds(added_bonds),
    removed_bonds: clone_bonds(removed_bonds),
    bond_order_overrides: clone_bonds(bond_order_overrides),
    bond_edit_mode,
    bond_edit_order,
  })

  function restore_bond_edit_snapshot(snapshot: BondEditHistorySnapshot) {
    added_bonds = clone_bonds(snapshot.added_bonds)
    removed_bonds = clone_bonds(snapshot.removed_bonds)
    bond_order_overrides = clone_bonds(snapshot.bond_order_overrides)
    bond_edit_mode = snapshot.bond_edit_mode
    bond_edit_order = snapshot.bond_edit_order
    clear_selection()
  }

  function clear_bond_history() {
    bond_undo_stack = []
    bond_redo_stack = []
    bond_history_context = undefined
  }

  function push_bond_undo() {
    if (bond_undo_stack.length >= MAX_HISTORY) {
      bond_undo_stack.splice(0, bond_undo_stack.length - MAX_HISTORY + 1)
    }
    bond_history_context ??= current_bond_edit_context()
    bond_undo_stack.push(snapshot_bond_edits())
    bond_redo_stack = []
  }

  function undo_bond_edit() {
    if (bond_undo_stack.length === 0) return
    const restored = bond_undo_stack.pop()
    if (!restored) return
    bond_redo_stack.push(snapshot_bond_edits())
    restore_bond_edit_snapshot(restored)
  }

  function redo_bond_edit() {
    if (bond_redo_stack.length === 0) return
    const restored = bond_redo_stack.pop()
    if (!restored) return
    bond_undo_stack.push(snapshot_bond_edits())
    restore_bond_edit_snapshot(restored)
  }

  function clear_bond_edits() {
    added_bonds = []
    removed_bonds = []
    bond_order_overrides = []
    clear_bond_history()
  }

  function emit_bonds(next_bonds: StructureBond[] | undefined) {
    const signature = bond_signature(next_bonds)
    if (signature === last_emitted_bond_signature) return
    last_emitted_bond_signature = signature
    bonds = next_bonds
    on_bonds_change?.(next_bonds)
  }

  const bond_signature = (edit_bonds: StructureBond[] | undefined): string =>
    edit_bonds === undefined ? `undefined` : JSON.stringify(edit_bonds)

  const current_source_bonds = (): StructureBond[] | undefined =>
    bonds ?? structure?.properties?.bonds

  const current_source_bond_signature = (): string => {
    const raw_signature = bond_signature(current_source_bonds())
    if (raw_signature !== last_emitted_bond_signature) return raw_signature
    return bond_history_context?.source_bond_signature ??
      (bond_edit_snapshot
        ? bond_signature(bond_edit_snapshot.bonds)
        : raw_signature)
  }

  const current_bond_edit_context = (): BondEditContext => ({
    structure_identity: structure,
    source_bond_signature: current_source_bond_signature(),
    cell_type,
    supercell_scaling,
    show_image_atoms,
  })

  const bond_edit_context_changed = (
    previous: BondEditContext,
    current: BondEditContext,
  ): boolean =>
    previous.structure_identity !== current.structure_identity ||
    previous.source_bond_signature !== current.source_bond_signature ||
    previous.cell_type !== current.cell_type ||
    previous.supercell_scaling !== current.supercell_scaling ||
    previous.show_image_atoms !== current.show_image_atoms

  const resolve_bond_edit_reset_bonds = (
    snapshot: BondEditSnapshot,
  ): StructureBond[] | undefined =>
    snapshot.context.structure_identity === structure
      ? snapshot.bonds
      : structure?.properties?.bonds

  $effect(() => {
    const next_structure_identity = structure
    untrack(() => {
      if (
        last_bond_structure_identity !== next_structure_identity &&
        bond_signature(bonds) === last_emitted_bond_signature
      ) {
        emit_bonds(structure?.properties?.bonds)
      }
      last_bond_structure_identity = next_structure_identity
    })
  })

  $effect(() => {
    const history_context = bond_history_context
    if (history_context === undefined) return
    if (bond_edit_context_changed(history_context, current_bond_edit_context())) {
      untrack(clear_bond_history)
    }
  })

  $effect(() => {
    const snapshot = bond_edit_snapshot
    if (snapshot === undefined) return
    const context = current_bond_edit_context()
    if (!bond_edit_context_changed(snapshot.context, context)) return
    untrack(() => {
      emit_bonds(resolve_bond_edit_reset_bonds(snapshot))
      clear_bond_edits()
      bond_edit_snapshot = undefined
    })
  })

  $effect(() => {
    if (!has_bond_edits) {
      if (bond_edit_snapshot === undefined) return
      emit_bonds(resolve_bond_edit_reset_bonds(bond_edit_snapshot))
      bond_edit_snapshot = undefined
      return
    }
    bond_edit_snapshot ??= {
      bonds: current_source_bonds(),
      context: current_bond_edit_context(),
    }
    const edited_bonds = merge_bond_edits(
      bond_edit_snapshot.bonds ?? [],
      added_bonds,
      removed_bonds,
      bond_order_overrides,
    )
    emit_bonds(edited_bonds)
  })

  // Elements currently anchoring polyhedra (written by StructureScene, read by
  // StructureControls so per-element toggles reflect actual render state)
  let polyhedra_rendered_elements = $state<string[]>([])

  // === Edit-atoms mode state ===
  let dragging_atoms = $state(false)
  let undo_stack = $state<AnyStructure[]>([])
  let redo_stack = $state<AnyStructure[]>([])
  const MAX_HISTORY = 20
  // Flag set before internal edits (undo/redo/delete/add/move) to distinguish
  // them from external structure changes (file load, trajectory step, etc.)
  let is_internal_edit = false
  // Add-atom sub-mode state (bound to StructureScene)
  let add_atom_mode = $state(false)
  let add_element = $state<ElementSymbol>(`C` as ElementSymbol)
  let is_measure_selection_mode = $derived(
    measure_mode === `distance` || measure_mode === `angle`,
  )
  let show_measure_selection_limit = $derived(
    is_measure_selection_mode && measured_sites.length >= MAX_SELECTED_SITES,
  )
  let show_selection_reset = $derived(
    has_bond_edits ||
      (is_measure_selection_mode && measured_sites.length > 0) ||
      (measure_mode === `edit-atoms` && selected_sites.length > 0),
  )
  let atom_legend_selected_sites = $derived(
    measure_mode === `edit-atoms` ? selected_sites : [],
  )
  let change_element_mode = $state(false)
  let change_element_value = $state(``)
  // Ephemeral toast message for edit operations
  let toast_msg = $state<string | null>(null)
  let toast_timer: ReturnType<typeof setTimeout> | undefined
  function show_toast(msg: string, duration_ms = 2000) {
    clearTimeout(toast_timer)
    toast_msg = msg
    toast_timer = setTimeout(() => (toast_msg = null), duration_ms)
  }

  // Normalize and validate element symbol (e.g. "fe" → "Fe", "Xx" → null)
  function normalize_element(input: string): ElementSymbol | null {
    const normalized = input.charAt(0).toUpperCase() + input.slice(1).toLowerCase()
    return coerce_elem_symbol(normalized) ?? null
  }

  function clear_selection() {
    selected_sites = []
    measured_sites = []
    dragging_atoms = false
  }

  function push_undo() {
    if (!structure) return
    if (undo_stack.length >= MAX_HISTORY) {
      undo_stack.splice(0, undo_stack.length - MAX_HISTORY + 1)
    }
    undo_stack.push($state.snapshot(structure) as AnyStructure)
    redo_stack.length = 0
  }

  // Shared undo/redo: pop from `source`, push current state onto `target`
  function apply_history(source: AnyStructure[], target: AnyStructure[]) {
    if (source.length === 0 || !structure) return
    const restored = source.pop()
    if (!restored) return
    is_internal_edit = true
    target.push($state.snapshot(structure) as AnyStructure)
    structure = restored
    clear_selection()
  }

  const undo = () => apply_history(undo_stack, redo_stack)
  const redo = () => apply_history(redo_stack, undo_stack)

  // Clear undo/redo stacks when structure changes externally (file load, etc.)
  // Internal edits set is_internal_edit=true before modifying structure.
  // This $effect runs after microtask, so the flag is still set from the edit.
  $effect(() => {
    // Track structure to re-run when it changes
    void structure
    if (is_internal_edit) {
      is_internal_edit = false
      return
    }
    // External change — clear history and stale edit-atoms state
    untrack(() => {
      if (undo_stack.length > 0 || redo_stack.length > 0) {
        undo_stack = []
        redo_stack = []
      }
      if (highlighted_sites.length > 0) highlighted_sites = []
      if (measure_mode === `edit-atoms`) {
        if (selected_sites.length > 0 || measured_sites.length > 0) clear_selection()
        if (site_radius_overrides?.size > 0) site_radius_overrides.clear()
      }
    })
  })

  // Clear selection when switching measure/edit mode so stale state doesn't carry over
  let mode_first_run = true
  $effect(() => {
    void measure_mode // track reactively
    if (mode_first_run) {
      mode_first_run = false
      return
    }
    untrack(() => {
      if (selected_sites.length > 0 || measured_sites.length > 0) clear_selection()
      if (measure_mode === `edit-bonds`) bond_edit_mode = `add`
    })
  })

  $effect(() => {
    void bond_edit_mode
    untrack(() => {
      if (measure_mode === `edit-bonds` && (selected_sites.length > 0 || measured_sites.length > 0)) {
        clear_selection()
      }
    })
  })

  // Auto-bake cell type transform and clear stale state when entering edit-atoms mode
  $effect(() => {
    if (measure_mode !== `edit-atoms`) return
    untrack(() => {
      // Clear bond edits from edit-bonds mode to avoid stale state
      if (has_bond_edits) clear_bond_edits()
      else clear_bond_history()
      if (cell_type !== `original` && cell_transformed_structure && structure) {
        // Bake the transformed cell: push original to undo, replace structure
        is_internal_edit = true
        push_undo()
        structure = $state.snapshot(cell_transformed_structure) as AnyStructure
        cell_type = `original`
      }
    })
  })

  let controls_config = $derived(normalize_show_controls(show_controls))
  // $effect instead of `$derived(hovered || focused)`: the $derived reading the $bindable
  // `hovered` prop went stale after the first hover/leave cycle, so the gizmo + mode toggle only
  // appeared on the first mouseenter until reload.
  let viewer_active = $state(false)
  $effect(() => {
    viewer_active = hovered || focused
  })
  let scene_gizmo = $derived(viewer_active && (scene_props.gizmo ?? scene_props.show_gizmo))
  let active_scene_sites = $derived([
    ...new SvelteSet([...(scene_props.active_sites ?? []), ...highlighted_sites]),
  ])

  // Normalize structure coordinates: wrap fractional coords to [0,1) and recompute Cartesian
  // This ensures atoms are rendered inside the unit cell regardless of data source
  let normalized_structure = $derived.by(() => {
    if (!structure || !(`lattice` in structure)) return structure
    return normalize_fractional_coords(structure) as AnyStructure
  })

  let structure_with_bonds = $derived.by(() => {
    if (!normalized_structure || bonds === undefined) return normalized_structure
    return {
      ...normalized_structure,
      properties: { ...normalized_structure.properties, bonds },
    } as AnyStructure
  })

  // Apply cell type transformation (original, conventional, or primitive)
  // This must happen BEFORE supercell transformation
  let cell_transformed_structure = $derived.by(() => {
    if (
      !structure_with_bonds || !(`lattice` in structure_with_bonds) ||
      cell_type === `original`
    ) {
      return structure_with_bonds
    }
    // Cell type transformation requires symmetry data
    if (!sym_data) {
      return structure_with_bonds
    }
    try {
      return transform_cell(structure_with_bonds as Crystal, cell_type, sym_data)
    } catch (error) {
      console.error(`Failed to transform cell to ${cell_type}:`, error)
      return structure_with_bonds
    }
  })

  // Create supercell if needed (uses cell_transformed_structure as base)
  let supercell_structure = $state(structure)
  let supercell_loading = $state(false)
  let has_supercell = $derived(
    Boolean(supercell_scaling) && ![``, `1x1x1`, `1`].includes(supercell_scaling),
  )
  let bond_edits_enabled = $derived(
    cell_type === `original` && !has_supercell && !supercell_loading,
  )

  $effect(() => {
    if (measure_mode !== `edit-bonds` || bond_edits_enabled) return
    untrack(() => {
      clear_selection()
      clear_bond_edits()
      measure_mode = `distance`
      show_toast(`Bond editing is only available for the original 1x1x1 cell`)
    })
  })

  // Tile volumetric data to match supercell when active.
  // Gate on !supercell_loading so the tiled volume and supercell structure update
  // in the same frame (large supercells defer structure via setTimeout).
  let supercell_volume = $derived.by(() => {
    const vol = volumetric_data?.[active_volume_idx]
    if (!vol || !has_supercell || supercell_loading) return vol
    try {
      return tile_volumetric_data(vol, parse_supercell_scaling(supercell_scaling))
    } catch {
      return vol
    }
  })

  let supercell_timeout: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const base_structure = cell_transformed_structure
    clearTimeout(supercell_timeout)
    if (!base_structure || !(`lattice` in base_structure) || !has_supercell) {
      supercell_structure = base_structure
      supercell_loading = false
    } else if (!is_valid_supercell_input(supercell_scaling)) {
      supercell_structure = base_structure
      supercell_loading = false
    } else {
      // For large supercells, show loading state and use async generation
      const sites_count = base_structure.sites?.length || 0
      const [nx_str, ny_str, nz_str] = supercell_scaling.split(/[x×]/)
      const scaling_mult = (parseInt(nx_str, 10) || 1) * (parseInt(ny_str, 10) || 1) *
        (parseInt(nz_str, 10) || 1)
      const estimated_sites = sites_count * scaling_mult

      // Show spinner for supercells with >1000 estimated sites or scaling >8
      const show_loading = estimated_sites > 1000 || scaling_mult > 8

      if (show_loading) {
        supercell_loading = true
        // Use setTimeout to allow UI to update before heavy computation
        supercell_timeout = setTimeout(() => {
          try {
            if (base_structure && `lattice` in base_structure) {
              supercell_structure = make_supercell(
                base_structure as Crystal,
                supercell_scaling,
              )
            }
          } catch (error) {
            console.error(`Failed to create supercell:`, error)
            supercell_structure = base_structure
          } finally {
            supercell_loading = false
          }
        }, 10)
      } else {
        if (base_structure && `lattice` in base_structure) {
          supercell_structure = make_supercell(
            base_structure as Crystal,
            supercell_scaling,
          )
        }
        supercell_loading = false
      }
    }
  })

  // Clear selections, site overrides, and stale camera target when transformations
  // change site indices (skip first run to preserve parent-provided selections)
  let first_run = true
  $effect(() => {
    void [supercell_scaling, show_image_atoms, structure, cell_type] // track reactively
    if (first_run) {
      first_run = false
      return
    }
    untrack(() => {
      // In edit-atoms mode, structure changes are intentional user edits
      // (move/add/delete) — preserve the selection so TransformControls stays active
      if (measure_mode === `edit-atoms`) return
      if (selected_sites.length > 0 || measured_sites.length > 0) clear_selection()
      // Clear site radius overrides since site indices are no longer valid
      if (site_radius_overrides?.size > 0) site_radius_overrides.clear()
      // Clear stale camera target so orbit controls re-center on the new cell
      scene_props.camera_target = undefined
    })
  })

  // Element-map + PBC image atoms. Skipped during drags (doubled site count drops frames);
  // images return on release.
  $effect(() => {
    let struct = supercell_structure
    if (struct && element_mapping && Object.keys(element_mapping).length > 0) {
      const mapping = element_mapping // capture for TypeScript narrowing
      struct = {
        ...struct,
        sites: struct.sites.map((site) => ({
          ...site,
          species: site.species.map((sp) => ({
            ...sp,
            element: mapping[sp.element as ElementSymbol] ?? sp.element,
          })),
          label: mapping[site.label as ElementSymbol] ?? site.label,
        })),
      }
    }
    displayed_structure =
      !dragging_atoms && show_image_atoms && struct && `lattice` in struct &&
        struct.lattice
        ? get_pbc_image_sites(struct)
        : struct
  })

  // scene + camera of the primary pane, bound out for the export pane. All other camera
  // handling (move tracking, reset, re-framing) lives in StructureViewport.
  let scene = $state<Scene | undefined>(undefined)
  let camera = $state<Camera | undefined>(undefined)

  // Multi-side view state: index of the pane the pointer is over (gets edit interactions),
  // a token bumped to reset every pane, and the set of panes whose camera has moved (so
  // the reset button stays visible until every moved pane is reset). Pane 0 = primary.
  let active_pane_idx = $state(0)
  let reset_token = $state(0)
  // SvelteSet is already reactive; do NOT wrap in $state (double-proxying breaks it)
  const moved_panes = new SvelteSet<number>()
  let any_camera_moved = $derived(moved_panes.size > 0)

  // Inputs shared by every StructureViewport (single + all multi-view panes). Camera,
  // selection bindings, and per-pane chrome differ and stay on each snippet below.
  let shared_viewport_props = $derived({
    structure: displayed_structure,
    base_structure: cell_transformed_structure,
    scene_props,
    gizmo: scene_gizmo,
    lattice_props,
    volumetric_data: supercell_volume,
    isosurface_settings,
    bond_edits_enabled,
    bond_edit_order,
    measure_mode,
    atom_color_config,
    sym_data,
    active_sites: active_scene_sites,
    on_sites_moved: handle_sites_moved,
    on_operation_start: push_undo,
    on_bond_edit_start: push_bond_undo,
    on_add_atom: handle_add_atom,
  })

  // Mutual exclusion: opening one pane closes others
  $effect(() => {
    if (info_pane_open) {
      untrack(() => [controls_open, export_pane_open] = [false, false])
    }
  })
  $effect(() => {
    if (controls_open) {
      untrack(() => [info_pane_open, export_pane_open] = [false, false])
    }
  })
  $effect(() => {
    if (export_pane_open) {
      untrack(() => [info_pane_open, controls_open] = [false, false])
    }
  })

  // Reset moved-pane tracking when structure changes
  $effect(() => {
    // untrack: clearing must not add moved_panes as a dependency, else a pane move
    // (which adds to moved_panes) would immediately re-run this and clear it again.
    if (structure) untrack(() => moved_panes.clear())
  })

  // Clear stale camera target and position so StructureScene uses the new
  // structure's rotation_target (unit cell center) and auto-positions the camera.
  function clear_camera_state() {
    // Reset to a fresh [0,0,0] so the primary viewport re-frames the new structure.
    // Side panes reset their local camera state in StructureViewport's structure effect.
    scene_props.camera_target = undefined
    scene_props.camera_position = [0, 0, 0]
  }

  // Reset every pane's camera (each StructureViewport resets on a reset_token bump and,
  // for the primary, emits on_camera_reset).
  function reset_all_cameras() {
    reset_token += 1
    moved_panes.clear()
  }

  const emit_file_load_event = (
    loaded_structure: AnyStructure,
    filename: string,
    content: string | ArrayBuffer,
  ) =>
    on_file_load?.({
      structure: loaded_structure,
      filename,
      file_size: typeof content === `string`
        ? new Blob([content]).size
        : content.byteLength,
      total_atoms: loaded_structure.sites?.length || 0,
    })

  // Try to parse content as a volumetric file, setting both structure and volumetric data.
  // Delegates format detection entirely to parse_volumetric_file (filename + content sniffing).
  // Returns the parsed structure on success, or null if the file isn't a volumetric format.
  function try_parse_volumetric(
    text_content: string,
    filename: string,
  ): AnyStructure | null {
    const vol_result = parse_volumetric_file(text_content, filename)
    if (!vol_result) return null
    // parse_volumetric_file extracts structure from file header;
    // parsers set pbc so the lattice conforms to Crystal's LatticeType
    structure = vol_result.structure as AnyStructure
    volumetric_data = vol_result.volumes
    // Auto-compute reasonable isosurface settings from data range
    const vol = vol_result.volumes[0]
    if (vol) {
      isosurface_settings = auto_isosurface_settings(vol.data_range)
      active_volume_idx = 0
    }
    return structure
  }

  // Parse file content, trying volumetric format first then falling back to plain structure.
  // Returns the parsed structure on success, throws on failure.
  function parse_file_content(text_content: string, filename: string): AnyStructure {
    clear_camera_state()
    const vol_struct = try_parse_volumetric(text_content, filename)
    if (vol_struct) return vol_struct
    // Clear stale volumetric data when loading a non-volumetric file
    volumetric_data = []
    const parsed = parse_any_structure(text_content, filename)
    if (!parsed) throw new Error(`Failed to parse structure from ${filename}`)
    structure = parsed
    return parsed
  }

  const handle_file_drop = create_file_drop_handler({
    allow: () => allow_file_drop,
    on_drop: (content, filename) => {
      if (on_file_drop) return on_file_drop(content, filename)
      try {
        const text_content = content instanceof ArrayBuffer
          ? new TextDecoder().decode(content)
          : content
        const parsed = parse_file_content(text_content, filename)
        emit_file_load_event(parsed, filename, content)
      } catch (err) {
        error_msg = `Failed to parse structure: ${
          to_error(err).message
        }`
        on_error?.({ error_msg, filename })
      }
    },
    on_error: (msg) => {
      error_msg = msg
      on_error?.({ error_msg: msg })
    },
    set_loading: (val) => {
      loading = val
      if (val) [error_msg, dragover] = [undefined, false]
    },
  })

  // Handle keyboard shortcuts. Returns true if the key was handled, so the caller
  // (handle_and_prevent / forward_window_keydown) can suppress the browser default.
  function handle_keydown(event: KeyboardEvent): boolean {
    // Don't handle shortcuts if user is typing in an input field
    const target = event.target
    const is_input_focused =
      target instanceof HTMLElement &&
      (target.tagName === `INPUT` ||
        target.tagName === `TEXTAREA` ||
        target.tagName === `SELECT` ||
        target.isContentEditable)

    // Allow Escape to cancel add-atom mode even when the element input is focused
    if (event.key === `Escape` && measure_mode === `edit-atoms` && add_atom_mode) {
      add_atom_mode = false
      return true
    }

    if (is_input_focused) return false

    if (measure_mode === `edit-bonds`) {
      const key = event.key.toLowerCase()
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey
      if (event.ctrlKey || event.metaKey) {
        if (key === `z` && !event.shiftKey) {
          if (bond_undo_stack.length === 0) return false
          undo_bond_edit()
          show_toast(`Undo bond edit (${bond_undo_stack.length} left)`)
          return true
        } else if (key === `y` || (key === `z` && event.shiftKey)) {
          if (bond_redo_stack.length === 0) return false
          redo_bond_edit()
          show_toast(`Redo bond edit (${bond_redo_stack.length} left)`)
          return true
        }
      }
      if (key === `a` && plain) {
        bond_edit_mode = `add`
        return true
      }
      if (key === `d` && plain) {
        bond_edit_mode = `delete`
        return true
      }
      if (event.key === `Escape` && selected_sites.length > 0) {
        clear_selection()
        return true
      }
    }

    // Edit-atoms mode shortcuts (including undo/redo)
    if (measure_mode === `edit-atoms`) {
      // Undo/redo shortcuts (Ctrl/Cmd + Z/Y) — only active in edit-atoms mode
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase()
        if (key === `z` && !event.shiftKey) {
          if (undo_stack.length === 0) return false
          undo()
          show_toast(`Undo (${undo_stack.length} left)`)
          return true
        } else if (key === `y` || (key === `z` && event.shiftKey)) {
          if (redo_stack.length === 0) return false
          redo()
          show_toast(`Redo (${redo_stack.length} left)`)
          return true
        }
      }

      if (event.key === `Delete` || event.key === `Backspace`) {
        // Delete selected atoms
        if (selected_sites.length > 0 && structure?.sites) {
          is_internal_edit = true
          push_undo()
          const to_delete = scene_to_structure_indices(selected_sites, true)
          const n_deleted = to_delete.size
          clear_selection()
          // Remap explicit bond metadata so surviving bonds track shifted site indices.
          // structure_with_bonds prefers the bindable `bonds` prop, so remap that too.
          if (bonds !== undefined) bonds = remap_bonds_after_deletion(bonds, to_delete)
          const old_bonds = structure.properties?.bonds
          structure = {
            ...structure,
            sites: structure.sites.filter((_, idx) => !to_delete.has(idx)),
            ...(old_bonds && {
              properties: {
                ...structure.properties,
                bonds: remap_bonds_after_deletion(old_bonds, to_delete),
              },
            }),
          }
          // Clear per-site overrides since indices shifted after deletion
          if (site_radius_overrides?.size > 0) site_radius_overrides.clear()
          clear_bond_edits()
          show_toast(`Deleted ${n_deleted} site${n_deleted > 1 ? `s` : ``}`)
          return true
        }
        return false
      }
      const key = event.key.toLowerCase()
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey

      if (key === `a` && plain) {
        // Enter add-atom sub-mode (plain 'a' only, not Ctrl+A/Cmd+A/Alt+A)
        add_atom_mode = !add_atom_mode
        return true
      }
      // Change element of selected atoms
      if (key === `e` && plain && selected_sites.length > 0) {
        change_element_mode = !change_element_mode
        return true
      }
      // Duplicate selected atoms at a small offset
      if (
        key === `d` && (event.ctrlKey || event.metaKey) &&
        selected_sites.length > 0 && structure?.sites
      ) {
        is_internal_edit = true
        push_undo()
        const orig_indices = scene_to_structure_indices(selected_sites)
        const cart_to_frac = get_cart_to_frac()
        const new_sites = structure.sites
          .filter((_, idx) => orig_indices.has(idx))
          .map((site) => {
            const new_xyz: Vec3 = [
              site.xyz[0] + 0.5,
              site.xyz[1] + 0.5,
              site.xyz[2] + 0.5,
            ]
            return {
              ...site,
              xyz: new_xyz,
              abc: cart_to_frac?.(new_xyz) ?? new_xyz,
              properties: { ...site.properties },
            }
          })
        const base_idx = structure.sites.length
        structure = {
          ...structure,
          sites: [...structure.sites, ...new_sites],
        }
        // Select the newly duplicated atoms
        selected_sites = new_sites.map((_, idx) => base_idx + idx)
        measured_sites = [...selected_sites]
        show_toast(
          `Duplicated ${new_sites.length} site${new_sites.length > 1 ? `s` : ``}`,
        )
        return true
      }

      // add_atom_mode Escape is already handled above (before is_input_focused guard)
      if (event.key === `Escape`) {
        if (change_element_mode) {
          change_element_mode = false
          return true
        }
        if (selected_sites.length > 0) {
          clear_selection()
          return true
        }
      }
    }

    // Interface shortcuts (require Ctrl/Cmd modifier to avoid accidental triggers)
    const has_modifier = event.ctrlKey || event.metaKey
    if (event.key === `f` && has_modifier && fullscreen_toggle) {
      toggle_fullscreen(wrapper)
      return true
    } else if (event.key === `i` && has_modifier && enable_info_pane) {
      info_pane_open = !info_pane_open
      return true
    } else if (
      event.key === `g` && has_modifier && controls_config.visible(`multi-view`)
    ) {
      multi_view = !multi_view
      return true
    } else if (event.key === `Escape`) {
      // Prioritize closing panes, then exit edit modes, then exit fullscreen
      if (info_pane_open) info_pane_open = false
      else if (controls_open) controls_open = false
      else if (export_pane_open) export_pane_open = false
      else if (measure_mode === `edit-bonds` || measure_mode === `edit-atoms`) {
        measure_mode = `distance`
      } else return false
      return true
    }
    return false
  }

  // Hover (window) path: skip edit-mode mutations so destructive keys (delete/undo)
  // require focus, not just a hovering mouse.
  const handle_hover_keydown = (event: KeyboardEvent): boolean =>
    measure_mode === `edit-atoms` || measure_mode === `edit-bonds`
      ? false
      : handle_keydown(event)

  // === Edit-atoms mode helpers ===

  // Map scene indices (into displayed_structure) back to raw structure indices.
  // Handles supercell atoms via orig_unit_cell_idx property.
  // skip_image_atoms: when true, image atoms (PBC ghosts) are excluded from the result.
  function scene_to_structure_indices(
    scene_indices: number[],
    skip_image_atoms = false,
  ): SvelteSet<number> {
    const result = new SvelteSet<number>()
    for (const scene_idx of scene_indices) {
      const displayed_site = displayed_structure?.sites?.[scene_idx]
      if (!displayed_site) continue
      if (skip_image_atoms && displayed_site.properties?.orig_site_idx != null) {
        continue
      }

      if (has_supercell && displayed_site.properties?.orig_unit_cell_idx != null) {
        result.add(displayed_site.properties.orig_unit_cell_idx as number)
      } else if (displayed_site.properties?.orig_site_idx != null) {
        // Image atom (PBC ghost) — map back to its original site index
        result.add(displayed_site.properties.orig_site_idx as number)
      } else {
        result.add(scene_idx)
      }
    }
    return result
  }

  // Try to create a Cartesian→fractional converter for the current structure's lattice
  function get_cart_to_frac(): ((xyz: Vec3) => Vec3) | undefined {
    if (!structure || !(`lattice` in structure)) return undefined
    try {
      return create_cart_to_frac((structure as Crystal).lattice.matrix)
    } catch {
      console.warn(`Failed to compute lattice inverse for fractional coordinates`)
      return undefined
    }
  }

  // Handle atom moves from TransformControls. Applies Cartesian delta and wraps
  // fractional coords inline so normalize_fractional_coords hits its fast path.
  function handle_sites_moved(scene_indices: number[], delta: Vec3) {
    if (!structure?.sites) return
    is_internal_edit = true

    const orig_indices = scene_to_structure_indices(scene_indices)
    // For crystals, wrap to [0,1) inline so normalize_fractional_coords fast-paths.
    // For molecules (no lattice), just apply the Cartesian delta directly.
    const lattice = `lattice` in structure
      ? (structure as Crystal).lattice.matrix
      : null
    // get_cart_to_frac guards matrix_inverse_3x3, which throws on singular lattices
    const cart_to_frac = get_cart_to_frac()
    const frac_to_cart = lattice ? create_frac_to_cart(lattice) : null
    structure = {
      ...structure,
      sites: structure.sites.map((site, idx) => {
        if (!orig_indices.has(idx)) return site
        const new_xyz: Vec3 = [
          site.xyz[0] + delta[0],
          site.xyz[1] + delta[1],
          site.xyz[2] + delta[2],
        ]
        if (!cart_to_frac || !frac_to_cart) {
          return { ...site, xyz: new_xyz, abc: new_xyz }
        }
        const wrapped_abc = wrap_to_unit_cell(cart_to_frac(new_xyz))
        return { ...site, xyz: frac_to_cart(wrapped_abc), abc: wrapped_abc }
      }),
    }
  }

  // Change element symbol of selected atoms
  function handle_change_element(new_element: string) {
    if (!structure?.sites || selected_sites.length === 0) return
    const elem = normalize_element(new_element)
    if (!elem) return
    is_internal_edit = true
    push_undo()
    const orig_indices = scene_to_structure_indices(selected_sites)
    structure = {
      ...structure,
      sites: structure.sites.map((site, idx) => {
        if (!orig_indices.has(idx)) return site
        return {
          ...site,
          species: [{ element: elem, occu: 1, oxidation_state: 0 }],
          label: elem,
        }
      }),
    }
    change_element_mode = false
    change_element_value = ``
    show_toast(
      `Changed ${orig_indices.size} site${
        orig_indices.size > 1 ? `s` : ``
      } to ${elem}`,
    )
  }

  // Handle add-atom from StructureScene click-to-place
  function handle_add_atom(xyz: Vec3, element: ElementSymbol) {
    if (!structure) return
    const elem = normalize_element(element)
    if (!elem) {
      return console.warn(`Invalid element symbol "${element}", ignoring add-atom`)
    }
    is_internal_edit = true
    push_undo()
    structure = {
      ...structure,
      sites: [...structure.sites, {
        species: [{ element: elem, occu: 1, oxidation_state: 0 }],
        xyz,
        abc: get_cart_to_frac()?.(xyz) ?? xyz,
        label: elem,
        properties: {},
      }],
    }
    show_toast(`Added ${elem} at (${xyz.map((coord) => coord.toFixed(2)).join(`, `)})`)
  }

  // Only set background override when background_color is explicitly provided
  $effect(() => {
    if (typeof window !== `undefined` && wrapper && background_color) {
      // Convert opacity (0-1) to hex alpha value (00-FF)
      const alpha_hex = Math.round(background_opacity * 255)
        .toString(16)
        .padStart(2, `0`)
      wrapper.style.setProperty(
        `--struct-bg-override`,
        `${background_color}${alpha_hex}`,
      )
    } else if (typeof window !== `undefined` && wrapper) {
      // Remove override to use theme system
      wrapper.style.removeProperty(`--struct-bg-override`)
    }
  })

  sync_fullscreen({
    get_wrapper: () => wrapper,
    get_fullscreen: () => fullscreen,
    set_fullscreen: (val) => (fullscreen = val),
    bg_css_var: `--struct-bg-fullscreen`,
    on_change: (val) => on_fullscreen_change?.({ structure, fullscreen: val }),
  })
</script>

<!-- Forward shortcuts to the hovered viewer when focus is on <body> (see
  forward_window_keydown). Edit modes are excluded so destructive keys
  (delete/undo) still require focus, not just a hovering mouse. -->
<svelte:window onkeydown={forward_window_keydown(() => hovered, handle_hover_keydown)} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class:dragover
  class:active={info_pane_open || controls_open || export_pane_open}
  class:gizmo-visible={Boolean(scene_gizmo)}
  class:multi-view={multi_view}
  role="application"
  tabindex="0"
  aria-label="Structure viewer"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  onfocusin={() => (focused = true)}
  onfocusout={(event) => {
    if (!(event.relatedTarget instanceof Node) || !wrapper?.contains(event.relatedTarget)) {
      focused = false
    }
  }}
  ondrop={handle_file_drop}
  {...drag_over_handlers({ allow: () => allow_file_drop, set_dragover: (over) => dragover = over })}
  onkeydown={handle_and_prevent(handle_keydown)}
  {...rest}
  class={[`structure`, rest.class]}
>
  {@render children?.({ structure, fullscreen })}
  {#if loading}
    <Spinner
      text="Loading structure..."
      {...spinner_props}
      style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)"
    />
  {:else if error_msg}
    <StatusMessage bind:message={error_msg} type="error" dismissible />
  {:else if (structure?.sites?.length ?? 0) > 0}
    {#snippet reset_camera_btn()}
      {#if any_camera_moved && controls_config.visible(`reset-camera`)}
        <button
          class="reset-camera"
          onclick={reset_all_cameras}
          title={reset_text}
          aria-label={reset_text}
        >
          <!-- Target/Focus icon for reset camera -->
          <Icon icon="Reset" />
        </button>
      {/if}
    {/snippet}
    <ViewerChrome
      {controls_config}
      {fullscreen}
      {fullscreen_toggle}
      fullscreen_btn_style="padding: 0 3px"
      {wrapper}
      before={reset_camera_btn}
      style="--viewer-buttons-gap: 4pt; --viewer-buttons-btn-padding: 1px 6px; --viewer-buttons-align: stretch"
    >
      {#if controls_config.visible(`multi-view`)}
        <button
          class="multi-view-toggle"
          class:active={multi_view}
          onclick={() => (multi_view = !multi_view)}
          title="Toggle multi-side view 2×2 grid (Cmd/Ctrl+G)"
          aria-label="Toggle multi-side view"
          aria-pressed={multi_view}
          {@attach tooltip()}
        >
          <Icon icon="Grid2x2" />
        </button>
      {/if}

      {#if enable_measure_mode && controls_config.visible(`measure-mode`)}
        <div
          class="measure-mode-dropdown"
          {@attach click_outside({ callback: () => measure_menu_open = false })}
        >
          <button
            onclick={() => (measure_menu_open = !measure_menu_open)}
            title="Measure / Edit"
            aria-label="Measure / Edit"
            class="view-mode-button"
            class:active={measure_menu_open}
            aria-expanded={measure_menu_open}
            style="transform: scale(1.2)"
            {@attach tooltip()}
          >
            {#if show_measure_selection_limit}
              <span class="selection-limit-text">
                {measured_sites.length}/{MAX_SELECTED_SITES}
              </span>
            {:else}
              <Icon
                icon={({
                  distance: `Ruler`,
                  angle: `Angle`,
                  'edit-bonds': `Link`,
                  'edit-atoms': `Edit`,
                } as const)[measure_mode]}
              />
            {/if}
            <Icon
              icon="Arrow{measure_menu_open ? `Up` : `Down`}"
              style="margin-left: -2px"
            />
          </button>
          {#if show_selection_reset}
            <button
              type="button"
              aria-label="Reset selection and bond edits"
              onclick={() => {
                clear_selection()
                clear_bond_edits()
              }}
            >
              <Icon icon="Reset" style="margin-left: -4px" />
            </button>
          {/if}
          {#if measure_menu_open}
            <div class="view-mode-dropdown">
              {#each [
          { mode: `distance`, icon: `Ruler`, label: `Distance`, scale: 1.1 },
          { mode: `angle`, icon: `Angle`, label: `Angle`, scale: 1.3 },
          { mode: `edit-atoms`, icon: `Edit`, label: `Edit Atoms`, scale: 1.0 },
          { mode: `edit-bonds`, icon: `Link`, label: `Edit Bonds`, scale: 1.0 },
        ] as const as { mode, icon, label, scale } (mode)}
                <button
                  class="view-mode-option"
                  class:selected={measure_mode === mode}
                  disabled={mode === `edit-bonds` && !bond_edits_enabled}
                  title={mode === `edit-bonds` && !bond_edits_enabled
                    ? `Bond editing is only available for the original 1x1x1 cell`
                    : label}
                  onclick={() => {
                    if (mode === `edit-bonds` && !bond_edits_enabled) return
                    ;[measure_mode, measure_menu_open] = [mode, false]
                  }}
                >
                  <Icon {icon} style="transform: scale({scale})" />
                  <span>{label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Undo/redo buttons (only in edit-atoms mode) -->
        {#if measure_mode === `edit-atoms`}
          <div class="undo-redo-container">
            <button
              type="button"
              aria-label="Undo (Cmd/Ctrl+Z)"
              disabled={undo_stack.length === 0}
              onclick={undo}
              title="Undo (Cmd/Ctrl+Z)"
              class="undo-redo-btn"
            >
              <Icon icon="Undo" />
              {#if undo_stack.length > 0}
                <span class="history-count">{undo_stack.length}</span>
              {/if}
            </button>
            <button
              type="button"
              aria-label="Redo (Cmd/Ctrl+Y or Cmd+Shift+Z)"
              disabled={redo_stack.length === 0}
              onclick={redo}
              title="Redo (Cmd/Ctrl+Y or Cmd+Shift+Z)"
              class="undo-redo-btn"
            >
              <Icon icon="Redo" />
              {#if redo_stack.length > 0}
                <span class="history-count">{redo_stack.length}</span>
              {/if}
            </button>
          </div>
        {/if}

        {#if measure_mode === `edit-bonds`}
          <div class="bond-edit-toolbar" aria-label="Bond editing controls">
            {#if bond_edit_mode === `add`}
              <label>
                <span>Bond order</span>
                <select bind:value={bond_edit_order}>
                  {#each BOND_ORDER_OPTIONS as { order, label } (label)}
                    <option value={order}>{label}</option>
                  {/each}
                </select>
              </label>
            {/if}
            <div class="bond-edit-mode-toggle">
              {#each [
                { mode: `add`, label: `Add`, title: `Add: click two atoms` },
                { mode: `delete`, label: `Delete`, title: `Delete: click a bond` },
              ] as const as { mode, label, title } (mode)}
                <button
                  type="button"
                  class:selected={bond_edit_mode === mode}
                  aria-pressed={bond_edit_mode === mode}
                  title="{title} ({label[0]})"
                  onclick={() => (bond_edit_mode = mode)}
                >
                  {label}
                </button>
              {/each}
            </div>
          </div>
          <div class="undo-redo-container">
            <button
              type="button"
              aria-label="Undo bond edit (Cmd/Ctrl+Z)"
              disabled={bond_undo_stack.length === 0}
              onclick={undo_bond_edit}
              title="Undo bond edit (Cmd/Ctrl+Z)"
              class="undo-redo-btn"
            >
              <Icon icon="Undo" />
              {#if bond_undo_stack.length > 0}
                <span class="history-count">{bond_undo_stack.length}</span>
              {/if}
            </button>
            <button
              type="button"
              aria-label="Redo bond edit (Cmd/Ctrl+Y or Cmd+Shift+Z)"
              disabled={bond_redo_stack.length === 0}
              onclick={redo_bond_edit}
              title="Redo bond edit (Cmd/Ctrl+Y or Cmd+Shift+Z)"
              class="undo-redo-btn"
            >
              <Icon icon="Redo" />
              {#if bond_redo_stack.length > 0}
                <span class="history-count">{bond_redo_stack.length}</span>
              {/if}
            </button>
          </div>
        {/if}

        <!-- Add-atom element input (shown when add_atom_mode is active) -->
        {#if measure_mode === `edit-atoms` && add_atom_mode}
          <div class="add-atom-input">
            <label>
              <span>Element:</span>
              <input
                type="text"
                bind:value={add_element}
                maxlength="2"
                placeholder="C"
                style="width: 3em; text-align: center"
              />
            </label>
            <span style="font-size: 0.75em; opacity: 0.7">Click to place</span>
          </div>
        {/if}

        <!-- Change-element input (shown when 'e' pressed with selection) -->
        {#if measure_mode === `edit-atoms` && change_element_mode &&
      selected_sites.length > 0}
          <div class="add-atom-input">
            <label>
              <span>New element:</span>
              <input
                type="text"
                bind:value={change_element_value}
                maxlength="2"
                placeholder="Fe"
                style="width: 3em; text-align: center"
                onkeydown={(event: KeyboardEvent) => {
                  if (event.key === `Enter`) {
                    handle_change_element(change_element_value)
                  } else if (event.key === `Escape`) {
                    change_element_mode = false
                  }
                  event.stopPropagation()
                }}
                {@attach (node: HTMLInputElement) => {
                  node.focus()
                }}
              />
            </label>
            <span style="font-size: 0.75em; opacity: 0.7">Enter to apply</span>
          </div>
        {/if}
      {/if}

      {#if enable_info_pane && normalized_structure &&
      controls_config.visible(`info-pane`)}
        <StructureInfoPane
          structure={normalized_structure}
          bind:pane_open={info_pane_open}
          bind:highlighted_sites
          bind:hovered_site_idx
          bind:selected_sites
          {sym_data}
          {@attach tooltip({ content: `Structure info pane` })}
        />
      {/if}

      {#if controls_config.visible(`export-pane`)}
        <StructureExportPane
          bind:export_pane_open
          structure={normalized_structure}
          {wrapper}
          {scene}
          {camera}
          bind:png_dpi
          pane_props={{ style: `max-height: calc(${height}px - 50px)` }}
        />
      {/if}

      {#if controls_config.visible(`controls`)}
        <StructureControls
          bind:controls_open
          bind:scene_props
          bind:lattice_props
          bind:show_image_atoms
          bind:supercell_scaling
          bind:background_color
          bind:background_opacity
          bind:color_scheme
          bind:atom_color_config
          bind:cell_type
          bind:volumetric_data
          bind:isosurface_settings
          bind:active_volume_idx
          {structure}
          {supercell_loading}
          {sym_data}
          {polyhedra_rendered_elements}
        />
      {/if}

      {@render top_right_controls?.()}
    </ViewerChrome>

    <AtomLegend
      bind:atom_color_config
      {property_colors}
      elements={get_element_counts(supercell_structure ?? structure!)}
      bind:hidden_elements
      bind:hidden_prop_vals
      bind:element_mapping
      bind:element_radius_overrides
      bind:site_radius_overrides
      selected_sites={atom_legend_selected_sites}
      structure={displayed_structure}
      show_mode_toggle={viewer_active}
      {sym_data}
    >
      {#snippet children({ mode_menu_open })}
        {#if structure && `lattice` in structure}
          <CellSelect
            bind:supercell_scaling
            bind:cell_type
            {sym_data}
            loading={supercell_loading}
            direction="up"
            suppress_hover={mode_menu_open}
          />
        {/if}
      {/snippet}
    </AtomLegend>

    <!-- One StructureViewport renders the single view; four render the 2x2 multi-view.
      The primary pane (index 0) carries the external camera API: scene/camera are bound
      out for export and camera_position/target persist into scene_props, and it emits
      on_camera_move/on_camera_reset. All camera handling itself lives in StructureViewport. -->
    {#snippet primary_viewport(view: StructureView)}
      <StructureViewport
        in_grid={multi_view}
        label={multi_view ? view.label : undefined}
        active={multi_view && active_pane_idx === 0}
        interactive={!multi_view || active_pane_idx === 0}
        onactivate={() => (active_pane_idx = 0)}
        {reset_token}
        report_moved={(moved) =>
        moved ? moved_panes.add(0) : moved_panes.delete(0)}
        {on_camera_move}
        {on_camera_reset}
        {...shared_viewport_props}
        camera_direction={view.direction}
        camera_projection={view.projection ?? scene_props.camera_projection}
        bind:camera_position={scene_props.camera_position}
        bind:camera_target={scene_props.camera_target}
        bind:scene
        bind:camera
        bind:selected_sites
        bind:measured_sites
        bind:hovered_site_idx
        bind:hidden_elements
        bind:hidden_prop_vals
        bind:element_radius_overrides
        bind:site_radius_overrides
        bind:added_bonds
        bind:removed_bonds
        bind:bond_order_overrides
        bind:bond_edit_mode
        bind:add_atom_mode
        bind:add_element
        bind:dragging_atoms
        bind:polyhedra_rendered_elements
      />
    {/snippet}

    {#snippet extra_viewport(view: StructureView, pane_idx: number)}
      <StructureViewport
        in_grid
        label={view.label}
        active={active_pane_idx === pane_idx}
        interactive={active_pane_idx === pane_idx}
        onactivate={() => (active_pane_idx = pane_idx)}
        {reset_token}
        report_moved={(moved) =>
        moved ? moved_panes.add(pane_idx) : moved_panes.delete(pane_idx)}
        {...shared_viewport_props}
        camera_direction={view.direction}
        camera_projection={view.projection ?? scene_props.camera_projection}
        bind:selected_sites
        bind:measured_sites
        bind:hovered_site_idx
        bind:hidden_elements
        bind:hidden_prop_vals
        bind:element_radius_overrides
        bind:site_radius_overrides
        bind:added_bonds
        bind:removed_bonds
        bind:bond_order_overrides
        bind:bond_edit_mode
        bind:add_atom_mode
        bind:add_element
        bind:dragging_atoms
      />
    {/snippet}

    <!-- prevent from rendering in vitest runner since WebGLRenderingContext not available -->
    {#if typeof WebGLRenderingContext !== `undefined`}
      <div class:multi={multi_view} class="viewport-stage">
        {@render primary_viewport(multi_view ? views[0] ?? {} : {})}
        {#if multi_view}
          {#each views.slice(1) as view, idx (idx)}
            {@render extra_viewport(view, idx + 1)}
          {/each}
        {/if}
      </div>
    {/if}

    <div class="bottom-left">
      {@render bottom_left?.({ structure: displayed_structure })}
    </div>

    {#if toast_msg}
      <div class="edit-toast">{toast_msg}</div>
    {/if}

    {#if symmetry_error}
      <div class="symmetry-error">
        <span>{symmetry_error}</span>
        <button onclick={() => (symmetry_error = undefined)} aria-label="Dismiss">
          ×
        </button>
      </div>
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
    height: var(--struct-height, 500px);
    width: var(--struct-width, 100%);
    max-width: var(--struct-max-width, 100%);
    min-width: var(--struct-min-width, 300px);
    border-radius: var(--struct-border-radius, var(--border-radius, 3pt));
    background: var(--struct-bg-override, var(--struct-bg));
    color: var(--struct-text-color);
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
  /* 2x2 multi-side view grid: four equal subcanvases. grid-auto-rows keeps rows
    equal-height if a custom `views` array supplies more than four entries. */
  .viewport-stage.multi {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    grid-auto-rows: 1fr;
    gap: var(--struct-viewport-gap, 2px);
  }
  .multi-view-toggle.active {
    color: var(--accent-color, #4a9eff);
  }
  /* Ensure canvas is transparent so the themed --struct-bg shows through */
  .structure :global(canvas) {
    background: transparent;
    cursor: var(--canvas-cursor, default);
  }
  .structure:not(.gizmo-visible) :global(.responsive-gizmo) {
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
  }
  /* Avoid accidental text selection while interacting with the viewer */
  .structure :global(canvas),
  .structure :global(section.control-buttons),
  .structure .bottom-left {
    user-select: none;
  }
  div.bottom-left {
    position: absolute;
    bottom: 0;
    left: 0;
    font-size: var(--struct-bottom-left-font-size, 1.2em);
    padding: var(--struct-bottom-left-padding, 1pt 5pt);
  }
  /* Match Trajectory dropdown UI */
  .view-mode-dropdown {
    position: absolute;
    top: 115%;
    right: 0;
    background: var(--surface-bg);
    border-radius: var(--border-radius, 3pt);
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.3), 0 4px 8px -2px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
  }
  .view-mode-option {
    display: flex;
    align-items: center;
    gap: 1ex;
    width: 100%;
    padding: var(--trajectory-view-mode-option-padding, 5pt);
    box-sizing: border-box;
    background: transparent;
    border-radius: 0;
    text-align: left;
    transition: background-color 0.15s ease;
  }
  .view-mode-option:first-child {
    border-top-left-radius: 3px;
    border-top-right-radius: 3px;
  }
  .view-mode-option.selected {
    color: var(--accent-color);
  }
  .view-mode-option span {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .measure-mode-dropdown {
    display: flex;
    position: relative;
    height: fit-content;
    place-self: center;
  }
  .measure-mode-dropdown > button {
    background: transparent;
    padding: 1px 6px;
    font-size: var(--ctrl-btn-icon-size, clamp(0.7rem, 2cqmin, 0.85rem));
  }
  .selection-limit-text {
    font-weight: bold;
    font-size: 0.9em;
    color: var(--accent-color, #ff6b6b);
    min-width: 2.5em;
    text-align: center;
  }
  p.warn {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
  }
  .symmetry-error {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    background: rgba(255, 165, 0, 0.95);
    color: #000;
    padding: 0.75rem 1rem;
    border-radius: var(--border-radius, 3pt);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    display: flex;
    gap: 1rem;
    max-width: min(90%, 400px);
    font-size: 0.9rem;
    z-index: 1000;
  }
  .symmetry-error span {
    flex: 1;
  }
  .symmetry-error button {
    background: transparent;
    border: none;
    font-size: 1.5rem;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    opacity: 0.7;
  }
  .symmetry-error button:hover {
    opacity: 1;
  }
  .edit-toast {
    position: absolute;
    bottom: 3rem;
    left: 50%;
    transform: translateX(-50%);
    background: color-mix(in srgb, var(--page-bg, Canvas) 85%, currentColor);
    color: var(--text-color, currentColor);
    padding: 0.4rem 0.8rem;
    border-radius: var(--border-radius, 3pt);
    font-size: 0.8rem;
    z-index: 100;
    pointer-events: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    animation: toast-fade 2s ease-in-out;
    opacity: 0;
  }
  @keyframes toast-fade {
    0%, 70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  /* CellSelect: position at left of legend, show on hover */
  .structure :global(.cell-select) {
    order: -1; /* Move to left side of AtomLegend flex container */
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  .structure:hover :global(.cell-select) {
    opacity: 1;
    pointer-events: auto;
  }
  .undo-redo-container {
    display: flex;
  }
  .undo-redo-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .bond-edit-toolbar {
    --bond-edit-control-height: 1.8em;
    display: flex;
    align-items: center;
    gap: 0.4em;
    font-size: 0.8em;
  }
  .bond-edit-mode-toggle,
  .bond-edit-toolbar label {
    display: flex;
    align-items: center;
  }
  .bond-edit-mode-toggle {
    gap: 0.35em;
  }
  .bond-edit-mode-toggle button,
  .bond-edit-toolbar label,
  .bond-edit-toolbar select {
    height: var(--bond-edit-control-height);
    line-height: 1;
  }
  .bond-edit-mode-toggle button {
    min-width: 3.5em;
    font: inherit;
  }
  .bond-edit-mode-toggle button.selected {
    background: var(--accent-color, #007acc);
    color: white;
  }
  .bond-edit-mode-toggle button.selected:hover {
    background-color: color-mix(in srgb, var(--accent-color, #007acc) 70%, black);
  }
  .bond-edit-toolbar label {
    gap: 0.25em;
  }
  .bond-edit-toolbar select {
    max-width: 8em;
    font: inherit;
  }
  .history-count {
    position: absolute;
    bottom: -2px;
    right: -2px;
    background: var(--accent-color, #007acc);
    color: white;
    border-radius: 50%;
    width: 12px;
    height: 12px;
    font-size: 8px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    pointer-events: none;
    z-index: 1;
  }
  .add-atom-input {
    display: flex;
    align-items: center;
    gap: 0.5em;
    background: color-mix(in srgb, var(--page-bg, Canvas) 85%, currentColor);
    color: var(--text-color, currentColor);
    padding: 0.3em 0.6em;
    border-radius: var(--border-radius, 3pt);
    font-size: 0.8rem;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    label {
      display: flex;
      align-items: center;
      gap: 0.3em;
    }
    input {
      background: color-mix(in srgb, currentColor 10%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 3px;
      color: inherit;
      font-size: 0.85rem;
      padding: 0.1em 0.3em;
    }
  }
</style>

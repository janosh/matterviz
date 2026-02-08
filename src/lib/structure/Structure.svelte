<script module lang="ts">
  export type MeasureMode = `distance` | `angle` | `edit-bonds` | `edit-atoms`
</script>

<script lang="ts">
  import type { ColorSchemeName } from '$lib/colors'
  import { ELEMENT_COLOR_SCHEMES } from '$lib/colors'
  import type { ShowControlsProp } from '$lib/controls'
  import { normalize_show_controls } from '$lib/controls'
  import type { ElementSymbol } from '$lib/element'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import Icon from '$lib/Icon.svelte'
  import { decompress_file, handle_url_drop, load_from_url } from '$lib/io'
  import { parse_volumetric_file } from '$lib/isosurface/parse'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import {
    auto_isosurface_settings,
    DEFAULT_ISOSURFACE_SETTINGS,
  } from '$lib/isosurface/types'
  import { ELEM_SYMBOLS } from '$lib/labels'
  import { set_fullscreen_bg, toggle_fullscreen } from '$lib/layout'
  import type { Vec3 } from '$lib/math'
  import { create_cart_to_frac } from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import type { AnyStructure, Crystal, Site } from '$lib/structure'
  import { get_element_counts, get_pbc_image_sites } from '$lib/structure'
  import { is_valid_supercell_input, make_supercell } from '$lib/structure/supercell'
  import type { CellType, SymmetrySettings } from '$lib/symmetry'
  import * as symmetry from '$lib/symmetry'
  import { transform_cell } from '$lib/symmetry'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { click_outside, tooltip } from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import type { Camera, OrthographicCamera, Scene } from 'three'
  import type { AtomColorConfig } from './atom-properties'
  import { get_property_colors } from './atom-properties'
  import AtomLegend from './AtomLegend.svelte'
  import CellSelect from './CellSelect.svelte'
  import type { StructureHandlerData } from './index'
  import { MAX_SELECTED_SITES } from './measure'
  import { normalize_fractional_coords, parse_any_structure } from './parse'
  import StructureControls from './StructureControls.svelte'
  import StructureExportPane from './StructureExportPane.svelte'
  import StructureInfoPane from './StructureInfoPane.svelte'
  import StructureScene from './StructureScene.svelte'

  // Type alias for event handlers to reduce verbosity
  type EventHandler = (data: StructureHandlerData) => void

  // Local reactive state for scene and lattice props. Deeply reactive so nested mutations propagate.
  // Deep-clone to prevent mutations from leaking to global defaults across component instances.
  let scene_props = $state(structuredClone(DEFAULTS.structure))
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
    scene_props: scene_props_in = $bindable(),
    lattice_props: lattice_props_in = $bindable(),
    controls_open = $bindable(false),
    info_pane_open = $bindable(false),
    enable_measure_mode = $bindable(true),
    measure_mode = $bindable<MeasureMode>(`distance`),
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
    // expose measured site indices for overlays/labels
    measured_sites = $bindable([]),
    // expose the displayed structure (with image atoms and supercell) for external use
    displayed_structure = $bindable(),
    // Track hidden elements across component lifecycle
    hidden_elements = $bindable(new Set<ElementSymbol>()),
    // Track hidden property values (e.g. Wyckoff positions, coordination numbers)
    hidden_prop_vals = $bindable(new Set<number | string>()),
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
    ...rest
  }:
    & {
      structure?: AnyStructure
      scene_props?: ComponentProps<typeof StructureScene>
      /**
       * Controls visibility configuration.
       * - 'always': controls always visible
       * - 'hover': controls visible on component hover (default)
       * - 'never': controls never visible
       * - object: { mode, hidden, style } for fine-grained control
       *
       * Control names: 'reset-camera', 'fullscreen', 'measure-mode', 'info-pane', 'export-pane', 'controls'
       */
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
      info_pane_open?: boolean
      fullscreen_toggle?: Snippet<[{ fullscreen: boolean }]> | boolean
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

  // Load structure from URL when data_url is provided
  $effect(() => {
    if (data_url && !structure) {
      loading = true
      error_msg = undefined

      load_from_url(data_url, (content, filename) => {
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
            error_msg = `Failed to parse structure: ${
              error instanceof Error ? error.message : String(error)
            }`
            on_error?.({ error_msg, filename })
          }
        }
      })
        .then(() => loading = false)
        .catch((error: Error) => {
          console.error(`Failed to load structure from URL:`, error)
          error_msg = `Failed to load structure: ${error.message}`
          loading = false
          on_error?.({ error_msg, filename: data_url })
        })
    }
  })

  $effect(() => { // Parse structure from string when structure_string is provided
    if (!structure_string || data_url) return
    loading = true
    error_msg = undefined
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
        err instanceof Error ? err.message : String(err)
      }`
      untrack(() => on_error?.({ error_msg, filename: `string` }))
    } finally {
      loading = false
    }
  })

  // Track if force vectors were auto-enabled to prevent repeated triggering
  let force_vectors_auto_enabled = $state(false)

  // Auto-enable force vectors when structure has force data
  $effect(() => {
    if (structure?.sites && !force_vectors_auto_enabled) {
      const has_force_data = structure.sites.some((site) =>
        site.properties?.force && Array.isArray(site.properties.force)
      )

      // Enable force vectors if structure has force data
      if (has_force_data && !scene_props.show_force_vectors) {
        scene_props.show_force_vectors = true
        scene_props.force_scale ??= DEFAULTS.structure.force_scale
        scene_props.force_color ??= DEFAULTS.structure.force_color
        force_vectors_auto_enabled = true
      }
    }
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

  // Trigger symmetry analysis when structure is loaded or settings change
  $effect(() => {
    if (!structure || !(`lattice` in structure)) {
      untrack(() => {
        sym_data = null
        symmetry_error = undefined
      })
      return
    }

    const current_structure = structure
    const run_id = ++symmetry_run_id
    // Destructure symmetry_settings to ensure Svelte tracks changes to symprec and algo
    // (reading just the object reference isn't sufficient for fine-grained reactivity)
    const { symprec, algo } = symmetry_settings ?? symmetry.default_sym_settings
    const current_settings = { symprec, algo }
    // Use untrack to prevent cascading reactivity when resetting state
    untrack(() => [sym_data, symmetry_error] = [null, undefined])

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
          symmetry_error = `Symmetry analysis failed: ${err?.message || err}`
          console.error(`Symmetry analysis failed:`, err)
        }
      })
  })

  let measure_menu_open = $state(false)
  let export_pane_open = $state(false)

  // Bond customization state
  let added_bonds = $state<[number, number][]>([])
  let removed_bonds = $state<[number, number][]>([])

  // === Edit-atoms mode state ===
  let undo_stack = $state<AnyStructure[]>([])
  let redo_stack = $state<AnyStructure[]>([])
  const MAX_HISTORY = 20
  // Flag set before internal edits (undo/redo/delete/add/move) to distinguish
  // them from external structure changes (file load, trajectory step, etc.)
  let is_internal_edit = false
  // Add-atom sub-mode state (bound to StructureScene)
  let add_atom_mode = $state(false)
  let add_element = $state<ElementSymbol>(`C` as ElementSymbol)

  function clear_selection() {
    selected_sites = []
    measured_sites = []
  }

  function push_undo() {
    if (!structure) return
    undo_stack = [...undo_stack.slice(-(MAX_HISTORY - 1)), $state.snapshot(structure)]
    redo_stack = []
  }

  // Shared undo/redo: pop from `source`, push current state onto `target`
  function apply_history(source: AnyStructure[], target: AnyStructure[]) {
    if (source.length === 0 || !structure) return
    is_internal_edit = true
    target.push($state.snapshot(structure) as AnyStructure)
    structure = source.pop()!
    clear_selection()
  }

  function undo() {
    apply_history(undo_stack, redo_stack)
  }
  function redo() {
    apply_history(redo_stack, undo_stack)
  }

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
    // External change — clear history
    untrack(() => {
      if (undo_stack.length > 0 || redo_stack.length > 0) {
        undo_stack = []
        redo_stack = []
      }
    })
  })

  // Auto-bake cell type transform and clear stale state when entering edit-atoms mode
  $effect(() => {
    if (measure_mode !== `edit-atoms`) return
    untrack(() => {
      // Clear bond edits from edit-bonds mode to avoid stale state
      if (added_bonds.length > 0 || removed_bonds.length > 0) {
        added_bonds = []
        removed_bonds = []
      }
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

  // Normalize structure coordinates: wrap fractional coords to [0,1) and recompute Cartesian
  // This ensures atoms are rendered inside the unit cell regardless of data source
  let normalized_structure = $derived.by(() => {
    if (!structure || !(`lattice` in structure)) return structure
    return normalize_fractional_coords(structure) as AnyStructure
  })

  // Apply cell type transformation (original, conventional, or primitive)
  // This must happen BEFORE supercell transformation
  let cell_transformed_structure = $derived.by(() => {
    if (
      !normalized_structure || !(`lattice` in normalized_structure) ||
      cell_type === `original`
    ) {
      return normalized_structure
    }
    // Cell type transformation requires symmetry data
    if (!sym_data) {
      return normalized_structure
    }
    try {
      return transform_cell(normalized_structure as Crystal, cell_type, sym_data)
    } catch (error) {
      console.error(`Failed to transform cell to ${cell_type}:`, error)
      return normalized_structure
    }
  })

  // Create supercell if needed (uses cell_transformed_structure as base)
  let supercell_structure = $state(structure)
  let supercell_loading = $state(false)
  let has_supercell = $derived(
    !!supercell_scaling && ![``, `1x1x1`, `1`].includes(supercell_scaling),
  )

  $effect(() => {
    const base_structure = cell_transformed_structure
    if (!base_structure || !(`lattice` in base_structure)) {
      supercell_structure = base_structure
      supercell_loading = false
    } else if ([``, `1x1x1`, `1`].includes(supercell_scaling)) {
      supercell_structure = base_structure
      supercell_loading = false
    } else if (!is_valid_supercell_input(supercell_scaling)) {
      supercell_structure = base_structure
      supercell_loading = false
    } else {
      // For large supercells, show loading state and use async generation
      const sites_count = base_structure.sites?.length || 0
      const [nx_str, ny_str, nz_str] = supercell_scaling.split(/[x×]/)
      const scaling_mult = (parseInt(nx_str) || 1) * (parseInt(ny_str) || 1) *
        (parseInt(nz_str) || 1)
      const estimated_sites = sites_count * scaling_mult

      // Show spinner for supercells with >1000 estimated sites or scaling >8
      const show_loading = estimated_sites > 1000 || scaling_mult > 8

      if (show_loading) {
        supercell_loading = true
        // Use setTimeout to allow UI to update before heavy computation
        setTimeout(() => {
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

  // Clear selections and site overrides when transformations change site indices
  // (skip first run to preserve parent-provided selections)
  let first_run = true
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    ;[supercell_scaling, show_image_atoms, structure, cell_type]
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
    })
  })

  // Apply element mapping then image atoms to the supercell structure
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
      show_image_atoms && struct && `lattice` in struct && struct.lattice
        ? get_pbc_image_sites(struct)
        : struct
  })

  // Track if camera has ever been moved from initial position
  let camera_has_moved = $state(false)
  let camera_is_moving = $state(false)
  let scene = $state<Scene | undefined>(undefined)
  let camera = $state<Camera | undefined>(undefined)
  let orbit_controls = $state<
    ComponentProps<typeof StructureScene>[`orbit_controls`]
  >(undefined)
  let rotation_target_ref = $state<Vec3 | undefined>(undefined)
  let initial_computed_zoom = $state<number | undefined>(undefined)
  let camera_move_timeout: ReturnType<typeof setTimeout> | null = $state(null)

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

  // Reset tracking when structure changes
  $effect(() => {
    if (structure) camera_has_moved = false
  })
  // Set camera_has_moved to true when camera starts moving
  $effect(() =>
    untrack(() => {
      if (camera_is_moving) {
        camera_has_moved = true
        // Debounce camera move events to avoid excessive emissions
        if (camera_move_timeout) clearTimeout(camera_move_timeout)
        camera_move_timeout = setTimeout(() => {
          const { camera_position } = scene_props
          on_camera_move?.({ structure, camera_has_moved, camera_position })
        }, 200)
      }
    })
  )

  function reset_camera() {
    // Reset camera position to trigger automatic positioning
    scene_props.camera_position = [0, 0, 0]
    camera_has_moved = false

    // Manually reset zoom and pan using the exposed initial values
    if (orbit_controls && camera) {
      // Reset the target to the structure center (pan reset)
      if (orbit_controls.target && rotation_target_ref) {
        const [x, y, z] = rotation_target_ref
        orbit_controls.target.set(x, y, z)
      }

      // Reset zoom for orthographic camera
      if (`zoom` in camera && initial_computed_zoom !== undefined) {
        const ortho_camera = camera as OrthographicCamera
        ortho_camera.zoom = initial_computed_zoom
        ortho_camera.updateProjectionMatrix()
      }

      // Call update to apply changes immediately
      if (typeof orbit_controls.update === `function`) {
        orbit_controls.update()
      }
    }

    on_camera_reset?.({ structure, camera_has_moved, camera_position: [0, 0, 0] })
  }

  const emit_file_load_event = (
    structure: AnyStructure,
    filename: string,
    content: string | ArrayBuffer,
  ) =>
    on_file_load?.({
      structure: structure,
      filename,
      file_size: typeof content === `string`
        ? new Blob([content]).size
        : content.byteLength,
      total_atoms: structure.sites?.length || 0,
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
    const vol_struct = try_parse_volumetric(text_content, filename)
    if (vol_struct) return vol_struct
    // Clear stale volumetric data when loading a non-volumetric file
    volumetric_data = []
    const parsed = parse_any_structure(text_content, filename)
    if (!parsed) throw new Error(`Failed to parse structure from ${filename}`)
    structure = parsed
    return parsed
  }

  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return
    loading = true
    error_msg = undefined // Clear previous error when a new file is dropped

    try {
      // Handle URL-based files (e.g. from FilePicker)
      const handled = await handle_url_drop(
        event,
        on_file_drop || ((content, filename) => {
          try {
            const text_content = content instanceof ArrayBuffer
              ? new TextDecoder().decode(content)
              : content
            const parsed = parse_file_content(text_content, filename)
            emit_file_load_event(parsed, filename, content)
          } catch (err) {
            error_msg = `Failed to parse structure: ${err}`
            on_error?.({ error_msg, filename })
          }
        }),
      ).catch(() => false)

      if (handled) return

      // Handle file system drops
      const file = event.dataTransfer?.files[0]
      if (file) {
        try {
          const { content, filename } = await decompress_file(file)
          if (content) {
            if (on_file_drop) on_file_drop(content, filename)
            else {
              // Parse structure internally when no handler provided
              try {
                const parsed = parse_file_content(content, filename)
                emit_file_load_event(parsed, filename, content)
              } catch (err) {
                error_msg = `Failed to parse structure: ${err}`
                on_error?.({ error_msg, filename })
              }
            }
          }
        } catch (error) {
          error_msg = `Failed to load file ${file.name}: ${error}`
          on_error?.({ error_msg, filename: file.name })
        }
      }
    } finally {
      loading = false
    }
  }

  function handle_keydown(event: KeyboardEvent) {
    // Don't handle shortcuts if user is typing in an input field
    const target = event.target as HTMLElement
    const is_input_focused = target.tagName === `INPUT` ||
      target.tagName === `TEXTAREA`

    // Allow Escape to cancel add-atom mode even when the element input is focused
    if (event.key === `Escape` && measure_mode === `edit-atoms` && add_atom_mode) {
      event.preventDefault()
      add_atom_mode = false
      return
    }

    if (is_input_focused) return

    // Edit-atoms mode shortcuts (including undo/redo)
    if (measure_mode === `edit-atoms`) {
      // Undo/redo shortcuts (Ctrl/Cmd + Z/Y) — only active in edit-atoms mode
      if (event.ctrlKey || event.metaKey) {
        if (event.key === `z` && !event.shiftKey) {
          event.preventDefault()
          undo()
          return
        } else if (event.key === `y` || (event.key === `z` && event.shiftKey)) {
          event.preventDefault()
          redo()
          return
        }
      }

      if (event.key === `Delete` || event.key === `Backspace`) {
        // Delete selected atoms
        if (selected_sites.length > 0 && structure?.sites) {
          event.preventDefault()
          is_internal_edit = true
          push_undo()
          const to_delete = scene_to_structure_indices(selected_sites, true)
          clear_selection()
          structure = {
            ...structure,
            sites: structure.sites.filter((_, idx) => !to_delete.has(idx)),
          }
          // Clear per-site overrides since indices shifted after deletion
          if (site_radius_overrides?.size > 0) site_radius_overrides.clear()
          added_bonds = []
          removed_bonds = []
        }
        return
      }
      if (
        event.key.toLowerCase() === `a` && !event.ctrlKey && !event.metaKey &&
        !event.altKey
      ) {
        // Enter add-atom sub-mode (plain 'a' only, not Ctrl+A/Cmd+A/Alt+A)
        event.preventDefault()
        add_atom_mode = !add_atom_mode
        return
      }
      if (event.key === `Escape`) {
        // Exit add-atom mode first, then clear selection
        if (add_atom_mode) {
          add_atom_mode = false
          return
        }
        if (selected_sites.length > 0) {
          clear_selection()
          return
        }
      }
    }

    // Interface shortcuts
    if (event.key === `f` && fullscreen_toggle) toggle_fullscreen(wrapper)
    else if (event.key === `i` && enable_info_pane) info_pane_open = !info_pane_open
    else if (event.key === `Escape`) {
      // Prioritize closing panes over exiting fullscreen
      if (info_pane_open) info_pane_open = false
      else if (controls_open) controls_open = false
      else if (export_pane_open) export_pane_open = false
    }
  }

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

  // Handle atom moves from StructureScene TransformControls.
  // Receives scene-level indices and a Cartesian delta (offset) to apply.
  function handle_sites_moved(scene_indices: number[], delta: Vec3) {
    if (!structure?.sites) return
    is_internal_edit = true

    const orig_indices = scene_to_structure_indices(scene_indices)
    const cart_to_frac = get_cart_to_frac()
    structure = {
      ...structure,
      sites: structure.sites.map((site, idx) => {
        if (!orig_indices.has(idx)) return site
        const new_xyz: Vec3 = [
          site.xyz[0] + delta[0],
          site.xyz[1] + delta[1],
          site.xyz[2] + delta[2],
        ]
        return { ...site, xyz: new_xyz, abc: cart_to_frac?.(new_xyz) ?? new_xyz }
      }),
    }
  }

  // Handle add-atom from StructureScene click-to-place
  function handle_add_atom(xyz: Vec3, element: ElementSymbol) {
    if (!structure) return
    // Validate element symbol — capitalize first letter to be forgiving of case
    const normalized = (element.charAt(0).toUpperCase() +
      element.slice(1).toLowerCase()) as ElementSymbol
    if (!ELEM_SYMBOLS.includes(normalized)) {
      console.warn(`Invalid element symbol "${element}", ignoring add-atom`)
      return
    }
    is_internal_edit = true
    push_undo()

    const new_site: Site = {
      species: [{ element: normalized, occu: 1, oxidation_state: 0 }],
      xyz,
      abc: get_cart_to_frac()?.(xyz) ?? xyz,
      label: normalized,
      properties: {},
    }

    structure = {
      ...structure,
      sites: [...structure.sites, new_site],
    }
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

  $effect(() => { // fullscreen and background
    if (typeof window !== `undefined`) {
      if (fullscreen && !document.fullscreenElement && wrapper) {
        wrapper.requestFullscreen().catch(console.error)
      } else if (!fullscreen && document.fullscreenElement) {
        document.exitFullscreen()
      }
    }
    set_fullscreen_bg(wrapper, fullscreen, `--struct-bg-fullscreen`)
  })
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
    on_fullscreen_change?.({ structure, fullscreen })
  }}
/>

<div
  class:dragover
  class:active={info_pane_open || controls_open || export_pane_open}
  role="region"
  tabindex="-1"
  aria-label="Structure viewer"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  ondblclick={(event) => {
    const target = event.target as HTMLElement
    // Don't reset if double-click was on UI controls/panes/legend
    if (
      target.closest(`.control-buttons`) ||
      target.closest(`.structure-legend`) ||
      target.closest(`.atom-legend`) ||
      target.closest(`.info-pane`) ||
      target.closest(`.export-pane`) ||
      target.closest(`.controls-pane`) ||
      target.tagName === `BUTTON` ||
      target.tagName === `INPUT` ||
      target.tagName === `SELECT`
    ) return
    // Reset camera for double-clicks on the 3D scene
    reset_camera()
  }}
  ondrop={handle_file_drop}
  ondragover={(event) => {
    event.preventDefault()
    if (!allow_file_drop) return
    dragover = true
  }}
  ondragleave={(event) => {
    event.preventDefault()
    dragover = false
  }}
  onkeydown={handle_keydown}
  {...rest}
  class="structure {rest.class ?? ``}"
>
  {@render children?.({ structure, fullscreen })}
  {#if loading}
    <Spinner
      text="Loading structure..."
      {...spinner_props}
      style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)"
    />
  {:else if error_msg}
    <div class="error-state">
      <p class="error">{error_msg}</p>
      <button onclick={() => (error_msg = undefined)}>Dismiss</button>
    </div>
  {:else if (structure?.sites?.length ?? 0) > 0}
    <section
      class="control-buttons {controls_config.class}"
      style={controls_config.style}
    >
      {#if controls_config.mode !== `never`}
        {#if camera_has_moved && controls_config.visible(`reset-camera`)}
          <button class="reset-camera" onclick={reset_camera} title={reset_text}>
            <!-- Target/Focus icon for reset camera -->
            <Icon icon="Reset" />
          </button>
        {/if}
        {#if fullscreen_toggle && controls_config.visible(`fullscreen`)}
          <button
            type="button"
            onclick={() => fullscreen_toggle && toggle_fullscreen(wrapper)}
            title="{fullscreen ? `Exit` : `Enter`} fullscreen"
            aria-pressed={fullscreen}
            class="fullscreen-toggle"
            style="padding: 0 3px"
            {@attach tooltip()}
          >
            {#if typeof fullscreen_toggle === `function`}
              {@render fullscreen_toggle({ fullscreen })}
            {:else}
              <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
            {/if}
          </button>
        {/if}

        {#if enable_measure_mode && controls_config.visible(`measure-mode`)}
          <div
            class="measure-mode-dropdown"
            {@attach click_outside({ callback: () => measure_menu_open = false })}
          >
            <button
              onclick={() => (measure_menu_open = !measure_menu_open)}
              title="Measurement mode"
              class="view-mode-button"
              class:active={measure_menu_open}
              aria-expanded={measure_menu_open}
              style="transform: scale(1.2)"
            >
              {#if (measured_sites?.length ?? 0) >= MAX_SELECTED_SITES}
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
            {#if (measured_sites?.length ?? 0) > 0 || added_bonds.length > 0 ||
          removed_bonds.length > 0}
              <button
                type="button"
                aria-label="Reset selection and bond edits"
                onclick={() => {
                  ;[measured_sites, selected_sites] = [[], []]
                  added_bonds = []
                  removed_bonds = []
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
            {
              mode: `edit-bonds`,
              icon: `Link`,
              label: `Edit Bonds`,
              scale: 1.0,
            },
            {
              mode: `edit-atoms`,
              icon: `Edit`,
              label: `Edit Atoms`,
              scale: 1.0,
            },
          ] as const as
                  { mode, icon, label, scale }
                  (mode)
                }
                  <button
                    class="view-mode-option"
                    class:selected={measure_mode === mode}
                    onclick={() => [measure_mode, measure_menu_open] = [mode, false]}
                  >
                    <Icon {icon} style="transform: scale({scale})" />
                    <span>{@html label}</span>
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
                aria-label="Undo (Ctrl+Z)"
                disabled={undo_stack.length === 0}
                onclick={undo}
                title="Undo (Ctrl+Z)"
                class="undo-redo-btn"
              >
                <Icon icon="Undo" />
                {#if undo_stack.length > 0}
                  <span class="history-count">{undo_stack.length}</span>
                {/if}
              </button>
              <button
                type="button"
                aria-label="Redo (Ctrl+Y)"
                disabled={redo_stack.length === 0}
                onclick={redo}
                title="Redo (Ctrl+Y)"
                class="undo-redo-btn"
              >
                <Icon icon="Redo" />
                {#if redo_stack.length > 0}
                  <span class="history-count">{redo_stack.length}</span>
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
        {/if}

        {#if enable_info_pane && normalized_structure &&
        controls_config.visible(`info-pane`)}
          <StructureInfoPane
            structure={normalized_structure}
            bind:pane_open={info_pane_open}
            {selected_sites}
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
          />
        {/if}

        {@render top_right_controls?.()}
      {/if}
    </section>

    <AtomLegend
      bind:atom_color_config
      {property_colors}
      elements={get_element_counts(supercell_structure ?? structure!)}
      bind:hidden_elements
      bind:hidden_prop_vals
      bind:element_mapping
      bind:element_radius_overrides
      bind:site_radius_overrides
      {selected_sites}
      structure={displayed_structure}
      {sym_data}
    >
      {#if structure && `lattice` in structure}
        <CellSelect
          bind:supercell_scaling
          bind:cell_type
          {sym_data}
          loading={supercell_loading}
          direction="up"
        />
      {/if}
    </AtomLegend>

    <!-- prevent from rendering in vitest runner since WebGLRenderingContext not available -->
    {#if typeof WebGLRenderingContext !== `undefined`}
      <!-- prevent HTML labels from rendering outside of the canvas -->
      <div style="overflow: hidden; height: 100%; flex: 1">
        <Canvas>
          <StructureScene
            structure={displayed_structure}
            base_structure={cell_transformed_structure}
            {...scene_props}
            {lattice_props}
            volumetric_data={volumetric_data?.[active_volume_idx]}
            {isosurface_settings}
            bind:camera_is_moving
            bind:selected_sites
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
            {measure_mode}
            {width}
            {height}
            {atom_color_config}
            {sym_data}
            on_sites_moved={handle_sites_moved}
            on_operation_start={push_undo}
            on_add_atom={handle_add_atom}
            bind:add_atom_mode
            bind:add_element
          />
        </Canvas>
      </div>
    {/if}

    <div class="bottom-left">
      {@render bottom_left?.({ structure: displayed_structure })}
    </div>

    {#if (measure_mode as string) === `edit-bonds` &&
      (added_bonds.length > 0 || removed_bonds.length > 0)}
      <div class="bond-edit-status">
        {#if added_bonds.length > 0}
          <span class="added">+{added_bonds.length} added</span>
        {/if}
        {#if removed_bonds.length > 0}
          <span class="removed">-{removed_bonds.length} removed</span>
        {/if}
      </div>
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
  .structure:fullscreen :global(canvas) {
    height: 100vh !important;
    width: 100vw !important;
  }
  .structure.dragover {
    background: var(--struct-dragover-bg, var(--dragover-bg));
    border: var(--struct-dragover-border, var(--dragover-border));
  }
  /* Ensure canvas is transparent so the themed --struct-bg shows through */
  .structure :global(canvas) {
    background: transparent;
  }
  /* Avoid accidental text selection while interacting with the viewer */
  .structure :global(canvas),
  .structure section.control-buttons,
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
  section.control-buttons {
    position: absolute;
    display: flex;
    top: var(--struct-buttons-top, var(--ctrl-btn-top, 1ex));
    right: var(--struct-buttons-right, var(--ctrl-btn-right, 1ex));
    gap: 4pt;
    /* buttons need higher z-index than AtomLegend to make info/controls panes occlude legend */
    /* we also need crazy high z-index to make info/control pane occlude threlte/extras' <HTML> elements for site labels */
    z-index: var(--struct-buttons-z-index, 100000000);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  /* Mode: always - controls always visible */
  section.control-buttons.always-visible {
    opacity: 1;
    pointer-events: auto;
  }
  /* Mode: hover - controls visible on component hover */
  .structure:hover section.control-buttons.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  /* Mode: never - stays hidden (default state, no additional CSS needed) */
  section.control-buttons > :global(button) {
    background-color: transparent;
    display: flex;
    padding: 4px;
    border-radius: var(--border-radius, 3pt);
    font-size: clamp(0.85em, 2cqmin, 1.3em);
  }
  section.control-buttons :global(button:hover) {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
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
    padding: 0 0 0 4px;
    font-size: clamp(0.85em, 2cqmin, 1.3em);
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
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: var(--struct-height, 500px);
    padding: 2rem;
    text-align: center;
    box-sizing: border-box;
  }
  .error-state p {
    color: var(--error-color, #ff6b6b);
    margin: 0 0 1rem;
  }
  .error-state button {
    padding: 0.5rem 1rem;
    background: var(--error-color, #ff6b6b);
    color: white;
    border: none;
    border-radius: var(--border-radius, 3pt);
    cursor: pointer;
    font-size: 0.9rem;
  }
  .error-state button:hover {
    background: var(--error-color-hover, #ff5252);
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
  .bond-edit-status {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 0.5rem 1rem;
    border-radius: var(--border-radius, 3pt);
    font-size: 0.85rem;
    display: flex;
    gap: 0.75rem;
    z-index: 100;
    pointer-events: none;
  }
  .bond-edit-status .added {
    color: #4caf50;
  }
  .bond-edit-status .removed {
    color: #f44336;
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
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 0.3em 0.6em;
    border-radius: var(--border-radius, 3pt);
    font-size: 0.8rem;
    label {
      display: flex;
      align-items: center;
      gap: 0.3em;
    }
    input {
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 3px;
      color: white;
      font-size: 0.85rem;
      padding: 0.1em 0.3em;
    }
  }
</style>

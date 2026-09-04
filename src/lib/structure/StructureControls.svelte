<script lang="ts">
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import { ControlPane, create_clipboard_feedback } from '$lib/overlays'
  import type { ColorSchemeName } from '$lib/colors'
  import { AXIS_COLORS, ELEMENT_COLOR_SCHEMES } from '$lib/colors'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import IsosurfaceControls from '$lib/isosurface/IsosurfaceControls.svelte'
  import VolumeSliceControls from '$lib/isosurface/VolumeSliceControls.svelte'
  import type { VolumeSliceSettings } from '$lib/isosurface/slice-settings'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import { format_num } from '$lib/labels'
  import { download } from '$lib/io/fetch'
  import {
    NumberRangeInput,
    SettingsGroup,
    SettingsSearch,
    SettingsSection,
  } from '$lib/layout'
  import type { Vec3 } from '$lib/math'
  import { clamp, to_degrees, to_radians } from '$lib/math'
  import MillerIndexInput from '$lib/MillerIndexInput.svelte'
  import type { ZoneAxisMode } from '$lib/scene'
  import { is_valid_zone_axis, ZONE_AXIS_MODE_LABELS, zone_axis_direction } from '$lib/scene'
  import { ColorScaleSelect } from '$lib/plot'
  import type { AtomColorMode, VectorLayerConfig } from '$lib/settings'
  import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
  import type { StructurePaneSize, StructureViewState } from '$lib/settings/viewer-state'
  import {
    clear_structure_view_state,
    create_structure_view_state,
    DEFAULT_STRUCTURE_VIEW_STATE,
    deserialize_structure_view_state,
    load_structure_view_state,
    save_structure_view_state,
    serialize_structure_view_state,
  } from '$lib/settings/viewer-state'
  import type { AnyStructure, StructureDisplayMode } from '$lib/structure'
  import {
    get_structure_vector_keys,
    RESET_VIEW_TITLE,
    StructureScene,
    VECTOR_PALETTE,
  } from '$lib/structure'
  import type { ElementSymbol } from '$lib/element'
  import type { AtomColorConfig } from '$lib/structure/atom-properties'
  import {
    DEFAULT_ATOM_COLOR_CONFIG,
    get_colorable_property_keys,
    get_atom_color_mode_options,
    next_atom_color_config,
    structure_has_selective_dynamics,
  } from '$lib/structure/atom-properties'
  import type { DisplacementSummary } from '$lib/structure/measure'
  import type { TrajectoryLinesStats } from '$lib/structure/trajectory-lines'
  import { get_majority_element } from '$lib/structure/bonding'
  import { is_valid_supercell_input } from '$lib/structure/supercell'
  import { is_periodic } from '$lib/structure/validation'
  import type { CellType, SymmetryDataset } from '$lib/symmetry'
  import { to_error } from '$lib/utils'
  import { untrack, type ComponentProps } from 'svelte'
  import { createAttachmentKey } from 'svelte/attachments'
  import { Icon, MultiSelect as Select } from 'svelte-widgets'
  import { Reset } from 'svelte-widgets/icons'
  import { tooltip } from 'svelte-widgets/attachments'

  let {
    controls_open = $bindable(false),
    scene_props = $bindable({}),
    show_image_atoms = $bindable(DEFAULTS.structure.show_image_atoms),
    supercell_scaling = $bindable(`1x1x1`),
    background_color = $bindable(),
    background_opacity = $bindable(DEFAULTS.background_opacity),
    color_scheme = $bindable(DEFAULTS.color_scheme),
    atom_color_config = $bindable<AtomColorConfig>({ ...DEFAULT_ATOM_COLOR_CONFIG }),
    structure = undefined,
    supercell_loading = false,
    sym_data = null,
    cell_type = $bindable(`original`),
    volumetric_data = $bindable<VolumetricData[]>(),
    isosurface_settings = $bindable<IsosurfaceSettings>(),
    slice_settings = $bindable<Partial<VolumeSliceSettings>>(),
    active_volume_idx = $bindable(0),
    display_mode = `structure`,
    multi_view = $bindable(false),
    multi_view_control_visible = true,
    multi_view_unavailable_reason = undefined,
    polyhedra_rendered_elements = [],
    displacement_summary = null,
    trajectory_lines_result = null,
    show_trajectory_lines = $bindable(DEFAULTS.structure.show_trajectory_lines),
    on_reset_camera,
    fly_to_request = $bindable(undefined),
    persist_settings = false,
    pane_props = {},
    toggle_props = {},
    ...rest
  }: Omit<ComponentProps<typeof ControlPane>, `children`> & {
    controls_open?: boolean // Control pane state
    scene_props?: ComponentProps<typeof StructureScene>
    show_image_atoms?: boolean
    supercell_scaling?: string
    background_color?: string
    background_opacity?: number
    color_scheme?: string
    atom_color_config?: AtomColorConfig
    structure?: AnyStructure
    supercell_loading?: boolean
    sym_data?: SymmetryDataset | null
    cell_type?: CellType // Cell type: original, conventional, or primitive
    volumetric_data?: VolumetricData[] // Volumetric data volumes for isosurface controls
    isosurface_settings?: IsosurfaceSettings // Isosurface rendering settings
    slice_settings?: Partial<VolumeSliceSettings> // 2D cross-section sampling and rendering settings
    active_volume_idx?: number // Active volume index
    display_mode?: StructureDisplayMode
    multi_view?: boolean
    multi_view_control_visible?: boolean
    multi_view_unavailable_reason?: string
    polyhedra_rendered_elements?: string[] // elements currently anchoring polyhedra
    // Displacement-vs-reference readout, bound out of the scene; null hides the whole section
    displacement_summary?: DisplacementSummary | null
    // Trajectory-trail vertex counts, bound out of the scene, shown as a cost readout
    trajectory_lines_result?: TrajectoryLinesStats | null
    show_trajectory_lines?: boolean
    on_reset_camera?: () => void // undefined while camera at home (hides button)
    fly_to_request?: Vec3 // (output) one-shot zone-axis camera command
    persist_settings?: boolean // Opt-in browser persistence for safely scoped single-view usage
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
  } = $props()

  let controls_pane = $state<HTMLDivElement | null>(null)
  let controls_pane_size = $state<StructurePaneSize>()
  let settings_import_status = $state<{ message: string; error: boolean }>()

  // Per-site scalars/vec3s available to color by (charge, velocity, c_pe, ...). Empty for
  // structures whose parser produced no extra columns, in which case the mode is disabled.
  let colorable_property_keys = $derived(get_colorable_property_keys(structure))
  // Single funnel for every mode/property switch. next_atom_color_config derives the
  // dependent fields and returns the current object untouched when nothing would change,
  // so assigning unconditionally is safe even from an effect.
  const set_atom_color_mode = (mode: AtomColorMode, preferred_key?: string): void => {
    atom_color_config = next_atom_color_config(
      atom_color_config,
      mode,
      colorable_property_keys,
      preferred_key,
    )
  }

  const apply_view_state = (state: StructureViewState): void => {
    const structure_settings = structuredClone(state.settings.structure)
    Object.assign(scene_props, structure_settings)
    show_image_atoms =
      structure_settings.show_image_atoms ?? DEFAULTS.structure.show_image_atoms
    show_trajectory_lines =
      structure_settings.show_trajectory_lines ?? DEFAULTS.structure.show_trajectory_lines
    atom_color_config = {
      ...DEFAULT_ATOM_COLOR_CONFIG,
      scale: structure_settings.atom_color_scale ?? DEFAULTS.structure.atom_color_scale,
      scale_type:
        structure_settings.atom_color_scale_type ?? DEFAULTS.structure.atom_color_scale_type,
    }
    // `custom` needs a runtime color_fn that no saved blob can carry, so a stored value
    // that claims it is treated as unset rather than restored into an invalid config.
    const stored_mode =
      structure_settings.atom_color_mode ?? DEFAULTS.structure.atom_color_mode
    set_atom_color_mode(stored_mode === `custom` ? `element` : stored_mode)
    color_scheme = state.settings.color_scheme
    background_color = state.settings.background_color
    background_opacity = state.settings.background_opacity
    supercell_scaling = state.viewer.supercell_scaling
    cell_type = state.viewer.cell_type
    multi_view = state.viewer.multi_view
    controls_pane_size = state.viewer.controls_pane_size
      ? { ...state.viewer.controls_pane_size }
      : undefined
    if (!controls_pane_size && controls_pane) {
      controls_pane.style.width = ``
      controls_pane.style.height = ``
    }
  }

  const restored_view_state = untrack(() =>
    persist_settings ? load_structure_view_state() : null,
  )
  if (restored_view_state) apply_view_state(restored_view_state)

  let current_view_state = $derived(
    create_structure_view_state({
      scene_props,
      show_trajectory_lines,
      color_scheme,
      background_color,
      background_opacity,
      show_image_atoms,
      atom_color_config,
      supercell_scaling,
      cell_type,
      multi_view,
      controls_pane_size,
    }),
  )
  let last_saved_view_state_json: string | undefined

  $effect(() => {
    const state = current_view_state
    const serialized = serialize_structure_view_state(state)
    last_saved_view_state_json ??= serialized
    if (!persist_settings || serialized === last_saved_view_state_json) return
    const save_timeout = setTimeout(() => {
      save_structure_view_state(state)
      last_saved_view_state_json = serialized
    }, 150)
    return () => clearTimeout(save_timeout)
  })

  $effect(() => {
    const pane = controls_pane
    if (!pane) return
    if (controls_pane_size) {
      pane.style.width = `${controls_pane_size.width}px`
      pane.style.height = `${controls_pane_size.height}px`
    }
    const observer = new ResizeObserver(() => {
      if (!pane.style.width || !pane.style.height) return
      const width = Number(pane.style.width.replace(/px$/, ``))
      const height = Number(pane.style.height.replace(/px$/, ``))
      if (!Number.isFinite(width) || !Number.isFinite(height)) return
      if (controls_pane_size?.width === width && controls_pane_size.height === height) {
        return
      }
      controls_pane_size = { width, height }
    })
    observer.observe(pane)
    return () => observer.disconnect()
  })

  const set_status = (message: string, error = false): void => {
    settings_import_status = { message, error }
  }

  const { copied: copied_view_state, copy: copy_view_state_text } = create_clipboard_feedback(
    1200,
    (error) => {
      console.error(`Failed to copy viewer settings to clipboard`, error)
      set_status(`Clipboard access failed`, true)
    },
  )

  const serialize_current_view_state = (): string =>
    serialize_structure_view_state(current_view_state)
  const copy_view_state = (): void =>
    void copy_view_state_text(serialize_current_view_state(), `viewer-settings`)
  const download_view_state = (): void =>
    download(
      serialize_current_view_state(),
      `matterviz-view-settings.json`,
      `application/json`,
    )

  const import_view_state = async (event: Event): Promise<void> => {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) return
    const file = input.files?.[0]
    // Clear before reading so re-picking the same file still fires a change event
    input.value = ``
    if (!file) return
    const text = await file.text().catch(() => null)
    if (text === null) return set_status(`Could not read ${file.name}`, true)
    const { state, error } = deserialize_structure_view_state(text)
    if (!state) return set_status(error, true)
    apply_view_state(state)
    set_status(`Imported ${file.name}`)
  }

  const reset_all_view_settings = (): void => {
    apply_view_state(DEFAULT_STRUCTURE_VIEW_STATE)
    scene_props.vector_configs = {}
    if (persist_settings) clear_structure_view_state()
    set_status(`Restored all viewer defaults`)
  }

  // === Schema-driven rows ===
  // Every uniform control is a Row: the schema entry's value type picks the widget (enum →
  // select, boolean → checkbox, number → slider + number input, string → color swatch).
  // Rows default to reading/writing scene_props[key]; `get`/`set` point one elsewhere (a
  // top-level bindable such as show_image_atoms). `pair` adds a dependent color swatch beside
  // the primary control, and `data_key` names the pseudo-setting the pair resets as one.
  type StructureSettingKey = keyof typeof SETTINGS_CONFIG.structure
  type Row = {
    key: StructureSettingKey
    label: string
    step?: number
    aria_label?: string
    when?: () => boolean // conditional rows (e.g. a color swatch only in uniform mode)
    get?: () => unknown
    set?: (value: unknown) => void
    pair?: { key: StructureSettingKey; when: () => boolean }
    data_key?: SettingKey // pseudo-key a paired row resets and describes as one
  }
  const row = (key: StructureSettingKey, label: string, step?: number): Row => ({
    key,
    label,
    step,
  })
  // A getter, not a const: the parent may rebind scene_props to a fresh object
  const scene_record = () => scene_props as Record<string, unknown>
  const row_value = (current: Row): unknown =>
    current.get ? current.get() : scene_record()[current.key]
  const set_row_value = (current: Row, value: unknown): void => {
    if (current.set) current.set(value)
    else scene_record()[current.key] = value
  }
  const visibility_rows: Row[] = [
    row(`show_atoms`, `Atoms`),
    {
      ...row(`show_image_atoms`, `Image atoms`),
      when: () => periodic,
      get: () => show_image_atoms,
      set: (value) => (show_image_atoms = Boolean(value)),
    },
    row(`show_site_labels`, `Site labels`),
    row(`show_site_indices`, `Site indices`),
    { ...row(`show_cell_vectors`, `Lattice vectors`), when: () => periodic },
  ]
  // Enum pickers rendered below the toggle grid, same section
  const visibility_mode_rows = [row(`show_bonds`, `Bonds`), row(`show_polyhedra`, `Polyhedra`)]
  const atom_rows = [
    row(`atom_radius`, `Radius (Å)`, 0.05),
    row(`same_size_atoms`, `Same size`),
  ]
  const bond_rows: Row[] = [
    row(`bonding_strategy`, `Strategy`),
    row(`auto_bond_order`, `Auto bond order`),
    {
      ...row(`aromatic_display`, `Aromatic`),
      when: () => Boolean(scene_props.auto_bond_order),
    },
    row(`bond_color`, `Color`),
    row(`bond_thickness`, `Thickness`, 0.01),
  ]
  const polyhedra_rows: Row[] = [
    row(`polyhedra_opacity`, `Opacity`, 0.05),
    {
      ...row(`polyhedra_color_mode`, `Color`),
      data_key: `polyhedra_color`,
      pair: {
        key: `polyhedra_color`,
        when: () => scene_props.polyhedra_color_mode === `uniform`,
      },
    },
    {
      ...row(`polyhedra_show_edges`, `Edges`),
      data_key: `polyhedra_edges`,
      pair: {
        key: `polyhedra_edge_color`,
        when: () => Boolean(scene_props.polyhedra_show_edges),
      },
    },
    row(`polyhedra_hide_center_atoms`, `Hide centers`),
    row(`polyhedra_min_neighbors`, `Min neighbors`, 1),
    row(`polyhedra_max_neighbors`, `Max neighbors`, 1),
  ]
  const label_rows: Row[] = [
    { ...row(`site_label_color`, `Color`), aria_label: `Site label color` },
    row(`site_label_size`, `Size`, 0.1),
    row(`site_label_padding`, `Padding`, 1),
  ]
  const vector_rows: Row[] = [
    row(`vector_scale`, `Global scale`, 0.001),
    row(`vector_normalize`, `Normalize`),
    row(`vector_uniform_thickness`, `Uniform width`),
    row(`vector_color_mode`, `Color by`),
    {
      ...row(`vector_color`, `Color`),
      when: () => scene_props.vector_color_mode === `uniform`,
    },
    {
      ...row(`vector_origin_gap`, `Origin gap`, 0.02),
      when: () => available_vector_keys.length > 1,
    },
  ]
  const cell_rows = [
    row(`cell_edge_color`, `Edge color`),
    row(`cell_edge_opacity`, `Edge opacity`, 0.05),
    row(`cell_surface_color`, `Surface color`),
    row(`cell_surface_opacity`, `Surface opacity`, 0.01),
  ]
  const view_rows = [
    row(`camera_projection`, `Projection`),
    row(`auto_rotate`, `Auto-rotate speed`, 0.01),
    row(`zoom_to_cursor`, `Zoom to cursor`),
  ]
  const pointer_rows = [
    row(`rotate_speed`, `Rotate`, 0.05),
    row(`zoom_speed`, `Zoom`, 0.02),
    row(`pan_speed`, `Pan`, 0.01),
    row(`rotation_damping`, `Damping`, 0.01),
  ]
  const lighting_rows = [
    row(`directional_light`, `Directional light`, 0.01),
    row(`ambient_light`, `Ambient light`, 0.05),
  ]
  const displacement_rows: Row[] = [
    row(`show_displacement_arrows`, `Show arrows`),
    row(`displacement_arrow_scale`, `Arrow scale`, 0.1),
    {
      ...row(`displacement_arrow_color`, `Arrow color`),
      aria_label: `Displacement arrow color`,
    },
  ]
  const trail_toggle_row: Row = {
    ...row(`show_trajectory_lines`, `Show trajectory trails`),
    get: () => show_trajectory_lines,
    set: (value) => (show_trajectory_lines = Boolean(value)),
  }
  const trail_rows = [
    row(`trajectory_line_frame_stride`, `Frame stride`),
    row(`trajectory_line_color_mode`, `Color by`),
    row(`trajectory_line_wrap_mode`, `Boundaries`),
  ]
  // Descriptions for every row this pane renders: the schema for real settings, plus entries
  // for the pseudo-keys used by rows that drive more than one setting at once.
  const structure_setting_metadata = {
    ...SETTINGS_CONFIG.structure,
    color_scheme: SETTINGS_CONFIG.color_scheme,
    background_color: SETTINGS_CONFIG.background_color,
    background_opacity: SETTINGS_CONFIG.background_opacity,
    atom_color_property_key: `Per-atom property mapped onto the selected color scale`,
    cell_type: `Transform the displayed structure to its original, conventional, or primitive cell`,
    multi_view: `Show synchronized structure views from multiple directions`,
    polyhedra_centers: `Elements used as centers when constructing coordination polyhedra`,
    polyhedra_color: `Color mode and optional uniform color for coordination polyhedra`,
    polyhedra_edges: `Visibility and color of coordination-polyhedra edges`,
    site_label_bg_hex: `Background color behind atom labels`,
    site_label_bg_opacity: `Opacity of the background behind atom labels`,
    supercell_scaling: `Repeat the unit cell along each lattice direction. Examples: "2x2x2", "3x1x2", or "2"`,
    trajectory_line_elements: `Atomic species whose trajectory trails are displayed`,
    zone_axis: `Point the camera along a crystallographic direction or plane normal`,
  }
  type SettingKey = keyof typeof structure_setting_metadata
  const description_for = (key: SettingKey): string => {
    const metadata = structure_setting_metadata[key]
    return typeof metadata === `string` ? metadata : metadata.description
  }
  const setting_attachment_key = createAttachmentKey()
  // Spread onto a row to tag it for per-row reset/search AND give it its description as a
  // tooltip. Spread (not an attachment) so `data-key` is a real attribute from the first
  // render, which is when SettingsSection's row enhancer takes its inventory. `tip` is only for
  // the handful of rows whose advice depends on the structure (no lattice, no symmetry yet).
  const setting_row = (key: SettingKey, tip?: string) => {
    const description = tip ?? description_for(key)
    return {
      'data-key': key,
      'aria-description': description,
      [setting_attachment_key]: tooltip({ content: description }),
    }
  }

  // A section's rows drive both its "changed" indicator and its reset, so a new setting can't
  // be registered in one and forgotten in the other: plain rows reset scene_props[key] directly,
  // rows with accessors or pairs reset through them. `extra_keys` covers bespoke controls
  // (rotation sliders, label offset) that still live on scene_props; `accessors` the pseudo-keys
  // whose rows drive several settings at once. No section-level reset: SettingsSection replays
  // `on_reset_key` over every changed key, so the section heading and the per-row buttons both
  // restore what this pane mounted with. "Reset all" under Preferences returns to shipped defaults.
  type Accessor = { get: () => unknown; set: (value: unknown, present: boolean) => void }
  const local = <T>(get: () => T, set: (value: T, present: boolean) => void): Accessor => ({
    get,
    set: (value, present) => set(value as T, present),
  })
  // One row driving two scene props (a mode plus its color, say). Sharing a key means the row's
  // reset restores both halves at once instead of leaving a half-reverted pair behind.
  const scene_pair = (left: StructureSettingKey, right: StructureSettingKey) =>
    local(
      () => ({ [left]: scene_record()[left], [right]: scene_record()[right] }),
      (reference) => Object.assign(scene_props, reference),
    )
  const scene_section = (
    rows: readonly Row[],
    accessors: Record<string, Accessor> = {},
    extra_keys: StructureSettingKey[] = [],
  ) => {
    const keys = [...extra_keys]
    for (const current of rows) {
      if (current.pair) {
        accessors[current.data_key ?? current.key] = scene_pair(current.key, current.pair.key)
      } else if (current.get && current.set) {
        accessors[current.key] = local(current.get, current.set)
      } else keys.push(current.key)
    }
    return {
      current_values: Object.fromEntries([
        ...keys.map((key) => [key, scene_record()[key] ?? DEFAULTS.structure[key]]),
        ...Object.entries(accessors).map(([key, accessor]) => [key, accessor.get()]),
      ]),
      on_reset_key: (key: string, reference_value: unknown, reference_present: boolean) => {
        const accessor = accessors[key]
        if (accessor) return accessor.set(reference_value, reference_present)
        if (reference_present) scene_record()[key] = reference_value
        else Reflect.deleteProperty(scene_props, key)
      },
      setting_metadata: structure_setting_metadata,
    }
  }

  const controls_id = $props.id()
  const multi_view_hint_id = `multi-view-hint-${controls_id}`
  let multi_view_blocked = $derived(Boolean(multi_view_unavailable_reason) && !multi_view)

  // Selective-dynamics coloring needs at least one site declaring the property (POSCAR
  // "Selective dynamics" block); without it every atom would land in one `unknown` bucket.
  let color_mode_options = $derived(
    get_atom_color_mode_options({
      has_sym_data: Boolean(sym_data),
      has_selective_dynamics: structure_has_selective_dynamics(structure),
      colorable_property_keys,
    }),
  )

  // A newly loaded structure may not carry the property being colored by, in which case
  // the mode drops back to element colors.
  $effect(() => {
    if (atom_color_config.mode === `property`) {
      set_atom_color_mode(`property`, atom_color_config.property_key)
    }
  })

  // Zone-axis camera: [uvw] is a direct-lattice direction, (hkl) a reciprocal one, so both
  // need a lattice — molecules have no crystallographic directions to look down.
  let zone_axis_indices = $state<Vec3>([0, 0, 1])
  let zone_axis_mode = $state<ZoneAxisMode>(`uvw`)
  let lattice_matrix = $derived(
    structure && `lattice` in structure ? structure.lattice.matrix : null,
  )

  // Resolved eagerly rather than on click so a degenerate cell (or, in hkl mode, any
  // singular one) disables the button and explains why, instead of throwing out of the
  // handler. Derived, so the message clears itself as soon as the indices or mode change.
  let zone_axis = $derived.by(() => {
    // Molecules have no crystallographic directions; the button's own title already says so
    if (!lattice_matrix) return { direction: null, error: `` }
    // The indices can be set programmatically to anything, which would otherwise grey the
    // button out with no reason given.
    if (!is_valid_zone_axis(zone_axis_indices)) {
      const error = `${zone_axis_mode} indices must be finite and not all zero`
      return { direction: null, error }
    }
    try {
      const indices = [...zone_axis_indices] as Vec3
      return {
        direction: zone_axis_direction(lattice_matrix, indices, zone_axis_mode),
        error: ``,
      }
    } catch (exc) {
      return { direction: null, error: to_error(exc).message }
    }
  })
  // The scene clears this as it starts the flight, so re-clicking the same axis flies again
  const fly_to_zone_axis = () => {
    if (zone_axis.direction) fly_to_request = zone_axis.direction
  }

  // Unique majority elements in the structure, for polyhedra center toggles.
  // Majority (not all) species so the list matches what compute_polyhedra can
  // actually use as centers - minority occupancies of disordered sites never are.
  let structure_elements = $derived(
    [
      ...new Set((structure?.sites ?? []).flatMap((site) => get_majority_element(site) ?? [])),
    ].toSorted(),
  )

  // An element counts as an enabled polyhedra center if it isn't excluded and is
  // either force-included or currently rendered. Using configured intent (not just
  // the transient render state) keeps the checkbox reversible: a force-included
  // element that the CN/geometry filters can't render still shows checked, so the
  // user can toggle it back off.
  const is_polyhedra_center_enabled = (element: string): boolean => {
    const excluded = scene_props.polyhedra_excluded_elements ?? []
    const included = scene_props.polyhedra_included_elements ?? []
    return (
      !excluded.includes(element) &&
      (included.includes(element) || polyhedra_rendered_elements.includes(element))
    )
  }

  // Toggle an element as polyhedra center. Enabled elements get excluded; disabled
  // ones get force-included (which also bypasses the automatic hiding of spectator
  // cations like Li/Na/Ba).
  function toggle_polyhedra_element(element: string) {
    const excluded = scene_props.polyhedra_excluded_elements ?? []
    const included = scene_props.polyhedra_included_elements ?? []
    if (is_polyhedra_center_enabled(element)) {
      scene_props.polyhedra_excluded_elements = [...new Set([...excluded, element])]
      scene_props.polyhedra_included_elements = included.filter((el) => el !== element)
    } else {
      scene_props.polyhedra_excluded_elements = excluded.filter((el) => el !== element)
      scene_props.polyhedra_included_elements = [...new Set([...included, element])]
    }
  }

  // Species in the collected trajectory stream, for the trail filter. A Li-ion conductor
  // wants Li trails and not the framework, so narrowing this is usually the first move.
  let trail_elements = $derived(
    [...new Set(scene_props.trajectory_position_stream?.elements)].toSorted(),
  )
  // A null filter means "every species", which is also the state the checkboxes start in
  const is_trail_element_on = (element: ElementSymbol): boolean =>
    scene_props.trajectory_line_elements?.includes(element) ?? true

  function toggle_trail_element(element: ElementSymbol) {
    const current = scene_props.trajectory_line_elements ?? trail_elements
    scene_props.trajectory_line_elements = is_trail_element_on(element)
      ? current.filter((elem) => elem !== element)
      : [...current, element]
  }

  const hex_color_pattern = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i
  const color_mix_pattern =
    /^color-mix\(in srgb,\s*(?<hex>#[0-9a-f]{3}(?:[0-9a-f]{3})?)\s+(?<pct>\d+(?:\.\d+)?)%,\s*transparent\)$/i

  const as_hex_color = (color: string | undefined, fallback: string): string =>
    color?.match(hex_color_pattern)?.[0] ?? fallback

  // Every unparsable background (`transparent` included) reports zero opacity, so a picked hex
  // would be lost the moment the slider bottoms out. `remembered_hex` carries it across.
  const parse_label_bg_color = (
    color: string | undefined,
    remembered_hex: string,
  ): { hex_color: string; opacity: number } => {
    const color_mix = color?.match(color_mix_pattern)
    if (color_mix) {
      return {
        hex_color: color_mix[1],
        opacity: clamp(Number(color_mix[2]), 0, 100) / 100,
      }
    }
    const hex_color = color?.match(hex_color_pattern)?.[0]
    return hex_color === undefined
      ? { hex_color: remembered_hex, opacity: 0 }
      : { hex_color, opacity: 1 }
  }

  // Derived from scene_props rather than mirrored into local state: the two label colors are
  // CSS strings the scene owns, and only the hex behind a fully transparent background has
  // nowhere in that string to live.
  let site_label_bg_hex = $state(
    parse_label_bg_color(scene_props.site_label_bg_color, `#000000`).hex_color,
  )
  let site_label_bg = $derived(
    parse_label_bg_color(scene_props.site_label_bg_color, site_label_bg_hex),
  )
  const set_site_label_bg = (hex_color: string, opacity: number): void => {
    site_label_bg_hex = hex_color
    // Fully transparent round-trips as `transparent`, else merely touching the slider rewrites
    // that default into an equivalent color-mix nobody asked for.
    scene_props.site_label_bg_color =
      opacity === 0
        ? `transparent`
        : `color-mix(in srgb, ${hex_color} ${format_num(opacity, `.1~%`)}, transparent)`
  }
  // The swatch, the opacity slider and the two reset accessors all pair the same getter with the
  // same setter. Naming each pair once stops a change to one from desynchronising the others.
  const get_label_bg_hex = (): string => site_label_bg.hex_color
  const set_label_bg_hex = (hex_color: string): void =>
    set_site_label_bg(hex_color, site_label_bg.opacity)
  const get_label_bg_opacity = (): number => site_label_bg.opacity
  const set_label_bg_opacity = (opacity: number | undefined): void =>
    set_site_label_bg(site_label_bg.hex_color, opacity ?? 0)

  // Collect available vector property keys from the structure
  let available_vector_keys = $derived(structure ? get_structure_vector_keys(structure) : [])
  const is_key_visible = (key: string): boolean =>
    scene_props.vector_configs?.[key]?.visible !== false

  let any_vectors_visible = $derived(available_vector_keys.some(is_key_visible))

  function update_vector_config(key: string, patch: Partial<VectorLayerConfig>) {
    const configs = { ...scene_props.vector_configs }
    configs[key] = {
      ...(configs[key] ?? { visible: true, color: null, scale: null }),
      ...patch,
    }
    scene_props.vector_configs = configs
  }
  // A vector row in Visibility owns visibility and color only. Tracking the whole config there
  // would make a per-key scale edit (owned by Site vectors) light up that section's reset,
  // which would then wipe the scale on its way past.
  const vector_visibility_accessors = (): Record<string, Accessor> =>
    Object.fromEntries(
      available_vector_keys.map((key, key_idx) => [
        `vector_config:${key}`,
        local(
          () => ({
            visible: is_key_visible(key),
            color:
              scene_props.vector_configs?.[key]?.color ??
              (available_vector_keys.length > 1
                ? VECTOR_PALETTE[key_idx % VECTOR_PALETTE.length]
                : null),
          }),
          (reference, present) =>
            update_vector_config(key, present ? reference : { visible: true, color: null }),
        ),
      ]),
    )
  // Per-key scales live in vector_configs rather than on a scene_props key of their own, so
  // without an accessor a scale-only edit would never reveal a reset
  const vector_scale_accessors = (): Record<string, Accessor> =>
    Object.fromEntries(
      available_vector_keys.map((key) => [
        `vector_scale:${key}`,
        local(
          () => scene_props.vector_configs?.[key]?.scale ?? null,
          (scale) => update_vector_config(key, { scale }),
        ),
      ]),
    )

  function update_label_offset(axis_idx: number, value: number) {
    const offset = scene_props.site_label_offset ?? DEFAULTS.structure.site_label_offset
    scene_props.site_label_offset = offset.with(axis_idx, value) as Vec3
  }

  // Cell styling/tiling needs a lattice; image atoms and cell reduction need periodicity.
  let has_lattice = $derived(
    structure && `lattice` in structure && structure.lattice !== undefined,
  )
  let periodic = $derived(is_periodic(structure))

  // Validate supercell input
  let supercell_input_valid = $derived(is_valid_supercell_input(supercell_scaling))

  // Rotation is stored in radians; the sliders show degrees in [0, 360)
  let rotation_degrees = $derived(
    scene_props.rotation?.map((rad) => ((to_degrees(rad) % 360) + 360) % 360) ?? [0, 0, 0],
  )

  function update_rotation(axis_idx: number, degrees: number) {
    const radians = to_radians(((clamp(degrees, 0, 360) % 360) + 360) % 360)
    scene_props.rotation = (scene_props.rotation ?? [0, 0, 0]).with(axis_idx, radians) as Vec3
  }

  // Sample colors for common elements, used to preview an element color scheme
  function get_representative_colors(scheme_name: string): string[] {
    const scheme = ELEMENT_COLOR_SCHEMES[scheme_name as ColorSchemeName]
    if (!scheme) return []
    return [`H`, `C`, `N`, `O`].map((elem) => scheme[elem] || scheme.H || `#cccccc`)
  }

  // Which top-level groups start expanded. Appearance is what people came for; camera and
  // scene are set-once topics, so they stay folded until asked for. Conditional groups open
  // when present — they only render at all because the data made them relevant.
  let open_groups = $state({ appearance: true, camera: false, scene: false })
  let has_overlays = $derived(
    Boolean(displacement_summary) || scene_props.trajectory_position_stream !== undefined,
  )
  // Collapsed groups still need to say what is inside them, so each summary carries a hint
  let camera_summary = $derived(
    `${scene_props.camera_projection ?? DEFAULTS.structure.camera_projection}${
      (scene_props.auto_rotate ?? 0) > 0 ? `, auto-rotating` : ``
    }`,
  )
</script>

<!-- Declared outside <ControlPane> so they are template snippets, not props of the pane -->
{#snippet enum_options(key: StructureSettingKey)}
  {#each Object.entries(SETTINGS_CONFIG.structure[key].enum ?? {}) as [value, label] (value)}
    <option {value}>{label}</option>
  {/each}
{/snippet}

<!-- One checkbox chip per element (polyhedra centers, trail species) -->
{#snippet element_chips(
  key: SettingKey,
  label: string,
  elements: readonly ElementSymbol[],
  is_on: (element: ElementSymbol) => boolean,
  toggle: (element: ElementSymbol) => void,
  tip?: string,
)}
  <div class="setting" {...setting_row(key, tip)}>
    <span>{label}</span>
    <div class="chip-row">
      {#each elements as element (element)}
        <label>
          <input type="checkbox" checked={is_on(element)} onchange={() => toggle(element)} />
          {element}
        </label>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet setting_rows(rows: readonly Row[])}
  {#each rows as current (current.key)}
    {@const { key, label, step, aria_label, pair } = current}
    {#if current.when?.() ?? true}
      {@const schema = SETTINGS_CONFIG.structure[key]}
      {@const set = (value: unknown) => set_row_value(current, value)}
      {#if typeof schema.value === `number`}
        <NumberRangeInput
          setting={key}
          schema={SETTINGS_CONFIG.structure}
          {step}
          bind:value={() => row_value(current) as number | undefined, set}
          >{label}</NumberRangeInput
        >
      {:else}
        <label {...setting_row(current.data_key ?? key)}>
          <span>{label}</span>
          <span class="ctrl-pair">
            {#if schema.enum}
              <select bind:value={() => row_value(current), set}>
                {@render enum_options(key)}
              </select>
            {:else if typeof schema.value === `boolean`}
              <input type="checkbox" bind:checked={() => Boolean(row_value(current)), set} />
            {:else}
              <input
                class="swatch"
                type="color"
                aria-label={aria_label}
                bind:value={
                  () =>
                    as_hex_color(
                      row_value(current) as string | undefined,
                      String(schema.value),
                    ),
                  set
                }
              />
            {/if}
            {#if pair?.when()}
              <input
                class="swatch"
                type="color"
                bind:value={
                  () => scene_record()[pair.key] as string | undefined,
                  (value) => (scene_record()[pair.key] = value)
                }
              />
            {/if}
          </span>
        </label>
      {/if}
    {/if}
  {/each}
{/snippet}

<ControlPane
  bind:controls_open
  bind:pane={controls_pane}
  resize="both"
  pane_class="controls-pane"
  toggle_class="structure-controls-toggle"
  pane_style="--pane-max-height: 70vh; --pane-padding: 1ex 1ex 0;"
  toggle_style=""
  toggle_props={{
    title: controls_open ? `` : `Structure controls`,
    ...toggle_props,
    'aria-label': toggle_props?.[`aria-label`] ?? `Structure controls`,
  }}
  {pane_props}
  {...rest}
>
  {#if on_reset_camera}
    <!-- Hoisted out of the Camera group: the one action people reach for repeatedly should
      not sit behind a disclosure triangle -->
    <button
      type="button"
      class="reset-camera"
      title={RESET_VIEW_TITLE}
      onclick={on_reset_camera}
    >
      <Icon icon={Reset} />
      <span>Reset view</span>
      <kbd>r</kbd>
    </button>
  {/if}

  <SettingsSearch trigger="icon">
    {#if volumetric_data?.length}
      <SettingsGroup
        title="Volumetric data"
        open
        subtitle={display_mode === `slice` ? `cross-section` : `isosurface`}
      >
        {#if display_mode === `slice` && slice_settings}
          <VolumeSliceControls
            bind:settings={slice_settings}
            volumes={volumetric_data}
            bind:active_volume_idx
          />
        {:else if isosurface_settings}
          <IsosurfaceControls
            bind:settings={isosurface_settings}
            bind:volumes={volumetric_data}
            bind:active_volume_idx
          />
        {/if}
      </SettingsGroup>
    {/if}

    <SettingsGroup title="Appearance" bind:open={open_groups.appearance}>
      {#key available_vector_keys.join(`\0`)}
        <SettingsSection
          title="Visibility"
          layout="grid"
          {...scene_section(
            [...visibility_rows, ...visibility_mode_rows],
            vector_visibility_accessors(),
          )}
        >
          <div class="toggle-grid">
            {@render setting_rows(visibility_rows)}
            {#each available_vector_keys as key, idx (key)}
              {@const key_visible = is_key_visible(key)}
              {@const description = `Visibility and color of ${key} vectors`}
              <label
                data-key={`vector_config:${key}`}
                data-description={description}
                {@attach tooltip({ content: description })}
              >
                <input
                  type="checkbox"
                  checked={key_visible}
                  onchange={() => update_vector_config(key, { visible: !key_visible })}
                />
                <input
                  class="swatch"
                  type="color"
                  aria-label={`${key} vector color`}
                  value={scene_props.vector_configs?.[key]?.color ??
                    VECTOR_PALETTE[idx % VECTOR_PALETTE.length]}
                  onchange={(evt) =>
                    update_vector_config(key, { color: evt.currentTarget.value })}
                />
                {key}
                {#if scene_props.vector_configs?.[key]?.color != null}
                  <button
                    type="button"
                    class="clear-color"
                    aria-label={`Reset ${key} color to default`}
                    onclick={() => update_vector_config(key, { color: null })}
                  >
                    ×
                  </button>
                {/if}
              </label>
            {/each}
          </div>
          {@render setting_rows(visibility_mode_rows)}
        </SettingsSection>
      {/key}

      <SettingsSection
        title="Atoms"
        layout="grid"
        {...scene_section(atom_rows, {
          color_scheme: local(
            () => color_scheme,
            (value) => (color_scheme = value),
          ),
          // scale_type is derived from the mode, so the two travel as one row
          atom_color_mode: local(
            () => ({ mode: atom_color_config.mode, scale_type: atom_color_config.scale_type }),
            (reference) => set_atom_color_mode(reference.mode),
          ),
          atom_color_scale: local(
            () => atom_color_config.scale,
            (value) => (atom_color_config.scale = value),
          ),
          atom_color_property_key: local(
            () =>
              `property_key` in atom_color_config ? atom_color_config.property_key : undefined,
            (value, present) =>
              set_atom_color_mode(present && value ? `property` : `element`, value),
          ),
        })}
      >
        {@render setting_rows(atom_rows)}
        <label {...setting_row(`color_scheme`)}>
          <span>Color scheme</span>
          <Select
            options={Object.keys(ELEMENT_COLOR_SCHEMES)}
            maxSelect={1}
            minSelect={1}
            bind:value={color_scheme}
            liOptionStyle="padding: 3pt 6pt;"
            liSelectedStyle="background-color: transparent;"
            ulSelectedStyle="display: contents;"
            inputStyle="flex: none; min-width: 0; width: 0; opacity: 0;"
            style="min-width: 0; border: none"
            aria-label="Color scheme"
          >
            {#snippet children({ option })}
              <div class="scheme-option">
                {option}
                <div class="scheme-swatches">
                  {#each get_representative_colors(String(option)) as color (color)}
                    <div style:background={color}></div>
                  {/each}
                </div>
              </div>
            {/snippet}
          </Select>
        </label>
        <label {...setting_row(`atom_color_mode`)}>
          <span>Color by</span>
          <select
            value={atom_color_config.mode}
            onchange={(event) =>
              set_atom_color_mode(event.currentTarget.value as AtomColorMode)}
          >
            {#each color_mode_options as [value, label, unavailable] (value)}
              <option
                {value}
                disabled={Boolean(unavailable)}
                title={unavailable ?? undefined}
                aria-describedby={unavailable ? `${controls_id}-${value}-hint` : undefined}
                >{unavailable ? `${label} — ${unavailable}` : label}</option
              >
            {/each}
          </select>
        </label>
        {#each color_mode_options as [value, label, unavailable] (value)}
          {#if unavailable}
            <small id={`${controls_id}-${value}-hint`} class="setting-hint">
              {label}: {unavailable}
            </small>
          {/if}
        {/each}
        {#if atom_color_config.mode === `property` && colorable_property_keys.length > 0}
          <label {...setting_row(`atom_color_property_key`)}>
            <span>Property</span>
            <select
              value={atom_color_config.property_key}
              onchange={(event) => set_atom_color_mode(`property`, event.currentTarget.value)}
            >
              {#each colorable_property_keys as key (key)}
                <option value={key}>{key}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if atom_color_config.mode !== `element`}
          <label {...setting_row(`atom_color_scale`)}>
            <span>Color scale</span>
            <ColorScaleSelect
              bind:value={
                () => atom_color_config.scale, (scale) => (atom_color_config.scale = scale)
              }
              color_bar={{ tick_labels: 0, wrapper_style: `width: 100%;` }}
              style="min-width: 0; border: none"
              aria-label="Color scale"
            />
          </label>
        {/if}
      </SettingsSection>

      {#if scene_props.show_bonds && scene_props.show_bonds !== `never`}
        <SettingsSection title="Bonds" layout="grid" {...scene_section(bond_rows)}>
          {@render setting_rows(bond_rows)}
        </SettingsSection>
      {/if}

      {#if scene_props.show_polyhedra && scene_props.show_polyhedra !== `never`}
        <SettingsSection
          title="Polyhedra"
          layout="grid"
          {...scene_section(polyhedra_rows, {
            polyhedra_centers: scene_pair(
              `polyhedra_excluded_elements`,
              `polyhedra_included_elements`,
            ),
          })}
        >
          {@render setting_rows(polyhedra_rows)}
          {#if structure_elements.length > 0}
            {@render element_chips(
              `polyhedra_centers`,
              `Centers`,
              structure_elements,
              is_polyhedra_center_enabled,
              toggle_polyhedra_element,
              `${description_for(`polyhedra_excluded_elements`)}. Force-including a spectator ` +
                `center (alkali or heavy alkaline-earth, e.g. Li, Na, Ba) may render its ` +
                `polyhedra truncated at cell boundaries.`,
            )}
          {/if}
        </SettingsSection>
      {/if}

      {#if scene_props.show_site_labels || scene_props.show_site_indices}
        <SettingsSection
          title="Labels"
          layout="grid"
          {...scene_section(
            label_rows,
            {
              // One CSS string drives two controls, so each half gets its own key: keying both
              // rows off site_label_bg_color would offer a reset on the swatch for an edit the
              // user made with the opacity slider.
              site_label_bg_hex: local(get_label_bg_hex, set_label_bg_hex),
              site_label_bg_opacity: local(get_label_bg_opacity, set_label_bg_opacity),
            },
            [`site_label_offset`],
          )}
        >
          {@render setting_rows(label_rows)}
          <label {...setting_row(`site_label_bg_hex`)}>
            <span>Background</span>
            <input
              class="swatch"
              type="color"
              aria-label="Site label background color"
              bind:value={get_label_bg_hex, set_label_bg_hex}
            />
          </label>
          <NumberRangeInput
            data-key="site_label_bg_opacity"
            min={0}
            max={1}
            step={0.01}
            title={description_for(`site_label_bg_opacity`)}
            bind:value={get_label_bg_opacity, set_label_bg_opacity}>Opacity</NumberRangeInput
          >
          <div class="setting" {...setting_row(`site_label_offset`)}>
            <span>Offset</span>
            <div class="axis-inputs">
              {#each [`X`, `Y`, `Z`] as axis, idx (axis)}
                <label>
                  {axis}
                  <input
                    type="number"
                    min="-1"
                    max="1"
                    step="0.1"
                    value={scene_props.site_label_offset?.[idx] ??
                      DEFAULTS.structure.site_label_offset[idx]}
                    oninput={(event) =>
                      update_label_offset(idx, Number(event.currentTarget.value))}
                  />
                </label>
              {/each}
            </div>
          </div>
        </SettingsSection>
      {/if}

      {#if available_vector_keys.length > 0 && any_vectors_visible}
        {#key available_vector_keys.join(`\0`)}
          <SettingsSection
            title="Site vectors"
            layout="grid"
            {...scene_section(vector_rows, vector_scale_accessors(), [`vector_color_scale`])}
          >
            {@render setting_rows(vector_rows)}
            {#if scene_props.vector_color_mode === `magnitude`}
              <label {...setting_row(`vector_color_scale`)}>
                <span>Color scale</span>
                <ColorScaleSelect
                  bind:value={scene_props.vector_color_scale}
                  style="min-width: 0; border: none"
                />
              </label>
            {/if}
            {#if available_vector_keys.length > 1}
              {#each available_vector_keys.filter(is_key_visible) as key (key)}
                {@const description = `Scale multiplier for ${key} arrows (applied on top of global scale)`}
                <NumberRangeInput
                  data-key={`vector_scale:${key}`}
                  data-description={description}
                  min={0.1}
                  max={5}
                  step={0.1}
                  title={description}
                  bind:value={
                    () => scene_props.vector_configs?.[key]?.scale ?? 1.0,
                    (scale) => update_vector_config(key, { scale: scale ?? 1.0 })
                  }
                >
                  <span>{key} scale</span>
                </NumberRangeInput>
              {/each}
            {/if}
          </SettingsSection>
        {/key}
      {/if}

      {#if has_lattice}
        <SettingsSection
          title="Cell"
          layout="grid"
          {...scene_section(cell_rows, {
            supercell_scaling: local(
              () => supercell_scaling,
              (value) => (supercell_scaling = value),
            ),
            ...(periodic
              ? {
                  cell_type: local(
                    () => cell_type,
                    (value) => (cell_type = value),
                  ),
                }
              : {}),
          })}
        >
          {#if periodic}
            <label
              {...setting_row(
                `cell_type`,
                sym_data
                  ? description_for(`cell_type`)
                  : `Symmetry analysis required. Wait for analysis to complete.`,
              )}
            >
              <span>Cell type</span>
              <select bind:value={cell_type} disabled={!sym_data}>
                <option value="original">Original</option>
                <option value="conventional">Conventional</option>
                <option value="primitive">Primitive</option>
              </select>
            </label>
          {/if}
          <label {...setting_row(`supercell_scaling`)}>
            <span>Supercell</span>
            <input
              type="text"
              bind:value={supercell_scaling}
              placeholder="1x1x1"
              style="border: {supercell_input_valid
                ? undefined
                : `1px dashed red`}; opacity: {supercell_loading ? 0.5 : 1}"
              disabled={supercell_loading}
              inputmode="text"
              autocomplete="off"
              spellcheck="false"
              pattern="^(\d+|\d+x\d+x\d+)$"
              aria-invalid={!supercell_input_valid}
              title={supercell_input_valid
                ? `Valid supercell scaling: ${supercell_scaling}`
                : `Invalid format. Use "2x2x2", "3x1x2", or "2"`}
            />
          </label>
          {#if supercell_loading}
            <Spinner
              text="Generating supercell..."
              style="--spinner-size: 12px; --spinner-border-width: 2px; --spinner-margin: 4pt 0 0; font-size: 0.85em; color: var(--accent-color)"
            />
          {/if}
          {#if !supercell_input_valid}
            <small data-testid="supercell-input-error" class="control-error">
              Invalid format. Use patterns like "2x2x2", "3x1x2", or "2".
            </small>
          {/if}
          {@render setting_rows(cell_rows)}
        </SettingsSection>
      {/if}
    </SettingsGroup>

    <SettingsGroup title="Camera" bind:open={open_groups.camera} subtitle={camera_summary}>
      <SettingsSection
        title="View"
        layout="grid"
        {...scene_section(
          view_rows,
          {
            multi_view: local(
              () => multi_view,
              (value) => (multi_view = value),
            ),
          },
          [`rotation`],
        )}
      >
        {@render setting_rows(view_rows)}
        {#if multi_view_control_visible && display_mode === `structure`}
          <label {...setting_row(`multi_view`)} class:disabled={multi_view_blocked}>
            <span>Multi-view grid</span>
            <input
              type="checkbox"
              bind:checked={multi_view}
              disabled={multi_view_blocked}
              aria-describedby={multi_view_unavailable_reason ? multi_view_hint_id : undefined}
            />
          </label>
          {#if multi_view_unavailable_reason}
            <small id={multi_view_hint_id} class="setting-hint">
              {multi_view_unavailable_reason}
            </small>
          {/if}
        {/if}
        <div class="rotation-axes" data-key="rotation">
          {#each AXIS_COLORS as [axis, color], idx (axis)}
            <NumberRangeInput
              min={0}
              max={360}
              step={1}
              title="{axis}-axis rotation in degrees"
              style={`--thumb-color: ${color}`}
              bind:value={
                () => Math.round(rotation_degrees[idx]),
                (degrees) => update_rotation(idx, degrees ?? 0)
              }
            >
              <span style:color>{axis.toUpperCase()} rotation</span>
            </NumberRangeInput>
          {/each}
        </div>
        <!-- Two rows rather than one: the mode names are sentences ("Plane normal (hkl)") and
        sharing a row with the indices and the button truncated all three -->
        <div
          class="zone-axis"
          {...setting_row(
            `zone_axis`,
            lattice_matrix
              ? description_for(`zone_axis`)
              : `Needs a lattice — molecules have no crystallographic directions`,
          )}
        >
          <label>
            <span>Look down</span>
            <select
              bind:value={zone_axis_mode}
              aria-label="Zone axis index type"
              disabled={!lattice_matrix}
            >
              {#each Object.entries(ZONE_AXIS_MODE_LABELS) as [mode, mode_label] (mode)}
                <option value={mode}>{mode_label}</option>
              {/each}
            </select>
          </label>
          <div class="setting">
            <span>Indices</span>
            <span class="ctrl-pair">
              <MillerIndexInput
                bind:value={zone_axis_indices}
                label={zone_axis_mode}
                disabled={!lattice_matrix}
              />
              <button type="button" onclick={fly_to_zone_axis} disabled={!zone_axis.direction}>
                View
              </button>
            </span>
          </div>
          {#if zone_axis.error}
            <small class="control-error">{zone_axis.error}</small>
          {/if}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Pointer sensitivity"
        layout="grid"
        {...scene_section(pointer_rows)}
      >
        {@render setting_rows(pointer_rows)}
      </SettingsSection>
    </SettingsGroup>

    <SettingsGroup title="Scene" bind:open={open_groups.scene}>
      <SettingsSection
        title="Background"
        layout="grid"
        {...scene_section([], {
          background_color: local(
            () => background_color,
            (value) => (background_color = value),
          ),
          background_opacity: local(
            () => background_opacity,
            (value) => (background_opacity = value),
          ),
        })}
      >
        <label {...setting_row(`background_color`)}>
          <span>Color</span>
          <!-- not using bind:value to not give a default value of #000000 to background_color,
          needs to stay undefined to not override --struct-bg theme color -->
          <input
            class="swatch"
            type="color"
            value={background_color}
            oninput={(event) => (background_color = event.currentTarget.value)}
          />
        </label>
        <NumberRangeInput
          setting="background_opacity"
          schema={{ background_opacity: SETTINGS_CONFIG.background_opacity }}
          step={0.02}
          bind:value={background_opacity}>Opacity</NumberRangeInput
        >
      </SettingsSection>

      <SettingsSection title="Lighting" layout="grid" {...scene_section(lighting_rows)}>
        {@render setting_rows(lighting_rows)}
      </SettingsSection>
    </SettingsGroup>

    {#if has_overlays}
      <SettingsGroup title="Overlays" open>
        {#if displacement_summary}
          <SettingsSection
            title="Displacement Overlay"
            layout="grid"
            {...scene_section(displacement_rows)}
          >
            <!-- `!== null` (not truthiness) so the union discriminates: an empty error string
            would leave the else branch un-narrowed and rmsd possibly undefined -->
            {#if displacement_summary.error !== null}
              <small class="control-error">{displacement_summary.error}</small>
            {:else}
              <div class="readout">
                <span
                  >RMSD <strong>{format_num(displacement_summary.rmsd, `.4~f`)} Å</strong
                  ></span
                >
                <span>
                  Max <strong
                    >{format_num(displacement_summary.max_displacement, `.4~f`)} Å</strong
                  >
                </span>
              </div>
              {@render setting_rows(displacement_rows)}
            {/if}
          </SettingsSection>
        {/if}

        <!-- Only the trajectory viewer can collect a whole-run position stream, so this section
        is absent for plain structures rather than showing dead controls -->
        {#if scene_props.trajectory_position_stream !== undefined}
          <SettingsSection
            title="Trajectory Trails"
            layout="grid"
            {...scene_section(
              [trail_toggle_row, ...trail_rows],
              {
                trajectory_line_elements: local(
                  () => scene_props.trajectory_line_elements,
                  (value) => (scene_props.trajectory_line_elements = value),
                ),
              },
              [`trajectory_line_trail_frames`],
            )}
          >
            {@render setting_rows([trail_toggle_row])}
            {#if show_trajectory_lines && scene_props.trajectory_position_stream}
              {#if trail_elements.length > 1}
                {@render element_chips(
                  `trajectory_line_elements`,
                  `Species`,
                  trail_elements,
                  is_trail_element_on,
                  toggle_trail_element,
                )}
              {/if}
              <NumberRangeInput
                setting="trajectory_line_trail_frames"
                schema={SETTINGS_CONFIG.structure}
                max={Math.max(1, scene_props.trajectory_position_stream.n_frames)}
                bind:value={scene_props.trajectory_line_trail_frames}
                >Trail length <small>(0 = all)</small></NumberRangeInput
              >
              {@render setting_rows(trail_rows)}
              {#if trajectory_lines_result}
                {@const { point_count, segment_count, atom_count, max_segment_length } =
                  trajectory_lines_result}
                <div class="readout">
                  <span>{format_num(atom_count, `.3~s`)} atoms</span>
                  <span>{format_num(point_count, `.3~s`)} vertices</span>
                  <span>{format_num(segment_count, `.3~s`)} segments</span>
                  <span
                    {@attach tooltip({
                      content:
                        `Longest drawn segment. With unwrapping on this stays at the scale of a ` +
                        `real per-step displacement; a value near a cell diagonal means the path ` +
                        `is jumping across the box.`,
                    })}
                  >
                    max step <strong>{format_num(max_segment_length, `.3~f`)} Å</strong>
                  </span>
                </div>
              {/if}
            {:else if show_trajectory_lines}
              <Spinner text="Collecting trajectory positions..." style="margin: 4pt 0" />
            {/if}
          </SettingsSection>
        {/if}
      </SettingsGroup>
    {/if}

    <SettingsGroup
      title="Preferences"
      subtitle={persist_settings ? `saved in this browser` : `session only`}
    >
      <div class="settings-actions">
        <button type="button" onclick={copy_view_state} aria-label="Copy viewer settings JSON">
          {copied_view_state.has(`viewer-settings`) ? `Copied ✓` : `Copy JSON`}
        </button>
        <button
          type="button"
          onclick={download_view_state}
          aria-label="Download viewer settings JSON"
        >
          Download JSON
        </button>
        <label class="import-settings">
          Import JSON
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Import viewer settings JSON"
            onchange={import_view_state}
          />
        </label>
        <button
          type="button"
          class="reset-all-settings"
          onclick={reset_all_view_settings}
          aria-label="Reset all viewer settings to defaults"
        >
          Reset all
        </button>
      </div>
      {#if settings_import_status}
        <small
          class={['settings-import-status', settings_import_status.error && `control-error`]}
          role={settings_import_status.error ? `alert` : `status`}
        >
          {settings_import_status.message}
        </small>
      {/if}
    </SettingsGroup>
  </SettingsSearch>
</ControlPane>

<style>
  /* Column rhythm for every grid section in this pane. Widening the pane widens the slider
     track only, so the label and value columns stay put and the eye can run straight down. */
  :global(.controls-pane) {
    font-size: 0.85em;
    --ctrl-label-w: 9.4em;
    --ctrl-value-w: 3.6em;
    --ctrl-cols: var(--ctrl-label-w) var(--ctrl-value-w) minmax(0, 1fr);
  }
  /* Sections that opted out of the grid keep the historical stacked flow (the nested
     isosurface and volume-slice panes render their own markup in here) */
  :global(.controls-pane section.flow) {
    display: flex;
    flex-direction: column;
    gap: 6pt;
  }
  :global(.controls-pane h4) {
    margin: 8pt 0 3pt !important;
    font-size: 0.95em;
    opacity: 0.75;
  }
  /* only the heading that opens a group, not every heading following the first section —
     `section:first-of-type + h4` would match the *second* section's heading */
  :global(.controls-pane h4:first-of-type) {
    margin-top: 0 !important;
  }
  .reset-camera {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5pt;
    margin-bottom: 4pt;
    padding: 3pt;
    cursor: pointer;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, currentColor 8%, transparent);
    color: inherit;
    &:hover {
      background: color-mix(in srgb, currentColor 16%, transparent);
    }
    kbd {
      padding: 0 4px;
      border-radius: 2pt;
      background: color-mix(in srgb, currentColor 14%, transparent);
    }
  }
  :is(
    .settings-actions,
    .import-settings,
    .toggle-grid label,
    .chip-row,
    .chip-row label,
    .ctrl-pair,
    .axis-inputs,
    .axis-inputs label,
    .readout,
    .scheme-option
  ) {
    display: flex;
    align-items: center;
  }
  .settings-actions {
    flex-wrap: wrap;
    gap: 4pt;
    button,
    .import-settings {
      font: inherit;
    }
  }
  .import-settings {
    gap: 4pt;
    input {
      max-width: 13em;
    }
  }
  /* Boolean toggles read faster as a wrapped two-column block than as one row each */
  .toggle-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.4em, 1fr));
    gap: 2pt 8pt;
    margin-bottom: 2pt;
    label {
      gap: 5pt;
      min-height: 1.7em;
    }
    /* schema rows put the label first; in this block the checkbox leads */
    > label:has(> span:first-child) {
      flex-direction: row-reverse;
      justify-content: flex-end;
    }
  }
  .chip-row {
    flex-wrap: wrap;
    gap: 2pt 8pt;
    label {
      gap: 4pt;
    }
  }
  /* Two controls sharing one row's control area (select + swatch, checkbox + swatch) */
  .ctrl-pair {
    gap: 6pt;
    min-width: 0;
    select {
      flex: 1;
      min-width: 0;
    }
  }
  .axis-inputs {
    gap: 6pt;
    label {
      gap: 3pt;
      min-width: 0;
    }
    input {
      min-width: 0;
    }
  }
  /* These wrappers sit one level below the section (they carry the classes tests select on),
     so SettingsSection's direct-child rules miss them and their rows opt in explicitly */
  .rotation-axes,
  .zone-axis {
    display: grid;
    gap: 4pt 0;
    > :is(label, .setting) {
      display: grid;
      grid-template-columns: var(--ctrl-cols);
      align-items: center;
      column-gap: var(--ctrl-gap, 7pt);
      min-height: 1.9em;
      > :nth-child(2):last-child {
        grid-column: 2 / -1;
      }
    }
  }
  .zone-axis button {
    padding: 1pt 6pt;
    cursor: pointer;
  }
  .readout {
    flex-wrap: wrap;
    gap: 2pt 10pt;
    opacity: 0.85;
  }
  .swatch {
    box-sizing: border-box;
    width: 2.4em;
    height: 1.5em;
    padding: 0;
    border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    border-radius: 2pt;
    cursor: pointer;
  }
  .clear-color {
    padding: 0 3pt;
    font-size: 0.8em;
    line-height: 1;
    cursor: pointer;
  }
  .scheme-option {
    gap: 6pt;
    justify-content: space-between;
  }
  .scheme-swatches {
    display: flex;
    gap: 3pt;
    div {
      width: 15px;
      height: 15px;
      border-radius: 2px;
    }
  }
  .control-error {
    color: var(--error-color, #e74c3c);
    font-size: 0.9em;
  }
  label.disabled {
    opacity: 0.6;
  }
  .setting-hint {
    color: var(--text-color-muted, color-mix(in srgb, currentColor 65%, transparent));
    line-height: 1.35;
  }
  input,
  select {
    font-size: inherit;
    font-family: inherit;
    min-width: 0;
  }
</style>

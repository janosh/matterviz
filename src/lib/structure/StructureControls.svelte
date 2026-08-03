<script lang="ts">
  import { DraggablePane, type PaneProps, type PaneToggleProps } from '$lib/overlays'
  import type { ColorSchemeName, D3InterpolateName } from '$lib/colors'
  import { AXIS_COLORS, ELEMENT_COLOR_SCHEMES } from '$lib/colors'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import IsosurfaceControls from '$lib/isosurface/IsosurfaceControls.svelte'
  import VolumeSliceControls from '$lib/isosurface/VolumeSliceControls.svelte'
  import type { VolumeSliceSettings } from '$lib/isosurface/slice-settings'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import { format_num } from '$lib/labels'
  import { NumberRangeInput, SettingsSection } from '$lib/layout'
  import type { Vec3 } from '$lib/math'
  import { to_degrees, to_radians } from '$lib/math'
  import MillerIndexInput from '$lib/MillerIndexInput.svelte'
  import type { ZoneAxisMode } from '$lib/scene'
  import { is_valid_zone_axis, ZONE_AXIS_MODE_LABELS, zone_axis_direction } from '$lib/scene'
  import { ColorScaleSelect } from '$lib/plot'
  import type { VectorLayerConfig } from '$lib/settings'
  import { DEFAULTS, SETTINGS_CONFIG, VECTOR_COLOR_MODES } from '$lib/settings'
  import type { AnyStructure, StructureDisplayMode } from '$lib/structure'
  import {
    default_vector_configs,
    get_structure_vector_keys,
    Lattice,
    StructureScene,
    VECTOR_PALETTE,
  } from '$lib/structure'
  import type { ElementSymbol } from '$lib/element'
  import type { AtomColorConfig } from '$lib/structure/atom-properties'
  import {
    get_colorable_property_keys,
    structure_has_selective_dynamics,
    sync_atom_color_mode,
  } from '$lib/structure/atom-properties'
  import type { DisplacementSummary } from '$lib/structure/measure'
  import type { TrajectoryLinesStats } from '$lib/structure/trajectory-lines'
  import { get_majority_element } from '$lib/structure/bonding'
  import { is_valid_supercell_input } from '$lib/structure/supercell'
  import type { CellType } from '$lib/symmetry'
  import { to_error } from '$lib/utils'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { ComponentProps } from 'svelte'
  import { Icon, MultiSelect as Select } from 'svelte-widgets'
  import { tooltip } from 'svelte-widgets/attachments'

  let {
    controls_open = $bindable(false),
    scene_props = $bindable({}),
    lattice_props = $bindable({
      show_cell_vectors: DEFAULTS.structure.show_cell_vectors,
      cell_edge_color: DEFAULTS.structure.cell_edge_color,
      cell_edge_opacity: DEFAULTS.structure.cell_edge_opacity,
      cell_surface_color: DEFAULTS.structure.cell_surface_color,
      cell_surface_opacity: DEFAULTS.structure.cell_surface_opacity,
      cell_edge_width: DEFAULTS.structure.cell_edge_width,
    }),
    show_image_atoms = $bindable(DEFAULTS.structure.show_image_atoms),
    supercell_scaling = $bindable(`1x1x1`),
    background_color = $bindable(),
    background_opacity = $bindable(DEFAULTS.background_opacity),
    color_scheme = $bindable(DEFAULTS.color_scheme),
    atom_color_config = $bindable({
      mode: DEFAULTS.structure.atom_color_mode,
      scale: DEFAULTS.structure.atom_color_scale,
      scale_type: DEFAULTS.structure.atom_color_scale_type,
    }),
    structure = undefined,
    supercell_loading = $bindable(false),
    sym_data = null,
    cell_type = $bindable(`original`),
    volumetric_data = $bindable<VolumetricData[]>(),
    isosurface_settings = $bindable<IsosurfaceSettings>(),
    slice_settings = $bindable<Partial<VolumeSliceSettings>>(),
    active_volume_idx = $bindable(0),
    display_mode = $bindable<StructureDisplayMode>(`structure`),
    on_slice_settings_change,
    multi_view = $bindable(false),
    multi_view_control_visible = true,
    multi_view_unavailable_reason = undefined,
    polyhedra_rendered_elements = [],
    displacement_summary = null,
    trajectory_lines_result = null,
    show_trajectory_lines = $bindable(DEFAULTS.structure.show_trajectory_lines),
    on_reset_camera,
    reset_text = `Reset view (r, or double-click)`,
    fly_to_request = $bindable(undefined),
    pane_props = {},
    toggle_props = {},
    ...rest
  }: Omit<ComponentProps<typeof DraggablePane>, `children`> & {
    controls_open?: boolean // Control pane state
    scene_props?: ComponentProps<typeof StructureScene>
    lattice_props?: ComponentProps<typeof Lattice>
    show_image_atoms?: boolean
    supercell_scaling?: string
    background_color?: string
    background_opacity?: number
    color_scheme?: string
    atom_color_config?: Partial<AtomColorConfig>
    structure?: AnyStructure
    supercell_loading?: boolean
    sym_data?: MoyoDataset | null
    cell_type?: CellType // Cell type: original, conventional, or primitive
    volumetric_data?: VolumetricData[] // Volumetric data volumes for isosurface controls
    isosurface_settings?: IsosurfaceSettings // Isosurface rendering settings
    slice_settings?: Partial<VolumeSliceSettings> // 2D cross-section sampling and rendering settings
    active_volume_idx?: number // Active volume index
    display_mode?: StructureDisplayMode
    on_slice_settings_change?: (settings: VolumeSliceSettings) => void
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
    reset_text?: string
    fly_to_request?: Vec3 // (output) one-shot zone-axis camera command
    pane_props?: PaneProps
    toggle_props?: PaneToggleProps
  } = $props()

  // Both halves of a section's reset wiring come from one key list, so a new setting can't be
  // registered in the "changed" indicator and forgotten in the reset (or the other way round).
  // `extra_reset` covers section state that doesn't live in scene_props.
  type SceneSettingKey = keyof ComponentProps<typeof StructureScene> &
    keyof typeof DEFAULTS.structure
  const scene_section = (keys: SceneSettingKey[], extra_reset?: () => void) => ({
    current_values: Object.fromEntries(keys.map((key) => [key, scene_props[key]])),
    on_reset: () => {
      for (const key of keys) {
        const value = DEFAULTS.structure[key]
        // copy array defaults, else editing one in place later would corrupt DEFAULTS
        Object.assign(scene_props, { [key]: Array.isArray(value) ? [...value] : value })
      }
      extra_reset?.()
    },
  })

  $effect(() => {
    scene_props.show_trajectory_lines = show_trajectory_lines
  })

  const controls_id = $props.id()
  const multi_view_hint_id = `multi-view-hint-${controls_id}`
  let multi_view_blocked = $derived(Boolean(multi_view_unavailable_reason) && !multi_view)

  // Color scheme selection state
  let color_scheme_selected = $state([color_scheme])
  $effect(() => {
    if (color_scheme_selected.length > 0) {
      color_scheme = color_scheme_selected[0] as string
    }
  })

  // Atom color config selection state
  let color_scale_selected = $state<D3InterpolateName[]>([
    atom_color_config.scale || DEFAULTS.structure.atom_color_scale,
  ])

  // Sync local selection to config
  $effect(() => {
    if (color_scale_selected[0] && color_scale_selected[0] !== atom_color_config.scale)
      atom_color_config.scale = color_scale_selected[0]
  })
  // Sync config to local selection (for external updates)
  $effect(() => {
    if (atom_color_config.scale && atom_color_config.scale !== color_scale_selected[0])
      color_scale_selected = [atom_color_config.scale]
  })
  // Selective-dynamics coloring needs at least one site declaring the property (POSCAR
  // "Selective dynamics" block); without it every atom would land in one `unknown` bucket.
  let has_selective_dynamics = $derived(structure_has_selective_dynamics(structure))

  // Per-site scalars/vec3s available to color by (charge, velocity, c_pe, ...). Empty for
  // structures whose parser produced no extra columns, in which case the mode is disabled.
  let colorable_property_keys = $derived(get_colorable_property_keys(structure))
  // Keep scale_type and the colored-by key in step with the mode, also when the structure
  // changes under a mode that was already selected (a stale key resets to the first one).
  $effect(() => sync_atom_color_mode(atom_color_config, colorable_property_keys))

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
    // MillerIndexInput accepts `000` and `Infinity 0 0`, which would otherwise grey the
    // button out with no reason given. The indices themselves are in the adjacent input.
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

  const parse_label_bg_color = (
    color: string | undefined,
    fallback_hex_color: string,
    fallback_opacity: number,
  ): { hex_color: string; opacity: number } => {
    if (color === `transparent`) {
      return { hex_color: fallback_hex_color, opacity: 0 }
    }
    const color_mix = color?.match(color_mix_pattern)
    if (color_mix) {
      const percentage = Math.max(0, Math.min(100, Number(color_mix[2])))
      return {
        hex_color: color_mix[1],
        opacity: percentage / 100,
      }
    }
    const hex_color = color?.match(hex_color_pattern)?.[0]
    return hex_color === undefined
      ? { hex_color: fallback_hex_color, opacity: fallback_opacity }
      : { hex_color, opacity: 1 }
  }

  const default_site_label_color = as_hex_color(DEFAULTS.structure.site_label_color, `#111111`)
  const default_site_label_bg = parse_label_bg_color(
    DEFAULTS.structure.site_label_bg_color,
    `#000000`,
    0,
  )
  const initial_site_label_bg = parse_label_bg_color(
    scene_props.site_label_bg_color,
    default_site_label_bg.hex_color,
    default_site_label_bg.opacity,
  )

  // Atom label color management
  let site_label_hex_color = $state(
    as_hex_color(scene_props.site_label_color, default_site_label_color),
  )
  let site_label_bg_hex_color = $state(initial_site_label_bg.hex_color)
  let site_label_background_opacity = $state(initial_site_label_bg.opacity)
  let last_synced_site_label_color = scene_props.site_label_color
  let last_synced_site_label_bg_color = scene_props.site_label_bg_color

  $effect(() => {
    const external_color_changed =
      scene_props.site_label_color !== last_synced_site_label_color
    const external_bg_changed =
      scene_props.site_label_bg_color !== last_synced_site_label_bg_color

    if (external_color_changed) {
      site_label_hex_color = as_hex_color(
        scene_props.site_label_color,
        default_site_label_color,
      )
    }
    if (external_bg_changed) {
      const next_bg = parse_label_bg_color(
        scene_props.site_label_bg_color,
        default_site_label_bg.hex_color,
        default_site_label_bg.opacity,
      )
      site_label_bg_hex_color = next_bg.hex_color
      site_label_background_opacity = next_bg.opacity
    }

    if (!external_color_changed) scene_props.site_label_color = site_label_hex_color
    if (!external_bg_changed) {
      // Fully transparent round-trips as `transparent`, else merely mounting the controls
      // rewrites that default into an equivalent color-mix nobody asked for.
      scene_props.site_label_bg_color =
        site_label_background_opacity === 0
          ? `transparent`
          : `color-mix(in srgb, ${site_label_bg_hex_color} ${format_num(
              site_label_background_opacity,
              `.1~%`,
            )}, transparent)`
    }

    last_synced_site_label_color = scene_props.site_label_color
    last_synced_site_label_bg_color = scene_props.site_label_bg_color
  })

  // Ensure site_label_offset is always available
  scene_props.site_label_offset ??= [...DEFAULTS.structure.site_label_offset]

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

  // Detect if structure has lattice (can create supercells)
  let has_lattice = $derived(
    structure && `lattice` in structure && structure.lattice !== undefined,
  )

  // Validate supercell input
  let supercell_input_valid = $derived(is_valid_supercell_input(supercell_scaling))

  // Ensure rotation is always an array
  $effect(() => {
    scene_props.rotation ??= [...DEFAULTS.structure.rotation]
  })

  let rotation_degrees = $derived(
    scene_props.rotation?.map((rad) => {
      const deg = to_degrees(rad)
      // Convert to [0, 360] range for UI display
      return ((deg % 360) + 360) % 360
    }) ?? [0, 0, 0],
  )

  function update_rotation(axis: `x` | `y` | `z`, degrees: number) {
    scene_props.rotation ??= [0, 0, 0]
    const axis_index = { x: 0, y: 1, z: 2 }[axis]
    const clamped = Math.max(0, Math.min(360, degrees))
    const norm = ((clamped % 360) + 360) % 360
    scene_props.rotation[axis_index] = to_radians(norm)
    // Trigger reactivity by creating new array
    scene_props.rotation = [...scene_props.rotation]
  }

  // Sample colors for common elements, used to preview an element color scheme
  function get_representative_colors(scheme_name: string): string[] {
    const scheme = ELEMENT_COLOR_SCHEMES[scheme_name as ColorSchemeName]
    if (!scheme) return []
    return [`H`, `C`, `N`, `O`].map((elem) => scheme[elem] || scheme.H || `#cccccc`)
  }
</script>

<DraggablePane
  bind:show={controls_open}
  resize="both"
  pane_props={{
    ...pane_props,
    class: `controls-pane ${pane_props?.class ?? ``}`,
    style: `--pane-max-height: 70vh; ${pane_props?.style ?? ``}`,
  }}
  toggle_props={{
    title: controls_open ? `` : `Structure controls`,
    ...toggle_props,
    class: `structure-controls-toggle ${toggle_props?.class ?? ``}`,
  }}
  open_icon="Cross"
  closed_icon="Settings"
  {...rest}
>
  {#if volumetric_data?.length}
    {#if display_mode === `slice` && slice_settings}
      <VolumeSliceControls
        bind:settings={slice_settings}
        volumes={volumetric_data}
        bind:active_volume_idx
        on_settings_change={on_slice_settings_change}
      />
    {:else if isosurface_settings}
      <IsosurfaceControls
        bind:settings={isosurface_settings}
        bind:volumes={volumetric_data}
        bind:active_volume_idx
      />
    {/if}
  {/if}

  {#if multi_view_control_visible && display_mode === `structure`}
    <SettingsSection
      title="Layout"
      current_values={{ multi_view }}
      on_reset={() => (multi_view = false)}
    >
      <label class:disabled={multi_view_blocked}>
        <input
          type="checkbox"
          bind:checked={multi_view}
          disabled={multi_view_blocked}
          aria-describedby={multi_view_unavailable_reason ? multi_view_hint_id : undefined}
        />
        Multi-view grid
      </label>
      {#if multi_view_unavailable_reason}
        <small id={multi_view_hint_id} class="setting-hint">
          {multi_view_unavailable_reason}
        </small>
      {/if}
    </SettingsSection>
  {/if}

  <SettingsSection
    title="Visibility"
    current_values={{
      show_atoms: scene_props.show_atoms,
      show_bonds: scene_props.show_bonds,
      show_polyhedra: scene_props.show_polyhedra,
      show_image_atoms,
      show_site_labels: scene_props.show_site_labels,
      show_site_indices: scene_props.show_site_indices,
      vector_configs: scene_props.vector_configs,
      show_cell_vectors: lattice_props.show_cell_vectors,
    }}
    on_reset={() => {
      scene_props.show_atoms = DEFAULTS.structure.show_atoms
      scene_props.show_bonds = DEFAULTS.structure.show_bonds
      scene_props.show_polyhedra = DEFAULTS.structure.show_polyhedra
      scene_props.show_site_labels = DEFAULTS.structure.show_site_labels
      scene_props.show_site_indices = DEFAULTS.structure.show_site_indices
      scene_props.vector_configs = default_vector_configs(available_vector_keys)
      show_image_atoms = DEFAULTS.structure.show_image_atoms
      lattice_props.show_cell_vectors = DEFAULTS.structure.show_cell_vectors
    }}
    style="display: flex; flex-direction: row; flex-wrap: wrap; gap: 12pt"
  >
    Show <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_atoms.description })}
      style="gap: 6pt"
    >
      <input type="checkbox" bind:checked={scene_props.show_atoms} />
      Atoms
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_image_atoms.description })}
      style="gap: 6pt"
    >
      <input type="checkbox" bind:checked={show_image_atoms} />
      Image Atoms
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_site_labels.description })}
      style="gap: 6pt"
    >
      <input type="checkbox" bind:checked={scene_props.show_site_labels} />
      Site Labels
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_site_indices.description })}
      style="gap: 6pt"
    >
      <input type="checkbox" bind:checked={scene_props.show_site_indices} />
      Site Indices
    </label>
    {#if available_vector_keys.length > 0}
      {#each available_vector_keys as key, idx (key)}
        {@const key_visible = is_key_visible(key)}
        <label
          {@attach tooltip({
            content: `Toggle ${key} vectors`,
          })}
          style="gap: 4pt"
        >
          <input
            type="checkbox"
            checked={key_visible}
            onchange={() => update_vector_config(key, { visible: !key_visible })}
          />
          <input
            type="color"
            aria-label={`${key} vector color`}
            value={scene_props.vector_configs?.[key]?.color ??
              VECTOR_PALETTE[idx % VECTOR_PALETTE.length]}
            onchange={(evt) =>
              update_vector_config(key, {
                color: evt.currentTarget.value,
              })}
            style="width: 22px; height: 22px; padding: 0; border: none; cursor: pointer"
          />
          {key}
          {#if scene_props.vector_configs?.[key]?.color != null}
            <button
              type="button"
              aria-label={`Reset ${key} color to default`}
              onclick={() => update_vector_config(key, { color: null })}
              style="padding: 0 3pt; font-size: 0.8em; line-height: 1; cursor: pointer"
            >
              ×
            </button>
          {/if}
        </label>
      {/each}
    {/if}
    <label style="gap: 6pt">
      <input type="checkbox" bind:checked={lattice_props.show_cell_vectors} />
      Lattice Vectors
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_bonds.description })}
      style="gap: 6pt"
    >
      Bonds:
      <select bind:value={scene_props.show_bonds}>
        {#each Object.entries(SETTINGS_CONFIG.structure.show_bonds.enum ?? {}) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_polyhedra.description })}
      style="gap: 6pt"
    >
      Polyhedra:
      <select bind:value={scene_props.show_polyhedra}>
        {#each Object.entries(SETTINGS_CONFIG.structure.show_polyhedra.enum ?? {}) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
  </SettingsSection>

  <SettingsSection
    title="Camera"
    {...scene_section([
      `camera_projection`,
      `auto_rotate`,
      `rotate_speed`,
      `zoom_speed`,
      `pan_speed`,
      `zoom_to_cursor`,
      `rotation_damping`,
      `rotation`,
    ])}
  >
    {#if on_reset_camera}
      <button type="button" class="reset-camera" title={reset_text} onclick={on_reset_camera}>
        <Icon icon="Reset" />
        <span>Reset view <kbd>r</kbd></span>
      </button>
    {/if}
    <label>
      <span
        {@attach tooltip({ content: SETTINGS_CONFIG.structure.camera_projection.description })}
      >
        Projection
      </span>
      <select bind:value={scene_props.camera_projection}>
        {#each Object.entries(SETTINGS_CONFIG.structure.camera_projection.enum ?? {}) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
    <NumberRangeInput
      min={0}
      max={2}
      step={0.01}
      bind:value={scene_props.auto_rotate}
      title={SETTINGS_CONFIG.structure.auto_rotate.description}
      >Auto-rotate speed</NumberRangeInput
    >
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.zoom_to_cursor.description })}
    >
      <input type="checkbox" bind:checked={scene_props.zoom_to_cursor} />
      <span>Zoom to cursor</span>
    </label>
    <!-- Collapsed: four sliders almost nobody moves, crowding out settings people do reach for -->
    <details class="advanced">
      <summary>Pointer sensitivity</summary>
      <NumberRangeInput
        min={0}
        max={2}
        step={0.05}
        bind:value={scene_props.rotate_speed}
        title={SETTINGS_CONFIG.structure.rotate_speed.description}
        >Rotate speed</NumberRangeInput
      >
      <NumberRangeInput
        min={0.1}
        max={0.8}
        step={0.02}
        bind:value={scene_props.zoom_speed}
        title={SETTINGS_CONFIG.structure.zoom_speed.description}>Zoom speed</NumberRangeInput
      >
      <NumberRangeInput
        min={0}
        max={2}
        step={0.01}
        bind:value={scene_props.pan_speed}
        title={SETTINGS_CONFIG.structure.pan_speed.description}>Pan speed</NumberRangeInput
      >
      <NumberRangeInput
        min={0.01}
        max={0.3}
        step={0.01}
        bind:value={scene_props.rotation_damping}
        title={SETTINGS_CONFIG.structure.rotation_damping.description}
        >Rotation damping</NumberRangeInput
      >
    </details>

    Axis Rotation
    <div class="rotation-axes">
      {#each AXIS_COLORS as [axis, color], idx (axis)}
        <div>
          <div {@attach tooltip()} title="{axis}-axis rotation in degrees" style:color>
            <span>{axis.toUpperCase()} = </span>
            <input
              type="number"
              min={0}
              max={360}
              step={1}
              value={rotation_degrees[idx].toFixed(0)}
              oninput={(event) => update_rotation(axis, Number(event.currentTarget.value))}
              style:color
              style="margin: 0"
            />
            °
          </div>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={rotation_degrees[idx].toFixed(0)}
            oninput={(event) => update_rotation(axis, Number(event.currentTarget.value))}
            style:--thumb-color={color}
            style="width: 100%"
          />
        </div>
      {/each}
    </div>

    Crystallographic View
    <div class="pane-row zone-axis">
      <select
        bind:value={zone_axis_mode}
        aria-label="Zone axis index type"
        disabled={!lattice_matrix}
      >
        {#each Object.entries(ZONE_AXIS_MODE_LABELS) as [mode, mode_label] (mode)}
          <option value={mode}>{mode_label}</option>
        {/each}
      </select>
      <MillerIndexInput
        bind:value={zone_axis_indices}
        label={zone_axis_mode}
        disabled={!lattice_matrix}
      />
      <button
        type="button"
        onclick={fly_to_zone_axis}
        disabled={!zone_axis.direction}
        title={lattice_matrix
          ? `Point the camera along this crystallographic direction`
          : `Needs a lattice — molecules have no crystallographic directions`}
      >
        View
      </button>
      {#if zone_axis.error}
        <span class="control-error">{zone_axis.error}</span>
      {/if}
    </div>
  </SettingsSection>

  <SettingsSection
    title="Atoms"
    current_values={{
      atom_radius: scene_props.atom_radius,
      same_size_atoms: scene_props.same_size_atoms,
      color_scheme,
      ...atom_color_config,
    }}
    on_reset={() => {
      scene_props.atom_radius = DEFAULTS.structure.atom_radius
      scene_props.same_size_atoms = DEFAULTS.structure.same_size_atoms
      color_scheme = DEFAULTS.color_scheme
      color_scheme_selected = [DEFAULTS.color_scheme]
      atom_color_config.mode = DEFAULTS.structure.atom_color_mode
      atom_color_config.scale = DEFAULTS.structure.atom_color_scale
      atom_color_config.scale_type = DEFAULTS.structure.atom_color_scale_type
      delete atom_color_config.property_key
      color_scale_selected = [DEFAULTS.structure.atom_color_scale]
    }}
  >
    <NumberRangeInput
      min={0.2}
      max={2}
      step={0.05}
      bind:value={scene_props.atom_radius}
      title={SETTINGS_CONFIG.structure.atom_radius.description}
      >Radius <small>(Å)</small></NumberRangeInput
    >
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.same_size_atoms.description })}
    >
      Same size atoms
      <input type="checkbox" bind:checked={scene_props.same_size_atoms} />
    </label>
    <label {@attach tooltip({ content: SETTINGS_CONFIG.color_scheme.description })}>
      Color scheme
      <Select
        options={Object.keys(ELEMENT_COLOR_SCHEMES)}
        maxSelect={1}
        minSelect={1}
        bind:selected={color_scheme_selected}
        liOptionStyle="padding: 3pt 6pt;"
        liSelectedStyle="background-color: transparent;"
        ulSelectedStyle="display: contents;"
        inputStyle="flex: none; min-width: 0; width: 0; opacity: 0;"
        style="flex: 1; min-width: 0; border: none; margin-left: 4pt"
        aria-label="Color scheme"
      >
        {#snippet children({ option })}
          {@const option_style = `display: flex; align-items: center; gap: 6pt; justify-content: space-between;`}
          <div style={option_style}>
            {option}
            <div style="display: flex; gap: 3pt">
              {#each get_representative_colors(String(option)) as color (color)}
                {@const color_style = `width: 15px; height: 15px; border-radius: 2px; background: ${color};`}
                <div style={color_style}></div>
              {/each}
            </div>
          </div>
        {/snippet}
      </Select>
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.atom_color_mode.description })}
    >
      Atom coloring
      <select bind:value={atom_color_config.mode}>
        {#each Object.entries(SETTINGS_CONFIG.structure.atom_color_mode.enum || {}) as [value, label] (value)}
          {@const disabled =
            (value === `wyckoff` && !sym_data) ||
            (value === `selective_dynamics` && !has_selective_dynamics) ||
            (value === `property` && colorable_property_keys.length === 0)}
          <option
            {value}
            {disabled}
            title={value === `property` && disabled
              ? `No per-atom properties on this structure — load a file that carries extra columns (extXYZ Properties=..., LAMMPS dump)`
              : undefined}>{label}</option
          >
        {/each}
      </select>
    </label>
    {#if atom_color_config.mode === `property` && colorable_property_keys.length > 0}
      <label {@attach tooltip({ content: `Per-atom property to map onto the color scale` })}>
        Property
        <select bind:value={atom_color_config.property_key}>
          {#each colorable_property_keys as key (key)}
            <option value={key}>{key}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if atom_color_config.mode !== `element`}
      <label
        {@attach tooltip({ content: SETTINGS_CONFIG.structure.atom_color_scale.description })}
      >
        Color scale
        <ColorScaleSelect
          bind:value={atom_color_config.scale}
          bind:selected={color_scale_selected}
          colorbar={{
            tick_labels: 0,
            wrapper_style: `width: 100%;`,
          }}
          style="flex: 1; min-width: 0; border: none"
          aria-label="Color scale"
        />
      </label>
    {/if}
  </SettingsSection>

  {#if scene_props.show_site_labels || scene_props.show_site_indices}
    <SettingsSection
      title="Labels"
      current_values={{
        site_label_size: scene_props.site_label_size,
        site_label_hex_color,
        site_label_bg_hex_color,
        site_label_background_opacity,
        site_label_padding: scene_props.site_label_padding,
        site_label_offset: scene_props.site_label_offset,
      }}
      on_reset={() => {
        scene_props.site_label_size = DEFAULTS.structure.site_label_size
        scene_props.site_label_padding = DEFAULTS.structure.site_label_padding
        scene_props.site_label_offset = [...DEFAULTS.structure.site_label_offset]
        site_label_hex_color = default_site_label_color
        site_label_bg_hex_color = default_site_label_bg.hex_color
        site_label_background_opacity = default_site_label_bg.opacity
      }}
    >
      <div class="pane-row">
        <label>
          Color
          <input
            type="color"
            aria-label="Site label color"
            bind:value={site_label_hex_color}
          />
        </label>
        <label>
          Size
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            bind:value={scene_props.site_label_size}
          />
        </label>
      </div>
      <div class="pane-row">
        <label>
          Background
          <input
            type="color"
            aria-label="Site label background color"
            bind:value={site_label_bg_hex_color}
          />
        </label>
        <label>
          Opacity
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            aria-label="Site label background opacity"
            bind:value={site_label_background_opacity}
          />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            aria-label="Site label background opacity slider"
            bind:value={site_label_background_opacity}
          />
        </label>
      </div>
      <div class="pane-row">
        <label>
          Padding
          <input
            type="number"
            min="0"
            max="10"
            step="1"
            bind:value={scene_props.site_label_padding}
          />
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            bind:value={scene_props.site_label_padding}
          />
        </label>
      </div>
      <div class="pane-row">
        Offset
        {#each [`X`, `Y`, `Z`] as axis, idx (axis)}
          <label>
            {axis}
            <input
              type="number"
              min="-1"
              max="1"
              step="0.1"
              bind:value={scene_props.site_label_offset![idx]}
            />
          </label>
        {/each}
      </div>
    </SettingsSection>
  {/if}

  {#if displacement_summary}
    <SettingsSection
      title="Displacement Overlay"
      {...scene_section([
        `show_displacement_arrows`,
        `displacement_arrow_scale`,
        `displacement_arrow_color`,
      ])}
    >
      <!-- `!== null` (not truthiness) so the union discriminates: an empty error string
        would leave the else branch un-narrowed and rmsd possibly undefined -->
      {#if displacement_summary.error !== null}
        <span class="control-error">{displacement_summary.error}</span>
      {:else}
        <div class="pane-row">
          <span>RMSD <strong>{format_num(displacement_summary.rmsd, `.4~f`)} Å</strong></span>
          <span>
            Max <strong>{format_num(displacement_summary.max_displacement, `.4~f`)} Å</strong>
          </span>
        </div>
        <label
          {@attach tooltip({
            content: SETTINGS_CONFIG.structure.show_displacement_arrows.description,
          })}
          style="gap: 6pt"
        >
          <input type="checkbox" bind:checked={scene_props.show_displacement_arrows} />
          Show displacement arrows
        </label>
        <NumberRangeInput
          min={0.1}
          max={20}
          step={0.1}
          bind:value={scene_props.displacement_arrow_scale}
          title={SETTINGS_CONFIG.structure.displacement_arrow_scale.description}
          >Arrow scale</NumberRangeInput
        >
        <label
          {@attach tooltip({
            content: SETTINGS_CONFIG.structure.displacement_arrow_color.description,
          })}
        >
          Arrow color
          <input
            type="color"
            aria-label="Displacement arrow color"
            bind:value={scene_props.displacement_arrow_color}
          />
        </label>
      {/if}
    </SettingsSection>
  {/if}

  <!-- Only the trajectory viewer can collect a whole-run position stream, so this section is
    absent for plain structures rather than showing dead controls -->
  {#if scene_props.trajectory_position_stream !== undefined}
    <SettingsSection
      title="Trajectory Trails"
      {...scene_section(
        [
          `show_trajectory_lines`,
          `trajectory_line_trail_frames`,
          `trajectory_line_frame_stride`,
          `trajectory_line_color_mode`,
          `trajectory_line_wrap_mode`,
        ],
        () => {
          show_trajectory_lines = DEFAULTS.structure.show_trajectory_lines
          scene_props.trajectory_line_elements = null
        },
      )}
    >
      <label
        {@attach tooltip({
          content: SETTINGS_CONFIG.structure.show_trajectory_lines.description,
        })}
        style="gap: 6pt"
      >
        <input type="checkbox" bind:checked={show_trajectory_lines} />
        Show trajectory trails
      </label>
      {#if show_trajectory_lines && scene_props.trajectory_position_stream}
        {#if trail_elements.length > 1}
          <div class="pane-row" style="flex-wrap: wrap; gap: 8pt">
            Species
            {#each trail_elements as element (element)}
              <label style="gap: 4pt">
                <input
                  type="checkbox"
                  checked={is_trail_element_on(element)}
                  onchange={() => toggle_trail_element(element)}
                />
                {element}
              </label>
            {/each}
          </div>
        {/if}
        <NumberRangeInput
          min={0}
          max={Math.max(1, scene_props.trajectory_position_stream.n_frames)}
          step={1}
          bind:value={scene_props.trajectory_line_trail_frames}
          title={SETTINGS_CONFIG.structure.trajectory_line_trail_frames.description}
          >Trail length <small>(0 = full run)</small></NumberRangeInput
        >
        <NumberRangeInput
          min={1}
          max={100}
          step={1}
          bind:value={scene_props.trajectory_line_frame_stride}
          title={SETTINGS_CONFIG.structure.trajectory_line_frame_stride.description}
          >Frame stride</NumberRangeInput
        >
        <label
          {@attach tooltip({
            content: SETTINGS_CONFIG.structure.trajectory_line_color_mode.description,
          })}
        >
          Color by
          <select bind:value={scene_props.trajectory_line_color_mode}>
            {#each Object.entries(SETTINGS_CONFIG.structure.trajectory_line_color_mode.enum ?? {}) as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
        <label
          {@attach tooltip({
            content: SETTINGS_CONFIG.structure.trajectory_line_wrap_mode.description,
          })}
        >
          Boundaries
          <select bind:value={scene_props.trajectory_line_wrap_mode}>
            {#each Object.entries(SETTINGS_CONFIG.structure.trajectory_line_wrap_mode.enum ?? {}) as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
        {#if trajectory_lines_result}
          {@const { point_count, segment_count, atom_count, max_segment_length } =
            trajectory_lines_result}
          <div class="pane-row">
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

  {#if available_vector_keys.length > 0 && any_vectors_visible}
    <SettingsSection
      title="Site Vectors"
      {...scene_section(
        [
          `vector_scale`,
          `vector_color`,
          `vector_normalize`,
          `vector_uniform_thickness`,
          `vector_color_mode`,
          `vector_color_scale`,
          `vector_origin_gap`,
        ],
        () => {
          for (const key of available_vector_keys) update_vector_config(key, { scale: null })
        },
      )}
    >
      <NumberRangeInput min={0.001} max={5} step={0.001} bind:value={scene_props.vector_scale}
        >Global Scale</NumberRangeInput
      >
      <label
        {@attach tooltip({ content: SETTINGS_CONFIG.structure.vector_normalize.description })}
        style="gap: 6pt"
      >
        <input type="checkbox" bind:checked={scene_props.vector_normalize} />
        Normalize
      </label>
      <label
        {@attach tooltip({
          content: SETTINGS_CONFIG.structure.vector_uniform_thickness.description,
        })}
        style="gap: 6pt"
      >
        <input type="checkbox" bind:checked={scene_props.vector_uniform_thickness} />
        Uniform Thickness
      </label>
      <label
        {@attach tooltip({ content: SETTINGS_CONFIG.structure.vector_color_mode.description })}
      >
        Color Mode
        <select bind:value={scene_props.vector_color_mode}>
          {#each VECTOR_COLOR_MODES as mode (mode)}
            <option value={mode}>{mode.replaceAll(`_`, ` `)}</option>
          {/each}
        </select>
      </label>
      {#if scene_props.vector_color_mode === `magnitude`}
        <label>
          Scale
          <ColorScaleSelect
            bind:value={scene_props.vector_color_scale}
            style="max-width: 180px"
          />
        </label>
      {/if}
      {#if scene_props.vector_color_mode === `uniform`}
        <label>
          Color
          <input type="color" bind:value={scene_props.vector_color} />
        </label>
      {/if}
      {#if available_vector_keys.length > 1}
        <NumberRangeInput
          min={0}
          max={0.5}
          step={0.02}
          bind:value={scene_props.vector_origin_gap}
          title={SETTINGS_CONFIG.structure.vector_origin_gap.description}
          >Origin Gap</NumberRangeInput
        >
        {#each available_vector_keys as key (key)}
          {#if is_key_visible(key)}
            {@const on_scale = (evt: Event & { currentTarget: HTMLInputElement }) => {
              const parsed = parseFloat(evt.currentTarget.value)
              update_vector_config(key, { scale: Number.isNaN(parsed) ? 1.0 : parsed })
            }}
            <label
              {@attach tooltip({
                content: `Scale multiplier for ${key} arrows (applied on top of global scale)`,
              })}
            >
              {key} scale
              <input
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                value={scene_props.vector_configs?.[key]?.scale ?? 1.0}
                onchange={on_scale}
              />
              <input
                type="range"
                min={0.1}
                max={5}
                step={0.1}
                value={scene_props.vector_configs?.[key]?.scale ?? 1.0}
                oninput={on_scale}
              />
            </label>
          {/if}
        {/each}
      {/if}
    </SettingsSection>
  {/if}

  {#if has_lattice}
    <SettingsSection
      title="Cell"
      current_values={{
        cell_edge_color: lattice_props.cell_edge_color,
        cell_edge_opacity: lattice_props.cell_edge_opacity,
        cell_surface_color: lattice_props.cell_surface_color,
        cell_surface_opacity: lattice_props.cell_surface_opacity,
        supercell_scaling,
        cell_type,
      }}
      on_reset={() => {
        lattice_props.cell_edge_color = DEFAULTS.structure.cell_edge_color
        lattice_props.cell_edge_opacity = DEFAULTS.structure.cell_edge_opacity
        lattice_props.cell_surface_color = DEFAULTS.structure.cell_surface_color
        lattice_props.cell_surface_opacity = DEFAULTS.structure.cell_surface_opacity
        supercell_scaling = `1x1x1`
        cell_type = `original`
      }}
    >
      <label
        {@attach tooltip({
          content: sym_data
            ? `Transform to conventional or primitive cell using crystallographic symmetry`
            : `Symmetry analysis required. Wait for analysis to complete.`,
        })}
      >
        <span>Cell Type</span>
        <select bind:value={cell_type} disabled={!sym_data}>
          <option value="original">Original</option>
          <option value="conventional">Conventional</option>
          <option value="primitive">Primitive</option>
        </select>
      </label>
      <label>
        <span
          {@attach tooltip({
            content: `Create supercells by repeating the unit cell. Examples: "2x2x2", "3x1x2", or "2"`,
          })}
        >
          Supercell Scaling
        </span>
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
        <div
          data-testid="supercell-input-error"
          style="color: red; font-size: 0.8em; margin-top: 4pt"
        >
          Invalid format. Use patterns like "2x2x2", "3x1x2", or "2".
        </div>
      {/if}

      {#each [{ label: `Edge color`, color_prop: `cell_edge_color`, opacity_prop: `cell_edge_opacity`, step: 0.05 }, { label: `Surface color`, color_prop: `cell_surface_color`, opacity_prop: `cell_surface_opacity`, step: 0.01 }] as const as { label, color_prop, opacity_prop, step } (label)}
        <div class="pane-row">
          <label>
            {label}
            <input type="color" bind:value={lattice_props[color_prop]} />
          </label>
          <NumberRangeInput min={0} max={1} {step} bind:value={lattice_props[opacity_prop]}>
            opacity
          </NumberRangeInput>
        </div>
      {/each}
    </SettingsSection>
  {/if}

  <SettingsSection
    title="Background"
    current_values={{
      background_color,
      background_opacity,
    }}
    on_reset={() => {
      background_color = undefined
      background_opacity = DEFAULTS.background_opacity
    }}
  >
    <div class="pane-row">
      <label>
        Color
        <!-- not using bind:value to not give a default value of #000000 to background_color, needs to stay undefined to not override --struct-bg theme color -->
        <input
          type="color"
          value={background_color}
          oninput={(event) => {
            background_color = event.currentTarget.value
          }}
        />
      </label>
      <NumberRangeInput min={0} max={1} step={0.02} bind:value={background_opacity}>
        Opacity
      </NumberRangeInput>
    </div>
  </SettingsSection>

  <SettingsSection title="Lighting" {...scene_section([`directional_light`, `ambient_light`])}>
    <NumberRangeInput
      min={0}
      max={4}
      step={0.01}
      bind:value={scene_props.directional_light}
      title={SETTINGS_CONFIG.structure.directional_light.description}
      >Directional light</NumberRangeInput
    >
    <NumberRangeInput
      min={0.5}
      max={3}
      step={0.05}
      bind:value={scene_props.ambient_light}
      title={SETTINGS_CONFIG.structure.ambient_light.description}
      >Ambient light</NumberRangeInput
    >
  </SettingsSection>

  {#if scene_props.show_bonds && scene_props.show_bonds !== `never`}
    <SettingsSection
      title="Bonds"
      {...scene_section([
        `bonding_strategy`,
        `auto_bond_order`,
        `aromatic_display`,
        `bond_color`,
        `bond_thickness`,
      ])}
    >
      <label>
        Strategy <select bind:value={scene_props.bonding_strategy}>
          {#each Object.entries(SETTINGS_CONFIG.structure.bonding_strategy.enum ?? {}) as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
      </label>
      <label
        style="gap: 6pt"
        {@attach tooltip({ content: SETTINGS_CONFIG.structure.auto_bond_order.description })}
      >
        <input type="checkbox" bind:checked={scene_props.auto_bond_order} />
        Auto bond order (perceive double/triple/aromatic)
      </label>
      {#if scene_props.auto_bond_order}
        <label
          {@attach tooltip({
            content: SETTINGS_CONFIG.structure.aromatic_display.description,
          })}
        >
          Aromatic display <select bind:value={scene_props.aromatic_display}>
            {#each Object.entries(SETTINGS_CONFIG.structure.aromatic_display.enum ?? {}) as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
      {/if}
      <label>
        Color <input type="color" bind:value={scene_props.bond_color} />
      </label>
      <NumberRangeInput
        min={0.05}
        max={0.5}
        step={0.05}
        bind:value={scene_props.bond_thickness}
      >
        Thickness
      </NumberRangeInput>
    </SettingsSection>
  {/if}

  {#if scene_props.show_polyhedra && scene_props.show_polyhedra !== `never`}
    <SettingsSection
      title="Polyhedra"
      {...scene_section([
        `polyhedra_opacity`,
        `polyhedra_show_edges`,
        `polyhedra_edge_color`,
        `polyhedra_color_mode`,
        `polyhedra_color`,
        `polyhedra_hide_center_atoms`,
        `polyhedra_min_neighbors`,
        `polyhedra_max_neighbors`,
        `polyhedra_excluded_elements`,
        `polyhedra_included_elements`,
      ])}
    >
      <NumberRangeInput
        min={0}
        max={1}
        step={0.05}
        bind:value={scene_props.polyhedra_opacity}
        title={SETTINGS_CONFIG.structure.polyhedra_opacity.description}
        >Opacity</NumberRangeInput
      >
      <label
        {@attach tooltip({
          content: SETTINGS_CONFIG.structure.polyhedra_color_mode.description,
        })}
      >
        Color <select bind:value={scene_props.polyhedra_color_mode}>
          {#each Object.entries(SETTINGS_CONFIG.structure.polyhedra_color_mode.enum ?? {}) as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
        {#if scene_props.polyhedra_color_mode === `uniform`}
          <input type="color" bind:value={scene_props.polyhedra_color} />
        {/if}
      </label>
      <label
        style="gap: 6pt"
        {@attach tooltip({
          content: SETTINGS_CONFIG.structure.polyhedra_show_edges.description,
        })}
      >
        <input type="checkbox" bind:checked={scene_props.polyhedra_show_edges} />
        Edges
        {#if scene_props.polyhedra_show_edges}
          <input type="color" bind:value={scene_props.polyhedra_edge_color} />
        {/if}
      </label>
      <label
        style="gap: 6pt"
        {@attach tooltip({
          content: SETTINGS_CONFIG.structure.polyhedra_hide_center_atoms.description,
        })}
      >
        <input type="checkbox" bind:checked={scene_props.polyhedra_hide_center_atoms} />
        Hide center atoms
      </label>
      <NumberRangeInput
        min={4}
        max={12}
        step={1}
        bind:value={scene_props.polyhedra_min_neighbors}
        title={SETTINGS_CONFIG.structure.polyhedra_min_neighbors.description}
        >Min neighbors</NumberRangeInput
      >
      <NumberRangeInput
        min={4}
        max={16}
        step={1}
        bind:value={scene_props.polyhedra_max_neighbors}
        title={SETTINGS_CONFIG.structure.polyhedra_max_neighbors.description}
        >Max neighbors</NumberRangeInput
      >
      {#if structure_elements.length > 0}
        <div
          style="display: flex; flex-wrap: wrap; gap: 8pt; align-items: center"
          {@attach tooltip({
            content: `${
              SETTINGS_CONFIG.structure.polyhedra_excluded_elements.description
            }. Force-including a spectator center (alkali or heavy alkaline-earth, e.g. Li, Na, Ba) may render its polyhedra truncated at cell boundaries.`,
          })}
        >
          Centers:
          {#each structure_elements as element (element)}
            <label style="gap: 4pt">
              <input
                type="checkbox"
                checked={is_polyhedra_center_enabled(element)}
                onchange={() => toggle_polyhedra_element(element)}
              />
              {element}
            </label>
          {/each}
        </div>
      {/if}
    </SettingsSection>
  {/if}
</DraggablePane>

<style>
  .reset-camera {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5pt;
    padding: 3pt;
    cursor: pointer;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, currentColor 8%, transparent);
    color: inherit;
    kbd {
      padding: 0 4px;
      border-radius: 2pt;
      background: color-mix(in srgb, currentColor 14%, transparent);
    }
  }
  .advanced {
    display: flex;
    flex-direction: column;
    gap: 6pt;
    summary {
      cursor: pointer;
      opacity: 0.75;
    }
    &[open] summary {
      margin-bottom: 6pt;
    }
  }
  .rotation-axes {
    display: flex;
    gap: 10pt;
  }
  .rotation-axes > div {
    display: grid;
    gap: 0.4em;
    place-items: center;
  }
  :global(.controls-pane) {
    font-size: 0.85em;
  }

  :global(.controls-pane section) {
    display: flex;
    flex-direction: column;
    gap: 6pt;
  }
  :global(.controls-pane h4) {
    margin: 10pt 0 4pt !important;
  }
  :global(.controls-pane h4:first-of-type) {
    margin-top: 0 !important;
  }
  .pane-row {
    display: flex;
    gap: 12pt;
    justify-content: space-between;
    width: 100%;
  }
  .zone-axis {
    align-items: center;
    gap: 6pt;
    select {
      flex: 1;
      min-width: 0;
    }
  }
  .control-error {
    color: var(--error-color, #e74c3c);
    font-size: 0.9em;
  }
  label {
    display: flex;
    align-items: center;
    gap: 10pt;
  }
  label.disabled {
    opacity: 0.6;
  }
  .setting-hint {
    color: var(--text-color-muted, color-mix(in srgb, currentColor 65%, transparent));
    line-height: 1.35;
    max-width: 32em;
  }
  input,
  select {
    font-size: inherit;
    font-family: inherit;
  }
  input[type='range'] {
    flex: 1;
    min-width: 40px;
  }
</style>

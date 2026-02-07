<script lang="ts">
  import type { ColorSchemeName, D3InterpolateName } from '$lib/colors'
  import { AXIS_COLORS, ELEMENT_COLOR_SCHEMES } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import { SettingsSection } from '$lib/layout'
  import { to_degrees, to_radians } from '$lib/math'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { ColorScaleSelect } from '$lib/plot'
  import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
  import IsosurfaceControls from '$lib/isosurface/IsosurfaceControls.svelte'
  import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
  import type { AnyStructure } from '$lib/structure'
  import { Lattice, StructureScene } from '$lib/structure'
  import type { AtomColorConfig } from '$lib/structure/atom-properties'
  import { is_valid_supercell_input } from '$lib/structure/supercell'
  import type { CellType } from '$lib/symmetry'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'
  import { tooltip } from 'svelte-multiselect/attachments'

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
    active_volume_idx = $bindable(0),
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
    active_volume_idx?: number // Active volume index
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  } = $props()

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
    if (
      color_scale_selected[0] && color_scale_selected[0] !== atom_color_config.scale
    ) atom_color_config.scale = color_scale_selected[0]
  })
  // Sync config to local selection (for external updates)
  $effect(() => {
    if (
      atom_color_config.scale && atom_color_config.scale !== color_scale_selected[0]
    ) color_scale_selected = [atom_color_config.scale]
  })
  // Auto-set scale_type based on mode
  $effect(() => {
    if (atom_color_config.mode === `wyckoff`) {
      atom_color_config.scale_type = `categorical`
    } else if (atom_color_config.mode === `coordination`) {
      atom_color_config.scale_type = `continuous`
    }
  })

  // Atom label color management
  let site_label_hex_color = $state(
    scene_props.site_label_color || DEFAULTS.structure.site_label_color,
  )
  let site_label_bg_hex_color = $state(
    scene_props.site_label_bg_color || DEFAULTS.structure.site_label_bg_color,
  )
  let site_label_background_opacity = $state(0)

  $effect(() => {
    scene_props.site_label_color = site_label_hex_color
    scene_props.site_label_bg_color =
      `color-mix(in srgb, ${site_label_bg_hex_color} ${
        format_num(site_label_background_opacity, `.1~%`)
      }, transparent)`
  })

  // Ensure site_label_offset is always available
  scene_props.site_label_offset ??= [...DEFAULTS.structure.site_label_offset]

  // Detect if structure has force data
  let has_forces = $derived(
    structure?.sites?.some((site) =>
      site.properties?.force && Array.isArray(site.properties.force)
    ) ?? false,
  )

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

  // Helper function to get example set of colors from an element color scheme
  function get_representative_colors(scheme_name: string): string[] {
    const scheme = ELEMENT_COLOR_SCHEMES[scheme_name as ColorSchemeName]
    if (!scheme) return []

    // Get colors for common elements: H, C, N, O, Fe, Ca, Si, Al
    const sample_elements = [`H`, `C`, `N`, `O`, `Fe`, `Ca`, `Si`, `Al`]
    return sample_elements
      .slice(0, 4) // Take first 4
      .map((el) => scheme[el] || scheme.H || `#cccccc`)
      .filter(Boolean)
  }
</script>

<DraggablePane
  bind:show={controls_open}
  pane_props={{ ...pane_props, class: `controls-pane ${pane_props?.class ?? ``}` }}
  toggle_props={{
    title: controls_open ? `` : `Structure controls`,
    ...toggle_props,
    class: `structure-controls-toggle ${toggle_props?.class ?? ``}`,
  }}
  {...rest}
>
  <SettingsSection
    title="Visibility"
    current_values={{
      show_atoms: scene_props.show_atoms,
      show_bonds: scene_props.show_bonds,
      show_image_atoms,
      show_site_labels: scene_props.show_site_labels,
      show_site_indices: scene_props.show_site_indices,
      show_force_vectors: scene_props.show_force_vectors,
      show_cell_vectors: lattice_props.show_cell_vectors,
    }}
    on_reset={() => {
      scene_props.show_atoms = DEFAULTS.structure.show_atoms
      scene_props.show_bonds = DEFAULTS.structure.show_bonds
      scene_props.show_site_labels = DEFAULTS.structure.show_site_labels
      scene_props.show_site_indices = DEFAULTS.structure.show_site_indices
      scene_props.show_force_vectors = DEFAULTS.structure.show_force_vectors
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
      {@attach tooltip({
        content: SETTINGS_CONFIG.structure.show_image_atoms.description,
      })}
      style="gap: 6pt"
    >
      <input type="checkbox" bind:checked={show_image_atoms} />
      Image Atoms
    </label>
    <label
      {@attach tooltip({
        content: SETTINGS_CONFIG.structure.show_site_labels.description,
      })}
      style="gap: 6pt"
    >
      <input type="checkbox" bind:checked={scene_props.show_site_labels} />
      Site Labels
    </label>
    <label
      {@attach tooltip({
        content: SETTINGS_CONFIG.structure.show_site_indices.description,
      })}
      style="gap: 6pt"
    >
      <input type="checkbox" bind:checked={scene_props.show_site_indices} />
      Site Indices
    </label>
    {#if has_forces}
      <label
        {@attach tooltip({
          content: SETTINGS_CONFIG.structure.show_force_vectors.description,
        })}
        style="gap: 6pt"
      >
        <input type="checkbox" bind:checked={scene_props.show_force_vectors} />
        Force Vectors
      </label>
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
        {#each Object.entries(SETTINGS_CONFIG.structure.show_bonds.enum ?? {}) as
          [value, label]
          (value)
        }
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
  </SettingsSection>

  <SettingsSection
    title="Camera"
    current_values={{
      camera_projection: scene_props.camera_projection,
      auto_rotate: scene_props.auto_rotate,
      rotate_speed: scene_props.rotate_speed,
      zoom_speed: scene_props.zoom_speed,
      pan_speed: scene_props.pan_speed,
      zoom_to_cursor: scene_props.zoom_to_cursor,
      rotation_damping: scene_props.rotation_damping,
      rotation: scene_props.rotation,
    }}
    on_reset={() => {
      scene_props.camera_projection = DEFAULTS.structure.camera_projection
      scene_props.auto_rotate = DEFAULTS.structure.auto_rotate
      scene_props.rotate_speed = DEFAULTS.structure.rotate_speed
      scene_props.zoom_speed = DEFAULTS.structure.zoom_speed
      scene_props.pan_speed = DEFAULTS.structure.pan_speed
      scene_props.zoom_to_cursor = DEFAULTS.structure.zoom_to_cursor
      scene_props.rotation_damping = DEFAULTS.structure.rotation_damping
      scene_props.rotation = [...DEFAULTS.structure.rotation]
    }}
  >
    <label>
      <span
        {@attach tooltip({
          content: SETTINGS_CONFIG.structure.camera_projection.description,
        })}
      >
        Projection
      </span>
      <select bind:value={scene_props.camera_projection}>
        {#each Object.entries(
            SETTINGS_CONFIG.structure.camera_projection.enum ?? {},
          ) as
          [value, label]
          (value)
        }
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.auto_rotate.description })}
    >
      Auto-rotate speed
      <input
        type="number"
        min={0}
        max={2}
        step={0.01}
        bind:value={scene_props.auto_rotate}
      />
      <input
        type="range"
        min={0}
        max={2}
        step={0.01}
        bind:value={scene_props.auto_rotate}
      />
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.rotate_speed.description })}
    >
      Rotate speed
      <input
        type="number"
        min={0}
        max={2}
        step={0.05}
        bind:value={scene_props.rotate_speed}
      />
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        bind:value={scene_props.rotate_speed}
      />
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.zoom_speed.description })}
    >
      Zoom speed
      <input
        type="number"
        min={0.1}
        max={0.8}
        step={0.02}
        bind:value={scene_props.zoom_speed}
      />
      <input
        type="range"
        min={0.1}
        max={0.8}
        step={0.02}
        bind:value={scene_props.zoom_speed}
      />
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.pan_speed.description })}
    >
      Pan speed
      <input
        type="number"
        min={0}
        max={2}
        step={0.01}
        bind:value={scene_props.pan_speed}
      />
      <input
        type="range"
        min={0}
        max={2}
        step={0.01}
        bind:value={scene_props.pan_speed}
      />
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.zoom_to_cursor.description })}
    >
      <input type="checkbox" bind:checked={scene_props.zoom_to_cursor} />
      <span>Zoom to cursor</span>
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.rotation_damping.description })}
    >
      Rotation damping
      <input
        type="number"
        min={0.01}
        max={0.3}
        step={0.01}
        bind:value={scene_props.rotation_damping}
      />
      <input
        type="range"
        min={0.01}
        max={0.3}
        step={0.01}
        bind:value={scene_props.rotation_damping}
      />
    </label>

    Axis Rotation
    <div class="rotation-axes">
      {#each AXIS_COLORS as [axis, color], idx (axis)}
        <div>
          <div
            {@attach tooltip()}
            title="{axis}-axis rotation in degrees"
            style:color
          >
            <span>{axis.toUpperCase()} = </span>
            <input
              type="number"
              min={0}
              max={360}
              step={1}
              value={rotation_degrees[idx].toFixed(0)}
              oninput={(event) =>
              update_rotation(axis, Number(event.currentTarget.value))}
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
      color_scale_selected = [DEFAULTS.structure.atom_color_scale]
    }}
  >
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.atom_radius.description })}
    >
      Radius <small>(Å)</small>
      <input
        type="number"
        min={0.2}
        max={2}
        step={0.05}
        bind:value={scene_props.atom_radius}
      />
      <input
        type="range"
        min={0.2}
        max={2}
        step={0.05}
        bind:value={scene_props.atom_radius}
      />
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.same_size_atoms.description })}
    >
      Same size atoms
      <input type="checkbox" bind:checked={scene_props.same_size_atoms} />
    </label>
    <span
      class="label"
      style="align-items: start"
      {@attach tooltip({ content: SETTINGS_CONFIG.color_scheme.description })}
    >
      Color scheme
      <Select
        options={Object.keys(ELEMENT_COLOR_SCHEMES)}
        maxSelect={1}
        minSelect={1}
        bind:selected={color_scheme_selected}
        liOptionStyle="padding: 3pt 6pt;"
        style="width: 10em; border: none"
        aria-label="Color scheme"
      >
        {#snippet children({ option })}
          {@const option_style =
            `display: flex; align-items: center; gap: 6pt; justify-content: space-between;`}
          <div style={option_style}>
            {option}
            <div style="display: flex; gap: 3pt">
              {#each get_representative_colors(String(option)) as color (color)}
                {@const color_style =
                `width: 15px; height: 15px; border-radius: 2px; background: ${color};`}
                <div style={color_style}></div>
              {/each}
            </div>
          </div>
        {/snippet}
      </Select>
    </span>
    <label
      style="align-items: start"
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.atom_color_mode.description })}
    >
      Atom coloring
      <select bind:value={atom_color_config.mode} style="font-size: 0.95em">
        {#each Object.entries(SETTINGS_CONFIG.structure.atom_color_mode.enum || {}) as
          [value, label]
          (value)
        }
          <option {value} disabled={!sym_data && value === `wyckoff`}>{label}</option>
        {/each}
      </select>
    </label>
    {#if atom_color_config.mode !== `element`}
      <span
        class="label"
        style="align-items: start; white-space: nowrap"
        {@attach tooltip({ content: SETTINGS_CONFIG.structure.atom_color_scale.description })}
      >
        Color scale
        <ColorScaleSelect
          bind:value={atom_color_config.scale}
          bind:selected={color_scale_selected}
          colorbar={{
            tick_labels: 0,
            wrapper_style: `width: 100%;`,
            title_style: `font-size: 0.95em;`,
          }}
          style="width: 100%; border: none"
          aria-label="Color scale"
        />
      </span>
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
        site_label_hex_color = DEFAULTS.structure.site_label_color
        site_label_bg_hex_color = DEFAULTS.structure.site_label_bg_color
        site_label_background_opacity = 0
      }}
    >
      <div class="pane-row">
        <label>
          Color
          <input type="color" bind:value={site_label_hex_color} />
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
          <input type="color" bind:value={site_label_bg_hex_color} />
        </label>
        <label>
          Opacity
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            bind:value={site_label_background_opacity}
          />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
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

  {#if has_forces && scene_props.show_force_vectors}
    <SettingsSection
      title="Force Vectors"
      current_values={{
        force_scale: scene_props.force_scale,
        force_color: scene_props.force_color,
      }}
      on_reset={() => {
        scene_props.force_scale = DEFAULTS.structure.force_scale
        scene_props.force_color = DEFAULTS.structure.force_color
      }}
    >
      <label>
        Scale
        <input
          type="number"
          min={0.001}
          max={5}
          step={0.001}
          bind:value={scene_props.force_scale}
        />
        <input
          type="range"
          min={0.001}
          max={5}
          step={0.001}
          bind:value={scene_props.force_scale}
        />
      </label>
      <label>
        Color
        <input type="color" bind:value={scene_props.force_color} />
      </label>
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
            content:
              `Create supercells by repeating the unit cell. Examples: "2x2x2", "3x1x2", or "2"`,
          })}
        >
          Supercell Scaling
        </span>
        <input
          type="text"
          bind:value={supercell_scaling}
          placeholder="1x1x1"
          style:border={supercell_input_valid ? undefined : `1px dashed red`}
          style:opacity={supercell_loading ? 0.5 : 1}
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
        <div
          style="display: flex; align-items: center; gap: 8px; font-size: 0.85em; color: var(--accent-color); margin-top: 4pt"
        >
          <span
            class="spinner-icon"
            style="display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite"
          ></span>
          <span>Generating supercell...</span>
        </div>
      {/if}

      {#if !supercell_input_valid}
        <div style="color: red; font-size: 0.8em; margin-top: 4pt">
          Invalid format. Use patterns like "2x2x2", "3x1x2", or "2".
        </div>
      {/if}

      {#each [
        {
          label: `Edge color`,
          color_prop: `cell_edge_color`,
          opacity_prop: `cell_edge_opacity`,
          step: 0.05,
        },
        {
          label: `Surface color`,
          color_prop: `cell_surface_color`,
          opacity_prop: `cell_surface_opacity`,
          step: 0.01,
        },
      ] as const as
        { label, color_prop, opacity_prop, step }
        (label)
      }
        <div class="pane-row">
          <label>
            {label}
            <input
              type="color"
              bind:value={lattice_props[color_prop]}
            />
          </label>
          <label>
            opacity
            <input
              type="number"
              min={0}
              max={1}
              {step}
              bind:value={lattice_props[opacity_prop]}
            />
            <input
              type="range"
              min={0}
              max={1}
              {step}
              bind:value={lattice_props[opacity_prop]}
            />
          </label>
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
            background_color = (event.target as HTMLInputElement).value
          }}
        />
      </label>
      <label>
        Opacity
        <input
          type="number"
          min={0}
          max={1}
          step={0.02}
          bind:value={background_opacity}
        />
        <input type="range" min={0} max={1} step={0.02} bind:value={background_opacity} />
      </label>
    </div>
  </SettingsSection>

  <SettingsSection
    title="Lighting"
    current_values={{
      directional_light: scene_props.directional_light,
      ambient_light: scene_props.ambient_light,
    }}
    on_reset={() => {
      scene_props.directional_light = DEFAULTS.structure.directional_light
      scene_props.ambient_light = DEFAULTS.structure.ambient_light
    }}
  >
    <label>
      <span title="Intensity of the directional light" {@attach tooltip()}>
        Directional light
      </span>
      <input
        type="number"
        min={0}
        max={4}
        step={0.01}
        bind:value={scene_props.directional_light}
      />
      <input
        type="range"
        min={0}
        max={4}
        step={0.01}
        bind:value={scene_props.directional_light}
      />
    </label>
    <label>
      <span title="Intensity of the ambient light" {@attach tooltip()}>
        Ambient light
      </span>
      <input
        type="number"
        min={0.5}
        max={3}
        step={0.05}
        bind:value={scene_props.ambient_light}
      />
      <input
        type="range"
        min={0.5}
        max={3}
        step={0.05}
        bind:value={scene_props.ambient_light}
      />
    </label>
  </SettingsSection>

  {#if scene_props.show_bonds && scene_props.show_bonds !== `never`}
    <SettingsSection
      title="Bonds"
      current_values={{
        bonding_strategy: scene_props.bonding_strategy,
        bond_color: scene_props.bond_color,
        bond_thickness: scene_props.bond_thickness,
      }}
      on_reset={() => {
        scene_props.bonding_strategy = DEFAULTS.structure.bonding_strategy
        scene_props.bond_color = DEFAULTS.structure.bond_color
        scene_props.bond_thickness = DEFAULTS.structure.bond_thickness
      }}
    >
      <label>
        Strategy <select bind:value={scene_props.bonding_strategy}>
          {#each Object.entries(
            SETTINGS_CONFIG.structure.bonding_strategy.enum ?? {},
          ) as
            [value, label]
            (value)
          }
            <option {value}>{label}</option>
          {/each}
        </select>
      </label>
      <label>
        Color <input type="color" bind:value={scene_props.bond_color} />
      </label>
      <label>
        Thickness
        <input
          type="number"
          min={0.05}
          max={0.5}
          step={0.05}
          bind:value={scene_props.bond_thickness}
        />
        <input
          type="range"
          min={0.05}
          max={0.5}
          step={0.05}
          bind:value={scene_props.bond_thickness}
        />
      </label>
    </SettingsSection>
  {/if}

  {#if volumetric_data && volumetric_data.length > 0 && isosurface_settings}
    <IsosurfaceControls
      bind:settings={isosurface_settings}
      volumes={volumetric_data}
      bind:active_volume_idx
    />
  {/if}
</DraggablePane>

<style>
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
  label, .label {
    display: flex;
    align-items: center;
    gap: 10pt;
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
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>

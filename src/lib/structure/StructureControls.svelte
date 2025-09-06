<script lang="ts">
  import type { AnyStructure } from '$lib'
  import { DraggablePane, Lattice, SettingsSection } from '$lib'
  import type { ColorSchemeName } from '$lib/colors'
  import { axis_colors, element_color_schemes } from '$lib/colors'
  import { export_canvas_as_png } from '$lib/io/export'
  import { to_degrees, to_radians } from '$lib/math'
  import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
  import { StructureScene } from '$lib/structure'
  import * as exports from '$lib/structure/export'
  import { is_valid_supercell_input } from '$lib/structure/supercell'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { Camera, Scene } from 'three'

  export interface Props
    extends Omit<ComponentProps<typeof DraggablePane>, `children`> {
    // Control pane state
    controls_open?: boolean
    // Scene properties (bindable from parent)
    scene_props?: ComponentProps<typeof StructureScene>
    // Lattice properties (bindable from parent)
    lattice_props?: ComponentProps<typeof Lattice>
    // Display options (bindable from parent)
    show_image_atoms?: boolean
    // Supercell options (bindable from parent)
    supercell_scaling?: string
    // Background settings (bindable from parent)
    background_color?: string
    background_opacity?: number
    // Color scheme (bindable from parent)
    color_scheme?: string
    // Structure for export functions
    structure?: AnyStructure | undefined
    // Canvas wrapper for PNG export
    wrapper?: HTMLDivElement
    // Export settings
    png_dpi?: number
    scene?: Scene
    camera?: Camera
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  }
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
    background_color = $bindable(undefined),
    background_opacity = $bindable(DEFAULTS.background_opacity),
    color_scheme = $bindable(DEFAULTS.color_scheme),
    structure = undefined,
    wrapper = undefined,
    png_dpi = $bindable(150),
    scene = undefined,
    camera = undefined,
    pane_props = $bindable({}),
    toggle_props = $bindable({}),
    ...rest
  }: Props = $props()

  // Color scheme selection state
  let color_scheme_selected = $state([color_scheme])
  $effect(() => {
    if (color_scheme_selected.length > 0) {
      color_scheme = color_scheme_selected[0] as string
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
        site_label_background_opacity * 100
      }%, transparent)`
  })

  // Ensure site_label_offset is always available
  scene_props.site_label_offset ??= [...DEFAULTS.structure.site_label_offset]

  // Copy button feedback state
  let copy_status = $state<
    { json: boolean; xyz: boolean; cif: boolean; poscar: boolean }
  >({
    json: false,
    xyz: false,
    cif: false,
    poscar: false,
  })

  // Dynamic button text based on copy status
  const copy_confirm = `✅`

  const export_formats = [
    { label: `JSON`, format: `json` },
    { label: `XYZ`, format: `xyz` },
    { label: `CIF`, format: `cif` },
    { label: `POSCAR`, format: `poscar` },
  ] as const

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
    const scheme = element_color_schemes[scheme_name as ColorSchemeName]
    if (!scheme) return []

    // Get colors for common elements: H, C, N, O, Fe, Ca, Si, Al
    const sample_elements = [`H`, `C`, `N`, `O`, `Fe`, `Ca`, `Si`, `Al`]
    return sample_elements
      .slice(0, 4) // Take first 4
      .map((el) => scheme[el] || scheme.H || `#cccccc`)
      .filter(Boolean)
  }

  // Helper function to export structure to file
  function export_structure(format: `json` | `xyz` | `cif` | `poscar`) {
    if (!structure) return
    const export_fns = {
      json: exports.export_structure_as_json,
      xyz: exports.export_structure_as_xyz,
      cif: exports.export_structure_as_cif,
      poscar: exports.export_structure_as_poscar,
    } as const
    export_fns[format](structure)
  }

  // Handle clipboard copy with user feedback
  async function handle_copy(format: `json` | `xyz` | `cif` | `poscar`) {
    if (!structure) {
      console.warn(`No structure available for copying`)
      return
    }

    try {
      let content: string
      if (format === `json`) content = exports.structure_to_json_str(structure)
      else if (format === `xyz`) content = exports.structure_to_xyz_str(structure)
      else if (format === `cif`) content = exports.structure_to_cif_str(structure)
      else if (format === `poscar`) {
        content = exports.structure_to_poscar_str(structure)
      } else throw new Error(`Invalid format: ${format}`)

      await navigator.clipboard.writeText(content)

      // Show temporary feedback in button text
      copy_status[format] = true
      setTimeout(() => {
        copy_status[format] = false
      }, 1000)
    } catch (error) {
      console.error(`Failed to copy ${format.toUpperCase()} to clipboard`, error)
    }
  }
</script>

<DraggablePane
  bind:show={controls_open}
  pane_props={{ ...pane_props, class: `controls-pane ${pane_props?.class ?? ``}` }}
  toggle_props={{
    title: `${controls_open ? `Close` : `Open`} structure controls`,
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
      Object.assign(scene_props, {
        show_atoms: DEFAULTS.structure.show_atoms,
        show_bonds: DEFAULTS.structure.show_bonds,
        show_site_labels: DEFAULTS.structure.show_site_labels,
        show_site_indices: DEFAULTS.structure.show_site_indices,
        show_force_vectors: DEFAULTS.structure.show_force_vectors,
      })
      show_image_atoms = DEFAULTS.structure.show_image_atoms
      lattice_props.show_cell_vectors = DEFAULTS.structure.show_cell_vectors
    }}
    style="display: flex; flex-wrap: wrap; gap: 1ex"
  >
    Show <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_atoms.description })}
    >
      <input type="checkbox" bind:checked={scene_props.show_atoms} />
      Atoms
    </label>
    <label
      {@attach tooltip({
        content: SETTINGS_CONFIG.structure.show_image_atoms.description,
      })}
    >
      <input type="checkbox" bind:checked={show_image_atoms} />
      Image Atoms
    </label>
    <label
      {@attach tooltip({
        content: SETTINGS_CONFIG.structure.show_site_labels.description,
      })}
    >
      <input type="checkbox" bind:checked={scene_props.show_site_labels} />
      Site Labels
    </label>
    <label
      {@attach tooltip({
        content: SETTINGS_CONFIG.structure.show_site_indices.description,
      })}
    >
      <input type="checkbox" bind:checked={scene_props.show_site_indices} />
      Site Indices
    </label>
    {#if has_forces}
      <label
        {@attach tooltip({
          content: SETTINGS_CONFIG.structure.show_force_vectors.description,
        })}
      >
        <input type="checkbox" bind:checked={scene_props.show_force_vectors} />
        Force Vectors
      </label>
    {/if}
    <label>
      <input type="checkbox" bind:checked={lattice_props.show_cell_vectors} />
      Lattice Vectors
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_bonds.description })}
    >
      Bonds:
      <select bind:value={scene_props.show_bonds}>
        {#each SETTINGS_CONFIG.structure.show_bonds.enum ?? [] as option (option)}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </label>
  </SettingsSection>

  <hr />
  <h4>Export</h4>
  <div class="export-buttons">
    {#each export_formats as { label, format } (format)}
      <div style="display: flex; align-items: center; gap: 4pt">
        {label}
        <button
          type="button"
          onclick={() => export_structure(format)}
          title="Download {label}"
        >
          ⬇
        </button>
        <button
          type="button"
          onclick={() => handle_copy(format)}
          title="Copy {label} to clipboard"
        >
          {copy_status[format] ? copy_confirm : `📋`}
        </button>
      </div>
    {/each}
    <label>
      PNG
      <button
        type="button"
        disabled={!wrapper?.querySelector(`canvas`)}
        onclick={() => {
          const canvas = wrapper?.querySelector(`canvas`) as HTMLCanvasElement
          if (canvas) {
            export_canvas_as_png(
              canvas,
              structure,
              png_dpi,
              scene,
              camera,
            )
          } else console.warn(`Canvas element not found for PNG export`)
        }}
        title="PNG ({png_dpi} DPI)"
      >
        ⬇
      </button>
      &nbsp;(DPI: <input
        type="number"
        min={50}
        max={500}
        bind:value={png_dpi}
        title="Export resolution in dots per inch"
        style="margin: 0 0 0 2pt"
      />)
    </label>
  </div>

  <hr />
  <SettingsSection
    title="Camera"
    current_values={{
      camera_projection: scene_props.camera_projection,
      auto_rotate: scene_props.auto_rotate,
      zoom_speed: scene_props.zoom_speed,
      pan_speed: scene_props.pan_speed,
      rotation_damping: scene_props.rotation_damping,
      rotation: scene_props.rotation,
    }}
    on_reset={() => {
      Object.assign(scene_props, {
        camera_projection: DEFAULTS.structure.camera_projection,
        auto_rotate: DEFAULTS.structure.auto_rotate,
        zoom_speed: DEFAULTS.structure.zoom_speed,
        pan_speed: DEFAULTS.structure.pan_speed,
        rotation_damping: DEFAULTS.structure.rotation_damping,
        rotation: [...DEFAULTS.structure.rotation],
      })
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
        {#each SETTINGS_CONFIG.structure.camera_projection.enum ?? [] as option (option)}
          <option value={option}>{option}</option>
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
      {#each axis_colors as [axis, color], idx (axis)}
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

  <hr />
  <SettingsSection
    title="Atoms"
    current_values={{
      atom_radius: scene_props.atom_radius,
      same_size_atoms: scene_props.same_size_atoms,
      color_scheme,
    }}
    on_reset={() => {
      Object.assign(scene_props, {
        atom_radius: DEFAULTS.structure.atom_radius,
        same_size_atoms: DEFAULTS.structure.same_size_atoms,
      })
      color_scheme = DEFAULTS.color_scheme
      color_scheme_selected = [DEFAULTS.color_scheme]
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
    <label
      style="align-items: start"
      {@attach tooltip({ content: SETTINGS_CONFIG.color_scheme.description })}
    >
      Color scheme
      <Select
        options={Object.keys(element_color_schemes)}
        maxSelect={1}
        minSelect={1}
        bind:selected={color_scheme_selected}
        liOptionStyle="padding: 3pt 6pt;"
        style="width: 10em; border: none"
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
    </label>
  </SettingsSection>

  {#if scene_props.show_site_labels || scene_props.show_site_indices}
    <hr />
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
        Object.assign(scene_props, {
          site_label_size: DEFAULTS.structure.site_label_size,
          site_label_padding: DEFAULTS.structure.site_label_padding,
          site_label_offset: [...DEFAULTS.structure.site_label_offset],
        })
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
    <hr />
    <SettingsSection
      title="Force Vectors"
      current_values={{
        force_scale: scene_props.force_scale,
        force_color: scene_props.force_color,
      }}
      on_reset={() => {
        Object.assign(scene_props, {
          force_scale: DEFAULTS.structure.force_scale,
          force_color: DEFAULTS.structure.force_color,
        })
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
    <hr />
    <SettingsSection
      title="Cell"
      current_values={{
        cell_edge_color: lattice_props.cell_edge_color,
        cell_edge_opacity: lattice_props.cell_edge_opacity,
        cell_surface_color: lattice_props.cell_surface_color,
        cell_surface_opacity: lattice_props.cell_surface_opacity,
        supercell_scaling,
      }}
      on_reset={() => {
        Object.assign(lattice_props, {
          cell_edge_color: DEFAULTS.structure.cell_edge_color,
          cell_edge_opacity: DEFAULTS.structure.cell_edge_opacity,
          cell_surface_color: DEFAULTS.structure.cell_surface_color,
          cell_surface_opacity: DEFAULTS.structure.cell_surface_opacity,
        })
        supercell_scaling = `1x1x1`
      }}
    >
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

  <hr />
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

  <hr />
  <SettingsSection
    title="Lighting"
    current_values={{
      directional_light: scene_props.directional_light,
      ambient_light: scene_props.ambient_light,
    }}
    on_reset={() => {
      Object.assign(scene_props, {
        directional_light: DEFAULTS.structure.directional_light,
        ambient_light: DEFAULTS.structure.ambient_light,
      })
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
    <hr />
    <SettingsSection
      title="Bonds"
      current_values={{
        bonding_strategy: scene_props.bonding_strategy,
        bond_color: scene_props.bond_color,
        bond_thickness: scene_props.bond_thickness,
      }}
      on_reset={() => {
        Object.assign(scene_props, {
          bonding_strategy: DEFAULTS.structure.bonding_strategy,
          bond_color: DEFAULTS.structure.bond_color,
          bond_thickness: DEFAULTS.structure.bond_thickness,
        })
      }}
    >
      <label>
        Bonding strategy
        <select bind:value={scene_props.bonding_strategy}>
          <option value="electroneg_ratio">Electronegativity Ratio</option>
          <option value="max_dist">Max Distance</option>
          <option value="nearest_neighbor">Nearest Neighbor</option>
        </select>
      </label>
      <label>
        Bond color
        <input type="color" bind:value={scene_props.bond_color} />
      </label>
      <label>
        Bond thickness
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
</DraggablePane>

<style>
  .export-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 1ex;
    font-size: 0.95em;
  }
  .export-buttons button {
    width: 1.6em;
    height: 1.6em;
    display: grid;
    place-items: center;
    padding: 0;
  }
  .rotation-axes {
    display: flex;
    gap: 9pt;
    font-size: 0.8em;
  }
  .rotation-axes > div {
    display: grid;
    gap: 0.3em;
    place-items: center;
  }
</style>

<script lang="ts">
  import type { AnyStructure } from '$lib'
  import { DraggablePanel } from '$lib'
  import { type ColorSchemeName, element_color_schemes } from '$lib/colors'
  import * as exports from '$lib/io/export'
  import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
  import { StructureScene } from '$lib/structure'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { Camera, Scene } from 'three'

  export interface Props {
    // Control panel state
    controls_open?: boolean
    // Scene properties (bindable from parent)
    scene_props?: ComponentProps<typeof StructureScene>
    // Lattice properties (bindable from parent)
    lattice_props?: {
      cell_edge_opacity: number
      cell_surface_opacity: number
      cell_edge_color: string
      cell_surface_color: string
      cell_line_width: number
      show_vectors: boolean
      [key: string]: unknown
    }
    // Display options (bindable from parent)
    show_image_atoms?: boolean
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
    panel_props?: ComponentProps<typeof DraggablePanel>[`panel_props`]
    toggle_props?: ComponentProps<typeof DraggablePanel>[`toggle_props`]
    [key: string]: unknown
  }
  let {
    controls_open = $bindable(false),
    scene_props = $bindable({}),
    lattice_props = $bindable({
      cell_edge_opacity: DEFAULTS.structure.cell_edge_opacity,
      cell_surface_opacity: DEFAULTS.structure.cell_surface_opacity,
      cell_edge_color: DEFAULTS.structure.cell_edge_color,
      cell_surface_color: DEFAULTS.structure.cell_surface_color,
      cell_line_width: DEFAULTS.structure.cell_line_width,
      show_vectors: true,
    }),
    show_image_atoms = $bindable(true),
    background_color = $bindable(undefined),
    background_opacity = $bindable(0.1),
    color_scheme = $bindable(`Vesta`),
    structure = undefined,
    wrapper = undefined,
    png_dpi = $bindable(150),
    scene = undefined,
    camera = undefined,
    panel_props = $bindable({}),
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
  if (!scene_props.site_label_offset) {
    scene_props.site_label_offset = [...DEFAULTS.structure.site_label_offset]
  }

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
    }
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

      await exports.copy_to_clipboard(content)

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

<DraggablePanel
  bind:show={controls_open}
  panel_props={{ class: `controls-panel`, ...panel_props }}
  toggle_props={{
    class: `structure-controls-toggle`,
    title: `${controls_open ? `Close` : `Open`} structure controls`,
    ...toggle_props,
  }}
  {...rest}
>
  <h4 style="margin-top: 0">Structure Controls</h4>
  <!-- Visibility Controls -->
  <div
    style="display: flex; align-items: center; gap: 4pt; flex-wrap: wrap; max-width: 90%"
  >
    Show <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_atoms.description })}
    >
      <input type="checkbox" bind:checked={scene_props.show_atoms} />
      atoms
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_bonds.description })}
    >
      <input type="checkbox" bind:checked={scene_props.show_bonds} />
      bonds
    </label>
    <label {@attach tooltip({ content: SETTINGS_CONFIG.show_image_atoms.description })}>
      <input type="checkbox" bind:checked={show_image_atoms} />
      image atoms
    </label>
    <label
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.show_site_labels.description })}
    >
      <input type="checkbox" bind:checked={scene_props.show_site_labels} />
      site labels
    </label>
    {#if has_forces}
      <label
        {@attach tooltip({
          content: SETTINGS_CONFIG.structure.show_force_vectors.description,
        })}
      >
        <input type="checkbox" bind:checked={scene_props.show_force_vectors} />
        force vectors
      </label>
    {/if}
  </div>

  <!-- Export Controls -->
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
        onclick={() => {
          const canvas = wrapper?.querySelector(`canvas`) as HTMLCanvasElement
          if (canvas) {
            exports.export_canvas_as_png(
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

  <!-- Camera Controls -->
  <hr />
  <h4>Camera</h4>
  <label>
    <span
      {@attach tooltip({ content: SETTINGS_CONFIG.structure.projection.description })}
    >
      Projection
    </span>
    <select bind:value={scene_props.camera_projection}>
      <option value="perspective">Perspective</option>
      <option value="orthographic">Orthographic</option>
    </select>
  </label>
  <label
    {@attach tooltip({ content: SETTINGS_CONFIG.structure.auto_rotate.description })}
  >
    Auto rotate speed
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
  <label {@attach tooltip({ content: SETTINGS_CONFIG.structure.zoom_speed.description })}>
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
  <label {@attach tooltip({ content: SETTINGS_CONFIG.structure.pan_speed.description })}>
    Pan speed
    <input type="number" min={0} max={2} step={0.01} bind:value={scene_props.pan_speed} />
    <input type="range" min={0} max={2} step={0.01} bind:value={scene_props.pan_speed} />
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

  <!-- Atom Controls -->
  <hr />
  <h4>Atoms</h4>
  <label
    class="slider-control"
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
    style="align-items: flex-start"
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

  <!-- Label Controls -->
  {#if scene_props.show_site_labels}
    <hr />
    <h4>Labels</h4>
    <div class="panel-row">
      <label>
        Color
        <input type="color" bind:value={site_label_hex_color} />
      </label>
      <label class="slider-control">
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
    <div class="panel-row">
      <label>
        Background
        <input type="color" bind:value={site_label_bg_hex_color} />
      </label>
      <label class="slider-control">
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
    <div class="panel-row">
      <label class="slider-control">
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
    <div class="panel-row">
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
  {/if}

  <!-- Force Vector Controls -->
  {#if has_forces && scene_props.show_force_vectors}
    <hr />
    <h4>Force Vectors</h4>
    <label class="slider-control">
      Scale
      <input
        type="number"
        min={0.001}
        max={5}
        step={0.001}
        bind:value={scene_props.force_vector_scale}
      />
      <input
        type="range"
        min={0.001}
        max={5}
        step={0.001}
        bind:value={scene_props.force_vector_scale}
      />
    </label>
    <label>
      Color
      <input type="color" bind:value={scene_props.force_vector_color} />
    </label>
  {/if}

  <!-- Cell Controls -->
  <hr />
  <h4>Cell</h4>
  <label>
    <input type="checkbox" bind:checked={lattice_props.show_vectors} />
    Lattice Vectors
  </label>
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
    <div class="panel-row">
      <label>
        {label}
        <input
          type="color"
          bind:value={lattice_props[color_prop]}
        />
      </label>
      <label class="slider-control">
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

  <!-- Background Controls -->
  <hr />
  <h4>Background</h4>
  <div class="panel-row">
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
    <label class="slider-control">
      Opacity
      <input type="number" min={0} max={1} step={0.02} bind:value={background_opacity} />
      <input type="range" min={0} max={1} step={0.02} bind:value={background_opacity} />
    </label>
  </div>

  <!-- Lighting Controls -->
  <hr />
  <h4>Lighting</h4>
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

  <!-- Bond Controls -->
  {#if scene_props.show_bonds}
    <hr />
    <h4>Bonds</h4>
    <label>
      Bonding strategy
      <select bind:value={scene_props.bonding_strategy}>
        <option value="max_dist">Max Distance</option>
        <option value="nearest_neighbor">Nearest Neighbor</option>
        <option value="vdw_radius_based">Van der Waals Radii</option>
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
  {/if}
</DraggablePanel>

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
</style>

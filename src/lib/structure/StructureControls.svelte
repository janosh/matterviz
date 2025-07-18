<script lang="ts">
  import type { AnyStructure } from '$lib'
  import { DraggablePanel } from '$lib'
  import { type ColorSchemeName, element_color_schemes } from '$lib/colors'
  import * as exports from '$lib/io/export'
  import { STRUCT_DEFAULTS, StructureScene } from '$lib/structure'
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
    show_site_labels?: boolean
    show_full_controls?: boolean
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
    save_json_btn_text?: string
    save_png_btn_text?: string
    save_xyz_btn_text?: string
    copy_json_btn_text?: string
    copy_xyz_btn_text?: string
    scene?: Scene
    camera?: Camera
    panel_props?: ComponentProps<typeof DraggablePanel>[`panel_props`]
    toggle_props?: ComponentProps<typeof DraggablePanel>[`toggle_props`]
    [key: string]: unknown
  }
  let {
    controls_open = $bindable(false),
    scene_props = $bindable({
      atom_radius: 1,
      show_atoms: true,
      auto_rotate: 0,
      show_bonds: false,
      show_force_vectors: false,
      force_vector_scale: STRUCT_DEFAULTS.vector.scale,
      force_vector_color: STRUCT_DEFAULTS.vector.color,
      same_size_atoms: false,
      bond_thickness: STRUCT_DEFAULTS.bond.thickness,
    }),
    lattice_props = $bindable({
      cell_edge_opacity: STRUCT_DEFAULTS.cell.edge_opacity,
      cell_surface_opacity: STRUCT_DEFAULTS.cell.surface_opacity,
      cell_edge_color: STRUCT_DEFAULTS.cell.edge_color,
      cell_surface_color: STRUCT_DEFAULTS.cell.surface_color,
      cell_line_width: STRUCT_DEFAULTS.cell.line_width,
      show_vectors: true,
    }),
    show_image_atoms = $bindable(true),
    show_site_labels = $bindable(false),
    show_full_controls = $bindable(false),
    background_color = $bindable(undefined),
    background_opacity = $bindable(0.1),
    color_scheme = $bindable(`Vesta`),
    structure = undefined,
    wrapper = undefined,
    png_dpi = $bindable(150),
    save_json_btn_text = `⬇ JSON`,
    save_png_btn_text = `⬇ PNG`,
    save_xyz_btn_text = `⬇ XYZ`,
    copy_json_btn_text = `📋 JSON`,
    copy_xyz_btn_text = `📋 XYZ`,
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

  // Copy button feedback state
  let copy_status = $state<{ json: boolean; xyz: boolean }>({
    json: false,
    xyz: false,
  })

  // Dynamic button text based on copy status
  const copy_confirm = `✅ Copied!`
  let current_copy_json_btn_text = $derived(
    copy_status.json ? copy_confirm : copy_json_btn_text,
  )
  let current_copy_xyz_btn_text = $derived(
    copy_status.xyz ? copy_confirm : copy_xyz_btn_text,
  )

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

  // Handle clipboard copy with user feedback
  async function handle_copy(format: `json` | `xyz`) {
    if (!structure) {
      console.warn(`No structure available for copying`)
      return
    }

    try {
      let content: string
      if (format === `json`) content = exports.structure_to_json_str(structure)
      else if (format === `xyz`) content = exports.structure_to_xyz_str(structure)
      else throw new Error(`Invalid format: ${format}`)

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
  toggle_props={{ class: `structure-controls-toggle`, title: `Open controls`, ...toggle_props }}
  icon_style="transform: scale(1.2);"
  {...rest}
>
  <h4 style="margin-top: 0">Structure Controls</h4>
  <!-- Visibility Controls -->
  <div
    style="display: flex; align-items: center; gap: 4pt; flex-wrap: wrap; max-width: 90%"
  >
    Show <label>
      <input
        type="checkbox"
        bind:checked={scene_props.show_atoms}
      />
      atoms
    </label>
    <label>
      <input
        type="checkbox"
        bind:checked={scene_props.show_bonds}
      />
      bonds
    </label>
    <label>
      <input type="checkbox" bind:checked={show_image_atoms} />
      image atoms
    </label>
    <label>
      <input type="checkbox" bind:checked={show_site_labels} />
      site labels
    </label>
    {#if has_forces}
      <label>
        <input
          type="checkbox"
          bind:checked={scene_props.show_force_vectors}
        />
        force vectors
      </label>
    {/if}
    <label>
      <input type="checkbox" bind:checked={show_full_controls} />
      full controls
    </label>
  </div>

  <hr />

  <!-- Atom Controls -->
  <h4>Atoms</h4>
  <label class="slider-control">
    Radius <small>(Å)</small>
    <input
      type="number"
      min="0.2"
      max={2}
      step={0.05}
      bind:value={scene_props.atom_radius}
    />
    <input
      type="range"
      min="0.2"
      max={2}
      step={0.05}
      bind:value={scene_props.atom_radius}
    />
  </label>
  <label
    title="If true, all atoms have same size. If false, scale according to atomic radii"
    {@attach tooltip()}
  >
    Same size atoms
    <input
      type="checkbox"
      bind:checked={scene_props.same_size_atoms}
    />
  </label>
  <label style="align-items: flex-start">
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

  <hr />

  <!-- Force Vector Controls -->
  {#if has_forces && scene_props.show_force_vectors}
    <h4>Force Vectors</h4>
    <label class="slider-control">
      Scale
      <input
        type="number"
        min="0.001"
        max="5"
        step="0.001"
        bind:value={scene_props.force_vector_scale}
      />
      <input
        type="range"
        min="0.001"
        max="5"
        step="0.001"
        bind:value={scene_props.force_vector_scale}
      />
    </label>
    <label class="compact">
      Color
      <input type="color" bind:value={scene_props.force_vector_color} />
    </label>

    <hr />
  {/if}

  <!-- Cell Controls -->
  <h4>Cell</h4>
  <label>
    <input
      type="checkbox"
      bind:checked={lattice_props.show_vectors}
    />
    lattice vectors
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
      <label class="compact">
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

  <hr />

  <!-- Background Controls -->
  <h4>Background</h4>
  <div class="panel-row">
    <label class="compact">
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
      <input
        type="number"
        min={0}
        max={1}
        step={0.02}
        bind:value={background_opacity}
      />
      <input
        type="range"
        min={0}
        max={1}
        step={0.02}
        bind:value={background_opacity}
      />
    </label>
  </div>

  {#if show_full_controls}
    <!-- Camera Controls -->
    <h4>Camera</h4>
    <label>
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
    <label>
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
    <label>
      <span
        title="Pan by clicking and dragging while holding cmd, ctrl or shift"
        {@attach tooltip()}
      >
        Pan speed
      </span>
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
    <label>
      <span title="Damping factor for rotation" {@attach tooltip()}>
        Rotation damping
      </span>
      <input
        type="number"
        min={0}
        max={0.3}
        step={0.01}
        bind:value={scene_props.rotation_damping}
      />
      <input
        type="range"
        min={0}
        max={0.3}
        step={0.01}
        bind:value={scene_props.rotation_damping}
      />
    </label>

    <hr />

    <!-- Lighting Controls -->
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
  {/if}

  <hr />

  {#if scene_props.show_bonds}
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

  <!-- Export Controls -->
  <hr />
  <h4>Export</h4>
  <span
    style="display: flex; gap: 4pt; margin: 3pt 0 0; align-items: center; flex-wrap: wrap"
  >
    <button
      type="button"
      onclick={() => exports.export_structure_as_json(structure)}
      title={save_json_btn_text}
    >
      {save_json_btn_text}
    </button>
    <button
      type="button"
      onclick={() => handle_copy(`json`)}
      title={current_copy_json_btn_text}
    >
      {current_copy_json_btn_text}
    </button>
    <button
      type="button"
      onclick={() => exports.export_structure_as_xyz(structure)}
      title={save_xyz_btn_text}
    >
      {save_xyz_btn_text}
    </button>
    <button
      type="button"
      onclick={() => handle_copy(`xyz`)}
      title={current_copy_xyz_btn_text}
    >
      {current_copy_xyz_btn_text}
    </button>
    <button
      type="button"
      onclick={() => {
        const canvas = wrapper?.querySelector(`canvas`) as HTMLCanvasElement
        if (canvas) {
          exports.export_canvas_as_png(canvas, structure, png_dpi, scene, camera)
        } else {
          console.warn(`Canvas element not found for PNG export`)
        }
      }}
      title="{save_png_btn_text} (${png_dpi} DPI)"
    >
      {save_png_btn_text}
    </button>
    <small style="margin-left: 4pt">DPI:</small>
    <input
      type="number"
      min={72}
      max={300}
      step={25}
      bind:value={png_dpi}
      style="width: 3.5em"
      title="Export resolution in dots per inch"
    />
  </span>
</DraggablePanel>

<style>
  h4 {
    margin: 8pt 0 2pt;
    font-size: 0.9em;
  }
  .panel-row {
    display: flex;
    gap: 4pt;
    align-items: flex-start;
  }
  .panel-row label {
    min-width: 0;
  }
  .panel-row label.compact {
    flex: 0 0 auto;
    margin-right: 8pt;
  }
  .panel-row label.slider-control {
    flex: 1;
  }
</style>

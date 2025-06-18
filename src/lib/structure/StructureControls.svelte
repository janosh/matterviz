<script lang="ts">
  import type { AnyStructure, Lattice } from '$lib'
  import { ControlPanel } from '$lib'
  import { element_color_schemes } from '$lib/colors'
  import * as exports from '$lib/io/export'
  import type { ComponentProps } from 'svelte'
  import Select from 'svelte-multiselect'
  import { Tooltip } from 'svelte-zoo'
  import type { StructureScene } from './index'

  export interface Props {
    // Control panel state
    controls_open?: boolean
    // Scene properties (bindable from parent)
    scene_props?: ComponentProps<typeof StructureScene>
    // Lattice properties (bindable from parent)
    lattice_props?: ComponentProps<typeof Lattice>
    // Display options (bindable from parent)
    show_image_atoms?: boolean
    show_site_labels?: boolean
    show_full_controls?: boolean
    // Background settings (bindable from parent)
    background_color?: string
    background_opacity?: number
    // Color scheme (bindable from parent)
    color_scheme?: `Jmol` | `Vesta`
    // Structure for export functions
    structure?: AnyStructure | undefined
    // Canvas wrapper for PNG export
    wrapper?: HTMLDivElement | undefined
    // Export settings
    png_dpi?: number
    save_json_btn_text?: string
    save_png_btn_text?: string
    save_xyz_btn_text?: string
  }
  let {
    controls_open = $bindable(false),
    scene_props = $bindable({}),
    lattice_props = $bindable({}),
    show_image_atoms = $bindable(true),
    show_site_labels = $bindable(false),
    show_full_controls = $bindable(false),
    background_color = $bindable(`#ffffff`),
    background_opacity = $bindable(0.1),
    color_scheme = $bindable(`Vesta`),
    structure = undefined,
    wrapper = undefined,
    png_dpi = $bindable(150),
    save_json_btn_text = `⬇ Save as JSON`,
    save_png_btn_text = `✎ Save as PNG`,
    save_xyz_btn_text = `📄 Save as XYZ`,
  }: Props = $props()

  // Color scheme selection state
  let color_scheme_selected = $state([color_scheme])
  $effect(() => {
    if (color_scheme_selected.length > 0) {
      color_scheme = color_scheme_selected[0] as `Jmol` | `Vesta`
    }
  })

  // Helper function to get example set of colors from an element color scheme
  function get_representative_colors(scheme_name: string): string[] {
    const scheme =
      element_color_schemes[scheme_name as keyof typeof element_color_schemes]
    if (!scheme) return []

    // Get colors for common elements: H, C, N, O, Fe, Ca, Si, Al
    const sample_elements = [`H`, `C`, `N`, `O`, `Fe`, `Ca`, `Si`, `Al`]
    return sample_elements
      .slice(0, 4) // Take first 4
      .map((el) => scheme[el] || scheme.H || `#cccccc`)
      .filter(Boolean)
  }
</script>

<ControlPanel bind:controls_open>
  {#snippet controls_content()}
    <!-- Visibility Controls -->
    <div style="display: flex; align-items: center; gap: 4pt; flex-wrap: wrap;">
      Show <label>
        <input type="checkbox" bind:checked={scene_props.show_atoms} />
        atoms
      </label>
      <label>
        <input type="checkbox" bind:checked={scene_props.show_bonds} />
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
      <label>
        <input type="checkbox" bind:checked={show_full_controls} />
        full controls
      </label>
    </div>

    <hr />

    <!-- Atom Controls -->
    <h4 class="section-heading">Atoms</h4>
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
    <label>
      <input type="checkbox" bind:checked={scene_props.same_size_atoms} />
      <span>
        Scale according to atomic radii
        <small> (if false, all atoms same size)</small>
      </span>
    </label>
    <label style="align-items: flex-start;">
      Color scheme
      <Select
        options={Object.keys(element_color_schemes)}
        maxSelect={1}
        minSelect={1}
        bind:selected={color_scheme_selected}
        liOptionStyle="padding: 3pt 6pt;"
        style="width: 10em; border: none;"
      >
        {#snippet children({ option })}
          {@const style = `display: flex; align-items: center; gap: 6pt; justify-content: space-between;`}
          <div {style}>
            {option}
            <div style="display: flex; gap: 3pt;">
              {#each get_representative_colors(String(option)) as color (color)}
                {@const style = `width: 15px; height: 15px; border-radius: 2px; background: {color};`}
                <div {style}></div>
              {/each}
            </div>
          </div>
        {/snippet}
      </Select>
    </label>

    <hr />

    <!-- Cell Controls -->
    <h4 class="section-heading">Cell</h4>
    <label>
      <input type="checkbox" bind:checked={lattice_props.show_vectors} />
      lattice vectors
    </label>
    {#each [
      { label: `Edge color`, color_prop: `cell_edge_color`, opacity_prop: `cell_edge_opacity`, step: 0.05 },
      { label: `Surface color`, color_prop: `cell_surface_color`, opacity_prop: `cell_surface_opacity`, step: 0.01 },
    ] as const as { label, color_prop, opacity_prop, step } (label)}
      <div class="control-row">
        <label class="compact">
          {label}
          <input type="color" bind:value={lattice_props[color_prop]} />
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
    <h4 class="section-heading">Background</h4>
    <div class="control-row">
      <label class="compact">
        Color
        <input type="color" bind:value={background_color} />
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
      <h4 class="section-heading">Camera</h4>
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
        <Tooltip text="pan by clicking and dragging while holding cmd, ctrl or shift">
          Pan speed
        </Tooltip>
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
        <Tooltip text="damping factor for rotation">Rotation damping</Tooltip>
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
      <h4 class="section-heading">Lighting</h4>
      <label>
        <Tooltip text="intensity of the directional light">Directional light</Tooltip>
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
        <Tooltip text="intensity of the ambient light">Ambient light</Tooltip>
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
          min={0.01}
          max={0.12}
          step={0.005}
          bind:value={scene_props.bond_thickness}
        />
        <input
          type="range"
          min="0.01"
          max="0.12"
          step={0.005}
          bind:value={scene_props.bond_thickness}
        />
      </label>
    {/if}

    <span
      style="display: flex; gap: 4pt; margin: 3pt 0 0; align-items: center; flex-wrap: wrap;"
    >
      <button
        type="button"
        onclick={() => exports.export_json(structure)}
        title={save_json_btn_text}
      >
        {save_json_btn_text}
      </button>
      <button
        type="button"
        onclick={() => exports.export_xyz(structure)}
        title={save_xyz_btn_text}
      >
        {save_xyz_btn_text}
      </button>
      <button
        type="button"
        onclick={() => {
          const canvas = wrapper?.querySelector(`canvas`) as HTMLCanvasElement
          exports.export_png(canvas, structure, png_dpi)
        }}
        title="{save_png_btn_text} (${png_dpi} DPI)"
      >
        {save_png_btn_text}
      </button>
      <small style="margin-left: 4pt;">DPI:</small>
      <input
        type="number"
        min={72}
        max={300}
        step={25}
        bind:value={png_dpi}
        style="width: 3.5em;"
        title="Export resolution in dots per inch"
      />
    </span>
  {/snippet}
</ControlPanel>

<style>
  .section-heading {
    margin: 8pt 0 2pt;
    font-size: 0.9em;
    color: var(--text-muted, #ccc);
  }
  .control-row {
    display: flex;
    gap: 4pt;
    align-items: flex-start;
  }
  .control-row label {
    min-width: 0;
  }
  .control-row label.compact {
    flex: 0 0 auto;
    margin-right: 8pt;
  }
  .control-row label.slider-control {
    flex: 1;
  }
</style>

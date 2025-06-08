<script lang="ts">
  import { browser } from '$app/environment'
  import type { AnyStructure, Lattice } from '$lib'
  import { get_elem_amounts, get_pbc_image_sites } from '$lib'
  import { element_color_schemes } from '$lib/colors'
  import * as exports from '$lib/io/export'
  import { colors } from '$lib/state.svelte'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import Select from 'svelte-multiselect'
  import { Tooltip } from 'svelte-zoo'
  import { WebGLRenderer } from 'three'
  import { BOND_DEFAULTS, CELL_DEFAULTS, StructureLegend, StructureScene } from '.'

  interface Props {
    // output of pymatgen.core.Structure.as_dict()
    structure?: AnyStructure | undefined
    // need to set a default atom_radius so it doesn't initialize to 0
    scene_props?: ComponentProps<typeof StructureScene> // passed to StructureScene
    lattice_props?: ComponentProps<typeof Lattice> // passed to Lattice
    // whether to show the controls panel
    controls_open?: boolean
    // canvas background color
    background_color?: string // must be hex code for <input type='color'>
    // background color opacity (0-1)
    background_opacity?: number
    // only show the buttons when hovering over the canvas on desktop screens
    // mobile screens don't have hover, so by default the buttons are always
    // shown on a canvas of width below 500px
    reveal_buttons?: boolean | number
    fullscreen?: boolean
    wrapper?: HTMLDivElement | undefined
    // the control panel DOM element
    controls?: HTMLElement | undefined
    // the button to toggle the control panel
    toggle_controls_btn?: HTMLButtonElement | undefined
    // bindable width of the canvas
    width?: number
    // bindable height of the canvas
    height?: number
    reset_text?: string
    color_scheme?: `Jmol` | `Vesta`
    hovered?: boolean
    dragover?: boolean
    allow_file_drop?: boolean
    tips_modal?: HTMLDialogElement | undefined
    enable_tips?: boolean
    save_json_btn_text?: string
    save_png_btn_text?: string
    save_xyz_btn_text?: string
    png_dpi?: number // PNG export DPI (dots per inch) - 72 is standard web resolution, 150+ is print quality
    // boolean or map from element symbols to labels
    // use atom_label snippet to include HTML and event handlers
    show_site_labels?: boolean
    show_image_atoms?: boolean
    show_full_controls?: boolean
    tips_icon?: Snippet<[]>
    fullscreen_toggle?: Snippet<[]>
    controls_toggle?: Snippet<[{ controls_open: boolean }]>
    bottom_left?: Snippet<[{ structure: AnyStructure }]>
    // Generic callback for when files are dropped - receives raw content and filename
    on_file_drop?: (content: string, filename: string) => void
    [key: string]: unknown
  }
  let {
    structure = $bindable(undefined),
    scene_props = $bindable({ atom_radius: 1, show_atoms: true, auto_rotate: 0 }),
    lattice_props = $bindable({
      cell_edge_opacity: CELL_DEFAULTS.edge_opacity,
      cell_surface_opacity: CELL_DEFAULTS.surface_opacity,
      cell_edge_color: CELL_DEFAULTS.color,
      cell_surface_color: CELL_DEFAULTS.color,
      cell_line_width: CELL_DEFAULTS.line_width,
      show_vectors: true,
    }),
    controls_open = $bindable(false),
    background_color = $bindable(`#ffffff`),
    background_opacity = $bindable(0.1),
    reveal_buttons = 500,
    fullscreen = false,
    wrapper = $bindable(undefined),
    controls = $bindable(undefined),
    toggle_controls_btn = $bindable(undefined),
    width = $bindable(0),
    height = $bindable(0),
    reset_text = `Reset camera`,
    color_scheme = $bindable(`Vesta`),
    hovered = $bindable(false),
    dragover = $bindable(false),
    allow_file_drop = true,
    tips_modal = $bindable(undefined),
    enable_tips = true,
    save_json_btn_text = `⬇ Save as JSON`,
    save_png_btn_text = `✎ Save as PNG`,
    save_xyz_btn_text = `📄 Save as XYZ`,
    png_dpi = $bindable(150),
    show_site_labels = $bindable(false),
    show_image_atoms = $bindable(true),
    show_full_controls = $bindable(false),
    tips_icon,
    fullscreen_toggle,
    controls_toggle,
    bottom_left,
    on_file_drop,
    ...rest
  }: Props = $props()

  // Ensure scene_props always has some defaults merged in
  $effect.pre(() => {
    scene_props = {
      atom_radius: 1,
      show_atoms: true,
      auto_rotate: 0,
      bond_thickness: BOND_DEFAULTS.thickness,
      ...scene_props,
    }
  })

  $effect.pre(() => {
    colors.element = element_color_schemes[color_scheme]
  })

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

  function on_keydown(event: KeyboardEvent) {
    if (event.key === `Escape`) controls_open = false
  }

  const on_window_click =
    (node: (HTMLElement | undefined | null)[], cb: () => void) => (event: MouseEvent) => {
      if (!node || !event.target) return // ignore invalid input
      // ignore clicks inside any of the nodes
      if (node && node.some((n) => n?.contains(event.target as Node))) return
      cb() // invoke callback
    }

  let visible_buttons = $derived(
    reveal_buttons == true ||
      (typeof reveal_buttons == `number` && reveal_buttons < width),
  )

  // Track if camera has ever been moved from initial position
  let camera_has_moved = $state(false)
  let camera_is_moving = $state(false)
  // Reset tracking when structure changes
  $effect(() => {
    if (structure) camera_has_moved = false
  })
  // Set camera_has_moved to true when camera starts moving
  $effect(() => {
    if (camera_is_moving) camera_has_moved = true
  })
  function reset_camera() {
    // Reset camera position to trigger automatic positioning
    scene_props.camera_position = [0, 0, 0]
    camera_has_moved = false
  }

  function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return

    const drag_data_json = event.dataTransfer?.getData(`application/json`)
    if (drag_data_json) {
      try {
        const file_info = JSON.parse(drag_data_json)
        if (file_info.name && file_info.content) {
          on_file_drop?.(file_info.content, file_info.name)
          return
        }
      } catch {
        // Not our format, continue to file handling
      }
    }

    // Handle regular file drops
    const file = event.dataTransfer?.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event: ProgressEvent<FileReader>) => {
      const content = event.target?.result as string
      if (content) on_file_drop?.(content, file.name)
    }
    reader.readAsText(file)
  }

  export function toggle_fullscreen() {
    if (!document.fullscreenElement && wrapper) {
      wrapper.requestFullscreen().catch(console.error)
    } else {
      document.exitFullscreen()
    }
  }

  // set --struct-bg to background_color
  $effect(() => {
    if (browser && wrapper && background_color) {
      // Convert opacity (0-1) to hex alpha value (00-FF)
      const alpha_hex = Math.round(background_opacity * 255)
        .toString(16)
        .padStart(2, `0`)
      wrapper.style.setProperty(`--struct-bg`, `${background_color}${alpha_hex}`)
    }
  })

  // react to changes in the 'fullscreen' property
  $effect(() => {
    if (browser) {
      // react to changes in the 'fullscreen' property
      if (fullscreen && !document.fullscreenElement && wrapper) {
        wrapper.requestFullscreen().catch(console.error)
      } else if (!fullscreen && document.fullscreenElement) {
        document.exitFullscreen()
      }
    }
  })
</script>

<svelte:window
  onkeydown={on_keydown}
  onclick={on_window_click([controls, toggle_controls_btn], () => {
    if (controls_open) controls_open = false
  })}
/>

{#if structure?.sites}
  <div
    class="structure"
    class:dragover
    role="region"
    bind:this={wrapper}
    bind:clientWidth={width}
    bind:clientHeight={height}
    onmouseenter={() => (hovered = true)}
    onmouseleave={() => (hovered = false)}
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
    {...rest}
  >
    <section class:visible={visible_buttons}>
      {#if camera_has_moved}
        <button class="reset-camera" onclick={reset_camera} title={reset_text}>
          <!-- Target/Focus icon for reset camera -->
          <svg><use href="#icon-reset" /></svg>
        </button>
      {/if}
      {#if enable_tips}
        <button class="info-icon" onclick={() => tips_modal?.showModal()}>
          {#if tips_icon}{@render tips_icon()}{:else}<svg><use href="#icon-info" /></svg
            >{/if}
        </button>
      {/if}
      <button
        onclick={toggle_fullscreen}
        class="fullscreen-toggle"
        title="Toggle fullscreen"
      >
        {#if fullscreen_toggle}{@render fullscreen_toggle()}{:else}
          <svg style="transform: scale(0.9);"><use href="#icon-fullscreen" /></svg>
        {/if}
      </button>
      <button
        onclick={() => (controls_open = !controls_open)}
        bind:this={toggle_controls_btn}
        class="controls-toggle"
        title={controls_open ? `Close controls` : `Open controls`}
      >
        {#if controls_toggle}{@render controls_toggle({
            controls_open,
          })}{:else if controls_open}
          <svg><use href="#icon-x" /></svg>
        {:else}
          <svg><use href="#icon-settings" /></svg>
        {/if}
      </button>
    </section>

    <StructureLegend elements={get_elem_amounts(structure)} bind:tips_modal />

    <dialog class="controls" bind:this={controls} open={controls_open}>
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
      {#each [{ label: `Edge color`, color_prop: `cell_edge_color` as const, opacity_prop: `cell_edge_opacity` as const, step: 0.05 }, { label: `Surface color`, color_prop: `cell_surface_color` as const, opacity_prop: `cell_surface_opacity` as const, step: 0.01 }] as { label, color_prop, opacity_prop, step } (label)}
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
    </dialog>

    <Canvas
      createRenderer={(canvas) => {
        const renderer = new WebGLRenderer({
          canvas,
          preserveDrawingBuffer: true,
          antialias: true,
          alpha: true,
        })
        // Store renderer reference for high-res export
        ;(canvas as exports.CanvasWithRenderer).__customRenderer = renderer
        return renderer
      }}
    >
      <StructureScene
        structure={show_image_atoms && structure && `lattice` in structure
          ? get_pbc_image_sites(structure)
          : structure}
        {...scene_props}
        {show_site_labels}
        {lattice_props}
        bind:camera_is_moving
      />
    </Canvas>

    <div class="bottom-left">
      {@render bottom_left?.({ structure })}
    </div>
  </div>
{:else if structure}
  <p class="warn">No sites found in structure</p>
{:else}
  <p class="warn">No structure provided</p>
{/if}

<style>
  .structure {
    position: relative;
    container-type: size;
    height: var(--struct-height, 500px);
    width: var(--struct-width);
    max-width: var(--struct-max-width);
    min-width: var(--struct-min-width);
    border-radius: var(--struct-border-radius, 3pt);
    background: var(--struct-bg, rgba(255, 255, 255, 0.1));
    --struct-controls-transition-duration: 0.3s;
    overflow: var(--struct-overflow, visible);
    color: var(--struct-text-color);
  }
  .structure:fullscreen :global(canvas) {
    height: 100vh !important;
    width: 100vw !important;
  }
  .structure.dragover {
    background: var(--struct-dragover-bg, rgba(0, 0, 0, 0.7));
  }
  div.bottom-left {
    position: absolute;
    bottom: 0;
    left: 0;
    font-size: var(--struct-bottom-left-font-size, 1.2em);
    padding: var(--struct-bottom-left-padding, 1pt 5pt);
  }
  button {
    background-color: transparent;
  }
  button:hover {
    background-color: transparent !important;
  }

  section {
    position: absolute;
    display: flex;
    justify-content: end;
    top: var(--struct-buttons-top, 1ex);
    right: var(--struct-buttons-right, 1ex);
    gap: var(--struct-buttons-gap, 3pt);
    z-index: 2;
  }

  section button {
    pointer-events: auto;
  }
  section button svg {
    pointer-events: none;
    width: 20px;
    height: 20px;
  }

  dialog.controls {
    position: absolute;
    left: unset;
    background: transparent;
    border: none;
    display: grid;
    visibility: hidden;
    opacity: 0;
    gap: var(--struct-controls-gap, 4pt);
    text-align: var(--struct-controls-text-align, left);
    transition:
      visibility var(--struct-controls-transition-duration),
      opacity var(--struct-controls-transition-duration);
    box-sizing: border-box;
    top: var(--struct-controls-top, 30pt);
    right: var(--struct-controls-right, 6pt);
    background: var(--struct-controls-bg, rgba(10, 10, 10, 0.8));
    padding: var(--struct-controls-padding, 6pt 9pt);
    border-radius: var(--struct-controls-border-radius, 3pt);
    width: var(--struct-controls-width, 20em);
    max-width: var(--struct-controls-max-width, 90cqw);
    color: var(--struct-controls-text-color);
    overflow: auto;
    max-height: var(--struct-controls-max-height, calc(100vh - 3em));
  }
  dialog.controls hr {
    border: none;
    background: var(--struct-controls-hr-bg, gray);
    margin: var(--struct-controls-hr-margin, 0);
    height: var(--struct-controls-hr-height, 0.5px);
  }
  dialog.controls label {
    display: flex;
    align-items: center;
    gap: var(--struct-controls-label-gap, 2pt);
  }
  dialog.controls input[type='range'] {
    margin-left: auto;
    width: var(--struct-controls-input-range-width, 100px);
    flex-shrink: 0;
  }
  .slider-control input[type='range'] {
    margin-left: 0;
  }
  dialog.controls input[type='number'] {
    box-sizing: border-box;
    text-align: center;
    border-radius: var(--struct-controls-input-num-border-radius, 3pt);
    width: var(--struct-controls-input-num-width, 2.2em);
    border: var(--struct-controls-input-num-border, none);
    background: var(--struct-controls-input-num-bg, rgba(255, 255, 255, 0.15));
    margin-right: 3pt;
    margin-left: var(--struct-controls-input-num-margin-left, 6pt);
    flex-shrink: 0;
  }
  input::-webkit-inner-spin-button {
    display: none;
  }

  dialog.controls[open] {
    visibility: visible;
    opacity: 1;
    z-index: var(--struct-controls-z-index, 1);
    pointer-events: auto;
  }
  dialog.controls button {
    width: max-content;
    background-color: var(--struct-controls-btn-bg, rgba(255, 255, 255, 0.2));
  }
  select {
    margin: var(--struct-controls-select-margin, 0 0 0 5pt);
    color: var(--struct-controls-select-color, white);
    background-color: var(--struct-controls-select-bg, rgba(255, 255, 255, 0.1));
  }
  p.warn {
    text-align: center;
  }
  input[type='color'] {
    width: var(--struct-input-color-width, 40px);
    height: var(--struct-input-color-height, 16px);
    margin: var(--struct-input-color-margin, 0 0 0 5pt);
    border: var(--struct-input-color-border, 1px solid rgba(255, 255, 255, 0.05));
    box-sizing: border-box;
  }
  .structure :global(canvas) {
    pointer-events: auto;
  }
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

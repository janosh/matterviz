<script lang="ts">
  import { browser } from '$app/environment'
  import type { Atoms, ElementSymbol, Lattice } from '$lib'
  import { alphabetical_formula, get_elem_amounts, get_pbc_image_sites } from '$lib'
  import { download } from '$lib/api'
  import { element_color_schemes } from '$lib/colors'
  import { element_colors } from '$lib/stores'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps } from 'svelte'
  import { Tooltip } from 'svelte-zoo'
  import StructureLegend from './StructureLegend.svelte'
  import StructureScene from './StructureScene.svelte'

  // output of pymatgen.core.Structure.as_dict()
  export let structure: Atoms | undefined = undefined

  // need to set a default atom_radius so it doesn't initialize to 0
  export let scene_props: ComponentProps<StructureScene> = { atom_radius: 1 } // passed to StructureScene
  export let lattice_props: ComponentProps<Lattice> = {} // passed to Lattice

  // whether to show the controls panel
  export let controls_open: boolean = false
  // canvas background color
  export let background_color: string = `#0000ff` // must be hex code for <input type='color'>
  // only show the buttons when hovering over the canvas on desktop screens
  // mobile screens don't have hover, so by default the buttons are always
  // shown on a canvas of width below 500px
  export let reveal_buttons: boolean | number = 500
  export let fullscreen: boolean = false

  export let wrapper: HTMLDivElement | undefined = undefined
  // the control panel DOM element
  export let controls: HTMLElement | undefined = undefined
  // the button to toggle the control panel
  export let toggle_controls_btn: HTMLButtonElement | undefined = undefined
  // bindable width of the canvas
  export let width: number = 0
  // bindable height of the canvas
  export let height: number = 0
  // export let reset_text: string = `Reset view`
  export let color_scheme: 'Jmol' | 'Vesta' = `Vesta`
  export let hovered: boolean = false
  export let dragover: boolean = false
  export let allow_file_drop: boolean = true
  export let tips_modal: HTMLDialogElement | undefined = undefined
  export let enable_tips: boolean = true
  export let save_json_btn_text: string = `⬇ Save as JSON`
  export let save_png_btn_text: string = `✎ Save as PNG`
  // boolean or map from element symbols to labels
  // use slot='atom-label' to include HTML and event handlers
  export let show_site_labels: boolean | Record<ElementSymbol, string | number> =
    (structure?.sites?.length ?? 0) < 20
  export let atom_labels_style: string | null = null
  export let style: string | null = null
  export let show_image_atoms: boolean = true
  export let show_full_controls: boolean = false

  // interactivity()
  $: $element_colors = element_color_schemes[color_scheme]

  function on_keydown(event: KeyboardEvent) {
    if (event.key === `Escape`) {
      controls_open = false
    }
  }

  const on_window_click =
    (node: (HTMLElement | null)[], cb: () => void) => (event: MouseEvent) => {
      if (!node || !event.target) return // ignore invalid input
      // ignore clicks inside any of the nodes
      if (node && node.some((n) => n?.contains(event.target as Node))) return
      cb() // invoke callback
    }

  $: visible_buttons =
    reveal_buttons == true ||
    (typeof reveal_buttons == `number` && reveal_buttons < width)

  function download_json() {
    if (!structure) alert(`No structure to download`)
    const data = JSON.stringify(structure, null, 2)
    const filename = structure?.id
      ? `${structure?.id} (${alphabetical_formula(structure)}).json`
      : `${alphabetical_formula(structure)}.json`
    download(data, filename, `application/json`)
  }

  function on_file_drop(event: DragEvent) {
    // TODO support dragging CIF/XYZ files
    dragover = false
    if (!allow_file_drop) return
    const file = event.dataTransfer?.items[0].getAsFile()
    const reader = new FileReader()
    reader.onloadend = (event: ProgressEvent<FileReader>) => {
      try {
        structure = JSON.parse(event.target.result)
      } catch (error) {
        console.error(`Invalid JSON file`, error)
      }
    }
    reader.readAsText(file)
  }

  function download_png() {
    const canvas = wrapper?.querySelector(`canvas`)
    canvas?.toBlob((blob) => {
      download(blob, `scene.png`, `image/png`)
    })
  }

  export function toggle_fullscreen() {
    if (!document.fullscreenElement && wrapper) {
      wrapper.requestFullscreen().catch(console.error)
    } else {
      document.exitFullscreen()
    }
  }
  // set --struct-bg to background_color
  $: if (browser) {
    document.documentElement.style.setProperty(`--struct-bg`, `${background_color}20`)

    // react to changes in the 'fullscreen' property
    if (fullscreen && !document.fullscreenElement && wrapper) {
      wrapper.requestFullscreen().catch(console.error)
    } else if (!fullscreen && document.fullscreenElement) {
      document.exitFullscreen()
    }
  }
</script>

<svelte:window
  on:keydown={on_keydown}
  on:click={on_window_click([controls, toggle_controls_btn], () => {
    if (controls_open) controls_open = false
  })}
/>

{#if structure?.sites}
  <div
    class="structure"
    class:dragover
    {style}
    role="region"
    bind:this={wrapper}
    bind:clientWidth={width}
    bind:clientHeight={height}
    on:mouseenter={() => (hovered = true)}
    on:mouseleave={() => (hovered = false)}
    on:drop|preventDefault={on_file_drop}
    on:dragover|preventDefault={() => allow_file_drop && (dragover = true)}
    on:dragleave|preventDefault={() => allow_file_drop && (dragover = false)}
  >
    <section class:visible={visible_buttons}>
      <!-- TODO show only when camera was moved -->
      <!-- <button
        class="reset-camera"
        on:click={() => {
          // TODO implement reset view and controls
        }}>{reset_text}</button
      > -->
      {#if enable_tips}
        <button class="info-icon" on:click={() => tips_modal?.showModal()}>
          <slot name="tips-icon">&#9432;</slot>
        </button>
      {/if}
      <button
        on:click={toggle_fullscreen}
        class="fullscreen-toggle"
        title="Toggle fullscreen"
      >
        <slot name="fullscreen-toggle">⛶</slot>
      </button>

      <button
        on:click={() => (controls_open = !controls_open)}
        bind:this={toggle_controls_btn}
        class="controls-toggle"
      >
        <slot name="controls-toggle" {controls_open}>
          {controls_open ? `Close` : `Controls`}
        </slot>
      </button>
    </section>

    <StructureLegend elements={get_elem_amounts(structure)} bind:tips_modal />

    <dialog class="controls" bind:this={controls} open={controls_open}>
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
          <input type="checkbox" bind:checked={lattice_props.show_vectors} />
          lattice vectors
        </label>
        <label>
          <input type="checkbox" bind:checked={show_image_atoms} />
          image atoms
        </label>
        <!-- add a toggle that's to show or hide the full currently visible set of controls. it should be off by default in which case only the controls the user is most likely to need are shown -->
        <label>
          <input type="checkbox" bind:checked={show_full_controls} />
          full controls
        </label>
        <label>
          <input type="checkbox" bind:checked={show_site_labels} />
          site labels
        </label>
        <label>
          <select bind:value={lattice_props.show_cell}>
            <option value="wireframe">wireframe</option>
            <option value="surface">surface</option>
            <option value={null}>none</option>
          </select>
          unit cell as
        </label>
      </div>

      <hr />

      <label>
        Atom radius
        <small> (Å)</small>
        <input
          type="number"
          min="0.1"
          max={1}
          step={0.05}
          bind:value={scene_props.atom_radius}
        />
        <input
          type="range"
          min="0.1"
          max={1}
          step={0.05}
          bind:value={scene_props.atom_radius}
        />
      </label>
      <label>
        <input type="checkbox" bind:checked={scene_props.same_size_atoms} />
        <span>
          Scale sites according to atomic radii
          <small> (if false, all atoms have same size)</small>
        </span>
      </label>

      {#if show_full_controls && lattice_props.show_cell}
        <hr />
        <label>
          Unit cell opacity
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            bind:value={lattice_props.cell_opacity}
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            bind:value={lattice_props.cell_opacity}
          />
        </label>
      {/if}

      {#if scene_props.show_bonds}
        <hr />
        <label>
          Bonding strategy
          <select bind:value={scene_props.bonding_strategy}>
            <option value="max_dist">Max Distance</option>
            <option value="nearest_neighbor">Nearest Neighbor</option>
          </select>
        </label>

        <label>
          Bond color mode
          <select bind:value={scene_props.bond_color_mode}>
            <option value="single">Single</option>
            <option value="split-midpoint">Split Midpoint</option>
            <option value="gradient" disabled>Gradient (TODO)</option>
          </select>
        </label>

        {#if scene_props.bond_color_mode === `single`}
          <label>
            Bond color
            <input type="color" bind:value={scene_props.bond_color} />
          </label>
        {/if}
        <label>
          Bond radius
          <input
            type="number"
            min={0.001}
            max={0.1}
            step={0.001}
            bind:value={scene_props.bond_radius}
          />
          <input
            type="range"
            min="0.001"
            max="0.1"
            step={0.001}
            bind:value={scene_props.bond_radius}
          />
        </label>
      {/if}

      <label>
        Background color
        <input type="color" bind:value={background_color} />
      </label>

      <hr />

      {#if show_full_controls}
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
            min={0}
            max={2}
            step={0.01}
            bind:value={scene_props.zoom_speed}
          />
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
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
        <!-- directional light intensity -->
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
        <!-- ambient light intensity -->
        <label>
          <Tooltip text="intensity of the ambient light">Ambient light</Tooltip>
          <input
            type="number"
            min={0}
            max={2}
            step={0.01}
            bind:value={scene_props.ambient_light}
          />
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            bind:value={scene_props.ambient_light}
          />
        </label>
        <!-- rotation damping -->
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
      {/if}

      <!-- color scheme -->
      <label>
        Color scheme
        <select bind:value={color_scheme}>
          {#each Object.keys(element_color_schemes) as key}
            <option value={key}>{key}</option>
          {/each}
        </select>
      </label>
      <span style="display: flex; gap: 4pt; margin: 3pt 0 0;">
        <button type="button" on:click={download_json} title={save_json_btn_text}>
          {save_json_btn_text}
        </button>
        <button type="button" on:click={download_png} title={save_png_btn_text}>
          {save_png_btn_text}
        </button>
      </span>
    </dialog>

    <Canvas rendererParameters={{ preserveDrawingBuffer: true }}>
      <StructureScene
        structure={show_image_atoms ? get_pbc_image_sites(structure) : structure}
        {...scene_props}
        {lattice_props}
      >
        <slot slot="atom-label" name="atom-label" let:elem>
          <!-- let:elem needed to fix false positive eslint no-undef -->
          {#if show_site_labels}
            <span class="atom-label" style={atom_labels_style}>
              {show_site_labels === true ? elem : show_site_labels[elem]}
            </span>
          {/if}
        </slot>
      </StructureScene>
    </Canvas>

    <div class="bottom-left">
      <slot name="bottom-left" {structure} />
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
    background: var(--struct-bg, rgba(0, 0, 255, 0.1));
    --struct-controls-transition-duration: 0.3s;
    overflow: var(--struct-overflow, hidden);
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

  section {
    position: absolute;
    display: flex;
    justify-content: end;
    top: var(--struct-buttons-top, 1ex);
    right: var(--struct-buttons-right, 1ex);
    gap: var(--struct-buttons-gap, 1ex);
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
    max-height: var(--struct-controls-max-height, calc(100cqh - 3em));
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
  }
  dialog.controls input[type='number'] {
    box-sizing: border-box;
    text-align: center;
    border-radius: var(--struct-controls-input-num-border-radius, 3pt);
    width: var(--struct-controls-input-num-width, 2em);
    border: var(--struct-controls-input-num-border, none);
    background: var(--struct-controls-input-num-bg, rgba(255, 255, 255, 0.15));
  }
  input::-webkit-inner-spin-button {
    display: none;
  }

  dialog.controls[open] {
    visibility: visible;
    opacity: 1;
    z-index: var(--struct-controls-z-index-open, 100);
  }
  dialog.controls button {
    width: max-content;
    background: var(--struct-controls-btn-bg, rgba(255, 255, 255, 0.4));
  }
  select {
    margin: var(--struct-controls-select-margin, 0 0 0 5pt);
    color: var(--struct-controls-select-color, white);
    background-color: var(--struct-controls-select-bg, rgba(255, 255, 255, 0.1));
  }

  p.warn {
    text-align: center;
  }
  .atom-label {
    background: var(--struct-atom-label-bg, rgba(0, 0, 0, 0.1));
    border-radius: var(--struct-atom-label-border-radius, 3pt);
    padding: var(--struct-atom-label-padding, 0 3px);
  }
  input[type='color'] {
    width: var(--struct-input-color-width, 40px);
    height: var(--struct-input-color-height, 16px);
    margin: var(--struct-input-color-margin, 0 0 0 5pt);
    border: var(--struct-input-color-border, 1px solid rgba(255, 255, 255, 0.05));
    box-sizing: border-box;
  }
</style>

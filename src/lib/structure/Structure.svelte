<script lang="ts">
  import { element_color_schemes } from '$lib/colors'
  import { element_colors } from '$lib/stores'
  import Iconify from '@iconify/svelte'
  import { Canvas } from '@threlte/core'
  import { Tooltip } from 'svelte-zoo'
  import type { ElementSymbol } from '..'
  import Icon from '../Icon.svelte'
  import { download } from '../api'
  import type { PymatgenStructure } from '../structure'
  import {
    alphabetical_formula,
    get_elem_amounts,
    symmetrize_structure,
  } from '../structure'
  import StructureLegend from './StructureLegend.svelte'
  import StructureScene from './StructureScene.svelte'

  // output of pymatgen.core.Structure.as_dict()
  export let structure: PymatgenStructure | undefined = undefined
  // scale factor for atomic radii
  export let atom_radius: number = 0.5
  // whether to use the same radius for all atoms. if not, the radius will be
  // determined by the atomic radius of the element
  export let same_size_atoms: boolean = true
  // initial camera position from which to render the scene
  export let camera_position: [number, number, number] = [10, 10, 10]
  // zoom level of the camera
  export let initial_zoom: number | undefined = undefined
  // auto rotate speed. set to 0 to disable auto rotation.
  export let auto_rotate: number = 0
  // zoom speed. set to 0 to disable zooming.
  export let zoom_speed: number = 0.3
  // pan speed. set to 0 to disable panning.
  export let pan_speed: number = 1
  // whether to show the controls panel
  export let controls_open: boolean = false
  // only show the buttons when hovering over the canvas on desktop screens
  // mobile screens don't have hover, so by default the buttons are always
  // shown on a canvas of width below 500px
  export let reveal_buttons: boolean | number = 500
  // TODO whether to make the canvas fill the whole screen
  // export let fullscreen: boolean = false
  // whether to show the structure's lattice cell as a wireframe
  export let show_atoms: boolean = true
  export let show_bonds: boolean = true
  export let bond_radius: number | undefined = undefined
  export let show_cell: 'surface' | 'wireframe' | null = `wireframe`
  export let cell_opacity: number | undefined = 0.15
  export let cell_line_width: number = 1
  // the control panel DOM element
  export let controls: HTMLElement | undefined = undefined
  // the button to toggle the control panel
  export let toggle_controls_btn: HTMLButtonElement | undefined = undefined
  // whether to show the lattice vectors
  export let show_vectors: boolean = true
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
  export let save_json_btn_text: string = `Save structure to JSON`
  // boolean or map from element symbols to labels
  // use slot='atom-label' to include HTML and event handlers
  export let atom_labels: boolean | Record<ElementSymbol, string | number> = false
  export let atom_labels_style: string | null = null

  // interactivity()
  $: $element_colors = element_color_schemes[color_scheme]

  function on_keydown(event: KeyboardEvent) {
    if (event.key === `Escape`) {
      controls_open = false
    }
  }

  $: ({ a, b, c } = structure?.lattice ?? { a: 0, b: 0, c: 0 })
  $: {
    // set camera position based on structure size
    const scale = initial_zoom ?? 2400 / (width + height)
    camera_position = [scale * a, 0.5 * scale * b, scale * c]
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
    bind:clientWidth={width}
    bind:clientHeight={height}
    on:mouseenter={() => (hovered = true)}
    on:mouseleave={() => (hovered = false)}
    on:drop|preventDefault={on_file_drop}
    on:dragover|preventDefault={() => allow_file_drop && (dragover = true)}
    on:dragleave|preventDefault={() => allow_file_drop && (dragover = false)}
    class:dragover
    role="region"
  >
    <section class:visible={visible_buttons}>
      <!-- TODO show only when camera was moved -->
      <!-- <button
        class="reset-camera"
        on:click={() => {
          // TODO implement reset view and controls
        }}>{reset_text}</button
      > -->
      <button
        on:click={() => (controls_open = !controls_open)}
        bind:this={toggle_controls_btn}
        class="controls-toggle"
      >
        <slot name="controls-toggle" {controls_open}>
          {controls_open ? `Close` : `Controls`}
        </slot>
      </button>
      {#if enable_tips}
        <button class="info-icon" on:click={() => tips_modal?.showModal()}>
          <slot name="tips-icon">
            <Iconify icon="mdi:information" inline />
          </slot>
        </button>
      {/if}
    </section>

    <dialog class="controls" bind:this={controls} open={controls_open}>
      <div style="display: flex; align-items: center; gap: 4pt; flex-wrap: wrap;">
        Show <label>
          <input type="checkbox" bind:checked={show_atoms} />
          atoms
        </label>
        <label>
          <input type="checkbox" bind:checked={show_bonds} />
          bonds
        </label>
        <label>
          <input type="checkbox" bind:checked={show_vectors} />
          lattice vectors
        </label>
      </div>
      <label>
        Show unit cell as
        <select bind:value={show_cell}>
          <option value="surface">surface</option>
          <option value="wireframe">wireframe</option>
          <option value={null}>none</option>
        </select>
      </label>

      <hr />

      <label>
        Atom radius
        <small> (Å)</small>
        <input type="number" min="0.1" max={1} step={0.05} bind:value={atom_radius} />
        <input type="range" min="0.1" max={1} step={0.05} bind:value={atom_radius} />
      </label>
      <label>
        <input type="checkbox" bind:checked={same_size_atoms} />
        <span>
          Scale sites according to atomic radii
          <small> (if false, all atoms have same size)</small>
        </span>
      </label>
      <label>
        Bond radius
        <input
          type="number"
          min={0.001}
          max={0.1}
          step={0.001}
          bind:value={bond_radius}
        />
        <input type="range" min="0.001" max="0.1" step={0.001} bind:value={bond_radius} />
      </label>

      <hr />

      <label>
        <input type="checkbox" bind:checked={atom_labels} />
        Show atom labels
      </label>
      {#if show_cell}
        <label>
          Unit cell opacity
          <input type="number" min={0} max={1} step={0.05} bind:value={cell_opacity} />
          <input type="range" min={0} max={1} step={0.05} bind:value={cell_opacity} />
        </label>
      {/if}

      <hr />

      <label>
        Auto rotate speed
        <input type="number" min={0} max={2} step={0.01} bind:value={auto_rotate} />
        <input type="range" min={0} max={2} step={0.01} bind:value={auto_rotate} />
      </label>
      <label>
        Zoom speed
        <input type="number" min={0} max={2} step={0.01} bind:value={zoom_speed} />
        <input type="range" min={0} max={2} step={0.01} bind:value={zoom_speed} />
      </label>
      <label>
        <Tooltip text="pan by clicking and dragging while holding cmd, ctrl or shift">
          Pan speed
        </Tooltip>
        <input type="number" min={0} max={2} step={0.01} bind:value={pan_speed} />
        <input type="range" min={0} max={2} step={0.01} bind:value={pan_speed} />
      </label>
      <!-- color scheme -->
      <label>
        Color scheme
        <select bind:value={color_scheme}>
          {#each Object.keys(element_color_schemes) as key}
            <option value={key}>{key}</option>
          {/each}
        </select>
      </label>
      <button type="button" on:click={download_json} title={save_json_btn_text}>
        <Icon icon="mdi:download" />
        {save_json_btn_text}
      </button>
    </dialog>

    <Canvas>
      <StructureScene
        structure={symmetrize_structure(structure)}
        {show_atoms}
        {show_bonds}
        {show_cell}
        {show_vectors}
        {...$$restProps}
        {cell_opacity}
        {cell_line_width}
        {bond_radius}
        {camera_position}
        {auto_rotate}
        {pan_speed}
        {zoom_speed}
        bind:atom_radius
        bind:same_size_atoms
      >
        <!-- above let:elem needed to fix false positive eslint no-undef -->
        <slot slot="atom-label" name="atom-label" let:elem>
          {#if atom_labels}
            <span class="atom-label" style={atom_labels_style}>
              {atom_labels === true ? elem : atom_labels[elem]}
            </span>
          {/if}
        </slot>
      </StructureScene>
    </Canvas>

    <StructureLegend elements={get_elem_amounts(structure)} bind:tips_modal />

    <div class="bottom-left">
      <slot name="bottom-left" {structure} />
    </div>
  </div>
{:else if structure}
  <p class="warn">No sites found in structure</p>
{:else}
  <p class="warn">No pymatgen <code>Structure</code> provided</p>
{/if}

<style>
  .structure {
    height: 600px;
    width: 100%;
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: 3pt;
    position: relative;
    container-type: inline-size;
    --controls-transition-duration: 0.3s;
  }
  .structure.dragover {
    background: rgba(0, 0, 0, 0.7);
  }
  div.bottom-left {
    position: absolute;
    bottom: 0;
    left: 0;
    font-size: 1.2em;
    padding: 1pt 5pt;
  }

  section {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    justify-content: end;
    gap: 1ex;
  }

  dialog.controls {
    position: absolute;
    left: unset;
    background: transparent;
    border: none;
    display: grid;
    gap: 1ex;
    visibility: hidden;
    opacity: 0;
    text-align: var(--controls-text-align, left);
    transition: visibility var(--controls-transition-duration),
      opacity var(--controls-transition-duration);
    box-sizing: border-box;
    top: var(--controls-top, 30pt);
    right: var(--controls-right, 6pt);
    background-color: var(--controls-bg, rgba(0, 0, 0, 0.7));
    padding: var(--controls-padding, 6pt 9pt);
    border-radius: var(--controls-border-radius, 3pt);
    width: var(--controls-width, 20em);
    max-width: var(--controls-max-width, 90cqw);
  }
  dialog.controls hr {
    width: 100%;
    height: 0.5px;
    border: none;
    background: gray;
    margin: 0;
  }
  dialog.controls label {
    display: flex;
    align-items: center;
    gap: 4pt;
  }
  dialog.controls input[type='range'] {
    margin-left: auto;
  }
  dialog.controls input[type='number'] {
    background-color: rgba(255, 255, 255, 0.15);
    width: 2em;
    text-align: center;
    border-radius: 3pt;
    border: none;
  }
  input::-webkit-inner-spin-button {
    display: none;
  }

  dialog.controls[open] {
    visibility: visible;
    opacity: 1;
  }
  dialog.controls button {
    width: max-content;
    background-color: rgba(255, 255, 255, 0.4);
  }
  select {
    margin-left: 5pt;
    color: white;
    background-color: rgba(0, 0, 0, 0.4);
  }

  p.warn {
    font-size: larger;
    text-align: center;
  }
  .atom-label {
    background: rgba(0, 0, 0, 0.4);
    border-radius: 2pt;
    padding: 0 3pt;
  }
</style>

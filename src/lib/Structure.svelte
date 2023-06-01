<script lang="ts">
  import { Canvas } from '@threlte/core'

  import { Tooltip } from 'svelte-zoo'
  import Icon from './Icon.svelte'
  import StructureLegend from './StructureLegend.svelte'
  import StructureScene from './StructureScene.svelte'
  import { element_color_schemes } from './colors'
  import { element_colors } from './stores'
  import type { PymatgenStructure } from './structure'
  import { alphabetical_formula, get_elements } from './structure'

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
  export let show_cell: 'surface' | 'wireframe' | null = `wireframe`
  // the control panel DOM element
  export let controls: HTMLElement | undefined = undefined
  // the button to toggle the control panel
  export let toggle_controls_btn: HTMLButtonElement | undefined = undefined
  // cell opacity
  export let cell_opacity: number | undefined = undefined
  // whether to show the lattice vectors
  export let show_vectors: boolean = true
  // bindable width of the canvas
  export let width: number = 0
  // bindable height of the canvas
  export let height: number = 0
  export let reset_text: string = `Reset view`
  export let color_scheme: 'Jmol' | 'Vesta' = `Vesta`
  export let hovered: boolean = false

  // interactivity()
  $: $element_colors = element_color_schemes[color_scheme]

  function on_keydown(event: KeyboardEvent) {
    if (event.key === `Escape`) {
      controls_open = false
    }
  }

  $: ({ a, b, c } = structure?.lattice ?? { a: 0, b: 0, c: 0 })
  $: {
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

  // Function to download data to a file
  function download(data: string, filename: string, type: string) {
    const file = new Blob([data], { type: type })
    const anchor = document.createElement(`a`)
    const url = URL.createObjectURL(file)
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  function download_json() {
    if (!structure) alert(`No structure to download`)
    const data = JSON.stringify(structure, null, 2)
    const filename = structure?.id
      ? `${structure?.id} (${alphabetical_formula(structure)}).json`
      : `${alphabetical_formula(structure)}.json`
    download(data, filename, `application/json`)
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
  >
    <section class:visible={visible_buttons}>
      <!-- TODO show only when camera was moved -->
      <button
        class="reset-camera"
        on:click={() => {
          // TODO implement reset view and controls
        }}>{reset_text}</button
      >
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

    <dialog bind:this={controls} open={controls_open}>
      <label>
        Atom radius
        <input type="range" min="0.1" max="1" step="0.05" bind:value={atom_radius} />
      </label>
      <label>
        <input type="checkbox" bind:checked={same_size_atoms} />
        Scale atoms according to atomic radius (if false, all atoms have same size)
      </label>
      <label>
        Show unit cell as
        <select bind:value={show_cell}>
          <option value="surface">surface</option>
          <option value="wireframe">wireframe</option>
          <option value={null}>none</option>
        </select>
      </label>
      {#if show_cell}
        <label>
          Unit cell opacity
          <input type="range" min="0" max="1" step="0.05" bind:value={cell_opacity} />
        </label>
      {/if}
      <label>
        <input type="checkbox" bind:checked={show_vectors} />
        Show lattice vectors
      </label>
      <label>
        Zoom speed
        <input type="range" min="0" max="2" step="0.01" bind:value={zoom_speed} />
      </label>
      <label>
        <Tooltip text="pan by clicking and dragging while holding cmd, ctrl or shift">
          Pan speed
        </Tooltip>
        <input type="range" min="0" max="2" step="0.01" bind:value={pan_speed} />
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
      <button type="button" on:click={download_json} title="Download Structure as JSON">
        <Icon icon="mdi:download" />
        Download Structure as JSON
      </button>
    </dialog>

    <Canvas>
      <StructureScene
        {...$$restProps}
        {structure}
        {pan_speed}
        {cell_opacity}
        {camera_position}
        {zoom_speed}
        {show_cell}
        {show_vectors}
      />
    </Canvas>

    <StructureLegend elements={get_elements(structure)} />
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

  section {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    justify-content: end;
    gap: 1ex;
  }

  dialog {
    position: absolute;
    left: unset;
    background: transparent;
    border: none;
    display: grid;
    gap: 1ex;
    visibility: hidden;
    opacity: 0;
    transition: visibility var(--controls-transition-duration),
      opacity var(--controls-transition-duration);
    box-sizing: border-box;
    top: var(--controls-top, 30pt);
    right: var(--controls-right, 6pt);
    background-color: var(--controls-bg, rgba(0, 0, 0, 0.7));
    padding: var(--controls-padding, 6pt 9pt);
    border-radius: var(--controls-border-radius, 3pt);
    width: var(--controls-width, 18em);
    max-width: var(--controls-max-width, 90cqw);
  }
  dialog[open] {
    visibility: visible;
    opacity: 1;
  }
  dialog button {
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
</style>

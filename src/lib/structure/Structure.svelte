<script lang="ts">
  import { browser } from '$app/environment'
  import type { Atoms, Lattice } from '$lib'
  import { alphabetical_formula, get_elem_amounts, get_pbc_image_sites } from '$lib'
  import { download } from '$lib/api'
  import { element_color_schemes } from '$lib/colors'
  import { colors } from '$lib/state.svelte'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { Tooltip } from 'svelte-zoo'
  import StructureLegend from './StructureLegend.svelte'
  import StructureScene from './StructureScene.svelte'

  interface Props {
    // output of pymatgen.core.Structure.as_dict()
    structure?: Atoms | undefined
    // need to set a default atom_radius so it doesn't initialize to 0
    scene_props?: ComponentProps<typeof StructureScene> // passed to StructureScene
    lattice_props?: ComponentProps<typeof Lattice> // passed to Lattice
    // whether to show the controls panel
    controls_open?: boolean
    // canvas background color
    background_color?: string // must be hex code for <input type='color'>
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
    // export let reset_text: string = `Reset view`
    color_scheme?: `Jmol` | `Vesta`
    hovered?: boolean
    dragover?: boolean
    allow_file_drop?: boolean
    tips_modal?: HTMLDialogElement | undefined
    enable_tips?: boolean
    save_json_btn_text?: string
    save_png_btn_text?: string
    // boolean or map from element symbols to labels
    // use atom_label snippet to include HTML and event handlers
    show_site_labels?: boolean
    style?: string | null
    show_image_atoms?: boolean
    show_full_controls?: boolean
    tips_icon?: Snippet<[]>
    fullscreen_toggle?: Snippet<[]>
    controls_toggle?: Snippet<[{ controls_open: boolean }]>
    bottom_left?: Snippet<[{ structure: Atoms }]>
  }
  let {
    structure = $bindable(undefined),
    scene_props = $bindable({ atom_radius: 1, show_atoms: true, auto_rotate: 0 }),
    lattice_props = $bindable({}),
    controls_open = $bindable(false),
    background_color = $bindable(`#0000ff`),
    reveal_buttons = 500,
    fullscreen = false,
    wrapper = $bindable(undefined),
    controls = $bindable(undefined),
    toggle_controls_btn = $bindable(undefined),
    width = $bindable(0),
    height = $bindable(0),
    color_scheme = $bindable(`Vesta`),
    hovered = $bindable(false),
    dragover = $bindable(false),
    allow_file_drop = true,
    tips_modal = $bindable(undefined),
    enable_tips = true,
    save_json_btn_text = `⬇ Save as JSON`,
    save_png_btn_text = `✎ Save as PNG`,
    show_site_labels = $bindable(false),
    style = null,
    show_image_atoms = $bindable(true),
    show_full_controls = $bindable(false),
    tips_icon,
    fullscreen_toggle,
    controls_toggle,
    bottom_left,
  }: Props = $props()

  // Ensure scene_props always has some defaults merged in
  $effect.pre(() => {
    scene_props = { atom_radius: 1, show_atoms: true, auto_rotate: 0, ...scene_props }
  })

  $effect.pre(() => {
    colors.element = element_color_schemes[color_scheme]
  })

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

  function download_json() {
    if (!structure) {
      alert(`No structure to download`)
      return
    }
    const data = JSON.stringify(structure, null, 2)
    const filename = structure?.id
      ? `${structure?.id} (${alphabetical_formula(structure)}).json`
      : `${alphabetical_formula(structure)}.json`
    download(data, filename, `application/json`)
  }

  function on_file_drop(event: DragEvent) {
    event.preventDefault()
    // TODO support dragging CIF/XYZ files
    dragover = false
    if (!allow_file_drop) return
    const file = event.dataTransfer?.items[0].getAsFile()
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = (event: ProgressEvent<FileReader>) => {
      try {
        const result = event.target?.result
        if (result && typeof result === `string`) {
          structure = JSON.parse(result)
        }
      } catch (error) {
        console.error(`Invalid JSON file`, error)
      }
    }
    reader.readAsText(file)
  }

  function download_png() {
    const canvas = wrapper?.querySelector(`canvas`)
    canvas?.toBlob((blob) => {
      if (blob) {
        download(blob, `scene.png`, `image/png`)
      }
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
  $effect(() => {
    if (browser) {
      document.documentElement.style.setProperty(`--struct-bg`, `${background_color}20`)

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
    {style}
    role="region"
    bind:this={wrapper}
    bind:clientWidth={width}
    bind:clientHeight={height}
    onmouseenter={() => (hovered = true)}
    onmouseleave={() => (hovered = false)}
    ondrop={on_file_drop}
    ondragover={(event) => {
      event.preventDefault()
      if (allow_file_drop) dragover = true
    }}
    ondragleave={(event) => {
      event.preventDefault()
      if (allow_file_drop) dragover = false
    }}
  >
    <section class:visible={visible_buttons}>
      <!-- TODO show only when camera was moved -->
      <!-- <button
        class="reset-camera"
        onclick={() => {
          // TODO implement reset view and controls
        }}>{reset_text}</button
      > -->
      {#if enable_tips}
        <button class="info-icon" onclick={() => tips_modal?.showModal()}>
          {#if tips_icon}{@render tips_icon()}{:else}&#9432;{/if}
        </button>
      {/if}
      <button
        onclick={toggle_fullscreen}
        class="fullscreen-toggle"
        title="Toggle fullscreen"
      >
        {#if fullscreen_toggle}{@render fullscreen_toggle()}{:else}⛶{/if}
      </button>

      <button
        onclick={() => (controls_open = !controls_open)}
        bind:this={toggle_controls_btn}
        class="controls-toggle"
      >
        {#if controls_toggle}{@render controls_toggle({ controls_open })}{:else}
          {controls_open ? `Close` : `Controls`}
        {/if}
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
          Bond color
          <input type="color" bind:value={scene_props.bond_color} />
        </label>
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
          {#each Object.keys(element_color_schemes) as key (key)}
            <option value={key}>{key}</option>
          {/each}
        </select>
      </label>
      <span style="display: flex; gap: 4pt; margin: 3pt 0 0;">
        <button type="button" onclick={download_json} title={save_json_btn_text}>
          {save_json_btn_text}
        </button>
        <button type="button" onclick={download_png} title={save_png_btn_text}>
          {save_png_btn_text}
        </button>
      </span>
    </dialog>

    <Canvas>
      <StructureScene
        structure={show_image_atoms && structure && `lattice` in structure
          ? get_pbc_image_sites(structure)
          : structure}
        {...scene_props}
        {show_site_labels}
        {lattice_props}
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
    background: var(--struct-bg, rgba(0, 0, 255, 0.1));
    --struct-controls-transition-duration: 0.3s;
    overflow: var(--struct-overflow, hidden);
    color: var(--struct-text-color);
    pointer-events: none;
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
    pointer-events: none;
  }

  section {
    position: absolute;
    display: flex;
    justify-content: end;
    top: var(--struct-buttons-top, 1ex);
    right: var(--struct-buttons-right, 1ex);
    gap: var(--struct-buttons-gap, 1ex);
    z-index: 2;
    pointer-events: none;
  }

  section button {
    pointer-events: auto;
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
</style>

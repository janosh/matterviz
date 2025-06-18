<script lang="ts">
  import { browser } from '$app/environment'
  import type { AnyStructure } from '$lib'
  import { get_elem_amounts, get_pbc_image_sites, Icon } from '$lib'
  import { element_color_schemes } from '$lib/colors'
  import { decompress_file } from '$lib/io/decompress'
  import * as exports from '$lib/io/export'
  import { colors } from '$lib/state.svelte'
  import { Canvas } from '@threlte/core'
  import type { Snippet } from 'svelte'
  import { WebGLRenderer } from 'three'
  import {
    BOND_DEFAULTS,
    CELL_DEFAULTS,
    StructureControls,
    StructureLegend,
    StructureScene,
  } from './index'
  import type { Props as ControlProps } from './StructureControls.svelte'

  interface Props extends ControlProps {
    // output of pymatgen.core.Structure.as_dict()
    // structure?: AnyStructure | undefined
    // only show the buttons when hovering over the canvas on desktop screens
    // mobile screens don't have hover, so by default the buttons are always
    // shown on a canvas of width below 500px
    reveal_buttons?: boolean | number
    fullscreen?: boolean
    // bindable width of the canvas
    width?: number
    // bindable height of the canvas
    height?: number
    reset_text?: string
    hovered?: boolean
    dragover?: boolean
    allow_file_drop?: boolean
    tips_modal?: HTMLDialogElement | undefined
    enable_tips?: boolean
    tips_icon?: Snippet<[]>
    fullscreen_toggle?: Snippet<[]> | boolean
    bottom_left?: Snippet<[{ structure: AnyStructure }]>
    // Generic callback for when files are dropped - receives raw content and filename
    on_file_drop?: (content: string, filename: string) => void
    // Maximum size for text data to prevent UI freezes (bytes)
    max_text_size?: number
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
    fullscreen_toggle = true,
    bottom_left,
    on_file_drop,
    max_text_size = 5 * 1024 * 1024, // 5 MB default
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

  let visible_buttons = $derived(
    reveal_buttons == true ||
      (typeof reveal_buttons == `number` && reveal_buttons < width),
  )

  // only updates when structure or show_image_atoms change
  let scene_structure = $derived(
    show_image_atoms && structure && `lattice` in structure
      ? get_pbc_image_sites(structure)
      : structure,
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

  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return

    // Check for our custom internal file format first
    const internal_data = event.dataTransfer?.getData(`application/x-elementari-file`)
    if (internal_data) {
      try {
        const file_info = JSON.parse(internal_data)
        if (file_info.content && file_info.content.length > max_text_size) {
          console.warn(
            `Internal file data too large: ${file_info.content.length} bytes`,
          )
          return
        }
        try {
          on_file_drop?.(file_info.content, file_info.name)
        } catch (error) {
          console.error(`Failed to process internal file data:`, error)
        }
        return
      } catch (error) {
        console.warn(`Failed to parse internal file data:`, error)
      }
    }

    // Check for plain text data (fallback)
    const text_data = event.dataTransfer?.getData(`text/plain`)
    if (text_data) {
      if (text_data.length > max_text_size) {
        console.warn(
          `Text data too large: ${text_data.length} bytes (max: ${max_text_size})`,
        )
        return
      }
      try {
        on_file_drop?.(text_data, `structure.json`)
      } catch (error) {
        console.error(`Failed to process text data:`, error)
      }
      return
    }

    // Handle actual file drops from file system
    const file = event.dataTransfer?.files[0]
    if (!file) return

    try {
      const { content, filename } = await decompress_file(file)
      if (content) on_file_drop?.(content, filename)
    } catch (error) {
      console.error(`Failed to read file:`, error)
    }
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
          <Icon icon="Reset" />
        </button>
      {/if}
      {#if enable_tips}
        <button class="info-icon" onclick={() => tips_modal?.showModal()}>
          {#if tips_icon}{@render tips_icon()}{:else}<Icon icon="Info" />{/if}
        </button>
      {/if}
      <button
        onclick={toggle_fullscreen}
        class="fullscreen-toggle"
        title="Toggle fullscreen"
      >
        {#if typeof fullscreen_toggle === `function`}
          {@render fullscreen_toggle()}
        {:else if fullscreen_toggle}
          <Icon icon="Fullscreen" style="transform: scale(0.9)" />
        {/if}
      </button>

      <StructureControls
        bind:controls_open
        bind:scene_props
        bind:lattice_props
        bind:show_image_atoms
        bind:show_site_labels
        bind:show_full_controls
        bind:background_color
        bind:background_opacity
        bind:color_scheme
        bind:png_dpi
        {structure}
        {wrapper}
        {save_json_btn_text}
        {save_png_btn_text}
        {save_xyz_btn_text}
      />
    </section>

    <StructureLegend elements={get_elem_amounts(structure)} bind:tips_modal />

    <Canvas
      createRenderer={(canvas) => {
        const renderer = new WebGLRenderer({
          canvas,
          preserveDrawingBuffer: true,
          antialias: true,
          alpha: true,
        }) // Store renderer reference for high-res export
        ;(canvas as exports.CanvasWithRenderer).__customRenderer = renderer
        return renderer
      }}
    >
      <StructureScene
        structure={scene_structure}
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
    width: var(--struct-width, 100%);
    max-width: var(--struct-max-width, 100%);
    min-width: var(--struct-min-width, 300px);
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
    font-size: 1em;
  }
  section :global(.controls-toggle) {
    background-color: transparent;
  }
  section :global(.controls-toggle):hover {
    background-color: transparent !important;
  }
  .structure :global(canvas) {
    pointer-events: auto;
  }
  p.warn {
    text-align: center;
  }
</style>

<script lang="ts">
  import type { AnyStructure } from '$lib'
  import { get_elem_amounts, get_pbc_image_sites, Icon } from '$lib'
  import { element_color_schemes } from '$lib/colors'
  import { decompress_file } from '$lib/io/decompress'
  import { colors } from '$lib/state.svelte'
  import { Canvas } from '@threlte/core'
  import type { Snippet } from 'svelte'
  import type { Camera, Scene } from 'three'
  import { WebGLRenderer } from 'three'
  import {
    STRUCT_DEFAULTS,
    StructureControls,
    StructureInfoPanel,
    StructureLegend,
    StructureScene,
  } from './index'
  import type { Props as ControlProps } from './StructureControls.svelte'

  interface Props extends ControlProps {
    // only show the buttons when hovering over the canvas on desktop screens
    // mobile screens don't have hover, so by default the buttons are always
    // shown on a canvas of width below 500px
    show_buttons?: boolean | number
    fullscreen?: boolean
    // bindable width of the canvas
    width?: number
    // bindable height of the canvas
    height?: number
    reset_text?: string
    hovered?: boolean
    dragover?: boolean
    allow_file_drop?: boolean
    enable_info?: boolean
    info_open?: boolean
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
    scene_props = $bindable({
      atom_radius: 1,
      show_atoms: true,
      auto_rotate: 0,
      same_size_atoms: false,
    }),
    lattice_props = $bindable({
      cell_edge_opacity: STRUCT_DEFAULTS.cell.edge_opacity,
      cell_surface_opacity: STRUCT_DEFAULTS.cell.surface_opacity,
      cell_edge_color: STRUCT_DEFAULTS.cell.color,
      cell_surface_color: STRUCT_DEFAULTS.cell.color,
      cell_line_width: STRUCT_DEFAULTS.cell.line_width,
      show_vectors: true,
    }),
    controls_open = $bindable(false),
    info_open = $bindable(false),
    background_color = $bindable(undefined),
    background_opacity = $bindable(0.1),
    show_buttons = 0,
    fullscreen = false,
    wrapper = $bindable(undefined),
    width = $bindable(0),
    height = $bindable(0),
    reset_text = `Reset camera`,
    color_scheme = $bindable(`Vesta`),
    hovered = $bindable(false),
    dragover = $bindable(false),
    allow_file_drop = true,
    enable_info = true,
    save_json_btn_text = `⬇ JSON`,
    save_png_btn_text = `⬇ PNG`,
    save_xyz_btn_text = `⬇ XYZ`,
    png_dpi = $bindable(150),
    show_site_labels = $bindable(false),
    show_image_atoms = $bindable(true),
    show_full_controls = $bindable(false),
    fullscreen_toggle = true,
    bottom_left,
    on_file_drop,
    max_text_size = 5 * 1024 * 1024, // 5 MB default
    ...rest
  }: Props = $props()

  // Ensure scene_props defaults to show_atoms=true on component mount
  $effect.pre(() => {
    // show_atoms undefined check is important to avoid infinite $effect loop
    if (scene_props.show_atoms === undefined) {
      scene_props = { show_atoms: true, ...scene_props }
    }
  })

  // Track if force vectors have been auto-enabled to prevent repeated triggering
  let force_vectors_auto_enabled = $state(false)

  // Auto-enable force vectors when structure has force data
  $effect(() => {
    if (structure?.sites && !force_vectors_auto_enabled) {
      const has_force_data = structure.sites.some((site) =>
        site.properties?.force && Array.isArray(site.properties.force)
      )

      // Enable force vectors if structure has force data
      if (has_force_data && !scene_props.show_force_vectors) {
        scene_props = {
          ...scene_props,
          show_force_vectors: true,
          force_vector_scale: scene_props.force_vector_scale ||
            STRUCT_DEFAULTS.vector.scale,
          force_vector_color: scene_props.force_vector_color || `#ff6b6b`,
        }
        force_vectors_auto_enabled = true
      }
    }
  })

  $effect.pre(() => {
    colors.element =
      element_color_schemes[color_scheme as keyof typeof element_color_schemes]
  })

  let visible_buttons = $derived(
    show_buttons == true ||
      (typeof show_buttons == `number` && show_buttons < width),
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
  let scene: Scene | undefined = $state(undefined)
  let camera: Camera | undefined = $state(undefined)

  // Track which panel was opened last for mutual exclusion
  let last_opened: `info` | `controls` | null = $state(null)

  // Auto-close behavior: make info/controls panels mutually exclusive
  $effect(() => {
    if (info_open && !controls_open) last_opened = `info`
    if (controls_open && !info_open) last_opened = `controls`

    if (info_open && controls_open) {
      if (last_opened === `info`) controls_open = false
      else info_open = false
    }
  })

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
    const internal_data = event.dataTransfer?.getData(`application/x-matterviz-file`)
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

  // Handle keyboard shortcuts
  function onkeydown(event: KeyboardEvent) {
    // Don't handle shortcuts if user is typing in an input field
    const target = event.target as HTMLElement
    const is_input_focused = target.tagName === `INPUT` ||
      target.tagName === `TEXTAREA`

    if (is_input_focused) return

    // Interface shortcuts
    if (event.key === `f` && (event.ctrlKey || event.metaKey)) toggle_fullscreen()
    else if (event.key === `i` && (event.ctrlKey || event.metaKey)) {
      info_open = !info_open
    } else if (event.key === `Escape`) {
      if (document.fullscreenElement) document.exitFullscreen()
      else {
        info_open = false
        controls_open = false
      }
    }
  }

  // Only set background override when background_color is explicitly provided
  $effect(() => {
    if (typeof window !== `undefined` && wrapper && background_color) {
      // Convert opacity (0-1) to hex alpha value (00-FF)
      const alpha_hex = Math.round(background_opacity * 255)
        .toString(16)
        .padStart(2, `0`)
      wrapper.style.setProperty(
        `--struct-bg-override`,
        `${background_color}${alpha_hex}`,
      )
    } else if (typeof window !== `undefined` && wrapper) {
      // Remove override to use theme system
      wrapper.style.removeProperty(`--struct-bg-override`)
    }
  })

  $effect(() => { // react to 'fullscreen' state changes
    if (typeof window !== `undefined`) {
      if (fullscreen && !document.fullscreenElement && wrapper) {
        wrapper.requestFullscreen().catch(console.error)
      } else if (!fullscreen && document.fullscreenElement) {
        document.exitFullscreen()
      }
    }
  })

  // Listen for fullscreen changes to keep state in sync
  $effect(() => {
    if (typeof window === `undefined`) return
    const on_fullscreen_change = () => {
      fullscreen = !!document.fullscreenElement
    }

    document.addEventListener(`fullscreenchange`, on_fullscreen_change)

    return () => {
      document.removeEventListener(`fullscreenchange`, on_fullscreen_change)
    }
  })
</script>

{#if (structure?.sites?.length ?? 0) > 0}
  <div
    class="structure"
    class:dragover
    class:active={info_open || controls_open}
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
    {onkeydown}
    {...rest}
  >
    <section class:visible={visible_buttons} class="control-buttons">
      {#if camera_has_moved}
        <button class="reset-camera" onclick={reset_camera} title={reset_text}>
          <!-- Target/Focus icon for reset camera -->
          <Icon icon="Reset" />
        </button>
      {/if}
      {#if fullscreen_toggle}
        <button
          onclick={toggle_fullscreen}
          class="fullscreen-toggle"
          title="{fullscreen ? `Exit` : `Enter`} fullscreen"
        >
          {#if typeof fullscreen_toggle === `function`}
            {@render fullscreen_toggle()}
          {:else}
            <Icon
              icon="{fullscreen ? `Exit` : ``}Fullscreen"
              style="transform: scale(0.9)"
            />
          {/if}
        </button>
      {/if}

      {#if enable_info && structure}
        <StructureInfoPanel {structure} bind:info_open />
      {/if}

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
        {scene}
        {camera}
      />
    </section>

    <StructureLegend elements={get_elem_amounts(structure!)} />

    {#if !import.meta.env.VITEST}
      <!-- prevent from rendering in vitest runner since Canvas API not available -->
      <Canvas
        createRenderer={(canvas) => {
          const renderer = new WebGLRenderer({
            canvas,
            preserveDrawingBuffer: true,
            antialias: true,
            alpha: true,
          })
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
    {/if}

    <div class="bottom-left">
      {@render bottom_left?.({ structure: structure! })}
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
    background: var(--struct-bg-override, var(--struct-bg));
    color: var(--struct-text-color);
  }
  .structure.active {
    z-index: var(--struct-active-z-index, 2);
  }
  .structure:fullscreen {
    background: var(--page-bg);
  }
  .structure:fullscreen :global(canvas) {
    height: 100vh !important;
    width: 100vw !important;
  }
  .structure.dragover {
    background: var(--struct-dragover-bg);
  }
  div.bottom-left {
    position: absolute;
    bottom: 0;
    left: 0;
    font-size: var(--struct-bottom-left-font-size, 1.2em);
    padding: var(--struct-bottom-left-padding, 1pt 5pt);
  }
  section.control-buttons {
    position: absolute;
    display: flex;
    justify-content: end;
    top: var(--struct-buttons-top, 1ex);
    right: var(--struct-buttons-right, 1ex);
    gap: var(--struct-buttons-gap, 3pt);
    /* buttons need higher z-index than StructureLegend to make info/controls panels occlude legend */
    z-index: var(--struct-buttons-z-index, 2);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  section.control-buttons.visible {
    opacity: 1;
    pointer-events: auto;
  }
  section.control-buttons button {
    background-color: transparent;
  }
  section.control-buttons :global(button:hover) {
    background-color: var(--panel-btn-hover-bg);
  }
  p.warn {
    text-align: center;
  }
</style>

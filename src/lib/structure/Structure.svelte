<script lang="ts">
  import type { AnyStructure } from '$lib'
  import { get_elem_amounts, get_pbc_image_sites, Icon, Spinner } from '$lib'
  import { type ColorSchemeName, element_color_schemes } from '$lib/colors'
  import {
    decompress_file,
    handle_url_drop,
    load_from_url,
    parse_any_structure,
  } from '$lib/io'
  import { DEFAULTS } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { tooltip } from 'svelte-multiselect'
  import type { Camera, Scene } from 'three'
  import { WebGLRenderer } from 'three'
  import type { StructureHandlerData } from './index'
  import {
    StructureControls,
    StructureInfoPanel,
    StructureLegend,
    StructureScene,
  } from './index'
  import type { Props as ControlProps } from './StructureControls.svelte'

  // Type alias for event handlers to reduce verbosity
  type EventHandler = (data: StructureHandlerData) => void
  type EventHandlers = {
    on_file_load?: EventHandler
    on_error?: EventHandler
    on_fullscreen_change?: EventHandler
    on_camera_move?: EventHandler
    on_camera_reset?: EventHandler
  }

  interface Props extends ControlProps, EventHandlers {
    // only show the buttons when hovering over the canvas on desktop screens
    // mobile screens don't have hover, so by default the buttons are always
    // shown on a canvas of width below 500px
    show_controls?: boolean | number
    fullscreen?: boolean
    // bindable width of the canvas
    width?: number
    // bindable height of the canvas
    height?: number
    reset_text?: string
    hovered?: boolean
    dragover?: boolean
    allow_file_drop?: boolean
    enable_info_panel?: boolean
    info_panel_open?: boolean
    fullscreen_toggle?: Snippet<[]> | boolean
    bottom_left?: Snippet<[{ structure: AnyStructure }]>
    data_url?: string // URL to load structure from (alternative to providing structure directly)
    // Generic callback for when files are dropped - receives raw content and filename
    on_file_drop?: (content: string | ArrayBuffer, filename: string) => void
    // spinner props (passed to Spinner component)
    spinner_props?: ComponentProps<typeof Spinner>
    loading?: boolean
    error_msg?: string
    // Performance mode: 'quality' (default) or 'speed' for large structures
    performance_mode?: `quality` | `speed`
    children?: Snippet<[{ structure?: AnyStructure }]>
    [key: string]: unknown
  }
  let {
    structure = $bindable(undefined),
    // TODO figure out a way to avoid having to explicitly set default scene_props keys for them to take effect
    scene_props = $bindable({
      // Atoms & Display
      show_atoms: DEFAULTS.structure.show_atoms,
      show_bonds: DEFAULTS.structure.show_bonds,
      same_size_atoms: DEFAULTS.structure.same_size_atoms,
      atom_radius: DEFAULTS.structure.atom_radius,
      sphere_segments: DEFAULTS.structure.sphere_segments,
      // Camera & Controls
      auto_rotate: DEFAULTS.structure.auto_rotate,
      zoom_speed: DEFAULTS.structure.zoom_speed,
      pan_speed: DEFAULTS.structure.pan_speed,
      rotation_damping: DEFAULTS.structure.rotation_damping,
      camera_projection: DEFAULTS.structure.projection,
      // Bonds
      bond_thickness: DEFAULTS.structure.bond_thickness,
      bond_color: DEFAULTS.structure.bond_color,
      // Labels
      show_site_labels: DEFAULTS.structure.show_site_labels,
      site_label_size: DEFAULTS.structure.site_label_size,
      site_label_padding: DEFAULTS.structure.site_label_padding,
      site_label_offset: [...DEFAULTS.structure.site_label_offset],
      site_label_color: DEFAULTS.structure.site_label_color,
      site_label_bg_color: DEFAULTS.structure.site_label_bg_color,
      // Forces
      show_force_vectors: DEFAULTS.structure.show_force_vectors,
      force_vector_scale: DEFAULTS.structure.force_scale,
      force_vector_color: DEFAULTS.structure.force_color,
      // Lighting
      directional_light: DEFAULTS.structure.directional_light,
      ambient_light: DEFAULTS.structure.ambient_light,
    }),
    lattice_props = $bindable({
      cell_edge_opacity: DEFAULTS.structure.lattice_edge_opacity,
      cell_surface_opacity: DEFAULTS.structure.lattice_surface_opacity,
      cell_edge_color: DEFAULTS.structure.lattice_edge_color,
      cell_surface_color: DEFAULTS.structure.lattice_surface_color,
      cell_line_width: DEFAULTS.structure.lattice_line_width,
      show_vectors: true,
    }),
    controls_open = $bindable(false),
    info_panel_open = $bindable(false),
    background_color = $bindable(undefined),
    background_opacity = $bindable(0.1),
    show_controls = 0,
    fullscreen = false,
    wrapper = $bindable(undefined),
    width = $bindable(0),
    height = $bindable(0),
    reset_text = `Reset camera`,
    color_scheme = $bindable(`Vesta`),
    hovered = $bindable(false),
    dragover = $bindable(false),
    allow_file_drop = true,
    enable_info_panel = true,
    save_json_btn_text = `⬇ JSON`,
    save_xyz_btn_text = `⬇ XYZ`,
    png_dpi = $bindable(150),
    show_site_labels = $bindable(false),
    show_image_atoms = $bindable(true),
    fullscreen_toggle = true,
    bottom_left,
    data_url,
    on_file_drop,
    spinner_props = {},
    loading = $bindable(false),
    error_msg = $bindable(undefined),
    performance_mode = $bindable(`quality`),
    on_file_load,
    on_error,
    on_fullscreen_change,
    on_camera_move,
    on_camera_reset,
    children,
    ...rest
  }: Props = $props()

  // Load structure from URL when data_url is provided
  $effect(() => {
    if (data_url && !structure) {
      loading = true
      error_msg = undefined

      load_from_url(data_url, (content, filename) => {
        if (on_file_drop) on_file_drop(content, filename)
        else {
          // Parse structure internally when no handler provided
          try {
            const text_content = content instanceof ArrayBuffer
              ? new TextDecoder().decode(content)
              : content
            const parsed_structure = parse_any_structure(text_content, filename)
            if (parsed_structure) {
              structure = parsed_structure
              // Emit file load event
              on_file_load?.({
                structure,
                filename,
                file_size: new Blob([content]).size,
                total_atoms: structure.sites?.length || 0,
              })
            } else {
              error_msg = `Failed to parse structure from ${filename}`
              on_error?.({ error_msg, filename })
            }
          } catch (error) {
            error_msg = `Failed to parse structure: ${
              error instanceof Error ? error.message : String(error)
            }`
            on_error?.({ error_msg, filename })
          }
        }
      })
        .then(() => loading = false)
        .catch((error: Error) => {
          console.error(`Failed to load structure from URL:`, error)
          error_msg = `Failed to load structure: ${error.message}`
          loading = false
          on_error?.({ error_msg, filename: data_url })
        })
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
            DEFAULTS.structure.force_scale,
          force_vector_color: scene_props.force_vector_color || `#ff6b6b`,
        }
        force_vectors_auto_enabled = true
      }
    }
  })

  // Optimize scene props for performance based on structure size and mode
  $effect(() => {
    if (structure?.sites && performance_mode === `speed`) {
      const site_count = structure.sites.length
      const current_sphere_segments = scene_props.sphere_segments || 20

      // Reduce sphere segments for large structures in speed mode
      if (site_count > 200 && current_sphere_segments > 12) {
        scene_props = {
          ...scene_props,
          sphere_segments: Math.min(current_sphere_segments, 12),
        }
      }
    }
  })

  $effect(() => {
    colors.element = element_color_schemes[color_scheme as ColorSchemeName]
  })

  let visible_buttons = $derived(
    show_controls === true ||
      (typeof show_controls === `number` && width > show_controls),
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
  let camera_move_timeout: ReturnType<typeof setTimeout> | null = $state(null)

  // Custom toggle handlers for mutual exclusion
  function toggle_info() {
    if (info_panel_open) info_panel_open = false
    else [info_panel_open, controls_open] = [true, false]
  }

  function toggle_controls() {
    if (controls_open) controls_open = false
    else [controls_open, info_panel_open] = [true, false]
  }

  // Reset tracking when structure changes
  $effect(() => {
    if (structure) camera_has_moved = false
  })
  // Set camera_has_moved to true when camera starts moving
  $effect(() =>
    untrack(() => {
      if (camera_is_moving) {
        camera_has_moved = true
        const { camera_position } = scene_props
        // Debounce camera move events to avoid excessive emissions
        if (camera_move_timeout) clearTimeout(camera_move_timeout)
        camera_move_timeout = setTimeout(() => {
          on_camera_move?.({ structure, camera_has_moved, camera_position })
        }, 200)
      }
    })
  )

  function reset_camera() {
    // Reset camera position to trigger automatic positioning
    scene_props.camera_position = [0, 0, 0]
    camera_has_moved = false
    on_camera_reset?.({ structure, camera_has_moved, camera_position: [0, 0, 0] })
  }

  const emit_file_load_event = (
    structure: AnyStructure,
    filename: string,
    content: string | ArrayBuffer,
  ) =>
    on_file_load?.({
      structure: structure,
      filename,
      file_size: typeof content === `string`
        ? new Blob([content]).size
        : content.byteLength,
      total_atoms: structure.sites?.length || 0,
    })

  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return

    // Handle URL-based files (e.g. from FilePicker)
    const handled = await handle_url_drop(
      event,
      on_file_drop || ((content, filename) => {
        const text_content = content instanceof ArrayBuffer
          ? new TextDecoder().decode(content)
          : content
        const parsed_structure = parse_any_structure(text_content, filename)
        if (parsed_structure) {
          structure = parsed_structure
          emit_file_load_event(parsed_structure, filename, content)
        } else {
          error_msg = `Failed to parse structure from ${filename}`
          on_error?.({ error_msg, filename })
        }
      }),
    ).catch(() => false)

    if (handled) return

    // Handle file system drops
    const file = event.dataTransfer?.files[0]
    if (file) {
      try {
        const { content, filename } = await decompress_file(file)
        if (content) {
          if (on_file_drop) on_file_drop(content, filename)
          else {
            // Parse structure internally when no handler provided
            const parsed_structure = parse_any_structure(content, filename)
            if (parsed_structure) {
              structure = parsed_structure
              emit_file_load_event(parsed_structure, filename, content)
            } else {
              error_msg = `Failed to parse structure from ${filename}`
              on_error?.({ error_msg, filename })
            }
          }
        }
      } catch (error) {
        error_msg = `Failed to load file ${file.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
        on_error?.({ error_msg, filename: file.name })
      }
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
      info_panel_open = !info_panel_open
    } else if (event.key === `Escape`) {
      if (document.fullscreenElement) document.exitFullscreen()
      else {
        info_panel_open = false
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
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
    on_fullscreen_change?.({
      structure,
      is_fullscreen: fullscreen,
    })
  }}
/>

<div
  class="structure"
  class:dragover
  class:active={info_panel_open || controls_open}
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
  {@render children?.({ structure })}
  {#if loading}
    <Spinner text="Loading structure..." {...spinner_props} />
  {:else if error_msg}
    <div class="error-state">
      <p class="error">{error_msg}</p>
      <button onclick={() => (error_msg = undefined)}>Dismiss</button>
    </div>
  {:else if (structure?.sites?.length ?? 0) > 0}
    <section class:visible={visible_buttons} class="control-buttons">
      {#if visible_buttons}
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
            {@attach tooltip({ content: `${fullscreen ? `Exit` : `Enter`} fullscreen` })}
          >
            {#if typeof fullscreen_toggle === `function`}
              {@render fullscreen_toggle()}
            {:else}
              <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
            {/if}
          </button>
        {/if}

        {#if enable_info_panel && structure}
          <StructureInfoPanel
            {structure}
            bind:panel_open={info_panel_open}
            custom_toggle={toggle_info}
            {@attach tooltip({ content: `Structure info panel` })}
          />
        {/if}

        <StructureControls
          bind:controls_open
          bind:scene_props
          bind:lattice_props
          bind:show_image_atoms
          bind:background_color
          bind:background_opacity
          bind:color_scheme
          bind:png_dpi
          {structure}
          {wrapper}
          {save_json_btn_text}
          {save_xyz_btn_text}
          {scene}
          {camera}
          custom_toggle={toggle_controls}
        />
      {/if}
    </section>

    <StructureLegend elements={get_elem_amounts(structure!)} />

    <!-- prevent from rendering in vitest runner since WebGLRenderingContext not available -->
    {#if typeof WebGLRenderingContext !== `undefined`}
      <Canvas
        createRenderer={(canvas: HTMLCanvasElement) => {
          return new WebGLRenderer({
            canvas,
            preserveDrawingBuffer: true,
            antialias: true,
            alpha: true,
          })
        }}
      >
        <StructureScene
          structure={scene_structure}
          {...scene_props}
          {lattice_props}
          bind:camera_is_moving
        />
      </Canvas>
    {/if}

    <div class="bottom-left">
      {@render bottom_left?.({ structure: structure! })}
    </div>
  {:else if structure}
    <p class="warn">No sites found in structure</p>
  {:else}
    <p class="warn">No structure provided</p>
  {/if}
</div>

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
    container-type: inline-size;
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
    background: var(--struct-dragover-bg, var(--dragover-bg));
    border: var(--struct-dragover-border, var(--dragover-border));
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
    top: var(--struct-buttons-top, var(--ctrl-btn-top, 1ex));
    right: var(--struct-buttons-right, var(--ctrl-btn-right, 1ex));
    gap: clamp(2pt, 0.5cqw, 6pt);
    /* buttons need higher z-index than StructureLegend to make info/controls panels occlude legend */
    /* we also need crazy high z-index to make info/control panel occlude threlte/extras' <HTML> elements for site labels */
    z-index: var(--struct-buttons-z-index, 100000000);
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
    font-size: clamp(1em, 2cqw, 1.6em);
  }
  section.control-buttons :global(button:hover) {
    background-color: var(--panel-btn-hover-bg);
  }
  p.warn {
    text-align: center;
  }
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: var(--struct-height, 500px);
    padding: 2rem;
    text-align: center;
    box-sizing: border-box;
  }
  .error-state p {
    color: var(--error-color, #ff6b6b);
    margin: 0 0 1rem;
  }
  .error-state button {
    padding: 0.5rem 1rem;
    background: var(--error-color, #ff6b6b);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .error-state button:hover {
    background: var(--error-color-hover, #ff5252);
  }
</style>

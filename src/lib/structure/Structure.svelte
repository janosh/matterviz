<script lang="ts">
  import type { AnyStructure, Vec3 } from '$lib'
  import { get_elem_amounts, get_pbc_image_sites, Icon, Spinner } from '$lib'
  import { type ColorSchemeName, element_color_schemes } from '$lib/colors'
  import { decompress_file, handle_url_drop, load_from_url } from '$lib/io'
  import { DEFAULTS } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import type { PymatgenStructure } from '$lib/structure/index'
  import { is_valid_supercell_input, make_supercell } from '$lib/structure/supercell'
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
  import { parse_any_structure } from './parse'
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
    bottom_left?: Snippet<[{ structure?: AnyStructure }]>
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
  // Local reactive state for scene and lattice props. Deeply reactive so nested mutations propagate.
  // Scene model seeded from central defaults with a few normalized fields
  let scene_model = $state({
    ...DEFAULTS.structure,
    camera_projection: DEFAULTS.structure.camera_projection,
    force_vector_scale: DEFAULTS.structure.force_scale,
    force_vector_color: DEFAULTS.structure.force_color,
    camera_position: [0, 0, 0] as Vec3,
    site_label_offset: [...DEFAULTS.structure.site_label_offset] as Vec3,
  })
  let lattice_model = $state({
    cell_edge_opacity: DEFAULTS.structure.cell_edge_opacity,
    cell_surface_opacity: DEFAULTS.structure.cell_surface_opacity,
    cell_edge_color: DEFAULTS.structure.cell_edge_color,
    cell_surface_color: DEFAULTS.structure.cell_surface_color,
    cell_edge_width: DEFAULTS.structure.cell_edge_width,
    show_cell_vectors: DEFAULTS.structure.show_cell_vectors,
  })

  let {
    structure = $bindable(undefined),
    scene_props: scene_props_in = $bindable(undefined),
    lattice_props: lattice_props_in = $bindable(undefined),
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
    supercell_scaling = $bindable(`1x1x1`),
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

  // Initialize models from incoming props; mutations come from UI controls; we mirror into local dicts (NOTE only doing shallow merge)
  $effect.pre(() => {
    if (scene_props_in && typeof scene_props_in === `object`) {
      Object.assign(scene_model, scene_props_in)
    }
    if (lattice_props_in && typeof lattice_props_in === `object`) {
      Object.assign(lattice_model, lattice_props_in)
    }
  })

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
      if (has_force_data && !scene_model.show_force_vectors) {
        scene_model.show_force_vectors = true
        scene_model.force_vector_scale = scene_model.force_vector_scale ||
          DEFAULTS.structure.force_scale
        scene_model.force_vector_color = scene_model.force_vector_color
        force_vectors_auto_enabled = true
      }
    }
  })

  // Optimize scene props for performance based on structure size and mode
  $effect(() => {
    if (structure?.sites && performance_mode === `speed`) {
      const site_count = structure.sites.length
      const current_sphere_segments = scene_model.sphere_segments || 20

      // Reduce sphere segments for large structures in speed mode
      if (site_count > 200 && current_sphere_segments > 12) {
        scene_model.sphere_segments = Math.min(current_sphere_segments, 12)
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

  // Create supercell if needed
  let supercell_structure = $state(structure)
  $effect(() => {
    if (!structure || !(`lattice` in structure)) {
      supercell_structure = structure
    } else if ([``, `1x1x1`, `1`].includes(supercell_scaling)) {
      supercell_structure = structure
    } else if (!is_valid_supercell_input(supercell_scaling)) {
      supercell_structure = structure
    } else supercell_structure = make_supercell(structure, supercell_scaling)
  })

  // Apply image atoms to the supercell structure
  let scene_structure = $derived(
    show_image_atoms && supercell_structure && `lattice` in supercell_structure &&
      supercell_structure.lattice
      ? get_pbc_image_sites(supercell_structure as PymatgenStructure)
      : supercell_structure,
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
        const { camera_position } = scene_model
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
    scene_model.camera_position = [0, 0, 0]
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
    loading = true
    error_msg = undefined // Clear previous error when a new file is dropped

    try {
      // Handle URL-based files (e.g. from FilePicker)
      const handled = await handle_url_drop(
        event,
        on_file_drop || ((content, filename) => {
          try {
            const text_content = content instanceof ArrayBuffer
              ? new TextDecoder().decode(content)
              : content
            const parsed_structure = parse_any_structure(text_content, filename)
            if (parsed_structure) {
              structure = parsed_structure
              emit_file_load_event(parsed_structure, filename, content)
            } else throw new Error(`Failed to parse structure from ${filename}`)
          } catch (err) {
            error_msg = `Failed to parse structure: ${err}`
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
              try {
                const parsed_structure = parse_any_structure(content, filename)
                if (parsed_structure) {
                  structure = parsed_structure
                  emit_file_load_event(parsed_structure, filename, content)
                } else throw new Error(`Failed to parse structure from ${filename}`)
              } catch (err) {
                error_msg = `Failed to parse structure: ${err}`
                on_error?.({ error_msg, filename })
              }
            }
          }
        } catch (error) {
          error_msg = `Failed to load file ${file.name}: ${error}`
          on_error?.({ error_msg, filename: file.name })
        }
      }
    } finally {
      loading = false
    }
  }

  export function toggle_fullscreen() {
    if (!document.fullscreenElement && wrapper) {
      wrapper.requestFullscreen().catch(console.error)
    } else document.exitFullscreen()
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
      // Prioritize closing panels over exiting fullscreen
      if (info_panel_open) info_panel_open = false
      else if (controls_open) controls_open = false
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
      } else if (!fullscreen && document.fullscreenElement) document.exitFullscreen()
    }
  })
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
    on_fullscreen_change?.({ structure, is_fullscreen: fullscreen })
  }}
/>

<div
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
  class="structure {rest.class ?? ``}"
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
            style="padding: 0"
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
          bind:scene_props={scene_model}
          bind:lattice_props={lattice_model}
          bind:show_image_atoms
          bind:supercell_scaling
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

    <StructureLegend elements={get_elem_amounts(supercell_structure ?? structure!)} />

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
          {...scene_model}
          lattice_props={lattice_model}
          bind:camera_is_moving
          {width}
          {height}
        />
      </Canvas>
    {/if}

    <div class="bottom-left">
      {@render bottom_left?.({ structure: scene_structure })}
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
    place-items: center;
    top: var(--struct-buttons-top, var(--ctrl-btn-top, 1ex));
    right: var(--struct-buttons-right, var(--ctrl-btn-right, 1ex));
    gap: clamp(6pt, 1cqw, 9pt);
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
  section.control-buttons > :global(button) {
    background-color: transparent;
    font-size: clamp(1.1em, 2cqw, 1.4em);
    display: flex;
    padding: 0;
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

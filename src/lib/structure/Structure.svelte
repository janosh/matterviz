<script lang="ts">
  import type { AnyStructure, Lattice, Site } from '$lib'
  import { Icon, Spinner, toggle_fullscreen } from '$lib'
  import { type ColorSchemeName, element_color_schemes } from '$lib/colors'
  import { decompress_file, handle_url_drop, load_from_url } from '$lib/io'
  import { DEFAULTS } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import { get_elem_amounts, get_pbc_image_sites } from '$lib/structure'
  import { is_valid_supercell_input, make_supercell } from '$lib/structure/supercell'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { click_outside, tooltip } from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { StructureHandlerData } from './index'
  import {
    StructureControls,
    StructureInfoPane,
    StructureLegend,
    StructureScene,
  } from './index'
  import { MAX_SELECTED_SITES } from './measure'
  import { parse_any_structure } from './parse'

  // Type alias for event handlers to reduce verbosity
  type EventHandler = (data: StructureHandlerData) => void

  interface Props
    extends
      Omit<ControlProps, `children` | `onclose`>,
      Omit<HTMLAttributes<HTMLDivElement>, `children`> {
    scene_props?: ComponentProps<typeof StructureScene>
    lattice_props?: ComponentProps<typeof Lattice>
    controls_open?: boolean
    background_color?: string
    background_opacity?: number
    wrapper?: HTMLDivElement
    color_scheme?: ColorSchemeName
    png_dpi?: number
    show_image_atoms?: boolean
    supercell_scaling?: string
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
    enable_info_pane?: boolean
    info_pane_open?: boolean
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
    // allow parent components to control highlighted/selected site indices
    selected_sites?: number[]
    // explicit measured sites for distance/angle overlays
    measured_sites?: number[]
    // expose the displayed structure (with image atoms and/or supercell) for external use
    displayed_structure?: AnyStructure | undefined
    // structure content as string (alternative to providing structure directly or via data_url)
    structure_string?: string
    children?: Snippet<[{ structure?: AnyStructure }]>
    on_file_load?: EventHandler
    on_error?: EventHandler
    on_fullscreen_change?: EventHandler
    on_camera_move?: EventHandler
    on_camera_reset?: EventHandler
  }
  // Local reactive state for scene and lattice props. Deeply reactive so nested mutations propagate.
  // Scene model seeded from central defaults with a few normalized fields
  let scene_props = $state(DEFAULTS.structure)
  let lattice_props = $state({
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
    info_pane_open = $bindable(false),
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
    enable_info_pane = true,
    png_dpi = $bindable(150),
    show_image_atoms = $bindable(true),
    supercell_scaling = $bindable(`1x1x1`),
    fullscreen_toggle = DEFAULTS.structure.fullscreen_toggle,
    bottom_left,
    data_url,
    structure_string,
    on_file_drop,
    spinner_props = {},
    loading = $bindable(false),
    error_msg = $bindable(undefined),
    performance_mode = $bindable(`quality`),
    // expose selected site indices for external control/highlighting
    selected_sites = $bindable<number[]>([]),
    // expose measured site indices for overlays/labels
    measured_sites = $bindable<number[]>([]),
    // expose the displayed structure (with image atoms and supercell) for external use
    displayed_structure = $bindable<AnyStructure | undefined>(undefined),
    children,
    on_file_load,
    on_error,
    on_fullscreen_change,
    on_camera_move,
    on_camera_reset,
    ...rest
  }: Props = $props()

  // Initialize models from incoming props; mutations come from UI controls; we mirror into local dicts (NOTE only doing shallow merge)
  $effect.pre(() => {
    if (scene_props_in && typeof scene_props_in === `object`) {
      Object.assign(scene_props, scene_props_in)
    }
    if (lattice_props_in && typeof lattice_props_in === `object`) {
      Object.assign(lattice_props, lattice_props_in)
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

  $effect(() => { // Parse structure from string when structure_string is provided
    if (!structure_string || data_url) return
    loading = true
    error_msg = undefined
    try {
      const parsed = parse_any_structure(structure_string, `string`)
      if (parsed) {
        structure = parsed
        untrack(() => emit_file_load_event(parsed, `string`, structure_string))
      } else {
        throw new Error(`Failed to parse structure from string`)
      }
    } catch (err) {
      error_msg = `Failed to parse structure from string: ${
        err instanceof Error ? err.message : String(err)
      }`
      untrack(() => on_error?.({ error_msg, filename: `string` }))
    } finally {
      loading = false
    }
  })

  // Track if force vectors were auto-enabled to prevent repeated triggering
  let force_vectors_auto_enabled = $state(false)

  // Auto-enable force vectors when structure has force data
  $effect(() => {
    if (structure?.sites && !force_vectors_auto_enabled) {
      const has_force_data = structure.sites.some((site: Site) =>
        site.properties?.force && Array.isArray(site.properties.force)
      )

      // Enable force vectors if structure has force data
      if (has_force_data && !scene_props.show_force_vectors) {
        scene_props.show_force_vectors = true
        scene_props.force_scale ??= DEFAULTS.structure.force_scale
        scene_props.force_color ??= DEFAULTS.structure.force_color
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
      if (site_count > 200) {
        scene_props.sphere_segments = Math.min(current_sphere_segments, 12)
      }
    }
  })

  $effect(() => {
    colors.element = element_color_schemes[color_scheme as ColorSchemeName]
  })

  // Measurement mode and selection state
  let measure_mode: `distance` | `angle` | `edit` = $state(`distance`)
  let measure_menu_open = $state(false)

  // Undo/redo system
  let structure_history = $state<typeof structure[]>([])
  let history_index = $state(-1)
  let is_during_continuous_operation = $state(false)

  const MAX_HISTORY = 20

  // Save current structure to history before making changes
  function save_to_history() {
    if (!structure) return

    // Remove any future history if we're not at the end
    if (history_index < structure_history.length - 1) {
      structure_history = structure_history.slice(0, history_index + 1)
    }

    // Add current structure to history
    structure_history.push(JSON.parse(JSON.stringify(structure)))
    history_index++

    // Limit history size
    if (structure_history.length > MAX_HISTORY) {
      structure_history = structure_history.slice(-MAX_HISTORY)
      history_index = structure_history.length - 1
    }
  }

  // Undo last change
  function undo() {
    if (history_index > 0) {
      history_index--
      const previous_structure = structure_history[history_index]
      if (previous_structure) {
        // Clear selections before restoring to avoid conflicts
        selected_sites = []
        measured_sites = []
        structure = JSON.parse(JSON.stringify(previous_structure))
      }
    }
  }

  // Redo last undone change
  function redo() {
    if (history_index < structure_history.length - 1) {
      history_index++
      const next_structure = structure_history[history_index]
      if (next_structure) {
        // Clear selections before restoring to avoid conflicts
        selected_sites = []
        measured_sites = []
        structure = JSON.parse(JSON.stringify(next_structure))
      }
    }
  }

  // Initialize history when structure first loads
  $effect(() => {
    if (structure && structure_history.length === 0) {
      structure_history = [JSON.parse(JSON.stringify(structure))]
      history_index = 0
    }
  })

  // Keyboard shortcuts
  function handle_keydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey) {
      if (event.key === `z` && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((event.key === `y`) || (event.key === `z` && event.shiftKey)) {
        event.preventDefault()
        redo()
      }
    } else if (event.key === `Delete` || event.key === `Backspace`) {
      // Delete selected atoms in edit mode
      if (measure_mode === `edit` && selected_sites.length > 0) {
        event.preventDefault()

        // Save to history once before making any changes
        save_to_history()

        // Store atoms to delete before clearing selection
        const atoms_to_delete = new Set(selected_sites)

        // Clear selection BEFORE updating structure to prevent TransformControls interference
        selected_sites = []
        measured_sites = []

        // Delete all selected atoms in one operation
        if (structure?.sites) {
          structure = {
            ...structure,
            sites: structure.sites.filter((_, idx) => !atoms_to_delete.has(idx)),
          }
        }
      }
    }
  }

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
  $effect(() => {
    if (
      show_image_atoms && supercell_structure && `lattice` in supercell_structure &&
      supercell_structure.lattice
    ) {
      displayed_structure = get_pbc_image_sites(supercell_structure)
    } else displayed_structure = supercell_structure
  })

  // Track if camera has ever been moved from initial position
  let camera_has_moved = $state(false)
  let camera_is_moving = $state(false)
  let scene = $state(undefined)
  let camera = $state(undefined)
  let camera_move_timeout: ReturnType<typeof setTimeout> | null = $state(null)

  // Custom toggle handlers for mutual exclusion
  function toggle_info() {
    if (info_pane_open) info_pane_open = false
    else [info_pane_open, controls_open] = [true, false]
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
        // Debounce camera move events to avoid excessive emissions
        if (camera_move_timeout) clearTimeout(camera_move_timeout)
        camera_move_timeout = setTimeout(() => {
          const { camera_position } = scene_props
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

  function onkeydown(event: KeyboardEvent) {
    // Don't handle shortcuts if user is typing in an input field
    const target = event.target as HTMLElement
    const is_input_focused = target.tagName === `INPUT` ||
      target.tagName === `TEXTAREA`

    if (is_input_focused) return

    // Interface shortcuts
    if (event.key === `f` && fullscreen_toggle) toggle_fullscreen(wrapper)
    else if (event.key === `i` && enable_info_pane) toggle_info()
    else if (event.key === `Escape`) {
      // Prioritize closing panes over exiting fullscreen
      if (info_pane_open) info_pane_open = false
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
  class:active={info_pane_open || controls_open}
  role="application"
  aria-label="Structure viewer with keyboard shortcuts"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  tabindex="-1"
  onkeydown={handle_keydown}
  onclick={() => wrapper?.focus()}
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
            type="button"
            onclick={() => fullscreen_toggle && toggle_fullscreen(wrapper)}
            title="{fullscreen ? `Exit` : `Enter`} fullscreen"
            aria-pressed={fullscreen}
            class="fullscreen-toggle"
            style="padding: 0"
            {@attach tooltip()}
          >
            {#if typeof fullscreen_toggle === `function`}
              {@render fullscreen_toggle()}
            {:else}
              <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
            {/if}
          </button>
        {/if}

        <!-- Measurement mode dropdown (match Trajectory display mode UI) -->
        <div
          class="measure-mode-dropdown"
          {@attach click_outside({ callback: () => measure_menu_open = false })}
        >
          <button
            onclick={() => (measure_menu_open = !measure_menu_open)}
            title="Measurement mode"
            class="view-mode-button"
            class:active={measure_menu_open}
            aria-expanded={measure_menu_open}
            style="transform: scale(1.2)"
          >
            {#if (measured_sites?.length ?? 0) >= MAX_SELECTED_SITES}
              <span class="selection-limit-text">
                {measured_sites.length}/{MAX_SELECTED_SITES}
              </span>
            {:else}
              <Icon
                icon={({ distance: `Ruler`, angle: `Angle`, edit: `Edit` } as const)[
                  measure_mode
                ]}
                style="transform: scale({{ distance: 0.9, angle: 1.1, edit: 1.0 }[measure_mode]})"
              />
            {/if}
            <Icon
              icon="Arrow{measure_menu_open ? `Up` : `Down`}"
              style="margin-left: -2px"
            />
          </button>
          {#if (measured_sites?.length ?? 0) > 0}
            <button
              type="button"
              aria-label="Reset selection"
              onclick={() => (measured_sites = [])}
            >
              <Icon icon="Reset" style="margin-left: -4px" />
            </button>
          {/if}

          <!-- Undo/Redo buttons (only show in edit mode) -->
          {#if measure_mode === `edit`}
            {@const undo_count = history_index}
            {@const redo_count = structure_history.length - 1 - history_index}
            <div class="undo-redo-container">
              <button
                type="button"
                aria-label="Undo (Ctrl+Z)"
                disabled={history_index <= 0}
                onclick={undo}
                title="Undo (Ctrl+Z)"
                class="undo-redo-button"
              >
                <Icon icon="Undo" />
                {#if undo_count > 0}
                  <span class="history-count">{undo_count}</span>
                {/if}
              </button>
              <button
                type="button"
                aria-label="Redo (Ctrl+Y)"
                disabled={history_index >= structure_history.length - 1}
                onclick={redo}
                title="Redo (Ctrl+Y)"
                class="undo-redo-button"
              >
                <Icon icon="Redo" />
                {#if redo_count > 0}
                  <span class="history-count">{redo_count}</span>
                {/if}
              </button>
            </div>
          {/if}
          {#if measure_menu_open}
            <div class="view-mode-dropdown">
              {#each [
            { mode: `distance`, icon: `Ruler`, label: `Distance`, scale: 1.1 },
            { mode: `angle`, icon: `Angle`, label: `Angle`, scale: 1.3 },
            { mode: `edit`, icon: `Edit`, label: `Edit Atoms`, scale: 1.0 },
          ] as const as
                { mode, icon, label, scale }
                (mode)
              }
                <button
                  class="view-mode-option"
                  class:selected={measure_mode === mode}
                  onclick={() => {
                    measure_mode = mode
                    measure_menu_open = false
                  }}
                >
                  <Icon {icon} style="transform: scale({scale})" />
                  <span>{label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        {#if enable_info_pane && structure}
          <StructureInfoPane
            {structure}
            bind:pane_open={info_pane_open}
            bind:selected_sites
            {@attach tooltip({ content: `Structure info pane` })}
          />
        {/if}

        <StructureControls
          bind:controls_open
          bind:scene_props
          bind:lattice_props
          bind:show_image_atoms
          bind:supercell_scaling
          bind:background_color
          bind:background_opacity
          bind:color_scheme
          bind:png_dpi
          {structure}
          {wrapper}
          {scene}
          {camera}
        />
      {/if}
    </section>

    <StructureLegend elements={get_elem_amounts(supercell_structure ?? structure!)} />

    <!-- prevent from rendering in vitest runner since WebGLRenderingContext not available -->
    {#if typeof WebGLRenderingContext !== `undefined`}
      <!-- prevent HTML labels from rendering outside of the canvas -->
      <div style="overflow: hidden; height: 100%">
        <Canvas>
          <StructureScene
            structure={displayed_structure}
            {...scene_props}
            {lattice_props}
            bind:camera_is_moving
            bind:selected_sites
            bind:measured_sites
            {measure_mode}
            {width}
            {height}
            original_atom_count={supercell_structure?.sites?.length || structure?.sites?.length}
            on_operation_start={() => {
              // Save history BEFORE starting the continuous operation
              save_to_history()
              is_during_continuous_operation = true
            }}
            on_operation_end={() => {
              is_during_continuous_operation = false
              // Don't save history here - it was saved at the start
            }}
            on_atom_move={(event) => {
              if (!event.detail || !structure?.sites) return

              const {
                site_idx,
                new_position,
                new_abc,
                element,
                delete_site_idx,
              } = event.detail

              // For discrete operations (not during continuous ops), save history before changes
              if (!is_during_continuous_operation) {
                save_to_history()
              }

              if (site_idx === -1 && element) {
                // Add new atom
                const new_site = {
                  species: [{
                    element: element as any,
                    occu: 1,
                    oxidation_state: null,
                  }],
                  xyz: new_position,
                  abc: new_abc || [0, 0, 0],
                  properties: {},
                  label: element,
                } as any
                structure = {
                  ...structure,
                  sites: [...structure.sites, new_site],
                }
              } else if (site_idx === -2 && delete_site_idx !== undefined) {
                // Delete atom
                structure = {
                  ...structure,
                  sites: structure.sites.filter((_, idx) => idx !== delete_site_idx),
                }
              } else if (site_idx >= 0) {
                // Move existing atom
                const target_idx = site_idx >= structure.sites.length
                  ? site_idx % structure.sites.length // Image atom -> original atom
                  : site_idx

                if (structure.sites[target_idx]) {
                  structure = {
                    ...structure,
                    sites: structure.sites.map((site, idx) =>
                      idx === target_idx
                        ? { ...site, xyz: new_position, abc: new_abc || site.abc }
                        : site
                    ),
                  }
                }
              }
            }}
          />
        </Canvas>
      </div>
    {/if}

    <div class="bottom-left">
      {@render bottom_left?.({ structure: displayed_structure })}
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
    container-type: size; /* enable cqh/cqw for internal panes */
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
    background: var(--struct-bg-fullscreen, var(--struct-bg));
  }
  .structure:fullscreen :global(canvas) {
    height: 100vh !important;
    width: 100vw !important;
  }
  .structure.dragover {
    background: var(--struct-dragover-bg, var(--dragover-bg));
    border: var(--struct-dragover-border, var(--dragover-border));
  }
  /* Avoid accidental text selection while interacting with the viewer */
  .structure :global(canvas),
  .structure section.control-buttons,
  .structure .bottom-left {
    user-select: none;
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
    gap: clamp(6pt, 1cqmin, 9pt);
    /* buttons need higher z-index than StructureLegend to make info/controls panes occlude legend */
    /* we also need crazy high z-index to make info/control pane occlude threlte/extras' <HTML> elements for site labels */
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
    display: flex;
    padding: 0;
  }
  section.control-buttons :global(button:hover) {
    background-color: var(--pane-btn-bg-hover);
  }
  /* Match Trajectory dropdown UI */
  .view-mode-dropdown {
    position: absolute;
    top: 115%;
    right: 0;
    background: var(--surface-bg);
    border-radius: 4px;
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.3), 0 4px 8px -2px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
  }
  .view-mode-option {
    display: flex;
    align-items: center;
    gap: 1ex;
    width: 100%;
    padding: var(--trajectory-view-mode-option-padding, 5pt);
    box-sizing: border-box;
    background: transparent;
    border-radius: 0;
    text-align: left;
    transition: background-color 0.15s ease;
  }
  .view-mode-option:first-child {
    border-top-left-radius: 3px;
    border-top-right-radius: 3px;
  }
  .view-mode-option.selected {
    color: var(--accent-color);
  }
  .view-mode-option span {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .measure-mode-dropdown {
    display: flex;
    position: relative;
    gap: 8pt;
    margin-inline: 3pt;
  }
  .measure-mode-dropdown > button {
    background: transparent;
    padding: 0;
  }
  .selection-limit-text {
    font-weight: bold;
    font-size: 0.9em;
    color: var(--accent-color, #ff6b6b);
    min-width: 2.5em;
    text-align: center;
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
  .undo-redo-container {
    display: flex;
    gap: 0;
  }
  .undo-redo-button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .history-count {
    position: absolute;
    bottom: -2px;
    right: -2px;
    background: var(--accent-color, #007acc);
    color: white;
    border-radius: 50%;
    width: 12px;
    height: 12px;
    font-size: 8px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    pointer-events: none;
    z-index: 1;
  }
</style>

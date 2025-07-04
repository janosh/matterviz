<script lang="ts">
  import { Icon, Spinner, Structure } from '$lib'
  import { decompress_file } from '$lib/io/decompress'
  import { format_num, trajectory_property_config } from '$lib/labels'
  import type { DataSeries, Point } from '$lib/plot'
  import { Histogram, ScatterPlot } from '$lib/plot'
  import { scaleLinear } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { titles_as_tooltips } from 'svelte-zoo'
  import { full_data_extractor } from './extract'
  import type { Trajectory, TrajectoryDataExtractor } from './index'
  import { TrajectoryError, TrajectorySidebar } from './index'
  import type { ParseProgress } from './parse'
  import {
    get_unsupported_format_message,
    load_trajectory_from_url,
    parse_trajectory_async,
  } from './parse'
  import {
    generate_axis_labels,
    generate_plot_series,
    should_hide_plot,
    toggle_series_visibility,
  } from './plotting'

  interface Props {
    // trajectory data - can be provided directly or loaded from file
    trajectory?: Trajectory | undefined
    // URL to load trajectory from (alternative to providing trajectory directly)
    trajectory_url?: string
    // current step index being displayed
    current_step_idx?: number
    // custom function to extract plot data from trajectory frames
    data_extractor?: TrajectoryDataExtractor
    // file drop handlers
    allow_file_drop?: boolean
    on_file_drop?: (content: string, filename: string) => Promise<void> | void
    // layout configuration - 'auto' (default) adapts to viewport, 'horizontal'/'vertical' forces layout
    layout?: `auto` | `horizontal` | `vertical`
    // structure viewer props (passed to Structure component)
    structure_props?: ComponentProps<typeof Structure>
    // plot props (passed to ScatterPlot component)
    scatter_props?: ComponentProps<typeof ScatterPlot>
    // histogram props (passed to Histogram component, excluding series which is handled separately)
    histogram_props?: Omit<ComponentProps<typeof Histogram>, `series`>
    // spinner props (passed to Spinner component)
    spinner_props?: ComponentProps<typeof Spinner>
    // custom snippets for additional UI elements
    trajectory_controls?: Snippet<
      [
        {
          trajectory: Trajectory
          current_step_idx: number
          total_frames: number
          on_step_change: (idx: number) => void
        },
      ]
    >
    // Custom error snippet for advanced error handling
    error_snippet?: Snippet<[{ error_message: string; on_dismiss: () => void }]>

    show_controls?: boolean // show/hide the trajectory controls bar
    // show/hide the fullscreen button
    show_fullscreen_button?: boolean
    // display mode: 'structure+scatter' (default), 'structure' (only structure), 'scatter' (only scatter), 'histogram' (only histogram), 'structure+histogram' (structure with histogram)
    display_mode?:
      | `structure+scatter`
      | `structure`
      | `scatter`
      | `histogram`
      | `structure+histogram`
    // step labels configuration for slider
    // - positive number: number of evenly spaced ticks
    // - negative number: spacing between ticks (e.g., -10 = every 10th step)
    // - array: exact step indices to label
    // - undefined: no labels
    step_labels?: number | number[] | undefined
    // explicit mapping from property keys to display labels
    property_labels?: Record<string, string>
    // units configuration - developers can override these (deprecated - use property_labels instead)
    units?: {
      energy?: string
      energy_per_atom?: string
      force_max?: string
      force_norm?: string
      stress_max?: string
      volume?: string
      density?: string
      temperature?: string
      pressure?: string
      length?: string
      a?: string
      b?: string
      c?: string
      [key: string]: string | undefined
    }
  }
  let {
    trajectory = $bindable(undefined),
    trajectory_url,
    current_step_idx = $bindable(0),
    data_extractor = full_data_extractor,
    allow_file_drop = true,
    on_file_drop = handle_trajectory_file_drop,
    layout = `auto`,
    structure_props = {},
    scatter_props = {},
    histogram_props = {},
    spinner_props = {},
    trajectory_controls,
    error_snippet,
    show_controls = true,
    show_fullscreen_button = true,
    display_mode = $bindable(`structure+scatter`),
    step_labels = 5,
  }: Props = $props()

  let dragover = $state(false)
  let loading = $state(false)
  let error_message = $state<string | null>(null)
  let is_playing = $state(false)
  let frame_rate_fps = $state(5)
  let play_interval: ReturnType<typeof setInterval> | undefined = $state(undefined)
  let current_filename = $state<string | null>(null)
  let current_file_path = $state<string | null>(null)
  let file_size = $state<number | null>(null)
  let file_object = $state<File | null>(null)
  let wrapper = $state<HTMLDivElement | undefined>(undefined)
  let sidebar_open = $state(false)
  let parsing_progress = $state<ParseProgress | null>(null)

  // Viewport dimensions for responsive layout
  let viewport = $state({ width: 0, height: 0 })

  // Reactive layout that chooses based on viewport aspect ratio when layout is 'auto'
  let actual_layout = $derived.by((): `horizontal` | `vertical` => {
    if (layout === `horizontal` || layout === `vertical`) return layout // Explicit layout override

    // Auto layout: choose based on viewport aspect ratio
    if (viewport.width > 0 && viewport.height > 0) {
      return viewport.width > viewport.height ? `horizontal` : `vertical`
    }

    return `horizontal` // Fallback to horizontal if dimensions not available yet
  })

  // Current frame structure for display
  let current_structure = $derived(
    trajectory && current_step_idx < trajectory.frames.length
      ? trajectory.frames[current_step_idx]?.structure
      : undefined,
  )

  // Calculate step label positions using D3's pretty ticks for even distribution
  let step_label_positions = $derived.by((): number[] => {
    if (!trajectory || !step_labels) return []

    const total_frames = trajectory.frames.length
    if (total_frames <= 1) return []

    if (Array.isArray(step_labels)) {
      // Exact positions provided as array
      return step_labels.filter((idx: number) => idx >= 0 && idx < total_frames)
    }

    if (typeof step_labels === `number`) {
      if (step_labels > 0) {
        // Use D3's pretty ticks for even distribution
        const scale = scaleLinear().domain([0, total_frames - 1])
        const ticks = scale.nice().ticks(Math.min(step_labels, total_frames))
        // Round and filter to valid frame indices
        return ticks
          .map((t) => Math.round(t))
          .filter((t) => t >= 0 && t < total_frames)
          .filter((t, idx, arr) => arr.indexOf(t) === idx) // Remove duplicates
      } else if (step_labels < 0) {
        // Negative number: spacing between ticks
        const spacing = Math.abs(step_labels)
        const positions: number[] = []
        for (let idx = 0; idx < total_frames; idx += spacing) {
          positions.push(idx)
        }
        // Always include the last frame if it's not already included
        if (positions[positions.length - 1] !== total_frames - 1) {
          positions.push(total_frames - 1)
        }
        return positions
      }
    }

    return []
  })

  // Generate plot data using extracted plotting utilities
  let plot_series = $derived.by((): DataSeries[] => {
    if (!trajectory) return []

    return generate_plot_series(trajectory, data_extractor, {
      property_config: trajectory_property_config,
    })
  })

  // Check if all plotted values are constant (no variation) using extracted utility
  let show_plot = $derived(
    display_mode !== `structure` && !should_hide_plot(trajectory, plot_series),
  )

  // Determine what to show based on display mode
  let show_structure = $derived(![`scatter`, `histogram`].includes(display_mode))
  let actual_show_plot = $derived(display_mode !== `structure` && show_plot)

  // Generate intelligent axis labels based on first visible series on each axis
  let y_axis_labels = $derived(generate_axis_labels(plot_series))

  // Check if there are any Y2 series to determine padding
  let has_y2_series = $derived(
    plot_series.some((s) => s.y_axis === `y2` && s.visible),
  )

  // Handle file drop events
  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return

    // Check for our custom internal file format first
    const internal_data = event.dataTransfer?.getData(`application/x-matterviz-file`)
    if (internal_data) {
      try {
        const file_info = JSON.parse(internal_data)

        // Check if this is a binary file
        if (file_info.is_binary) {
          if (file_info.content instanceof ArrayBuffer) {
            await handle_trajectory_binary_drop(file_info.content, file_info.name)
          } else if (file_info.content_url) {
            const response = await fetch(file_info.content_url)
            const array_buffer = await response.arrayBuffer()
            await handle_trajectory_binary_drop(array_buffer, file_info.name)
          } else {
            console.warn(
              `Binary file without ArrayBuffer or blob URL:`,
              file_info.name,
            )
          }
        } else {
          await on_file_drop(file_info.content, file_info.name)
        }
        return
      } catch (error) {
        console.warn(`Failed to parse internal file data:`, error)
        // Fall through to other methods
      }
    }

    // Check for plain text data (fallback)
    const text_data = event.dataTransfer?.getData(`text/plain`)
    if (text_data) {
      file_size = null // Size not available for text drops
      await on_file_drop(text_data, `trajectory.json`)
      return
    }

    // Handle actual file drops from file system
    const file = event.dataTransfer?.files[0]
    if (!file) return

    loading = true
    file_size = file.size // Capture file size
    current_file_path = file.webkitRelativePath || file.name // Capture full path if available
    file_object = file
    try {
      // Check if this is a binary trajectory file (HDF5 or ASE)
      if (
        file.name.toLowerCase().endsWith(`.h5`) ||
        file.name.toLowerCase().endsWith(`.hdf5`) ||
        file.name.toLowerCase().endsWith(`.traj`)
      ) {
        const buffer = await file.arrayBuffer()
        await handle_trajectory_binary_drop(buffer, file.name)
        return
      }

      // Check for known unsupported binary formats before trying to read
      const unsupported_message = get_unsupported_format_message(file.name, ``)
      if (unsupported_message) {
        error_message = unsupported_message
        current_filename = null
        file_size = null
        return
      }

      const { content, filename } = await decompress_file(file)
      if (content) await on_file_drop(content, filename)
    } catch (error) {
      error_message = `Failed to read file: ${error}`
      current_filename = null
      file_size = null
      console.error(`File reading error:`, error)
    } finally {
      loading = false
    }
  }

  // Step navigation functions
  function next_step() {
    if (trajectory && current_step_idx < trajectory.frames.length - 1) {
      current_step_idx++
    }
  }

  function prev_step() {
    if (current_step_idx > 0) {
      current_step_idx--
    }
  }

  function go_to_step(idx: number) {
    if (trajectory && idx >= 0 && idx < trajectory.frames.length) {
      current_step_idx = idx
    }
  }

  // Handle plot point clicks to jump to that step
  function handle_plot_change(data: (Point & { series: DataSeries }) | null) {
    if (data?.x !== undefined && typeof data.x === `number`) {
      const step_idx = Math.round(data.x)
      go_to_step(step_idx)
    }
  }

  // Handle legend toggling with unit-aware visibility management
  function handle_legend_toggle(series_idx: number): void {
    plot_series = toggle_series_visibility(plot_series, series_idx)
  }

  // Legend configuration with unit-aware toggle handlers
  let legend_config = $derived.by(() => {
    const config = {
      responsive: true,
      layout: `horizontal`,
      layout_tracks: 3,
      item_gap: 0,
      padding: { t: 5, b: 5, l: 5, r: 5 },
      ...scatter_props?.legend,
      on_toggle: scatter_props?.legend?.on_toggle ?? handle_legend_toggle,
    }
    return config
  })

  // Play/pause functionality
  function toggle_play() {
    if (is_playing) {
      pause_playback()
    } else {
      start_playback()
    }
  }

  function start_playback() {
    if (!trajectory || trajectory.frames.length <= 1) return
    is_playing = true
  }

  function pause_playback() {
    is_playing = false
  }

  // Effect to manage playback interval
  $effect(() => {
    // Only watch is_playing and frame_rate_ms, not play_interval itself
    const playing = is_playing
    const rate_ms = 1000 / frame_rate_fps

    if (playing) {
      // Clear existing interval if it exists - use untrack to avoid circular dependency
      const current_interval = untrack(() => play_interval)
      if (current_interval !== undefined) clearInterval(current_interval)

      // Create new interval with current frame rate
      play_interval = setInterval(() => {
        if (current_step_idx >= trajectory!.frames.length - 1) go_to_step(0) // Loop back to 1st step
        else next_step()
      }, rate_ms)
    } else {
      // Clear interval when not playing - use untrack to avoid circular dependency
      const current_interval = untrack(() => play_interval)
      if (current_interval !== undefined) {
        clearInterval(current_interval)
        play_interval = undefined
      }
    }
  })

  // Cleanup interval on component destroy
  $effect(() => {
    return () => {
      if (play_interval !== undefined) clearInterval(play_interval)
    }
  })

  // Load trajectory from URL when trajectory_url is provided
  $effect(() => {
    if (trajectory_url && !trajectory) {
      loading = true
      error_message = null

      load_trajectory_from_url(trajectory_url)
        .then((loaded_trajectory: Trajectory) => {
          trajectory = loaded_trajectory
          current_step_idx = 0
          // Extract filename from URL
          current_filename = trajectory_url.split(`/`).pop() || trajectory_url
          file_size = null // Size not available for URL loads
          loading = false
        })
        .catch((err: Error) => {
          console.error(`Failed to load trajectory from URL:`, err)
          error_message = `Failed to load trajectory: ${err.message}`
          current_filename = null
          file_size = null
          loading = false
        })
    }
  })

  async function handle_trajectory_file_drop(content: string, filename: string) {
    await load_trajectory_data(content, filename)
  }

  async function handle_trajectory_binary_drop(
    buffer: ArrayBuffer,
    filename: string,
  ) {
    await load_trajectory_data(buffer, filename)
  }

  // Consolidated trajectory loading function
  async function load_trajectory_data(
    data: string | ArrayBuffer,
    filename: string,
  ) {
    loading = true
    error_message = null
    parsing_progress = null

    try {
      // Check for unsupported formats first (only for text content)
      if (typeof data === `string`) {
        const unsupported_message = get_unsupported_format_message(filename, data)
        if (unsupported_message) {
          error_message = unsupported_message
          current_filename = null
          file_size = null
          return
        }
      }

      trajectory = await parse_trajectory_async(data, filename, (progress) => {
        parsing_progress = progress
      })

      current_step_idx = 0
      current_filename = filename
      parsing_progress = null
    } catch (err) {
      // Check if this might be an unsupported format even if not detected initially
      if (typeof data === `string`) {
        const unsupported_message = get_unsupported_format_message(filename, data)
        if (unsupported_message) {
          error_message = unsupported_message
        } else {
          error_message = `Failed to parse trajectory file: ${err}`
        }
      } else {
        error_message = `Failed to parse binary trajectory file: ${err}`
      }
      current_filename = null
      file_size = null
      parsing_progress = null
      console.error(`Trajectory parsing error:`, err)
    } finally {
      loading = false
    }
  }

  // Fullscreen functionality
  function toggle_fullscreen() {
    if (!document.fullscreenElement && wrapper) {
      wrapper.requestFullscreen().catch(console.error)
    } else {
      document.exitFullscreen()
    }
  }

  // Get current view mode label
  let current_view_label = $derived.by(() => {
    if (display_mode === `structure`) return `Structure Only`
    if (display_mode === `scatter`) return `Scatter Only`
    if (display_mode === `histogram`) return `Histogram Only`
    return `Structure + Scatter`
  })

  let view_mode_dropdown_open = $state(false)

  // Handle click outside sidebar to close it
  function handle_click_outside(event: MouseEvent) {
    const target = event.target as Element

    // Handle sidebar
    if (sidebar_open) {
      const sidebar = target.closest(`.info-sidebar`)
      const info_button = target.closest(`.info-button`)
      // Don't close if clicking on sidebar or info button
      if (!sidebar && !info_button) sidebar_open = false
    }

    // Handle view mode dropdown
    if (view_mode_dropdown_open) {
      const dropdown_wrapper = target.closest(`.view-mode-dropdown-wrapper`)
      // Don't close if clicking on dropdown wrapper (which contains both button and menu)
      if (!dropdown_wrapper) view_mode_dropdown_open = false
    }
  }

  // Handle keyboard shortcuts
  function onkeydown(event: KeyboardEvent) {
    if (!trajectory) return

    // Don't handle shortcuts if user is typing in an input field (but allow if it's our step input and not focused)
    const target = event.target as HTMLElement
    const is_step_input = target.classList.contains(`step-input`)
    const is_input_focused = target.tagName === `INPUT` ||
      target.tagName === `TEXTAREA`

    // Skip if typing in an input that's not our step input
    if (is_input_focused && !is_step_input) return

    // If typing in step input, only handle certain navigation keys
    if (is_step_input && is_input_focused) {
      // Allow normal typing, but handle special navigation keys
      if ([`Escape`, `Enter`].includes(event.key)) target.blur() // Remove focus from input
      return
    }

    const total_frames = trajectory.frames.length
    const is_cmd_or_ctrl = event.metaKey || event.ctrlKey

    // Navigation shortcuts
    if (event.key === ` `) toggle_play()
    else if (event.key === `ArrowLeft`) {
      if (is_cmd_or_ctrl) go_to_step(0)
      else prev_step()
    } else if (event.key === `ArrowRight`) {
      if (is_cmd_or_ctrl) go_to_step(total_frames - 1)
      else next_step()
    } else if (event.key === `Home`) go_to_step(0)
    else if (event.key === `End`) go_to_step(total_frames - 1)
    else if (event.key === `j`) {
      go_to_step(Math.max(0, current_step_idx - 10))
    } else if (event.key === `l`) {
      go_to_step(Math.min(total_frames - 1, current_step_idx + 10))
    } else if (event.key === `PageUp`) {
      go_to_step(Math.max(0, current_step_idx - 25))
    } else if (event.key === `PageDown`) {
      go_to_step(Math.min(total_frames - 1, current_step_idx + 25))
    } // Interface shortcuts
    else if (event.key === `f`) toggle_fullscreen()
    else if (event.key === `i`) sidebar_open = !sidebar_open // Playback speed shortcuts (only when playing)
    else if ((event.key === `=` || event.key === `+`) && is_playing) {
      frame_rate_fps = Math.min(30, frame_rate_fps + 0.2)
    } else if (event.key === `-` && is_playing) {
      frame_rate_fps = Math.max(0.2, frame_rate_fps - 0.2)
    } // System shortcuts
    else if (event.key === `Escape`) {
      if (document.fullscreenElement) document.exitFullscreen()
      else if (view_mode_dropdown_open) view_mode_dropdown_open = false
      else sidebar_open = false
    } // Number keys 0-9 - jump to percentage of trajectory
    else if (event.key >= `0` && event.key <= `9`) {
      go_to_step(Math.floor((parseInt(event.key, 10) / 10) * (total_frames - 1)))
    } else if (event.key === `Escape` && sidebar_open) { // Escape key to close sidebar
      event.stopPropagation()
      sidebar_open = false
    }
  }

  let controls_open = $state({ structure: false, plot: false })
</script>

<div
  class="trajectory-viewer {actual_layout}"
  class:dragover
  class:active={sidebar_open || is_playing || controls_open.structure || controls_open.plot}
  bind:this={wrapper}
  bind:clientWidth={viewport.width}
  bind:clientHeight={viewport.height}
  role="button"
  tabindex="0"
  aria-label="Drop trajectory file here to load"
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
  onclick={handle_click_outside}
  {onkeydown}
>
  {#if loading}
    {#if parsing_progress}
      <Spinner
        text="{parsing_progress.stage} ({parsing_progress.current}%)"
        {...spinner_props}
      />
    {:else}
      <Spinner text="Loading trajectory..." {...spinner_props} />
    {/if}
  {:else if error_message}
    <TrajectoryError
      {error_message}
      on_dismiss={() => (error_message = null)}
      {error_snippet}
    />
  {:else if trajectory}
    <!-- Trajectory Controls -->
    {#if show_controls}
      <div class="trajectory-controls">
        {#if trajectory_controls}
          {@render trajectory_controls({
        trajectory,
        current_step_idx,
        total_frames: trajectory.frames.length,
        on_step_change: go_to_step,
      })}
        {:else}
          {@const input_width = Math.max(25, String(current_step_idx).length * 8 + 6)}
          {#if current_filename}
            <div class="filename-section">
              <button
                use:titles_as_tooltips
                title="Click to copy filename {current_filename}"
                onclick={() => {
                  if (current_filename) navigator.clipboard.writeText(current_filename)
                }}
              >
                {current_filename}
              </button>
            </div>
          {/if}

          <!-- Navigation controls -->
          <div class="nav-section">
            <button
              onclick={prev_step}
              disabled={current_step_idx === 0 || is_playing}
              title="Previous step"
              class="nav-button"
            >
              ⏮
            </button>

            <button
              onclick={toggle_play}
              disabled={trajectory.frames.length <= 1}
              title={is_playing ? `Pause playback` : `Play trajectory`}
              class="play-button nav-button"
              class:playing={is_playing}
            >
              {is_playing ? `⏸` : `▶`}
            </button>

            <button
              onclick={next_step}
              disabled={current_step_idx === trajectory.frames.length - 1 || is_playing}
              title="Next step"
              class="nav-button"
            >
              ⏭
            </button>
          </div>

          <!-- Frame slider and counter -->
          <div class="step-section">
            <input
              type="number"
              min="0"
              max={trajectory.frames.length - 1}
              bind:value={current_step_idx}
              oninput={(event) => {
                const target = event.target as HTMLInputElement
                const width = Math.max(25, Math.min(80, target.value.length * 8 + 6))
                target.style.width = `${width}px`
              }}
              style:width="{input_width}px"
              class="step-input"
              title="Enter step number to jump to"
            />
            <span>/ {trajectory.frames.length}</span>
            <div class="slider-container">
              <input
                type="range"
                min="0"
                max={trajectory.frames.length - 1}
                bind:value={current_step_idx}
                class="step-slider"
                title="Drag to navigate steps"
              />
              {#if step_label_positions.length > 0}
                <div class="step-labels">
                  {#each step_label_positions as step_idx (step_idx)}
                    {@const position_percent = (step_idx / (trajectory.frames.length - 1)) *
              100}
                    {@const adjusted_position = 1.5 + (position_percent * (100 - 2)) / 100}
                    <div class="step-tick" style:left="{adjusted_position}%"></div>
                    <div class="step-label" style:left="{adjusted_position}%">
                      {step_idx}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>

          <!-- Frame rate control - only shown when playing -->
          {#if is_playing}
            <div class="speed-section">
              <label for="step-rate-slider" style="font-weight: 500; white-space: nowrap"
              >Speed:</label>
              <input
                id="step-rate-slider"
                type="range"
                min="0.2"
                max="30"
                step="0.1"
                bind:value={frame_rate_fps}
                class="speed-slider"
                title="Frame rate: {format_num(frame_rate_fps, `.2~s`)} fps"
              />
              <input
                type="number"
                min="0.2"
                max="30"
                step="0.1"
                bind:value={frame_rate_fps}
                class="speed-input"
                title="Enter precise FPS value"
              />
              fps
            </div>
          {/if}

          <!-- Frame info section -->
          <div class="info-section">
            <!-- Info button to open sidebar -->
            {#if trajectory}
              <button
                onclick={() => (sidebar_open = !sidebar_open)}
                title="{sidebar_open ? `Close` : `Open`} info panel"
                aria-label="{sidebar_open ? `Close` : `Open`} info panel"
                class="info-button nav-button"
                class:active={sidebar_open}
              >
                <Icon icon="Info" style="width: 22px; height: 22px" />
              </button>
            {/if}
            <!-- Display mode dropdown -->
            {#if plot_series.length > 0}
              <div class="view-mode-dropdown-wrapper">
                <button
                  onclick={() => (view_mode_dropdown_open = !view_mode_dropdown_open)}
                  title={current_view_label}
                  class="view-mode-button nav-button"
                  class:active={view_mode_dropdown_open}
                >
                  <Icon
                    icon={({
                      structure: `Atom`,
                      'structure+scatter': `TwoColumns`,
                      'structure+histogram': `TwoColumns`,
                      scatter: `ScatterPlot`,
                      histogram: `Histogram`,
                    } as const)[display_mode]}
                  />
                  <Icon icon={view_mode_dropdown_open ? `ArrowUp` : `ArrowDown`} />
                </button>
                {#if view_mode_dropdown_open}
                  <div class="view-mode-dropdown">
                    {#each [
              { mode: `structure`, icon: `Atom`, label: `Structure-only` },
              {
                mode: `structure+scatter`,
                icon: `TwoColumns`,
                label: `Structure + Scatter`,
              },
              {
                mode: `structure+histogram`,
                icon: `TwoColumns`,
                label: `Structure + Histogram`,
              },
              { mode: `scatter`, icon: `ScatterPlot`, label: `Scatter-only` },
              {
                mode: `histogram`,
                icon: `Histogram`,
                label: `Histogram-only`,
              },
            ] as const as
                      option
                      (option.mode)
                    }
                      <button
                        class="view-mode-option"
                        class:selected={display_mode === option.mode}
                        onclick={() => {
                          display_mode = option.mode
                          view_mode_dropdown_open = false
                        }}
                      >
                        <Icon icon={option.icon} />
                        <span>{option.label}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
            <!-- Fullscreen button - rightmost position -->
            {#if show_fullscreen_button}
              <button
                onclick={toggle_fullscreen}
                title="Toggle fullscreen"
                aria-label="Toggle fullscreen"
                class="fullscreen-button nav-button"
              >
                <Icon icon="Fullscreen" />
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <div
      class="content-area"
      class:hide-plot={!actual_show_plot}
      class:hide-structure={!show_structure}
      class:show-both={display_mode === `structure+scatter` || display_mode === `structure+histogram`}
      class:show-structure-only={display_mode === `structure`}
      class:show-plot-only={display_mode === `scatter` || display_mode === `histogram`}
    >
      {#if show_structure}
        <Structure
          structure={current_structure}
          allow_file_drop={false}
          style="height: 100%; border-radius: 0"
          enable_tips={false}
          fullscreen_toggle={false}
          {...{ show_image_atoms: false, ...structure_props }}
          bind:controls_open={controls_open.structure}
        />
      {/if}

      {#if actual_show_plot}
        {#if display_mode === `scatter` || display_mode === `structure+scatter`}
          <ScatterPlot
            series={plot_series}
            x_label="Step"
            y_label={y_axis_labels.y1}
            y_label_shift={{ y: 20 }}
            y_format=".2~s"
            y2_format=".2~s"
            y2_label={y_axis_labels.y2}
            y2_label_shift={{ y: 80 }}
            current_x_value={current_step_idx}
            change={handle_plot_change}
            markers="line"
            x_ticks={step_label_positions}
            show_controls
            bind:controls_open={controls_open.plot}
            padding={{ t: 20, b: 60, l: 100, r: has_y2_series ? 100 : 20 }}
            range_padding={0}
            style="height: 100%"
            {...scatter_props}
            legend={legend_config}
          >
            {#snippet tooltip({ x, y, metadata })}
              {#if metadata?.series_label}
                Step: {Math.round(x)}<br />
                {@html metadata.series_label}: {typeof y === `number` ? format_num(y) : y}
              {:else}
                Step: {Math.round(x)}<br />
                Value: {typeof y === `number` ? format_num(y) : y}
              {/if}
            {/snippet}
          </ScatterPlot>
        {:else if display_mode === `histogram` || display_mode === `structure+histogram`}
          <Histogram
            series={plot_series}
            x_label={histogram_props.x_label ?? `Value`}
            y_label={histogram_props.y_label ?? `Count`}
            mode={histogram_props.mode ?? `overlay`}
            show_legend={histogram_props.show_legend ?? (plot_series.length > 1)}
            legend={{
              responsive: true,
              layout: `horizontal`,
              layout_tracks: 3,
              item_gap: 0,
              padding: { t: 5, b: 5, l: 5, r: 5 },
              on_toggle: handle_legend_toggle,
              series_data: [],
              ...(histogram_props.legend || {}),
            }}
            style="height: 100%"
            {...histogram_props}
          >
            {#snippet tooltip({ value, count, property })}
              <div>Value: {format_num(value)}</div>
              <div>Count: {count}</div>
              <div>{property}</div>
            {/snippet}
          </Histogram>
        {/if}
      {/if}
    </div>
  {:else}
    <div class="empty-state">
      <div class="drop-zone">
        <h3>Load Trajectory</h3>
        <p>
          Drop a trajectory file here (.xyz, .extxyz, .json, .json.gz, XDATCAR, .traj,
          .h5) or provide trajectory data via props
        </p>
        <div class="supported-formats">
          <strong>Supported formats:</strong>
          <ul>
            <li>Multi-frame XYZ trajectory files (.xyz, .extxyz)</li>
            <li>ASE trajectory files (.traj)</li>
            <li>Pymatgen trajectory JSON</li>
            <li>Array of structures with metadata</li>
            <li>VASP XDATCAR files</li>
            <li>HDF5 trajectory files (.h5, .hdf5)</li>
            <li>Compressed files (.gz)</li>
          </ul>
          <p
            style="margin-top: 1rem; font-size: 0.9em; color: var(--trajectory-text-muted, #666)"
          >
            💡 Force vectors will be automatically displayed when present in trajectory
            data
          </p>
        </div>
      </div>
    </div>
  {/if}

  {#if trajectory}
    <TrajectorySidebar
      {trajectory}
      {current_step_idx}
      {current_filename}
      {current_file_path}
      {file_size}
      {file_object}
      is_open={sidebar_open}
      onclose={() => (sidebar_open = false)}
    />
  {/if}
</div>

<style>
  .trajectory-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    position: relative;
    min-height: 500px;
    border-radius: 4px;
    border: 2px dashed transparent;
    transition: border-color 0.2s ease;
    box-sizing: border-box;
    contain: layout;
  }
  .trajectory-viewer.active {
    z-index: 2;
  }
  .trajectory-viewer:fullscreen {
    height: 100vh !important;
    width: 100vw !important;
    border-radius: 0;
    border: none;
  }
  /* Content area - grid container for equal sizing */
  .content-area {
    display: grid;
    flex: 1;
    min-height: 0;
    overflow: visible;
  }
  .trajectory-viewer.horizontal .content-area {
    grid-template-columns: 1fr 1fr;
  }
  .trajectory-viewer.vertical .content-area {
    grid-template-rows: 1fr 1fr;
  }
  /* When plot is hidden, structure takes full space */
  .content-area.hide-plot {
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr !important;
  }
  /* When structure is hidden, plot takes full space */
  .content-area.hide-structure {
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr !important;
  }
  /* Display mode specific layouts */
  .trajectory-viewer.horizontal .content-area.show-structure-only,
  .trajectory-viewer.vertical .content-area.show-structure-only {
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr !important;
  }
  .trajectory-viewer.horizontal .content-area.show-plot-only,
  .trajectory-viewer.vertical .content-area.show-plot-only {
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr !important;
  }
  .trajectory-viewer.dragover {
    border-color: var(--trajectory-dragover-border, #007acc);
    background-color: var(--trajectory-dragover-bg, rgba(0, 122, 204, 0.1));
  }

  .trajectory-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem;
    background: var(--traj-surface, rgba(45, 55, 72, 0.95));
    backdrop-filter: blur(4px);
    border-bottom: var(--trajectory-border, 1px solid #e1e4e8);
    color: var(--trajectory-text-color, #24292e);
    font-size: 0.8rem;
    position: relative;
    z-index: 100;
  }
  .nav-section {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .nav-button {
    min-width: 28px;
    height: 28px;
    padding: 0.125rem 0.25rem;
    font-size: 0.8rem;
  }
  .step-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }
  .step-input {
    border: 1px solid rgba(99, 179, 237, 0.3);
    border-radius: 3px;
    text-align: center;
    margin: 1.5px -5px 0 0;
  }
  .slider-container {
    position: relative;
    flex: 1;
    min-width: 80px;
  }
  .step-slider {
    width: 100%;
    accent-color: var(--traj-accent, #63b3ed);
  }
  .step-labels {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    height: 16px;
    pointer-events: none;
  }
  .step-tick {
    position: absolute;
    transform: translateX(-50%);
    width: 2px;
    height: 4px;
    background: var(--traj-muted, rgba(148, 163, 184, 0.8));
    top: -10px;
  }
  .step-label {
    position: absolute;
    transform: translateX(-50%);
    font-size: 0.65rem;
    color: var(--traj-muted, rgba(148, 163, 184, 0.85));
    white-space: nowrap;
    text-align: center;
    top: -6px;
  }
  .speed-slider {
    width: 90px;
    accent-color: var(--traj-accent, #63b3ed);
  }
  .speed-input {
    width: 45px;
    text-align: center;
    background: var(--traj-bg, rgba(26, 32, 44, 0.8));
    border: var(--traj-border, 1px solid rgba(74, 85, 104, 0.5));
    border-radius: 3px;
    color: var(--traj-text, #e2e8f0);
    font-size: 0.8rem;
    padding: 0.125rem 0.25rem;
    box-sizing: border-box;
  }
  .speed-section {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--traj-text, #e2e8f0);
  }
  .filename-section {
    display: flex;
    align-items: center;
    color: var(--traj-text, #e2e8f0);
  }
  .filename-section button {
    white-space: nowrap;
    padding: 0.125rem 0.375rem;
    background: var(--traj-bg, rgba(26, 32, 44, 0.8));
    border-radius: 2px;
    border: var(--traj-border, 1px solid rgba(74, 85, 104, 0.5));
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    line-height: inherit;
  }
  .display-mode {
    min-width: 28px;
    height: 28px;
    background: var(--trajectory-display-mode-bg, rgba(255, 255, 255, 0.05));
  }
  .display-mode:hover:not(:disabled) {
    background: var(--trajectory-display-mode-hover-bg, #6b7280);
  }
  .fullscreen-button {
    min-width: 28px;
    height: 28px;
    background: var(--trajectory-fullscreen-bg, rgba(255, 255, 255, 0.05));
  }
  .fullscreen-button:hover:not(:disabled) {
    background: var(--trajectory-fullscreen-hover-bg, rgba(255, 255, 255, 0.1));
  }
  .info-button {
    width: 28px;
    height: 28px;
    min-width: 28px;
    border-radius: 50%;
    background: var(--trajectory-info-bg, #4b5563);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .info-button:hover:not(:disabled) {
    background: var(--trajectory-info-hover-bg, #6b7280);
  }
  .info-button.active {
    background: var(--trajectory-info-active-bg, #3b82f6);
  }
  .info-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--traj-text, #e2e8f0);
    margin-left: auto;
  }

  .play-button {
    background: var(--trajectory-play-button-bg, #6b7280);
    min-width: 36px;
    font-size: 0.9rem;
  }
  .play-button:hover:not(:disabled) {
    background: var(--trajectory-play-button-hover-bg, #7f8793);
  }
  .play-button.playing {
    background: var(--trajectory-pause-button-bg, #6b7280);
  }
  .play-button.playing:hover:not(:disabled) {
    background: var(--trajectory-pause-button-hover-bg, #9ca3af);
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    color: var(--trajectory-text-color, #24292e);
  }
  .drop-zone {
    text-align: center;
    padding: 3rem;
    border: 2px dashed var(--trajectory-dropzone-border, #ccc);
    border-radius: 8px;
    background: var(--trajectory-dropzone-bg, #f9f9f9);
    color: var(--trajectory-text-color, #24292e);
    max-width: 500px;
  }
  .drop-zone h3 {
    color: var(--trajectory-heading-color, var(--trajectory-text-color, #24292e));
    margin-bottom: 1rem;
  }
  .supported-formats {
    margin-top: 1.5rem;
    text-align: left;
  }
  .supported-formats strong {
    color: var(--trajectory-text-color, #24292e);
  }
  .supported-formats ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }
  .supported-formats li {
    color: var(--trajectory-text-muted, #586069);
  }
  button {
    background: var(--traj-border-bg, #4a5568);
    color: var(--traj-text, #e2e8f0);
    border: none;
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font-size: 0.85rem;
    min-width: 2rem;
    transition: background-color 0.2s;
  }
  button:hover:not(:disabled) {
    background: var(--traj-surface-hover, #4a5568);
  }
  button:disabled {
    background: var(--traj-text-muted, #a0aec0);
    color: var(--traj-border-bg, #4a5568);
    cursor: not-allowed;
  }
  /* Hide number input spinner arrows */
  .trajectory-controls input[type='number']::-webkit-outer-spin-button,
  .trajectory-controls input[type='number']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  /* Responsive design */
  @media (max-width: 768px) {
    /* On small screens, force vertical layout for content area regardless of viewport aspect ratio */
    .trajectory-viewer.horizontal .content-area {
      grid-template-columns: 1fr !important;
      grid-template-rows: 1fr 1fr !important;
    }
    /* Override for when plot is hidden */
    .trajectory-viewer.horizontal .content-area.hide-plot {
      grid-template-rows: 1fr !important;
    }
  }
  /* Additional responsive breakpoints for auto layout */
  @media (orientation: portrait) and (max-width: 1024px) {
    /* Force vertical layout on portrait tablets and phones */
    .trajectory-viewer .content-area {
      grid-template-columns: 1fr !important;
      grid-template-rows: 1fr 1fr !important;
    }
  }

  /* View mode dropdown styles */
  .view-mode-dropdown-wrapper {
    position: relative;
    display: inline-block;
    padding: 2pt 0 2pt 6pt;
  }
  .view-mode-button {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 50px;
    max-width: 120px;
    background: var(--trajectory-view-mode-bg, rgba(255, 255, 255, 0.05));
    overflow: hidden;
  }
  .view-mode-button:hover:not(:disabled) {
    background: var(--trajectory-view-mode-hover-bg, #6b7280);
  }
  .view-mode-button.active {
    background: var(--trajectory-view-mode-active-bg, #4b5563);
  }
  .view-mode-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    background: var(--traj-surface, rgba(45, 55, 72, 0.95));
    backdrop-filter: blur(4px);
    border: 1px solid var(--traj-border, rgba(74, 85, 104, 0.7));
    border-radius: 4px;
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.3), 0 4px 8px -2px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    margin-top: 2px;
    min-width: 180px;
  }
  .view-mode-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px;
    background: transparent;
    border: none;
    border-radius: 0;
    text-align: left;
    color: var(--traj-text, #e2e8f0);
    font-size: 0.8rem;
    line-height: 1.2;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  .view-mode-option:first-child {
    border-top-left-radius: 3px;
    border-top-right-radius: 3px;
  }
  .view-mode-option:last-child {
    border-bottom-left-radius: 3px;
    border-bottom-right-radius: 3px;
  }
  .view-mode-option:hover {
    background: var(--traj-surface-hover, rgba(74, 85, 104, 0.3));
  }
  .view-mode-option.selected {
    background: var(--traj-accent, rgba(99, 179, 237, 0.2));
    color: var(--traj-accent-text, #a8d8f0);
  }
  .view-mode-option span {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
</style>

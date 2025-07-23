<script lang="ts">
  import { Icon, Spinner, Structure } from '$lib'
  import { decompress_file, handle_url_drop, load_from_url } from '$lib/io'
  import { format_num, trajectory_property_config } from '$lib/labels'
  import type { DataSeries, Point } from '$lib/plot'
  import { Histogram, ScatterPlot } from '$lib/plot'
  import { scaleLinear } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import { full_data_extractor } from './extract'
  import type {
    TrajectoryDataExtractor,
    TrajectoryType,
    TrajHandlerData,
  } from './index'
  import { TrajectoryError, TrajectoryInfoPanel } from './index'
  import type { ParseProgress } from './parse'
  import { get_unsupported_format_message, parse_trajectory_async } from './parse'
  import {
    generate_axis_labels,
    generate_plot_series,
    should_hide_plot,
    toggle_series_visibility,
  } from './plotting'

  type EventHandlers = {
    on_play?: (data: TrajHandlerData) => void
    on_pause?: (data: TrajHandlerData) => void
    on_step_change?: (data: TrajHandlerData) => void
    on_end?: (data: TrajHandlerData) => void
    on_loop?: (data: TrajHandlerData) => void
    on_frame_rate_change?: (data: TrajHandlerData) => void
    on_display_mode_change?: (data: TrajHandlerData) => void
    on_fullscreen_change?: (data: TrajHandlerData) => void
    on_file_load?: (data: TrajHandlerData) => void
    on_error?: (data: TrajHandlerData) => void
  }

  interface Props extends EventHandlers {
    // trajectory data - can be provided directly or loaded from file
    trajectory?: TrajectoryType | undefined
    // URL to load trajectory from (alternative to providing trajectory directly)
    data_url?: string
    // current step index being displayed
    current_step_idx?: number
    // custom function to extract plot data from trajectory frames
    data_extractor?: TrajectoryDataExtractor
    // file drop handlers
    allow_file_drop?: boolean
    on_file_drop?: (
      content: string | ArrayBuffer,
      filename: string,
    ) => Promise<void> | void
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
          trajectory: TrajectoryType
          current_step_idx: number
          total_frames: number
          on_step_change: (idx: number) => void
        },
      ]
    >
    // Custom error snippet for advanced error handling
    error_snippet?: Snippet<[{ error_msg: string; on_dismiss: () => void }]>

    show_controls?: boolean // show/hide the trajectory controls bar
    // show/hide the fullscreen button
    show_fullscreen_button?: boolean
    // automatically start playing when trajectory data is loaded
    auto_play?: boolean
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
    fps_range?: [number, number] // allowed FPS range [min_fps, max_fps]
    fps?: number // frame rate for playback
    [key: string]: unknown
  }
  let {
    trajectory = $bindable(undefined),
    data_url,
    current_step_idx = $bindable(0),
    data_extractor = full_data_extractor,
    allow_file_drop = true,
    on_file_drop = load_trajectory_data,
    layout = `auto`,
    structure_props = {},
    scatter_props = {},
    histogram_props = {},
    spinner_props = {},
    trajectory_controls,
    error_snippet,
    show_controls = true,
    show_fullscreen_button = true,
    auto_play = false,
    display_mode = $bindable(`structure+scatter`),
    step_labels = 5,
    on_play,
    on_pause,
    on_step_change,
    on_end,
    on_loop,
    on_frame_rate_change,
    on_display_mode_change,
    on_fullscreen_change,
    on_file_load,
    on_error,
    fps_range = [0.2, 30],
    fps = $bindable(5),
    ...rest
  }: Props = $props()

  let dragover = $state(false)
  let loading = $state(false)
  let error_msg = $state<string | null>(null)
  let is_playing = $state(false)
  let play_interval: ReturnType<typeof setInterval> | undefined = $state(undefined)

  // Ensure fps is within the allowed range
  $effect(() => {
    if (fps < fps_range[0]) {
      fps = fps_range[0]
    } else if (fps > fps_range[1]) {
      fps = fps_range[1]
    }
  })
  let current_filename = $state<string | null>(null)
  let current_file_path = $state<string | null>(null)
  let file_size = $state<number | null>(null)
  let file_object = $state<File | null>(null)
  let wrapper = $state<HTMLDivElement | undefined>(undefined)
  let info_panel_open = $state(false)
  let parsing_progress = $state<ParseProgress | null>(null)
  let viewport = $state({ width: 0, height: 0 })

  // Reactive layout based on viewport aspect ratio
  let actual_layout = $derived.by((): `horizontal` | `vertical` => {
    if (layout === `horizontal` || layout === `vertical`) return layout
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

  let step_label_positions = $derived.by((): number[] => {
    if (!trajectory?.frames.length || !step_labels) return []

    const total = trajectory.frames.length
    if (total <= 1) return []

    if (Array.isArray(step_labels)) {
      return step_labels.filter((idx) => idx >= 0 && idx < total)
    }

    if (typeof step_labels === `number`) {
      if (step_labels > 0) {
        return scaleLinear().domain([0, total - 1]).nice()
          .ticks(Math.min(step_labels, total))
          .map((t) => Math.round(t))
          .filter((t, i, arr) => t >= 0 && t < total && arr.indexOf(t) === i)
      }
      if (step_labels < 0) {
        const spacing = Math.abs(step_labels)
        const positions = Array.from(
          { length: Math.ceil(total / spacing) },
          (_, idx) => idx * spacing,
        )
        return positions[positions.length - 1] === total - 1
          ? positions
          : [...positions, total - 1]
      }
    }
    return []
  })

  // Generate plot data
  let plot_series = $derived(
    trajectory
      ? generate_plot_series(trajectory, data_extractor, {
        property_config: trajectory_property_config,
      })
      : [],
  )

  // hide plot if all plotted values are constant (no variation)
  let show_plot = $derived(
    display_mode !== `structure` && !should_hide_plot(trajectory, plot_series),
  )

  // Determine what to show based on display mode
  let show_structure = $derived(![`scatter`, `histogram`].includes(display_mode))
  let actual_show_plot = $derived(display_mode !== `structure` && show_plot)

  // Generate axis labels based on first visible series on each axis
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

    // --- Handle URL-based files (e.g. from FilePicker)
    loading = true
    error_msg = null

    const handled = await handle_url_drop(event, async (content, filename) => {
      current_filename = filename
      file_size = content instanceof ArrayBuffer
        ? content.byteLength
        : new Blob([content]).size
      await load_trajectory_data(content, filename)
    }).catch(() => false)

    if (handled) {
      loading = false
      return
    }

    // --- Handle file system drops
    const file = event.dataTransfer?.files[0]
    if (file) {
      file_size = file.size
      current_file_path = file.webkitRelativePath || file.name
      file_object = file

      const { content, filename } = await decompress_file(file)
      if (content) await on_file_drop(content, filename)
    }
    loading = false
  }

  // Step navigation functions
  function next_step() {
    if (trajectory && current_step_idx < trajectory.frames.length - 1) {
      current_step_idx++
      on_step_change?.({
        trajectory,
        step_idx: current_step_idx,
        frame_count: trajectory.frames.length,
        frame: trajectory.frames[current_step_idx],
      })
    }
  }

  function prev_step() {
    if (current_step_idx > 0) {
      current_step_idx--
      on_step_change?.({
        trajectory,
        step_idx: current_step_idx,
        frame_count: trajectory?.frames.length ?? 0,
        frame: (trajectory?.frames ?? [])[current_step_idx],
      })
    }
  }

  function go_to_step(idx: number) {
    if (trajectory && idx >= 0 && idx < trajectory.frames.length) {
      current_step_idx = idx
      on_step_change?.({
        trajectory,
        step_idx: current_step_idx,
        frame_count: trajectory.frames.length,
        frame: trajectory.frames[current_step_idx],
      })
    }
  }

  // Handle plot point clicks to jump to that step
  function handle_plot_change(data: (Point & { series: DataSeries }) | null) {
    if (data?.x !== undefined && typeof data.x === `number`) {
      go_to_step(Math.round(data.x))
    }
  }

  // Handle legend toggling
  function handle_legend_toggle(series_idx: number): void {
    plot_series = toggle_series_visibility(plot_series, series_idx)
  }

  // Legend configuration
  let legend_config = $derived({
    responsive: true,
    layout: `horizontal`,
    layout_tracks: 3,
    item_gap: 0,
    padding: { t: 5, b: 5, l: 5, r: 5 },
    ...scatter_props?.legend,
    on_toggle: scatter_props?.legend?.on_toggle ?? handle_legend_toggle,
  })

  // Play/pause functionality
  function toggle_play() {
    if (is_playing) pause_playback()
    else start_playback()
  }
  function start_playback() {
    if (!trajectory || trajectory.frames.length <= 1) return
    is_playing = true
    on_play?.({
      trajectory,
      step_idx: current_step_idx,
      frame_count: trajectory.frames.length,
    })
  }
  function pause_playback() {
    is_playing = false
    on_pause?.({
      trajectory: trajectory!,
      step_idx: current_step_idx,
      frame_count: trajectory!.frames.length,
    })
  }
  $effect(() => { // Effect to manage playback interval
    // Only watch is_playing and frame_rate_ms, not play_interval itself
    const playing = is_playing
    const rate_ms = 1000 / fps

    if (playing) {
      // Clear existing interval if it exists - use untrack to avoid circular dependency
      const current_interval = untrack(() => play_interval)
      if (current_interval !== undefined) clearInterval(current_interval)

      // Create new interval with current frame rate
      play_interval = setInterval(() => {
        if (current_step_idx >= trajectory!.frames.length - 1) {
          on_end?.({
            trajectory: trajectory!,
            step_idx: current_step_idx,
            frame_count: trajectory!.frames.length,
            frame: trajectory!.frames[current_step_idx],
          })
          go_to_step(0) // Loop back to 1st step
          on_loop?.({
            trajectory: trajectory!,
            frame_count: trajectory!.frames.length,
          })
        } else next_step()
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
  $effect(() => () => {
    if (play_interval !== undefined) clearInterval(play_interval)
  })

  $effect(() => { // Load trajectory from URL when data_url is provided
    if (data_url && !trajectory) {
      loading = true
      error_msg = null

      load_from_url(data_url, async (content, filename) => {
        current_filename = filename
        file_size = content instanceof ArrayBuffer
          ? content.byteLength
          : new Blob([content]).size
        await load_trajectory_data(content, filename)
      })
        .then(() => {
          loading = false
        })
        .catch((err: Error) => {
          console.error(`Failed to load trajectory from URL:`, err)
          error_msg = `Failed to load trajectory: ${err.message}`
          current_filename = null
          file_size = null
          loading = false
          on_error?.({
            error_msg,
            filename: current_filename || undefined,
            file_size: file_size || undefined,
          })
        })
    }
  })

  // Watch for frame rate changes
  $effect(() => {
    on_frame_rate_change?.({ trajectory, fps: fps })
  })

  async function load_trajectory_data(data: string | ArrayBuffer, filename: string) {
    loading = true
    error_msg = null
    parsing_progress = null

    try {
      trajectory = await parse_trajectory_async(data, filename, (progress) => {
        parsing_progress = progress
      })
      current_step_idx = 0
      current_filename = filename

      const file_size_bytes = data instanceof ArrayBuffer
        ? data.byteLength
        : new Blob([data]).size
      on_file_load?.({ // emit file load event
        trajectory,
        frame_count: trajectory.frames.length,
        total_atoms: trajectory.frames[0]?.structure.sites.length || 0,
        filename,
        file_size: file_size_bytes,
      })

      // Auto-play if enabled and trajectory has multiple frames
      if (auto_play && trajectory.frames.length > 1) start_playback()
    } catch (err) {
      const unsupported_message = get_unsupported_format_message(
        filename,
        typeof data === `string` ? data : ``,
      )
      error_msg = unsupported_message || `Failed to parse trajectory: ${err}`
      current_filename = null
      file_size = null

      on_error?.({ // emit error event
        error_msg,
        filename: current_filename || undefined,
        file_size: file_size || undefined,
      })
    } finally {
      parsing_progress = null
      loading = false
    }
  }

  function toggle_fullscreen() {
    if (!document.fullscreenElement && wrapper) {
      wrapper.requestFullscreen().catch(console.error)
    } else document.exitFullscreen()
  }

  // Get current view mode label
  let current_view_label = $derived.by(() => {
    if (display_mode === `structure`) return `Structure Only`
    if (display_mode === `scatter`) return `Scatter Only`
    if (display_mode === `histogram`) return `Histogram Only`
    if (display_mode === `structure+histogram`) return `Structure + Histogram`
    if (display_mode === `structure+scatter`) return `Structure + Scatter`
    throw new Error(`Unexpected display mode: ${display_mode}`)
  })

  let view_mode_dropdown_open = $state(false)

  // Handle click outside to close dropdowns
  function handle_click_outside(event: MouseEvent) {
    const target = event.target as Element
    if (view_mode_dropdown_open) {
      const dropdown_wrapper = target.closest(`.view-mode-dropdown-wrapper`)
      // Don't close if clicking on dropdown wrapper (contains both button and menu)
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
    // 'i' key handled by the TrajectoryInfoPanel's built-in toggle
    // Playback speed shortcuts (only when playing)
    else if ((event.key === `=` || event.key === `+`) && is_playing) {
      fps = Math.min(fps_range[1], fps + 0.2)
      on_frame_rate_change?.({ trajectory, fps: fps })
    } else if (event.key === `-` && is_playing) {
      fps = Math.max(fps_range[0], fps - 0.2)
      on_frame_rate_change?.({ trajectory, fps: fps })
    } // System shortcuts
    else if (event.key === `Escape`) {
      if (document.fullscreenElement) document.exitFullscreen()
      else if (view_mode_dropdown_open) view_mode_dropdown_open = false
      // Escape key for info panel handled by DraggablePanel
    } // Number keys 0-9 - jump to percentage of trajectory
    else if (event.key >= `0` && event.key <= `9`) {
      go_to_step(Math.floor((parseInt(event.key, 10) / 10) * (total_frames - 1)))
    }
  }

  let panels_open = $state({
    structure_info: false,
    structure_controls: false,
    plot_controls: false,
  })
  let fullscreen = $state(false)
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = !!document.fullscreenElement
    on_fullscreen_change?.({ trajectory, is_fullscreen: fullscreen })
  }}
/>

<div
  class:dragover
  class:active={is_playing || panels_open.structure_info || panels_open.structure_controls ||
  panels_open.plot_controls}
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
  {...rest}
  class="trajectory {actual_layout} {rest.class ?? ``}"
>
  {#if loading}
    {@const text = parsing_progress
      ? `${parsing_progress.stage} (${parsing_progress.current}%)`
      : `Loading trajectory...`}
    <Spinner {text} {...spinner_props} />
  {:else if error_msg}
    <TrajectoryError
      {error_msg}
      on_dismiss={() => (error_msg = null)}
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
            <button
              class="filename"
              title="Click to copy filename <code>{current_filename}</code>"
              {@attach tooltip()}
              onclick={() => {
                if (current_filename) navigator.clipboard.writeText(current_filename)
              }}
            >
              {current_filename}
            </button>
          {/if}

          <!-- Navigation controls -->
          <div class="nav-section">
            <button
              onclick={prev_step}
              disabled={current_step_idx === 0 || is_playing}
              title="Previous step"
            >
              ⏮
            </button>
            <button
              onclick={toggle_play}
              disabled={trajectory.frames.length <= 1}
              title={is_playing ? `Pause playback` : `Play trajectory`}
              class="play-button"
              class:playing={is_playing}
            >
              {is_playing ? `⏸` : `▶`}
            </button>
            <button
              onclick={next_step}
              disabled={current_step_idx === trajectory.frames.length - 1 || is_playing}
              title="Next step"
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
            <span style="font-size: clamp(0.7rem, 2cqw, 0.875rem)">/ {
                trajectory.frames.length
              }</span>
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
              <label
                for="step-rate-slider"
                style="font-weight: 500; white-space: nowrap; font-size: clamp(0.7rem, 2cqw, 0.875rem)"
              >Speed:</label>
              <input
                id="step-rate-slider"
                type="range"
                min={fps_range[0]}
                max={fps_range[1]}
                step="0.1"
                bind:value={fps}
                class="speed-slider"
                title="Frame rate: {format_num(fps, `.2~s`)} fps"
              />
              <input
                type="number"
                min={fps_range[0]}
                max={fps_range[1]}
                step="0.1"
                bind:value={fps}
                class="speed-input"
                title="Enter precise FPS value"
              />
              <span style="font-size: clamp(0.7rem, 2cqw, 0.875rem)">fps</span>
            </div>
          {/if}

          <!-- Frame info section -->
          <div class="info-section">
            {#if trajectory}
              <TrajectoryInfoPanel
                {trajectory}
                {current_step_idx}
                {current_filename}
                {current_file_path}
                {file_size}
                {file_object}
                bind:panel_open={info_panel_open}
                toggle_props={{ style: `width: 1em` }}
              />
            {/if}
            <!-- Display mode dropdown -->
            {#if plot_series.length > 0}
              <div class="view-mode-dropdown-wrapper">
                <button
                  onclick={() => (view_mode_dropdown_open = !view_mode_dropdown_open)}
                  title={current_view_label}
                  class="view-mode-button"
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
                          on_display_mode_change?.({ trajectory, mode: option.mode })
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
                title="{fullscreen ? `Exit` : `Enter`} fullscreen"
                aria-label="{fullscreen ? `Exit` : `Enter`} fullscreen"
                class="fullscreen-button"
              >
                <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
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
      class:show-both={[`structure+scatter`, `structure+histogram`].includes(display_mode)}
      class:show-structure-only={display_mode === `structure`}
      class:show-plot-only={[`scatter`, `histogram`].includes(display_mode)}
    >
      {#if show_structure}
        <Structure
          structure={current_structure}
          allow_file_drop={false}
          style="height: 100%; border-radius: 0"
          enable_tips={false}
          {...{ show_image_atoms: false, ...structure_props }}
          bind:controls_open={panels_open.structure_controls}
          bind:info_panel_open={panels_open.structure_info}
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
            bind:controls_open={panels_open.plot_controls}
            padding={{ t: 20, b: 60, l: 100, r: has_y2_series ? 100 : 20 }}
            range_padding={0}
            style="height: 100%"
            legend={legend_config}
            {...scatter_props}
            class="plot {scatter_props.class ?? ``}"
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
            x_label={String(histogram_props.x_label ?? y_axis_labels.y1)}
            y_label={(`y_label` in histogram_props) ? histogram_props.y_label as string : `Count`}
            mode={(`mode` in histogram_props)
            ? histogram_props.mode as `overlay` | `single`
            : `overlay`}
            show_legend={(`show_legend` in histogram_props)
            ? histogram_props.show_legend as boolean
            : (plot_series.length > 1)}
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
            class="plot {histogram_props.class ?? ``}"
            --ctrl-btn-top="6ex"
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
      <h3>Load Trajectory</h3>
      <p>
        Drop a trajectory file here (.xyz, .extxyz, .json, .json.gz, XDATCAR, .traj, .h5)
        or provide trajectory data via props
      </p>
      <strong style="display: block; margin-block: 1em 1ex">Supported formats:</strong>
      <ul>
        <li>Multi-frame XYZ trajectory files (.xyz, .extxyz)</li>
        <li>ASE trajectory files (.traj)</li>
        <li>Pymatgen trajectory JSON</li>
        <li>Array of structures with metadata</li>
        <li>VASP XDATCAR files</li>
        <li>HDF5 trajectory files (.h5, .hdf5)</li>
        <li>Compressed files (.gz)</li>
      </ul>
      <p>
        💡 Force vectors will be automatically displayed when present in trajectory data
      </p>
    </div>
  {/if}
</div>

<style>
  :root {
    --border-radius: 4px;
    --min-height: 500px;
  }
  .trajectory {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    min-height: var(--traj-min-height, var(--min-height));
    border-radius: var(--border-radius);
    transition: border-color 0.2s ease;
    box-sizing: border-box;
    contain: layout;
  }
  .trajectory :global(.plot) {
    background: var(--surface-bg);
  }
  .trajectory.active {
    z-index: 2; /* needed so info/control panels from an active viewer overlay those of the next (if there is one) */
  }
  .trajectory:fullscreen {
    height: 100vh !important;
    width: 100vw !important;
    border-radius: 0 !important;
    background: var(--surface-bg);
  }
  /* Content area - grid container for equal sizing */
  .content-area {
    display: grid;
    flex: 1;
  }
  .trajectory.horizontal .content-area {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr;
  }
  .trajectory.vertical .content-area {
    grid-template-columns: 1fr;
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
  .trajectory.horizontal .content-area.show-structure-only,
  .trajectory.vertical .content-area.show-structure-only {
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr !important;
  }
  .trajectory.horizontal .content-area.show-plot-only,
  .trajectory.vertical .content-area.show-plot-only {
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr !important;
  }
  .trajectory.dragover {
    background-color: var(--traj-dragover-bg, var(--dragover-bg));
    border: var(--traj-dragover-border, var(--dragover-border));
  }

  .trajectory-controls {
    display: flex;
    align-items: center;
    gap: clamp(2pt, 1cqw, 1ex);
    padding: clamp(2pt, 0.5cqw, 1ex);
    z-index: var(--traj-controls-z-index, 3);
    background: var(--surface-bg-hover);
    backdrop-filter: blur(4px);
    position: relative;
    border-radius: var(--border-radius) var(--border-radius) 0 0;
    container-type: inline-size;
  }
  .trajectory-controls button {
    background: var(--btn-bg);
  }
  .trajectory-controls button:hover {
    background: var(--btn-hover-bg);
  }
  .nav-section {
    display: flex;
    align-items: center;
    gap: clamp(1pt, 0.5cqw, 5pt);
  }
  .step-section {
    display: flex;
    align-items: center;
    gap: clamp(0.25rem, 1.5cqw, 0.5rem);
    flex: 1;
    min-width: 0;
  }
  .step-input {
    border: 1px solid rgba(99, 179, 237, 0.3);
    text-align: center;
    margin: 0 -5px 0 0;
  }
  .slider-container {
    position: relative;
    flex: 1;
    min-width: 100px;
  }
  .step-slider {
    width: 100%;
    accent-color: var(--accent-color);
  }
  .step-labels {
    position: absolute;
    left: 0;
    right: 0;
  }
  .step-tick {
    position: absolute;
    transform: translateX(-50%);
    width: 1px;
    height: 4px;
    background: var(--text-color-muted);
    top: -9pt;
  }
  .step-label {
    position: absolute;
    transform: translateX(-50%);
    font-size: clamp(0.5rem, 1.2cqw, 0.65rem);
    color: var(--text-color-muted);
    white-space: nowrap;
    text-align: center;
    top: -1.7ex;
  }
  .speed-slider {
    width: clamp(60px, 8cqw, 90px);
    accent-color: var(--accent-color);
  }
  .speed-input {
    width: clamp(35px, 4cqw, 45px);
    text-align: center;
    border: 1px solid rgba(99, 179, 237, 0.3);
    box-sizing: border-box;
  }
  .speed-section {
    display: flex;
    align-items: center;
    gap: clamp(0.125rem, 0.75cqw, 0.25rem);
  }
  button.filename {
    align-items: center;
    white-space: nowrap;
    padding: clamp(0.125rem, 0.5cqw, 0.375rem);
    border-radius: 2px;
    max-width: clamp(150px, 20cqw, 250px);
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-block;
    font-size: clamp(0.75rem, 2cqw, 0.875rem);
  }
  .fullscreen-button {
    background: transparent;
  }
  .fullscreen-button:hover:not(:disabled) {
    background: var(--border-color);
  }
  .info-section {
    display: flex;
    place-items: center;
    gap: clamp(3pt, 0.5cqw, 1ex);
  }

  .play-button {
    min-width: clamp(32px, 4cqw, 36px);
    font-size: clamp(0.8rem, 2.5cqw, 0.9rem);
  }
  .play-button:hover:not(:disabled) {
    background: var(--traj-play-button-hover-bg, #7f8793);
  }
  .play-button.playing {
    background: var(--traj-pause-button-bg, #6b7280);
  }
  .play-button.playing:hover:not(:disabled) {
    background: var(--traj-pause-button-hover-bg, #9ca3af);
  }

  .empty-state {
    padding: 2rem;
    border-radius: var(--border-radius);
    background: var(--dropzone-bg);
  }
  .empty-state :where(p, ul) {
    color: var(--text-color-muted);
  }
  .empty-state :where(h3, p, ul, li, strong) {
    max-width: 500px;
    margin-inline: auto;
  }
  .supported-formats {
    margin-top: 1.5rem;
    text-align: left;
  }
  .supported-formats ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }
  .supported-formats li {
    color: var(--text-color-muted);
  }
  button:hover:not(:disabled) {
    background: var(--border-color);
  }
  button:disabled {
    background: var(--btn-disabled-bg);
    color: var(--text-color-muted);
    cursor: not-allowed;
  }
  .trajectory-controls input[type='number']::-webkit-outer-spin-button,
  .trajectory-controls input[type='number']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  /* Responsive design */
  @media (orientation: portrait) {
    .trajectory .content-area.show-both:not(.hide-plot):not(.hide-structure) {
      grid-template-columns: 1fr !important;
      grid-template-rows: 1fr 1fr !important;
    }
  }
  .view-mode-dropdown-wrapper {
    display: flex;
    position: relative;
  }
  .view-mode-dropdown {
    position: absolute;
    top: 115%;
    right: 0;
    background: var(--surface-bg);
    border-radius: 4px;
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.3), 0 4px 8px -2px rgba(0, 0, 0, 0.1);
  }
  .view-mode-option {
    display: flex;
    align-items: center;
    gap: 1ex;
    width: 100%;
    padding: 5pt;
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
</style>

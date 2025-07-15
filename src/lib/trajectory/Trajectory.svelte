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
  import type { Trajectory, TrajectoryDataExtractor } from './index'
  import { TrajectoryError, TrajectoryInfoPanel } from './index'
  import type { ParseProgress } from './parse'
  import { get_unsupported_format_message, parse_trajectory_async } from './parse'
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
          trajectory: Trajectory
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
    display_mode = $bindable(`structure+scatter`),
    step_labels = 5,
    ...rest
  }: Props = $props()

  let dragover = $state(false)
  let loading = $state(false)
  let error_msg = $state<string | null>(null)
  let is_playing = $state(false)
  let frame_rate_fps = $state(5)
  let play_interval: ReturnType<typeof setInterval> | undefined = $state(undefined)
  let current_filename = $state<string | null>(null)
  let current_file_path = $state<string | null>(null)
  let file_size = $state<number | null>(null)
  let file_object = $state<File | null>(null)
  let wrapper = $state<HTMLDivElement | undefined>(undefined)
  let info_panel_open = $state(false)
  let parsing_progress = $state<ParseProgress | null>(null)
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

    // Handle URL-based files from FileCarousel
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

    // Handle file system drops
    const file = event.dataTransfer?.files[0]
    if (file) {
      file_size = file.size
      current_file_path = file.webkitRelativePath || file.name
      file_object = file

      // Binary trajectory files
      if (/\.(h5|hdf5|traj)$/i.test(file.name)) {
        const buffer = await file.arrayBuffer()
        await load_trajectory_data(buffer, file.name)
      } else {
        const { content, filename } = await decompress_file(file)
        if (content) await on_file_drop(content, filename)
      }
    }
    loading = false
  }

  // Step navigation functions
  function next_step() {
    if (trajectory && current_step_idx < trajectory.frames.length - 1) {
      current_step_idx++
    }
  }

  function prev_step() {
    if (current_step_idx > 0) current_step_idx--
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
        })
    }
  })

  // Consolidated trajectory loading function
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
    } catch (err) {
      const unsupported_message = typeof data === `string`
        ? get_unsupported_format_message(filename, data)
        : null
      error_msg = unsupported_message || `Failed to parse trajectory: ${err}`
      current_filename = null
      file_size = null
    } finally {
      parsing_progress = null
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
    if (display_mode === `structure+histogram`) return `Structure + Histogram`
    if (display_mode === `structure+scatter`) return `Structure + Scatter`
    throw new Error(`Unexpected display mode: ${display_mode}`)
  })

  let view_mode_dropdown_open = $state(false)

  // Handle click outside to close dropdowns
  function handle_click_outside(event: MouseEvent) {
    const target = event.target as Element

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
    // 'i' key handled by the TrajectoryInfoPanel's built-in toggle
    // Playback speed shortcuts (only when playing)
    else if ((event.key === `=` || event.key === `+`) && is_playing) {
      frame_rate_fps = Math.min(30, frame_rate_fps + 0.2)
    } else if (event.key === `-` && is_playing) {
      frame_rate_fps = Math.max(0.2, frame_rate_fps - 0.2)
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

  let controls_open = $state({ structure: false, plot: false })
  let fullscreen = $state(false)
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = !!document.fullscreenElement
  }}
/>

<div
  class:dragover
  class:active={is_playing || controls_open.structure || controls_open.plot}
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
            {#if trajectory}
              <TrajectoryInfoPanel
                {trajectory}
                {current_step_idx}
                {current_filename}
                {current_file_path}
                {file_size}
                {file_object}
                bind:panel_open={info_panel_open}
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
            x_label={(`x_label` in histogram_props) ? histogram_props.x_label as string : `Value`}
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
    --traj-border-radius: 8px;
    --traj-min-height: 500px;
  }
  .trajectory {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    min-height: var(--traj-min-height);
    border-radius: var(--traj-border-radius);
    border: 1px solid var(--traj-border-color);
    transition: border-color 0.2s ease;
    box-sizing: border-box;
    contain: layout;
  }
  .trajectory.active {
    /* needed so info/control panels from an active viewer overlay those of the next (if there is one) */
    z-index: 2;
  }
  .trajectory:fullscreen {
    height: 100vh !important;
    width: 100vw !important;
    border-radius: 0 !important;
    border: none;
    background: var(--traj-surface);
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
    border-color: var(--traj-dragover-border);
    background-color: var(--traj-dragover-bg);
  }

  .trajectory-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem;
    background: var(--traj-surface);
    backdrop-filter: blur(4px);
    border-bottom: 1px solid var(--traj-border, rgba(255, 255, 255, 0.1));
    position: relative;
    z-index: 100;
    border-radius: var(--traj-border-radius) var(--traj-border-radius) 0 0;
  }
  .nav-section {
    display: flex;
    align-items: center;
    gap: 0.25rem;
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
    accent-color: var(--traj-accent);
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
    background: var(--text-color-muted);
    top: -10px;
  }
  .step-label {
    position: absolute;
    transform: translateX(-50%);
    font-size: 0.65rem;
    color: var(--text-color-muted);
    white-space: nowrap;
    text-align: center;
    top: -6px;
  }
  .speed-slider {
    width: 90px;
    accent-color: var(--traj-accent);
  }
  .speed-input {
    width: 45px;
    text-align: center;
    border: 1px solid var(--traj-border-color);
    border-radius: 3px;
    font-size: 0.8rem;
    padding: 0.125rem 0.25rem;
    box-sizing: border-box;
  }
  .speed-section {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  button.filename {
    align-items: center;
    white-space: nowrap;
    padding: 0.125rem 0.375rem;
    border-radius: 2px;
    max-width: 250px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-block;
  }
  .display-mode {
    min-width: 28px;
    height: 28px;
    background: var(--traj-display-mode-bg, rgba(255, 255, 255, 0.05));
  }
  .display-mode:hover:not(:disabled) {
    background: var(--traj-display-mode-hover-bg, #6b7280);
  }
  .fullscreen-button {
    min-width: 28px;
    height: 28px;
    background: transparent;
  }
  .fullscreen-button:hover:not(:disabled) {
    background: var(--traj-border-color);
  }
  .info-section {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .play-button {
    min-width: 36px;
    font-size: 0.9rem;
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
    border: 2px dashed var(--traj-border-color);
    border-radius: var(--traj-border-radius);
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
  button {
    background: var(--traj-border-color);
    border: none;
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    min-width: 2rem;
    transition: background-color 0.2s;
  }
  button:hover:not(:disabled) {
    background: var(--traj-border-color);
  }
  button:disabled {
    background: var(--traj-text-muted);
    color: var(--traj-border-color);
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
    background: var(--traj-view-mode-bg, rgba(255, 255, 255, 0.05));
    overflow: hidden;
  }
  .view-mode-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    background: var(--traj-surface);
    backdrop-filter: blur(4px);
    border: 1px solid var(--traj-border-color);
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
    background: var(--traj-surface-hover);
  }
  .view-mode-option.selected {
    background: var(--traj-accent);
    color: var(--traj-accent-text);
  }
  .view-mode-option span {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
</style>

<script lang="ts">
  import type { ShowControlsProp } from '$lib/controls'
  import { normalize_show_controls } from '$lib/controls'
  import type { ElementSymbol } from '$lib/element'
  import EmptyState from '$lib/EmptyState.svelte'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import Icon from '$lib/Icon.svelte'
  import { handle_url_drop, load_from_url } from '$lib/io'
  import { format_num, trajectory_property_config } from '$lib/labels'
  import { toggle_fullscreen } from '$lib/layout'
  import type { ControlsConfig, DataSeries, Orientation, Point } from '$lib/plot'
  import { Histogram, ScatterPlot } from '$lib/plot'
  import { toggle_series_visibility } from '$lib/plot/utils/series-visibility'
  import { DEFAULTS } from '$lib/settings'
  import Structure from '$lib/structure/Structure.svelte'
  import { scaleLinear } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { full_data_extractor } from './extract'
  import type {
    ParseProgress,
    TrajectoryDataExtractor,
    TrajectoryFrame,
    TrajectoryType,
    TrajHandlerData,
  } from './index'
  import { TrajectoryError, TrajectoryExportPane, TrajectoryInfoPane } from './index'
  import type { AtomTypeMapping, LoadingOptions } from './parse'
  import {
    create_frame_loader,
    get_unsupported_format_message,
    MAX_BIN_FILE_SIZE,
    MAX_TEXT_FILE_SIZE,
    parse_trajectory_async,
  } from './parse'
  import {
    generate_axis_labels,
    generate_plot_series,
    generate_streaming_plot_series,
    should_hide_plot,
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
  type ControlsProps = {
    trajectory: TrajectoryType
    current_step_idx: number
    total_frames: number
    on_step_change: (idx: number) => void
  }

  let {
    trajectory = $bindable(),
    data_url,
    current_step_idx = $bindable(0),
    data_extractor = full_data_extractor,
    allow_file_drop = true,
    layout = `auto`,
    structure_props = {},
    scatter_props = {},
    histogram_props = {},
    spinner_props = {},
    trajectory_controls,
    error_snippet,
    show_controls,
    fullscreen_toggle = DEFAULTS.trajectory.fullscreen_toggle,
    auto_play = false,
    display_mode = $bindable(`structure+scatter`),
    step_labels = 5,
    visible_properties = $bindable(),
    ELEM_PROPERTY_LABELS,
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
    fps_range = DEFAULTS.trajectory.fps_range,
    fps = $bindable(5),
    loading_options = {},
    atom_type_mapping,
    plot_skimming = true,
    ...rest
  }: EventHandlers & HTMLAttributes<HTMLDivElement> & {
    // trajectory data - can be provided directly or loaded from file
    trajectory?: TrajectoryType
    // URL to load trajectory from (alternative to providing trajectory directly)
    data_url?: string
    // current step index being displayed
    current_step_idx?: number
    // custom function to extract plot data from trajectory frames
    data_extractor?: TrajectoryDataExtractor

    // file drop handlers
    allow_file_drop?: boolean
    // layout configuration - 'auto' (default) adapts to element size, 'horizontal'/'vertical' forces layout
    layout?: `auto` | Orientation
    // structure viewer props (passed to Structure component)
    structure_props?: ComponentProps<typeof Structure>
    // plot props (passed to ScatterPlot component)
    scatter_props?: ComponentProps<typeof ScatterPlot>
    // histogram props (passed to Histogram component, excluding series which is handled separately)
    histogram_props?: Omit<ComponentProps<typeof Histogram>, `series`>
    // spinner props (passed to Spinner component)
    spinner_props?: ComponentProps<typeof Spinner>
    // custom snippets for additional UI elements
    trajectory_controls?: Snippet<[ControlsProps]>
    // Custom error snippet for advanced error handling
    error_snippet?: Snippet<[{ error_msg: string; on_dismiss: () => void }]>
    // Controls visibility configuration.
    // - 'always': controls always visible
    // - 'hover': controls visible on component hover (default)
    // - 'never': controls never visible
    // - object: { mode, hidden, style } for fine-grained control
    // Control names: 'filename', 'nav', 'step', 'fps', 'info-pane', 'export-pane', 'view-mode', 'fullscreen'
    show_controls?: ShowControlsProp
    // show/hide the fullscreen button
    fullscreen_toggle?: Snippet<[{ fullscreen: boolean }]> | boolean
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
    // - negative number: spacing between ticks (e.g. -10 = every 10th step)
    // - array: exact step indices to label
    // - undefined: no labels
    step_labels?: number | number[]
    // visible properties - bindable array of property keys currently shown in the plot
    // - controls which trajectory properties are plotted (e.g. ['energy', 'volume', 'force_max'])
    // - bindable: reflects current visibility state and can be used for external control
    // - if not provided, uses default visible properties (energy, force_max, stress_frobenius)
    // - if specified properties don't exist in data, falls back to automatic selection
    visible_properties?: string[]
    // custom labels for trajectory properties - maps property keys to display labels
    // - e.g. {energy: 'Total Energy', volume: 'Cell Volume', force_max: 'Max Force'}
    // - merged with built-in trajectory_property_config
    ELEM_PROPERTY_LABELS?: Record<string, string>
    // units configuration - developers can override these (deprecated - use ELEM_PROPERTY_LABELS instead)
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
    // Loading options for large files
    loading_options?: LoadingOptions
    // Map LAMMPS atom types to element symbols (e.g. {1: 'Na', 2: 'Cl'})
    atom_type_mapping?: AtomTypeMapping
    // Disable plot skimming (mouse over plot doesn't update structure/step slider)
    plot_skimming?: boolean
  } = $props()

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
  let current_filename = $state<string | undefined>(undefined)
  let current_file_path = $state<string | null>(null)
  let file_size = $state<number | undefined>(undefined)
  let file_object = $state<File | null>(null)
  let wrapper = $state<HTMLDivElement | undefined>(undefined)
  let info_pane_open = $state(false)
  let parsing_progress = $state<ParseProgress | null>(null)
  let element_size = $state({ width: 0, height: 0 })
  let filename_copied = $state(false)
  let orig_data = $state<string | ArrayBuffer | null>(null)

  let controls_config = $derived(normalize_show_controls(show_controls))

  // Reactive layout based on element aspect ratio (for auto mode)
  let actual_layout = $derived.by(() => {
    if (layout === `horizontal` || layout === `vertical`) return layout
    // For auto layout, use element dimensions to determine orientation
    if (element_size.width > 0 && element_size.height > 0) {
      return element_size.width > element_size.height ? `horizontal` : `vertical`
    }
    return `horizontal` // Fallback to horizontal if dimensions not available yet
  })

  // Get total frame count (supports both regular and indexed trajectories)
  let total_frames = $derived(
    trajectory?.total_frames || trajectory?.frames.length || 0,
  )

  // Current frame - load on demand for indexed trajectories
  let current_frame = $state<TrajectoryFrame | null>(null)

  // Auto-play when trajectory changes (handles both props and file loading)
  $effect(() => {
    if (auto_play && trajectory && !untrack(() => is_playing) && total_frames > 1) {
      start_playback()
    }
  })

  // Update current frame when step changes
  $effect(() => {
    if (trajectory && current_step_idx >= 0 && current_step_idx < total_frames) {
      if (trajectory.frame_loader) {
        // Load frame on demand (works for both indexed files and external streaming)
        load_frame_on_demand(current_step_idx)
      } else {
        // Use in-memory frame for regular trajectories
        current_frame = trajectory.frames[current_step_idx] || null
      }
    } else {
      current_frame = null
    }
  })

  // Load frame on demand - works for both indexed files and external streaming
  async function load_frame_on_demand(frame_idx: number) {
    if (!trajectory?.frame_loader) return

    try {
      const frame = await trajectory.frame_loader.load_frame(
        orig_data || ``, // Use original_data for indexed files, empty string for external streaming
        frame_idx,
      )
      current_frame = frame
    } catch (error) {
      console.error(`Failed to load frame ${frame_idx}:`, error)
      current_frame = null
      on_error?.({
        error_msg: `Failed to load frame ${frame_idx}: ${error}`,
        filename: current_filename,
        file_size,
        step_idx: frame_idx,
        frame_count: total_frames,
      })
    }
  }

  // Current frame structure for display
  let current_structure = $derived(current_frame?.structure)

  // Track hidden elements (persists across frame changes)
  let hidden_elements = $state(new Set<ElementSymbol>())

  let step_label_positions = $derived.by((): number[] => {
    if (!step_labels || total_frames <= 1) return []

    if (Array.isArray(step_labels)) {
      return step_labels.filter((idx) => idx >= 0 && idx < total_frames)
    }

    if (typeof step_labels === `number`) {
      if (step_labels > 0) {
        return scaleLinear().domain([0, total_frames - 1]).nice()
          .ticks(Math.min(step_labels, total_frames))
          .map((t) => Math.round(t))
          .filter((t, i, arr) => t >= 0 && t < total_frames && arr.indexOf(t) === i)
      }
      if (step_labels < 0) {
        const spacing = Math.abs(step_labels)
        const positions = Array.from(
          { length: Math.ceil(total_frames / spacing) },
          (_, idx) => idx * spacing,
        )
        return positions.at(-1) === total_frames - 1
          ? positions
          : [...positions, total_frames - 1]
      }
    }
    return []
  })

  // Build extended property config with custom labels if provided
  let extended_config = $derived.by(() => {
    if (!ELEM_PROPERTY_LABELS) return trajectory_property_config

    const custom_config: Record<string, { label: string; unit: string }> = {}
    for (const [key, label] of Object.entries(ELEM_PROPERTY_LABELS)) {
      const existing = trajectory_property_config[key] ||
        trajectory_property_config[key.toLowerCase()]
      custom_config[key] = { label, unit: existing?.unit || `` }
    }
    return { ...trajectory_property_config, ...custom_config }
  })

  // Plot series state (not derived so we can update on legend toggle)
  let plot_series = $state<DataSeries[]>([])

  // Regenerate plot series when trajectory, config, or visible_properties change
  $effect(() => {
    const keys_set = visible_properties ? new Set(visible_properties) : undefined

    if (trajectory?.plot_metadata) {
      plot_series = generate_streaming_plot_series(trajectory.plot_metadata, {
        property_config: extended_config,
        default_visible_properties: keys_set,
      })
    } else if (trajectory) {
      plot_series = generate_plot_series(trajectory, data_extractor, {
        property_config: extended_config,
        default_visible_properties: keys_set,
      })
    } else {
      plot_series = []
    }
  })

  // Update visible_properties binding when user toggles series visibility in legend
  $effect(() => {
    if (!plot_series.length) return

    // Extract property keys from visible series metadata
    const visible_keys = plot_series
      .filter((srs) => srs.visible)
      // Get property key from series metadata (stored during series generation)
      .map((srs) => {
        const metadata = Array.isArray(srs.metadata) ? srs.metadata[0] : srs.metadata
        return metadata?.property_key
      })
      .filter((key): key is string => Boolean(key))

    // Only update if changed (use untrack to avoid circular dependency)
    const current = untrack(() => visible_properties) || []
    const has_changed = visible_keys.length !== current.length ||
      !visible_keys.every((key, idx) => key === current[idx])

    if (has_changed) {
      visible_properties = visible_keys
    }
  })

  // Handler for legend toggle - updates plot_series state
  function handle_legend_toggle(series_idx: number) {
    plot_series = toggle_series_visibility(plot_series, series_idx)
  }

  let x_axis = $derived({
    label: `Step`,
    format: `.3~s`,
    ticks: step_label_positions,
  })
  // Generate axis labels based on first visible series on each axis
  let y_axis_labels = $derived(generate_axis_labels(plot_series))
  let y_axis = $derived({
    label: y_axis_labels.y1,
    format: `.2~s`,
    label_shift: { y: 20 },
  })
  let y2_axis = $derived({
    label: y_axis_labels.y2,
    format: `.2~s`,
    label_shift: { y: 80 },
  })

  // hide plot if all plotted values are constant (no variation)
  let show_plot = $derived(
    display_mode !== `structure` && !should_hide_plot(trajectory, plot_series),
  )

  // Determine what to show based on display mode
  let show_structure = $derived(![`scatter`, `histogram`].includes(display_mode))
  let actual_show_plot = $derived(display_mode !== `structure` && show_plot)

  // Check if there are any Y2 series to determine padding
  let has_y2_series = $derived(
    plot_series.some((srs) => srs.y_axis === `y2` && srs.visible),
  )

  // Step navigation functions
  function next_step() {
    if (current_step_idx < total_frames - 1) {
      current_step_idx++
      // Streaming frame loading handled by reactive effect
      if (trajectory) {
        on_step_change?.({
          trajectory,
          step_idx: current_step_idx,
          frame_count: total_frames,
          frame: current_frame || undefined,
        })
      }
    }
  }

  function prev_step() {
    if (current_step_idx > 0) {
      current_step_idx--
      // Streaming frame loading handled by reactive effect
      if (trajectory) {
        on_step_change?.({
          trajectory,
          step_idx: current_step_idx,
          frame_count: total_frames,
          frame: current_frame || undefined,
        })
      }
    }
  }

  function go_to_step(idx: number) {
    if (idx >= 0 && idx < total_frames) {
      current_step_idx = idx
      // Note: streaming frame loading is handled by reactive effect
      // Handle callbacks for both traditional and streaming modes
      if (trajectory) {
        on_step_change?.({
          trajectory,
          step_idx: current_step_idx,
          frame_count: total_frames,
          frame: current_frame || undefined,
        })
      }
    }
  }

  // Handle plot point clicks to jump to that step
  function handle_plot_change(data: (Point & { series: DataSeries }) | null) {
    if (data?.x !== undefined && typeof data.x === `number`) {
      go_to_step(Math.round(data.x))
    }
  }

  // Helper function to read file content
  async function read_file_content(file: File): Promise<string | ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string | ArrayBuffer)
      reader.onerror = () => reject(new Error(`Failed to read file`))

      // Read as text for text-based formats, binary for others
      if (file.name.toLowerCase().match(/\.(xyz|json|extxyz|lammpstrj)$/)) {
        reader.readAsText(file)
      } else reader.readAsArrayBuffer(file)
    })
  }

  // Play/pause functionality
  function toggle_play() {
    if (is_playing) pause_playback()
    else start_playback()
  }
  function start_playback() {
    if (total_frames <= 1) return
    is_playing = true
    if (trajectory) {
      on_play?.({ trajectory, step_idx: current_step_idx, frame_count: total_frames })
    }
  }
  function pause_playback() {
    is_playing = false
    if (trajectory) {
      on_pause?.({
        trajectory: trajectory,
        step_idx: current_step_idx,
        frame_count: total_frames,
      })
    }
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
        if (current_step_idx >= total_frames - 1) {
          if (trajectory) {
            on_end?.({
              trajectory,
              step_idx: current_step_idx,
              frame_count: total_frames,
              frame: current_frame || undefined,
            })
          }
          go_to_step(0) // Loop back to 1st step
          if (trajectory) {
            on_loop?.({ trajectory, frame_count: total_frames })
          }
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

  // Handle internal file format drops
  async function handle_internal_file_drop(internal_data: string): Promise<boolean> {
    try {
      const file_info = JSON.parse(internal_data)

      // Check if this is a binary file
      if (file_info.is_binary) {
        if (file_info.content instanceof ArrayBuffer) {
          await load_trajectory_data(file_info.content, file_info.name)
        } else if (file_info.content_url) {
          const response = await fetch(file_info.content_url)
          const array_buffer = await response.arrayBuffer()
          await load_trajectory_data(array_buffer, file_info.name)
        } else {
          console.warn(
            `Binary file without ArrayBuffer or blob URL:`,
            file_info.name,
          )
        }
      } else {
        await load_trajectory_data(file_info.content, file_info.name)
      }
      return true
    } catch (error) {
      console.warn(`Failed to parse internal file data:`, error)
      return false
    }
  }

  // Handle file drop events with optimized large file support
  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return

    loading = true

    try {
      // Check for our custom internal file format first
      const internal_data = event.dataTransfer?.getData(
        `application/x-matterviz-file`,
      )
      if (internal_data) {
        const handled = await handle_internal_file_drop(internal_data)
        if (handled) return
      }

      // Handle URL-based files (e.g. from FilePicker)
      const handled = await handle_url_drop(event, async (content, filename) => {
        current_filename = filename
        file_size = content instanceof ArrayBuffer
          ? content.byteLength
          : new Blob([content]).size
        await load_trajectory_data(content, filename)
      }).catch(() => false)

      if (handled) {
        return
      }

      // Handle file system drops with optimized large file support
      const file = event.dataTransfer?.files[0]
      if (file) {
        file_size = file.size
        current_file_path = file.webkitRelativePath || file.name
        file_object = file

        // Read file content directly
        const content = await read_file_content(file)
        await load_trajectory_data(content, file.name)
      }

      // Check for plain text data (fallback)
      const text_data = event.dataTransfer?.getData(`text/plain`)
      if (text_data) {
        file_size = new Blob([text_data]).size // Calculate byte size of text data
        await load_trajectory_data(text_data, `trajectory.json`)
        return
      }
    } catch (error) {
      console.error(`File drop failed:`, error)
      error_msg = `Failed to load file: ${error}`
      on_error?.({ error_msg, filename: current_filename, file_size })
    } finally {
      loading = false
    }
  }

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
          current_filename = undefined
          file_size = undefined
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

    // Reset previous loading state
    orig_data = null

    try {
      const data_size = data instanceof ArrayBuffer ? data.byteLength : data.length

      // Determine loading strategy based on file size
      const bin_file_threshold = loading_options.bin_file_threshold ??
        MAX_BIN_FILE_SIZE
      const text_file_threshold = loading_options.text_file_threshold ??
        MAX_TEXT_FILE_SIZE
      if (
        (data instanceof ArrayBuffer && data_size > bin_file_threshold) ||
        (typeof data === `string` && data_size > text_file_threshold)
      ) { // Large files: Use indexed loading
        await load_with_indexing(data, filename)
      } else {
        // Small files: Use regular loading
        const merged_options = { ...loading_options, atom_type_mapping }
        trajectory = await parse_trajectory_async(data, filename, (progress) => {
          parsing_progress = progress
        }, merged_options)
      }

      current_step_idx = 0
      current_filename = filename

      const file_size_bytes = data instanceof ArrayBuffer
        ? data.byteLength
        : new Blob([data]).size
      on_file_load?.({ // emit file load event
        trajectory,
        frame_count: trajectory?.frames.length ?? 0,
        total_atoms: trajectory?.frames[0]?.structure.sites.length ?? 0,
        filename,
        file_size: file_size_bytes,
      })
    } catch (err) {
      const unsupported_message = get_unsupported_format_message(
        filename,
        typeof data === `string` ? data : ``,
      )
      error_msg = unsupported_message || `Failed to parse trajectory: ${err}`
      current_filename = undefined
      file_size = undefined

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

  // Load using indexed parsing for large files
  async function load_with_indexing(data: string | ArrayBuffer, filename: string) {
    try { // Use indexed parsing for efficient large file handling
      const merged_options = {
        use_indexing: true,
        ...loading_options,
        atom_type_mapping,
      }
      trajectory = await parse_trajectory_async(data, filename, (progress) => {
        parsing_progress = progress
      }, merged_options)

      // Attach frame loader and original data directly to trajectory for unified access
      orig_data = data
      trajectory.frame_loader = create_frame_loader(filename)
    } catch (error) {
      console.error(`Indexed loading failed:`, error)
      throw error
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
    else if (event.key === `f` && fullscreen_toggle) toggle_fullscreen(wrapper)
    // 'i' key handled by the TrajectoryInfoPane's built-in toggle
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
      // Escape key for info pane handled by DraggablePane
    } // Number keys 0-9 - jump to percentage of trajectory
    else if (event.key >= `0` && event.key <= `9`) {
      go_to_step(Math.floor((parseInt(event.key, 10) / 10) * (total_frames - 1)))
    }
  }

  // Separate state variables for each pane to match component prop types
  let structure_info_open = $state(false)
  let structure_controls_open = $state(false)
  let scatter_controls = $state<ControlsConfig>({ open: false })
  let trajectory_export_open = $state(false)
  let fullscreen = $state(false)
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = !!document.fullscreenElement
    on_fullscreen_change?.({ trajectory, fullscreen })
  }}
/>

<div
  class:dragover
  class:active={is_playing || structure_info_open || structure_controls_open ||
  scatter_controls.open || trajectory_export_open || info_pane_open}
  bind:this={wrapper}
  bind:clientWidth={element_size.width}
  bind:clientHeight={element_size.height}
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
  class:show-both-views={[`structure+scatter`, `structure+histogram`].includes(display_mode) &&
  actual_show_plot && show_structure}
>
  {#if loading}
    {@const text = parsing_progress
      ? `${parsing_progress.stage} (${parsing_progress.current}%)`
      : `Loading trajectory...`}
    <Spinner
      {text}
      style="flex: 1; display: flex; align-items: center; justify-content: center"
      {...spinner_props}
    />
  {:else if error_msg}
    <TrajectoryError
      {error_msg}
      on_dismiss={() => (error_msg = null)}
      {error_snippet}
    />
  {:else if trajectory}
    <!-- Trajectory Controls -->
    {#if controls_config.mode !== `never`}
      <div
        class="trajectory-controls {controls_config.class}"
        style={controls_config.style}
      >
        {#if trajectory_controls}
          {@render trajectory_controls({
        trajectory,
        current_step_idx,
        total_frames: total_frames,
        on_step_change: go_to_step,
      })}
        {:else}
          {#if current_filename && controls_config.visible(`filename`)}
            <button
              class="filename"
              title="Click to copy filename <code>{current_filename}</code>"
              {@attach tooltip()}
              onclick={() => {
                if (current_filename) {
                  navigator.clipboard.writeText(current_filename)
                  filename_copied = true
                  setTimeout(() => filename_copied = false, 1000)
                }
              }}
            >
              {current_filename}
              {#if filename_copied}
                <Icon
                  icon="Check"
                  style="color: var(--success-color); position: absolute; right: 3pt; top: 50%; transform: translateY(-50%); font-size: 16px; animation: fade-in 0.1s; background: var(--surface-bg-hover); border-radius: 50%"
                />
              {/if}
            </button>
          {/if}

          <!-- Navigation controls -->
          {#if controls_config.visible(`nav`)}
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
                disabled={total_frames <= 1}
                title={is_playing ? `Pause playback` : `Play trajectory`}
                class="play-button"
                class:playing={is_playing}
              >
                {is_playing ? `⏸` : `▶`}
              </button>
              <button
                onclick={next_step}
                disabled={current_step_idx === total_frames - 1 || is_playing}
                title="Next step"
              >
                ⏭
              </button>
            </div>
          {/if}

          <!-- Frame slider and counter -->
          {#if controls_config.visible(`step`)}
            <div class="step-section">
              <input
                type="number"
                min="0"
                max={total_frames - 1}
                bind:value={current_step_idx}
                class="step-input"
                title="Enter step number to jump to"
                aria-label="Step input"
                {@attach tooltip()}
              />
              <span aria-label="total frames">/ {format_num(total_frames, `.3~s`)}</span>
              <div class="slider-container">
                <input
                  type="range"
                  min="0"
                  max={total_frames - 1}
                  bind:value={current_step_idx}
                  class="step-slider"
                  title="Drag to navigate steps"
                />
                {#if step_label_positions.length > 0}
                  <div class="step-labels">
                    {#each step_label_positions as step_idx (step_idx)}
                      {@const position_percent = total_frames > 1
              ? (step_idx / (total_frames - 1)) * 100
              : 0}
                      {@const adjusted_position = 1.5 + (position_percent * (100 - 2)) / 100}
                      <div class="step-tick" style:left="{adjusted_position}%"></div>
                      <div class="step-label" style:left="{adjusted_position}%">
                        {format_num(step_idx, `.3~s`)}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Frame rate control - only shown when playing -->
          {#if is_playing && controls_config.visible(`fps`)}
            <label
              class="fps-section"
              style="font-size: 0.9em; display: flex; align-items: center; gap: 5pt; margin-inline: 6pt"
            >
              FPS
              <input
                type="range"
                min={fps_range[0]}
                max={fps_range[1]}
                bind:value={fps}
                title="Frame rate: {format_num(fps, `.2~s`)} fps"
                style="width: clamp(60px, 8cqw, 90px); accent-color: var(--accent-color)"
              />
              <input
                type="number"
                min={fps_range[0]}
                max={fps_range[1]}
                bind:value={fps}
                title="Enter precise FPS value"
                style="text-align: center; border: var(--tooltip-border)"
              />
            </label>
          {/if}

          <!-- Frame info section -->
          <div class="info-section">
            {#if trajectory && controls_config.visible(`info-pane`)}
              <TrajectoryInfoPane
                {trajectory}
                {current_step_idx}
                {current_filename}
                {current_file_path}
                {file_size}
                {file_object}
                bind:pane_open={info_pane_open}
                pane_props={{ style: `max-height: calc(${element_size.height}px - 50px)` }}
              />
            {/if}
            <!-- Trajectory Export Pane -->
            {#if controls_config.visible(`export-pane`)}
              <TrajectoryExportPane
                bind:export_pane_open={trajectory_export_open}
                {trajectory}
                {wrapper}
                filename={current_filename || `trajectory`}
                on_step_change={go_to_step}
                pane_props={{ style: `max-height: calc(${element_size.height}px - 50px)` }}
              />
            {/if}
            <!-- Display mode dropdown -->
            {#if plot_series.length > 0 &&
          controls_config.visible(`view-mode`)}
              <div class="view-mode-dropdown-wrapper">
                <button
                  onclick={() => (view_mode_dropdown_open = !view_mode_dropdown_open)}
                  title={current_view_label}
                  class="view-mode-button"
                  class:active={view_mode_dropdown_open}
                  style="background-color: transparent; padding: 0"
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
            {#if fullscreen_toggle &&
          controls_config.visible(`fullscreen`)}
              <button
                type="button"
                onclick={() => fullscreen_toggle && toggle_fullscreen(wrapper)}
                title="{fullscreen ? `Exit` : `Enter`} fullscreen"
                aria-label="{fullscreen ? `Exit` : `Enter`} fullscreen"
                aria-pressed={fullscreen}
                class="fullscreen-button"
              >
                {#if typeof fullscreen_toggle === `function`}
                  {@render fullscreen_toggle({ fullscreen })}
                {:else}
                  <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
                {/if}
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
          style="height: 100%; min-height: 0; z-index: 3; border-radius: 0"
          {...{
            show_image_atoms: false, // Default to false to avoid atoms popping in/out at cell edges
            ...structure_props,
          }}
          bind:controls_open={structure_controls_open}
          bind:info_pane_open={structure_info_open}
          bind:hidden_elements
        />
      {/if}

      {#if actual_show_plot}
        {#if display_mode === `scatter` || display_mode === `structure+scatter`}
          <ScatterPlot
            series={plot_series}
            {x_axis}
            {y_axis}
            {y2_axis}
            controls={scatter_controls}
            current_x_value={current_step_idx}
            change={plot_skimming ? handle_plot_change : undefined}
            padding={{ t: 20, b: 60, l: 100, r: has_y2_series ? 100 : 20 }}
            range_padding={0}
            style="height: 100%"
            {...scatter_props}
            legend={{
              ...scatter_props.legend ?? {},
              on_toggle: (series_idx) => {
                handle_legend_toggle(series_idx)
                scatter_props.legend?.on_toggle?.(series_idx)
              },
            }}
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
            {...histogram_props}
            series={plot_series}
            x_axis={{
              label: String(histogram_props.x_axis?.label ?? y_axis_labels.y1),
              format: `.3~s`,
            }}
            y_axis={{ label: histogram_props.y_axis?.label ?? `Count`, format: `.3~s` }}
            mode={histogram_props.mode ?? `overlay`}
            show_legend={histogram_props.show_legend ?? plot_series.length > 1}
            legend={histogram_props.legend}
            on_series_toggle={(series_idx) => {
              handle_legend_toggle(series_idx)
              histogram_props.on_series_toggle?.(series_idx)
            }}
            style="height: 100%"
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
    <EmptyState class="trajectory-empty-state">
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
    </EmptyState>
  {/if}
</div>

<style>
  .trajectory {
    --min-height: 500px;
    display: flex;
    flex-direction: column;
    height: var(--traj-height, 100%);
    position: relative;
    min-height: var(--traj-min-height, var(--min-height));
    border-radius: var(--traj-border-radius, var(--border-radius, 3pt));
    box-sizing: border-box;
    contain: layout;
    z-index: var(--traj-z-index, 1);
    container-type: size; /* enable cqh for panes if explicit height is set */
    :global(.plot) {
      background: var(--surface-bg);
    }
    &.active {
      z-index: 2; /* needed so info/control panes from an active viewer overlay those of the next (if there is one) */
      .trajectory-controls {
        z-index: 5; /* needed so info/control panes from an active viewer its own plot when active, not sure why needed */
      }
    }
    &:fullscreen {
      height: 100vh !important;
      width: 100vw !important;
      border-radius: 0 !important;
      background: var(--surface-bg);
      overflow: hidden;
    }
    &.horizontal .content-area {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr;
    }
    &.vertical .content-area {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr 1fr;
    }
    /* Display mode specific layouts */
    &:is(.horizontal, .vertical) .content-area:is(.show-structure-only, .show-plot-only) {
      grid-template-columns: 1fr !important;
      grid-template-rows: 1fr !important;
    }
    &.dragover {
      background-color: var(--traj-dragover-bg, var(--dragover-bg));
      border: var(--traj-dragover-border, var(--dragover-border));
    }
    /* Mode: hover - controls visible on component hover */
    &:hover .trajectory-controls.hover-visible {
      opacity: 1;
      pointer-events: auto;
    }
  }
  /* Content area - grid container for equal sizing */
  .content-area {
    display: grid;
    flex: 1;
    min-height: 0; /* important for tall structure viewers not to overflow */
    /* When plot or structure is hidden, the other takes full space */
    &:is(.hide-plot, .hide-structure) {
      grid-template-columns: 1fr !important;
      grid-template-rows: 1fr !important;
    }
  }
  .trajectory-controls {
    display: flex;
    align-items: center;
    gap: clamp(2pt, 1cqw, 1ex);
    padding: clamp(2pt, 0.5cqw, 1ex) clamp(4pt, 1cqw, 1.2ex);
    background: var(--surface-bg-hover);
    backdrop-filter: blur(4px);
    position: relative;
    border-radius: var(--border-radius, 3pt) var(--border-radius, 3pt) 0 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    /* Mode: always - controls always visible */
    &.always-visible {
      opacity: 1;
      pointer-events: auto;
    }
    /* Mode: never - stays hidden (default state, no additional CSS needed) */
    &:focus-within {
      z-index: var(--traj-controls-z-index, 999999999);
    }
    button {
      background: var(--btn-bg);
      font-size: clamp(0.8rem, 2cqw, 1rem);
      &:hover:not(:disabled) {
        background: var(--btn-bg-hover);
      }
    }
    input[type='number'] {
      &::-webkit-outer-spin-button,
      &::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
    }
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
    padding: 2px;
  }
  .slider-container {
    position: relative;
    flex: 1;
    min-width: var(--trajectory-slider-min-width, 100px);
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
    width: var(--trajectory-step-tick-width, 1px);
    height: var(--trajectory-step-tick-height, 4px);
    background: var(--text-color-muted);
    top: -9pt;
  }
  .step-label {
    position: absolute;
    transform: translateX(-50%);
    font-size: clamp(0.5em, 1.2cqw, 0.65em);
    color: var(--text-color-muted);
    white-space: nowrap;
    text-align: center;
    top: -1.7ex;
  }
  button.filename {
    align-items: center;
    white-space: nowrap;
    padding: var(--trajectory-filename-padding, 3pt 4pt);
    border-radius: var(--trajectory-filename-border-radius, var(--border-radius, 3pt));
    max-width: clamp(150px, 20cqw, 250px);
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-block;
    position: relative;
    font-family: monospace;
    font-size: 0.9em;
    background: var(--code-bg, rgba(0, 0, 0, 0.1));
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  .fullscreen-button {
    background: transparent !important;
    padding: 0;
    &:hover:not(:disabled) {
      background: var(--border-color);
    }
  }
  .info-section {
    display: flex;
    align-items: center;
    gap: clamp(6pt, 1cqw, 1.5ex);
    position: relative;
  }
  .play-button {
    min-width: clamp(32px, 4cqw, 36px);
    &:hover:not(:disabled) {
      background: var(--traj-play-btn-bg-hover, var(--btn-bg-hover, rgba(0, 0, 0, 0.2)));
    }
    &.playing {
      background: var(--traj-pause-btn-bg, var(--btn-bg, rgba(0, 0, 0, 0.1)));
      &:hover:not(:disabled) {
        background: var(
          --traj-pause-btn-bg-hover,
          var(--btn-bg-hover, rgba(0, 0, 0, 0.1))
        );
      }
    }
  }
  :global(.trajectory-empty-state) {
    padding: 2rem;
    border-radius: var(--border-radius, 3pt);
    background: var(--dropzone-bg);
    :where(p, ul) {
      color: var(--text-color-muted);
    }
    :where(ul, li, strong) {
      max-width: var(--trajectory-empty-state-max-width, 500px);
      margin-inline: auto;
    }
  }
  button {
    &:hover:not(:disabled) {
      background: var(--border-color);
    }
    &:disabled {
      background: var(--btn-disabled-bg);
      color: var(--text-color-muted);
      cursor: not-allowed;
    }
  }
  /* Responsive design */
  @media (orientation: portrait) {
    .trajectory {
      /* Fallback class for browsers without :has() support */
      &.show-both-views {
        min-height: calc(var(--min-height) * 2);
      }
      /* Modern browsers: use :has() for same effect */
      @supports selector(:has(.content-area)) {
        &:has(.content-area.show-both:not(.hide-plot):not(.hide-structure)) {
          min-height: calc(var(--min-height) * 2);
        }
      }
      .content-area.show-both:not(.hide-plot):not(.hide-structure) {
        grid-template-columns: 1fr !important;
        grid-template-rows: 1fr 1fr !important;
      }
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
    padding: var(--trajectory-view-mode-option-padding, 5pt);
    box-sizing: border-box;
    background: transparent;
    border-radius: 0;
    text-align: left;
    transition: background-color 0.15s ease;
    &:first-child {
      border-top-left-radius: 3px;
      border-top-right-radius: 3px;
    }
    &.selected {
      color: var(--accent-color);
    }
    span {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
  }
</style>

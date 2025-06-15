<script lang="ts">
  import { Spinner, Structure } from '$lib'
  import { decompress_file } from '$lib/io/decompress'
  import { format_num, trajectory_labels } from '$lib/labels'
  import type { DataSeries, Point } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { titles_as_tooltips } from 'svelte-zoo'
  import { full_data_extractor } from './extract'
  import type { Trajectory, TrajectoryDataExtractor } from './index'
  import { TrajectoryError } from './index'
  import {
      data_url_to_array_buffer,
      get_unsupported_format_message,
      load_trajectory_from_url,
      parse_trajectory_data,
  } from './parse'
  import { generate_plot_series, should_hide_plot } from './plotting'

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
    // layout configuration
    layout?: `horizontal` | `vertical`
    // structure viewer props (passed to Structure component)
    structure_props?: ComponentProps<typeof Structure>
    // plot props (passed to ScatterPlot component)
    plot_props?: ComponentProps<typeof ScatterPlot>
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
    layout = `horizontal`,
    structure_props = { show_image_atoms: false },
    plot_props = {},
    spinner_props = {},
    trajectory_controls,
    error_snippet,
    show_controls = true,
    property_labels = trajectory_labels,
    units = {
      energy: `eV`,
      energy_per_atom: `eV/atom`,
      force_max: `eV/Å`,
      force_norm: `eV/Å`,
      stress_max: `GPa`,
      volume: `Å³`,
      density: `g/cm³`,
      temperature: `K`,
      pressure: `GPa`,
      length: `Å`,
    },
    step_labels = 5,
  }: Props = $props()

  let dragover = $state(false)
  let loading = $state(false)
  let error_message = $state<string | null>(null)
  let is_playing = $state(false)
  let frame_rate_fps = $state(1) // default 1 frame per second
  let play_interval: ReturnType<typeof setInterval> | undefined = $state(undefined)
  let current_filename = $state<string | null>(null)
  let file_size = $state<number | null>(null)

  // Current frame structure for display
  let current_structure = $derived(
    trajectory && current_step_idx < trajectory.frames.length
      ? trajectory.frames[current_step_idx]?.structure
      : undefined,
  )

  // Truncate filename for display
  let display_filename = $derived.by((): string | null => {
    if (!current_filename) return null

    if (current_filename.length <= 20) return current_filename

    // Truncate with ellipsis in the middle: 8 chars + "..." + 9 chars = 20 total
    const start = current_filename.slice(0, 8)
    const end = current_filename.slice(-9)
    return `${start}...${end}`
  })

  // Comprehensive tooltip with trajectory statistics
  let info_tooltip = $derived.by((): string | undefined => {
    if (!trajectory) return undefined

    const stats: string[] = []
    const first_frame = trajectory.frames[0]

    // File information
    if (current_filename) stats.push(`File: ${current_filename}`)
    if (file_size !== null) {
      const size_str =
        file_size > 1024 * 1024
          ? `${format_num(file_size / (1024 * 1024), `.2~f`)} MB`
          : `${format_num(file_size / 1024, `.1~f`)} KB`
      stats.push(`Size: ${size_str}`)
    }

    // Lattice information (atoms/volume already in top bar)
    if (`lattice` in first_frame.structure) {
      const { volume, a, b, c, alpha, beta, gamma } = first_frame.structure.lattice
      stats.push(
        `Density: ${format_num(first_frame.structure.sites.length / volume, `.4~s`)} atoms/Å³`,
      )
      stats.push(
        `Cell: ${format_num(a, `.2~s`)} × ${format_num(b, `.2~s`)} × ${format_num(c, `.2~s`)} Å`,
      )
      stats.push(
        `Angles: α=${format_num(alpha, `.1~f`)}° β=${format_num(beta, `.1~f`)}° γ=${format_num(gamma, `.1~f`)}°`,
      )

      // Volume change if available
      if (trajectory.frames.length > 1) {
        const volumes = trajectory.frames
          .map((frame) =>
            `lattice` in frame.structure ? frame.structure.lattice.volume : null,
          )
          .filter((v): v is number => v !== null)

        if (volumes.length > 1) {
          const vol_change =
            ((Math.max(...volumes) - Math.min(...volumes)) / Math.min(...volumes)) * 100
          if (Math.abs(vol_change) > 0.1) {
            stats.push(`Volume change: ${format_num(vol_change, `.2~f`)}%`)
          }
        }
      }
    }

    // Energy range with span in parentheses
    const energies = trajectory.frames
      .map((f) => f.metadata?.energy)
      .filter(Boolean) as number[]
    if (energies.length > 1) {
      const min_energy = Math.min(...energies)
      const max_energy = Math.max(...energies)
      const energy_span = max_energy - min_energy
      stats.push(
        `Energy: ${format_num(min_energy, `.3~s`)} to ${format_num(max_energy, `.3~s`)} eV (span: ${format_num(energy_span, `.3~s`)} eV)`,
      )
    }

    // Format if available
    if (trajectory.metadata?.source_format) {
      stats.push(`Format: ${trajectory.metadata.source_format}`)
    }

    return stats.join(`<br />`)
  })

  // Calculate step label positions based on step_labels prop
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
        // Positive number: evenly spaced ticks
        const tick_count = Math.min(step_labels, total_frames)
        if (tick_count <= 1) return [0]

        const positions: number[] = []
        for (let idx = 0; idx < tick_count; idx++) {
          const position = Math.round((idx * (total_frames - 1)) / (tick_count - 1))
          positions.push(position)
        }
        return positions
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

    // Filter out undefined values from units
    const filtered_units: Record<string, string> = {}
    for (const [key, value] of Object.entries(units)) {
      if (value !== undefined) {
        filtered_units[key] = value
      }
    }

    return generate_plot_series(trajectory, data_extractor, {
      property_labels,
      units: filtered_units,
    })
  })

  // Check if all plotted values are constant (no variation) using extracted utility
  let show_plot = $derived(!should_hide_plot(trajectory, plot_series))

  // Generate intelligent axis labels based on first series on each axis
  let y_axis_labels = $derived.by(() => {
    if (plot_series.length === 0) return { y1: `Value`, y2: `Value` }

    const y1_series = plot_series.filter((s) => (s.y_axis ?? `y1`) === `y1`)
    const y2_series = plot_series.filter((s) => s.y_axis === `y2`)

    const get_axis_label = (series: DataSeries[]): string => {
      if (series.length === 0) return `Value`
      // Use the first series label as the axis label
      const first_series = series[0]
      return first_series?.label || `Value`
    }

    return {
      y1: get_axis_label(y1_series),
      y2: get_axis_label(y2_series),
    }
  })

  // Check if there are any Y2 series to determine padding
  let has_y2_series = $derived(plot_series.some((s) => s.y_axis === `y2` && s.visible))

  // Handle file drop events
  async function handle_file_drop(event: DragEvent) {
    event.preventDefault()
    dragover = false
    if (!allow_file_drop) return

    // Check for our custom internal file format first
    const internal_data = event.dataTransfer?.getData(`application/x-elementari-file`)
    if (internal_data) {
      try {
        const file_info = JSON.parse(internal_data)

        // Check if this is a binary file
        if (file_info.is_binary) {
          const array_buffer = data_url_to_array_buffer(file_info.content)
          await handle_trajectory_binary_drop(array_buffer, file_info.name)
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
    try {
      // Check if this is an HDF5 file (handle as binary)
      if (
        file.name.toLowerCase().endsWith(`.h5`) ||
        file.name.toLowerCase().endsWith(`.hdf5`)
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
      if (current_interval !== undefined) {
        clearInterval(current_interval)
      }

      // Create new interval with current frame rate
      play_interval = setInterval(() => {
        if (current_step_idx >= trajectory!.frames.length - 1) {
          pause_playback()
        } else {
          next_step()
        }
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
    loading = true
    error_message = null

    try {
      // Check for unsupported formats first
      const unsupported_message = get_unsupported_format_message(filename, content)
      if (unsupported_message) {
        error_message = unsupported_message
        current_filename = null
        file_size = null
        return
      }

      // Use the new parser that can handle multiple formats including XDATCAR
      trajectory = await parse_trajectory_data(content, filename)
      current_step_idx = 0
      current_filename = filename
      // Note: file_size remains as set by the caller (could be null for text drops)
    } catch (err) {
      // Check if this might be an unsupported format even if not detected initially
      const unsupported_message = get_unsupported_format_message(filename, content)
      if (unsupported_message) {
        error_message = unsupported_message
      } else {
        error_message = `Failed to parse trajectory file: ${err}`
      }
      current_filename = null
      file_size = null
      console.error(`Trajectory parsing error:`, err)
    } finally {
      loading = false
    }
  }

  async function handle_trajectory_binary_drop(buffer: ArrayBuffer, filename: string) {
    loading = true
    error_message = null

    try {
      // Parse binary data (e.g., HDF5 files)
      trajectory = await parse_trajectory_data(buffer, filename)
      current_step_idx = 0
      current_filename = filename
      // Note: file_size should already be set by the caller
    } catch (err) {
      error_message = `Failed to parse binary trajectory file: ${err}`
      current_filename = null
      file_size = null
      console.error(`Binary trajectory parsing error:`, err)
    } finally {
      loading = false
    }
  }
</script>

<div
  class="trajectory-viewer"
  class:horizontal={layout === `horizontal`}
  class:vertical={layout === `vertical`}
  class:dragover
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
>
  {#if loading}
    <Spinner text="Loading trajectory..." {...spinner_props} />
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
          {@const current_frame = trajectory.frames[current_step_idx]}
          {@const input_width = Math.max(25, String(current_step_idx).length * 8 + 6)}
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
              value={current_step_idx}
              onchange={(event) => {
                const target = event.target as HTMLInputElement
                const step_num = parseInt(target.value, 10)
                if (
                  !isNaN(step_num) &&
                  step_num >= 0 &&
                  trajectory &&
                  step_num <= trajectory.frames.length - 1
                ) {
                  current_step_idx = step_num
                } else {
                  // Reset to current value if invalid
                  target.value = String(current_step_idx)
                }
              }}
              oninput={(event) => {
                const target = event.target as HTMLInputElement
                const width = Math.max(25, Math.min(80, target.value.length * 8 + 6))
                target.style.width = `${width}px`
              }}
              style="width: {input_width}px;"
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
                    {@const position_percent =
                      (step_idx / (trajectory.frames.length - 1)) * 100}
                    {@const adjusted_position =
                      1.5 + (position_percent * (100 - 2)) / 100}
                    <div class="step-tick" style="left: {adjusted_position}%;"></div>
                    <div class="step-label" style="left: {adjusted_position}%;">
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
              <label for="step-rate-slider" style="font-weight: 500; white-space: nowrap;"
                >Speed:</label
              >
              <input
                id="step-rate-slider"
                type="range"
                min="0.2"
                max="5"
                step="0.1"
                bind:value={frame_rate_fps}
                class="speed-slider"
                title="Frame rate: {format_num(frame_rate_fps, `.2~s`)} fps"
              />
              <input
                type="number"
                min="0.2"
                max="5"
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
            {#if display_filename}
              <span
                use:titles_as_tooltips
                title={current_filename !== display_filename
                  ? current_filename
                  : undefined}>{display_filename}</span
              >
            {/if}
            <span>Atoms: {current_frame.structure.sites.length}</span>
            {#if `lattice` in current_frame.structure}
              <span title="Initial cell volume" use:titles_as_tooltips>
                Vol<sub>0</sub>: {format_num(
                  current_frame.structure.lattice.volume,
                  `.3~s`,
                )} Å³
              </span>
            {/if}
            {#if current_frame.metadata?.energy}
              <span title="Initial total energy" use:titles_as_tooltips>
                E<sub>0</sub>: {format_num(
                  current_frame.metadata.energy as number,
                  `.3~s`,
                )} eV
              </span>
            {/if}
            <!-- Info icon with comprehensive tooltip -->
            {#if info_tooltip}
              <div class="info-icon" use:titles_as_tooltips title={info_tooltip}>
                <svg style="width: 20px; height: 20px;"><use href="#icon-info" /></svg>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <div class="content-area" class:hide-plot={!show_plot}>
      <Structure
        structure={current_structure}
        allow_file_drop={false}
        style="height: 100%; border-radius: 0;"
        enable_tips={false}
        {...structure_props}
      />

      {#if show_plot}
        <ScatterPlot
          series={plot_series}
          x_label="Step"
          y_label={y_axis_labels.y1}
          y_label_shift={{ y: 20 }}
          y2_label={y_axis_labels.y2}
          current_x_value={current_step_idx}
          change={handle_plot_change}
          markers="line"
          x_ticks={step_label_positions.length > 1
            ? -(step_label_positions[1] - step_label_positions[0])
            : trajectory && trajectory.frames.length <= 10
              ? -1
              : undefined}
          legend={{
            responsive: true,
            layout: `horizontal`,
            layout_tracks: 3,
            item_gap: 0,
            padding: { t: 5, b: 5, l: 5, r: 5 },
          }}
          padding={{ t: 20, b: 60, l: 100, r: has_y2_series ? 80 : 20 }}
          range_padding={0}
          style="height: 100%;"
          {...plot_props}
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
      {/if}
    </div>
  {:else}
    <div class="empty-state">
      <div class="drop-zone">
        <h3>Load Trajectory</h3>
        <p>
          Drop a trajectory file here (.xyz, .json, .json.gz, XDATCAR) or provide
          trajectory data via props
        </p>
        <div class="supported-formats">
          <strong>Supported formats:</strong>
          <ul>
            <li>Multi-frame XYZ trajectory files</li>
            <li>Pymatgen trajectory JSON</li>
            <li>Array of structures with metadata</li>
            <li>VASP XDATCAR files</li>
            <li>Compressed files (.gz)</li>
          </ul>
        </div>
      </div>
    </div>
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
    overflow: visible;
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
  .info-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--traj-text, #e2e8f0);
    margin-left: auto;
  }
  .info-section span {
    white-space: nowrap;
    padding: 0.125rem 0.375rem;
    background: var(--traj-bg, rgba(26, 32, 44, 0.8));
    border-radius: 2px;
    border: var(--traj-border, 1px solid rgba(74, 85, 104, 0.5));
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
    .trajectory-viewer.horizontal {
      flex-direction: column;
    }
    .trajectory-controls {
      flex-wrap: wrap;
      gap: 0.375rem;
    }
    .step-section {
      order: 1;
      width: 100%;
      min-width: 0;
    }
    .speed-section {
      justify-content: center;
    }
    .info-section {
      margin-left: 0;
      justify-content: center;
      gap: 0.375rem;
    }
  }
  @media (max-width: 480px) {
    .trajectory-controls {
      padding: 0.125rem 0.375rem;
      font-size: 0.75rem;
      gap: 0.25rem;
    }
    .nav-button {
      min-width: 24px;
      height: 24px;
      font-size: 0.7rem;
    }
    .info-section {
      flex-direction: column;
      gap: 0.125rem;
    }
    .speed-section {
      font-size: 0.65rem;
    }
  }
</style>

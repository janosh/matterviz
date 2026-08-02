<script lang="ts">
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import type { ElementSymbol } from '$lib/element'
  import EmptyState from '$lib/EmptyState.svelte'
  import { StatusMessage } from '$lib/feedback'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { Icon, type IconName } from 'svelte-widgets'
  import * as io from '$lib/io'
  import { handle_and_prevent, to_error } from '$lib/utils'
  import { format_num, trajectory_property_config, type TrajPropertyConfig } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import {
    collect_msd_positions,
    has_all_frames_in_memory,
    suggest_msd_frame_stride,
  } from '$lib/msd/collect'
  import TrajectoryMsdPane from '$lib/msd/TrajectoryMsdPane.svelte'
  import { sanitize_html } from '$lib/sanitize'
  import { FullscreenButton, type FullscreenToggleProp, toggle_fullscreen } from '$lib/layout'
  import { sync_fullscreen } from 'svelte-widgets/fullscreen'
  import type { ControlsConfig, DataSeries, Orientation, Point } from '$lib/plot'
  import type { ScatterHandlerProps } from '$lib/plot/core/types'
  import { Histogram, ScatterPlot } from '$lib/plot'
  import { toggle_series_visibility } from '$lib/plot/core/utils/series-visibility'
  import { DEFAULTS } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import Structure from '$lib/structure/Structure.svelte'
  import TrajectoryStructureIdPane from '$lib/structure-id/TrajectoryStructureIdPane.svelte'
  import { collected_frame_idx } from '$lib/structure/trajectory-lines'
  import TrajectoryVacfPane from '$lib/vacf/TrajectoryVacfPane.svelte'
  import { scaleLinear } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import { onMount, untrack } from 'svelte'
  import { forward_window_keydown, tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { full_data_extractor } from './extract'
  import type {
    ParseProgress,
    TrajectoryDataExtractor,
    TrajectoryFrame,
    TrajectoryMetadata,
    TrajectoryPositionStream,
    TrajectoryType,
    TrajectoryXQuantity,
    TrajHandlerData,
  } from './index'
  import type { TrajectoryFrameResolver } from './file-export'
  import {
    pick_pane_orientation,
    TrajectoryDataInspectorPane,
    TrajectoryError,
    TrajectoryExportPane,
    TrajectoryInfoPane,
  } from './index'
  import type { AtomTypeMapping, LoadingOptions } from './parse'
  import {
    get_unsupported_format_message,
    MAX_BIN_FILE_SIZE,
    MAX_TEXT_FILE_SIZE,
    parse_trajectory_async,
  } from './parse'
  import {
    available_x_quantities,
    build_x_map,
    generate_axis_labels,
    generate_axis_scale_types,
    generate_plot_series,
    generate_streaming_plot_series,
    get_frame_step_samples,
    get_frame_time_step,
    should_hide_plot,
    X_QUANTITY_LABELS,
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
  type PlotMetadataStreamMessage = {
    command?: string
    file_path?: string
    plot_metadata?: TrajectoryMetadata[]
    is_complete?: boolean
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
    x_quantity = $bindable(),
    visible_properties = $bindable(),
    property_labels,
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
    hovered = $bindable(false),
    controls_open = $bindable(false),
    info_pane_open = $bindable(false),
    msd_pane_open = $bindable(false),
    vacf_pane_open = $bindable(false),
    structure_id_pane_open = $bindable(false),
    data_inspector_open = $bindable(false),
    wrapper = $bindable(),
    fullscreen = $bindable(false),
    ...rest
  }: EventHandlers &
    HTMLAttributes<HTMLDivElement> & {
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
      // Control names: 'filename', 'nav', 'step', 'fps', 'info-pane', 'export-pane', 'msd-pane', 'x-axis', 'view-mode', 'fullscreen'
      show_controls?: ShowControlsProp
      // show/hide the fullscreen button
      fullscreen_toggle?: FullscreenToggleProp
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
      // what the plot's x axis counts: 'frame' (position in the trajectory), 'step' (the MD
      // step recorded in the file) or 'time' (step x the file's timestep). Leave unset to
      // pick the most informative one the data supports.
      x_quantity?: TrajectoryXQuantity
      // visible properties - bindable array of property keys currently shown in the plot
      // - controls which trajectory properties are plotted (e.g. ['energy', 'volume', 'force_max'])
      // - bindable: reflects current visibility state and can be used for external control
      // - if not provided, uses default visible properties (energy, force_max, stress_frobenius)
      // - if specified properties don't exist in data, falls back to automatic selection
      visible_properties?: string[]
      // custom labels for trajectory properties - maps property keys to display labels
      // - e.g. {energy: 'Total Energy', volume: 'Cell Volume', force_max: 'Max Force'}
      // - merged with built-in trajectory_property_config
      property_labels?: Record<string, string>
      fps_range?: Vec2 // allowed FPS range [min_fps, max_fps]
      fps?: number // frame rate for playback
      // Loading options for large files
      loading_options?: LoadingOptions
      // Map LAMMPS atom types to element symbols (e.g. {1: 'Na', 2: 'Cl'})
      atom_type_mapping?: AtomTypeMapping
      // Disable plot skimming (mouse over plot doesn't update structure/step slider)
      plot_skimming?: boolean
      // bindable: true while the pointer is over the viewer (drives hover-scoped shortcuts)
      hovered?: boolean
      // bindable: whether the (structure) controls pane is currently open
      controls_open?: boolean
      // bindable: whether the trajectory info pane is currently open
      info_pane_open?: boolean
      // bindable: whether the MSD / diffusion pane is currently open
      msd_pane_open?: boolean
      // bindable: whether the VACF / VDOS pane is currently open
      vacf_pane_open?: boolean
      // bindable: whether the structure identification (CNA / centrosymmetry) pane is open
      structure_id_pane_open?: boolean
      // bindable: whether the per-frame data inspector pane is currently open
      data_inspector_open?: boolean
      // bindable: top-level wrapper element
      wrapper?: HTMLDivElement
      // bindable: fullscreen state
      fullscreen?: boolean
    } = $props()

  let dragover = $state(false)
  let loading = $state(false)
  let error_msg = $state<string | null>(null)
  // Non-fatal parse warnings from trajectory metadata (set by parser via attach_parse_warnings); dismissible
  let parse_warning_msg = $state<string | undefined>(undefined)
  $effect(() => {
    const warnings = trajectory?.metadata?.parse_warnings
    parse_warning_msg =
      Array.isArray(warnings) && warnings.length > 0
        ? `${warnings.length} parse warning${warnings.length > 1 ? `s` : ``}: ${warnings.join(
            `; `,
          )}`
        : undefined
  })
  let is_playing = $state(false)
  // requestAnimationFrame handle for the playback loop (rAF auto-pauses in background tabs and
  // self-throttles, unlike setInterval which drifts and queues work when a frame render overruns)
  let play_raf: number | undefined

  // Ensure fps is within the allowed range
  $effect(() => {
    const clamped = Math.max(fps_range[0], Math.min(fps_range[1], fps))
    if (clamped !== fps) fps = clamped
  })
  let current_filename = $state<string | undefined>(undefined)
  let current_file_path = $state<string | null>(null)
  let file_size = $state<number | undefined>(undefined)
  let file_object = $state<File | null>(null)
  let parsing_progress = $state<ParseProgress | null>(null)
  let content_size = $state({ width: 0, height: 0 })
  // Cap panes to .content-area (controls bar is a flex sibling above it).
  let pane_max_height = $derived(
    content_size.height > 0 ? `max-height: ${content_size.height}px` : undefined,
  )
  let filename_copied = $state(false)
  let orig_data = $state<string | ArrayBuffer | null>(null)
  let data_url_load_id = 0
  let loaded_data_url: string | undefined
  let url_owned_trajectory: TrajectoryType | undefined

  let controls_config = $derived(normalize_show_controls(show_controls))

  // Reactive layout based on the size of the box actually being split (for auto
  // mode). Measured on .content-area, not the wrapper: a mounted controls bar is
  // ~32px of the wrapper's height that no pane ever gets.
  let actual_layout = $derived.by(() => {
    if (layout === `horizontal` || layout === `vertical`) return layout
    const { width, height } = content_size
    if (width > 0 && height > 0) return pick_pane_orientation(width, height)
    return `horizontal` // Fallback to horizontal if dimensions not available yet
  })

  // Get total frame count (supports both regular and indexed trajectories)
  let total_frames = $derived(trajectory?.total_frames || trajectory?.frames.length || 0)

  // Clamp out-of-range step indices (e.g. an initial current_step_idx of
  // Number.MAX_SAFE_INTEGER means "jump to the last frame", used by hosts
  // restoring viewer position across trajectory reloads). Hosts are notified
  // of the correction so their recorded position matches the shown frame.
  $effect(() => {
    if (total_frames > 0 && current_step_idx > total_frames - 1) {
      current_step_idx = total_frames - 1
      notify_step_change()
    } else if (current_step_idx < 0) {
      current_step_idx = 0
      notify_step_change()
    }
  })

  // Decoration gets a 64 MB budget; larger runs trade smoothness for frame stride.
  const TRAIL_POSITION_MAX_BYTES = 64 * 1024 * 1024

  // Avoid deep-proxying lattice_matrices: unwrapping measured 1917 ms proxied vs 1.1 ms raw.
  let trail_stream = $state.raw<TrajectoryPositionStream | null>(null)
  let show_trajectory_lines = $state(
    untrack(
      () =>
        structure_props.scene_props?.show_trajectory_lines ??
        DEFAULTS.structure.show_trajectory_lines,
    ),
  )
  $effect(() => {
    const configured = structure_props.scene_props?.show_trajectory_lines
    if (configured !== undefined) show_trajectory_lines = configured
  })
  let trajectory_lines_available = $derived(
    Boolean(trajectory && total_frames >= 2 && has_all_frames_in_memory(trajectory)),
  )
  // Indexed trajectories would require a second full parse for an optional overlay. In-memory
  // trajectories are collected only when trails are enabled, so the default path pays nothing.
  $effect(() => {
    const owner = trajectory
    const enabled = show_trajectory_lines
    trail_stream = null
    if (!enabled || !owner || !trajectory_lines_available) return
    let cancelled = false
    const frame_stride = suggest_msd_frame_stride(owner, TRAIL_POSITION_MAX_BYTES) ?? 1
    collect_msd_positions(owner, { frame_stride, max_bytes: TRAIL_POSITION_MAX_BYTES })
      .then((stream) => {
        if (!cancelled && trajectory === owner) trail_stream = stream
      })
      .catch((exc: unknown) => {
        if (cancelled) return
        // Trails are optional, so a failure here hides them rather than breaking the viewer
        console.error(`Trajectory trails: position collection failed`, to_error(exc).message)
      })
    return () => {
      cancelled = true
    }
  })

  const SCRUB_SETTLE_MS = 80
  let scrub_active = $state(false)
  let scrub_animation_frame: number | undefined
  let scrub_settle_timeout: ReturnType<typeof setTimeout> | undefined
  let pending_scrub_step: number | undefined

  // Convert source-frame playhead to collected frames; collection and scrub deferral remain
  // owned by the trajectory interaction pipeline.
  let trail_scene_props = $derived({
    ...structure_props.scene_props,
    trajectory_position_stream: trajectory_lines_available ? trail_stream : undefined,
    trajectory_line_end_frame: trail_stream
      ? collected_frame_idx(trail_stream, current_step_idx)
      : undefined,
    show_trajectory_lines,
    defer_expensive_geometry: scrub_active,
  })

  // Current frame - load on demand for indexed trajectories
  let current_frame = $state<TrajectoryFrame | null>(null)
  let frame_load_request_id = 0
  let frame_read_active = false
  let pending_frame_idx: number | undefined

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
        current_frame = null
        schedule_frame_load_on_demand(current_step_idx)
      } else {
        // Use in-memory frame for regular trajectories
        current_frame = trajectory.frames[current_step_idx] || null
      }
    } else {
      current_frame = null
    }
  })

  // LRU cache of decoded frames (keyed to the current trajectory) so scrub/playback over
  // indexed/streaming trajectories avoids re-reading frames and prefetch can warm upcoming ones.
  // Capped by frame count AND a total-atom budget (cache many tiny frames or few huge ones).
  const FRAME_CACHE_MAX = 64
  const FRAME_CACHE_MAX_ATOMS = 200_000
  let frame_cache = new SvelteMap<number, TrajectoryFrame>()
  let frame_cache_atom_count = 0
  let frame_cache_owner: TrajectoryType | undefined
  // Frames currently being read (direct or prefetch) so we don't kick off duplicate loads
  const inflight_frames = new SvelteSet<number>()
  let streaming_file_path = $derived(
    trajectory?.metadata?.streaming_file_path as string | undefined,
  )
  let plot_metadata_loading = $derived(trajectory?.metadata?.plot_metadata_loading === true)

  const skip_stale_url_stream = () =>
    Boolean(data_url && loaded_data_url && data_url !== loaded_data_url)

  // Replace the trajectory with an updated copy, keeping URL ownership if it applied.
  // No-ops while a data_url switch is in flight so stale streams can't mutate the old model.
  const update_trajectory = (updates: Partial<TrajectoryType>) => {
    if (!trajectory || skip_stale_url_stream()) return
    const preserves_url_ownership = trajectory === url_owned_trajectory
    trajectory = { ...trajectory, ...updates }
    if (preserves_url_ownership) url_owned_trajectory = trajectory
  }

  const merge_plot_metadata = (batch: TrajectoryMetadata[]) => {
    if (batch.length === 0) return
    update_trajectory({ plot_metadata: [...(trajectory?.plot_metadata ?? []), ...batch] })
  }

  const finish_plot_metadata_loading = () =>
    update_trajectory({
      metadata: { ...trajectory?.metadata, plot_metadata_loading: false },
    })

  onMount(() => {
    const handle_plot_metadata_stream = (event: MessageEvent<PlotMetadataStreamMessage>) => {
      // Global listener: other code posts arbitrary messages (including null data)
      if (typeof event.data !== `object` || event.data === null) return
      const { command, file_path, is_complete, plot_metadata } = event.data
      if (command !== `plot_metadata_stream` || file_path !== streaming_file_path) return
      if (Array.isArray(plot_metadata)) merge_plot_metadata(plot_metadata)
      if (is_complete) finish_plot_metadata_loading()
    }
    globalThis.addEventListener(`message`, handle_plot_metadata_stream)
    return () => {
      globalThis.removeEventListener(`message`, handle_plot_metadata_stream)
      if (scrub_animation_frame !== undefined) cancelAnimationFrame(scrub_animation_frame)
      if (scrub_settle_timeout !== undefined) clearTimeout(scrub_settle_timeout)
    }
  })

  // Reset per-trajectory caches when the trajectory changes (frames belong to the old one)
  function ensure_frame_cache_owner() {
    if (frame_cache_owner !== trajectory) {
      frame_cache = new SvelteMap()
      frame_cache_atom_count = 0
      inflight_frames.clear()
      pending_frame_idx = undefined
      frame_cache_owner = trajectory
    }
  }
  // Sync LRU read (delete + re-insert refreshes recency); undefined on miss
  function cache_get(frame_idx: number): TrajectoryFrame | undefined {
    return untrack(() => {
      const hit = frame_cache.get(frame_idx)
      if (!hit) return undefined
      frame_cache.delete(frame_idx)
      frame_cache.set(frame_idx, hit)
      return hit
    })
  }
  // Sync LRU write, evicting oldest entries until under both the frame and atom budgets
  function cache_put(frame_idx: number, frame: TrajectoryFrame) {
    untrack(() => {
      frame_cache.set(frame_idx, frame)
      let total_atoms = 0
      for (const cached of frame_cache.values())
        total_atoms += cached.structure?.sites?.length ?? 0
      while (
        frame_cache.size > 1 &&
        (frame_cache.size > FRAME_CACHE_MAX || total_atoms > FRAME_CACHE_MAX_ATOMS)
      ) {
        const oldest = frame_cache.keys().next().value
        if (oldest === undefined) break
        total_atoms -= frame_cache.get(oldest)?.structure?.sites?.length ?? 0
        frame_cache.delete(oldest)
      }
      frame_cache_atom_count = total_atoms
    })
  }

  const emit_frame_load_state = (frame_idx: number) => {
    wrapper?.dispatchEvent(
      new CustomEvent(`matterviz:trajectory-load-state`, {
        detail: {
          frame_idx,
          inflight: frame_read_active ? 1 : 0,
          cached_frames: frame_cache.size,
          cached_atoms: frame_cache_atom_count,
        },
      }),
    )
  }

  const finish_frame_read = (frame_idx: number, prefetch_from_idx?: number) => {
    inflight_frames.delete(frame_idx)
    frame_read_active = false
    emit_frame_load_state(frame_idx)
    const next_frame_idx = pending_frame_idx
    pending_frame_idx = undefined
    if (next_frame_idx !== undefined && next_frame_idx === current_step_idx) {
      schedule_frame_load_on_demand(next_frame_idx)
    } else if (prefetch_from_idx !== undefined) {
      prefetch_frames(prefetch_from_idx)
    }
  }

  // Warm one adjacent frame only while the demand lane is idle. A new scrub target waits for
  // this read instead of starting another, keeping decode/IPC backlog strictly bounded.
  function prefetch_frames(from_idx: number) {
    const frame_loader = trajectory?.frame_loader
    if (!frame_loader || frame_read_active || pending_frame_idx !== undefined) return
    if (trajectory?.indexed_frames && trajectory.indexed_frames.length < total_frames) return
    const owner = trajectory
    for (const ahead of [1, 2]) {
      const idx = from_idx + ahead
      if (
        idx >= total_frames ||
        untrack(() => frame_cache.has(idx) || inflight_frames.has(idx))
      )
        continue
      frame_read_active = true
      inflight_frames.add(idx)
      emit_frame_load_state(idx)
      frame_loader
        .load_frame(orig_data || ``, idx)
        .then((frame) => {
          if (frame && frame_cache_owner === owner) cache_put(idx, frame)
        })
        .catch(() => {})
        .finally(() => finish_frame_read(idx))
      break
    }
  }

  function use_cached_or_in_memory_frame(
    load_trajectory: TrajectoryType,
    frame_idx: number,
  ): boolean {
    const cached = cache_get(frame_idx)
    if (cached) {
      current_frame = cached
      prefetch_frames(frame_idx)
      return true
    }

    const in_memory_frame = load_trajectory.frames[frame_idx]
    if (in_memory_frame) {
      cache_put(frame_idx, in_memory_frame)
      current_frame = in_memory_frame
      prefetch_frames(frame_idx)
      return true
    }
    return false
  }

  function schedule_frame_load_on_demand(frame_idx: number) {
    const load_trajectory = trajectory
    if (!load_trajectory?.frame_loader) return
    ensure_frame_cache_owner()
    frame_load_request_id++

    if (use_cached_or_in_memory_frame(load_trajectory, frame_idx)) {
      pending_frame_idx = undefined
      return
    }
    pending_frame_idx = frame_idx
    if (frame_read_active) return
    pending_frame_idx = undefined
    void load_frame_on_demand(frame_idx)
  }

  // Resolve any frame for export. Indexed trajectories hold only the first handful in
  // `frames`, so the export panes must go through the loader for the rest; the decode is
  // cached so re-exporting an overlapping range doesn't re-read the file.
  const resolve_frame: TrajectoryFrameResolver = async (frame_idx) => {
    const owner = trajectory
    if (!owner || frame_idx < 0 || frame_idx >= total_frames) return null
    // Both load paths bail before ensure_frame_cache_owner when a trajectory has no loader, so
    // an eager trajectory loaded after an indexed one inherits a cache still full of the old
    // one's frames. Claiming ownership here keeps the export from reading those.
    ensure_frame_cache_owner()
    const cached = cache_get(frame_idx) ?? owner.frames[frame_idx]
    if (cached) return cached
    if (!owner.frame_loader) return null
    const frame = await owner.frame_loader.load_frame(orig_data || ``, frame_idx)
    // A swap mid-export must not emit the old trajectory's frames into the new one's file.
    // Deliberately not cached: a whole-range export would evict every frame playback holds.
    return trajectory === owner ? frame : null
  }

  // Load frame on demand - works for both indexed files and external streaming
  async function load_frame_on_demand(frame_idx: number) {
    const load_trajectory = trajectory
    const frame_loader = load_trajectory?.frame_loader
    if (!load_trajectory || !frame_loader) return
    ensure_frame_cache_owner()

    if (frame_read_active) {
      pending_frame_idx = frame_idx
      return
    }
    const request_id = frame_load_request_id
    const request_is_current = () =>
      request_id === frame_load_request_id &&
      trajectory === load_trajectory &&
      current_step_idx === frame_idx

    if (use_cached_or_in_memory_frame(load_trajectory, frame_idx)) return
    frame_read_active = true
    inflight_frames.add(frame_idx)
    emit_frame_load_state(frame_idx)
    let prefetch_from_idx: number | undefined
    try {
      const frame = await frame_loader.load_frame(
        orig_data || ``, // original_data for indexed files, empty string for external streaming
        frame_idx,
      )
      // cache the decoded frame even if it arrived stale (still valid data for that index)
      if (frame && frame_cache_owner === load_trajectory) cache_put(frame_idx, frame)
      if (!request_is_current()) return
      current_frame = frame
      prefetch_from_idx = frame_idx
    } catch (error) {
      if (!request_is_current()) return
      console.error(`Failed to load frame ${frame_idx}:`, error)
      current_frame = null
      on_error?.({
        error_msg: `Failed to load frame ${frame_idx}: ${error}`,
        filename: current_filename,
        file_size,
        step_idx: frame_idx,
        frame_count: total_frames,
      })
    } finally {
      finish_frame_read(frame_idx, prefetch_from_idx)
    }
  }

  // Current frame structure for display. Holds the last resolved structure so the 3D
  // view doesn't blank while an uncached frame loads on demand (current_frame is nulled
  // during loads to keep the info pane from showing the previous frame's data).
  let current_structure = $state<AnyStructure | undefined>(undefined)
  $effect(() => {
    if (current_frame?.structure) current_structure = current_frame.structure
    else if (!trajectory) current_structure = undefined
  })

  // Track hidden elements (persists across frame changes)
  let hidden_elements = $state(new SvelteSet<ElementSymbol>())

  let step_label_positions = $derived.by((): number[] => {
    if (!step_labels || total_frames <= 1) return []

    if (Array.isArray(step_labels)) {
      return step_labels.filter((idx) => idx >= 0 && idx < total_frames)
    }

    if (typeof step_labels === `number`) {
      if (step_labels > 0) {
        return scaleLinear()
          .domain([0, total_frames - 1])
          .nice()
          .ticks(Math.min(step_labels, total_frames))
          .map((tick) => Math.round(tick))
          .filter(
            (tick, idx, ticks) =>
              tick >= 0 && tick < total_frames && ticks.indexOf(tick) === idx,
          )
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
    if (!property_labels) return trajectory_property_config

    const custom_config: Record<string, TrajPropertyConfig> = {}
    for (const [key, label] of Object.entries(property_labels)) {
      const existing =
        trajectory_property_config[key] || trajectory_property_config[key.toLowerCase()]
      // Spread the existing config so fields like axis_group survive the
      // label override (losing axis_group would break dedicated-axis grouping)
      custom_config[key] = { ...existing, label, unit: existing?.unit || `` }
    }
    return { ...trajectory_property_config, ...custom_config }
  })

  // Plot series state (not derived so we can update on legend toggle)
  let plot_series = $state<DataSeries[]>([])
  // Prevent circular updates when syncing legend toggles back to bindable visible_properties.
  let syncing_visible_properties = false

  // Regenerate plot series when trajectory, config, or visible_properties change.
  // Read ALL reactive deps before the syncing guard can return: a guarded run that
  // reads no dependencies leaves the effect dep-less, and Svelte permanently unlinks
  // dep-less effects - trajectory changes would then never regenerate the plot.
  $effect(() => {
    const [traj, extractor, config, keys, active_x_map] = [
      trajectory,
      data_extractor,
      extended_config,
      visible_properties,
      x_map,
    ]
    if (syncing_visible_properties) return
    const keys_set = keys ? new Set(keys) : undefined

    if (traj?.plot_metadata) {
      plot_series = generate_streaming_plot_series(traj.plot_metadata, {
        property_config: config,
        default_visible_properties: keys_set,
        x_map: active_x_map,
      })
    } else if (traj) {
      plot_series = generate_plot_series(traj, extractor, {
        property_config: config,
        default_visible_properties: keys_set,
        x_map: active_x_map,
      })
    } else {
      plot_series = []
    }
  })

  // Update visible_properties binding when user toggles series visibility in legend
  $effect(() => {
    if (plot_series.length === 0) return

    // Extract property keys from visible series metadata
    const visible_keys = plot_series.flatMap((srs) => {
      if (!srs.visible) return []
      const metadata = Array.isArray(srs.metadata) ? srs.metadata[0] : srs.metadata
      const key = metadata?.property_key
      return key ? [key as string] : []
    })

    // Only update if changed (use untrack to avoid circular dependency)
    const current = untrack(() => visible_properties) || []
    const has_changed =
      visible_keys.length !== current.length ||
      !visible_keys.every((key, idx) => key === current[idx])

    if (has_changed) {
      syncing_visible_properties = true
      visible_properties = visible_keys
      queueMicrotask(() => (syncing_visible_properties = false))
    }
  })

  // Handler for legend toggle - updates plot_series state
  function handle_legend_toggle(series_idx: number) {
    plot_series = toggle_series_visibility(plot_series, series_idx)
  }

  // Frame/step pairs backing the x axis. Eager trajectories supply every frame, indexed
  // ones only the sampled frames their plot metadata covers.
  let frame_step_samples = $derived(
    trajectory ? get_frame_step_samples(trajectory) : { frame_numbers: [], steps: [] },
  )
  let x_quantity_options = $derived(
    available_x_quantities(frame_step_samples, trajectory?.time_step, trajectory?.time_unit),
  )
  // Until the user picks one, take the most informative axis the file supports: a
  // trajectory whose steps are just 0, 1, 2, … offers nothing beyond the frame index.
  // Keep this priority explicit rather than coupling the default to the options' display order.
  // build_x_map validates explicit user choices, so x_map.quantity is the one actually in effect.
  let requested_x_quantity = $state<TrajectoryXQuantity | undefined>(untrack(() => x_quantity))
  let auto_picked_x_quantity = $state<TrajectoryXQuantity | undefined>(undefined)
  let auto_pick_active = $state(false)
  let chosen_x_quantity = $derived.by((): TrajectoryXQuantity => {
    const component_owned = auto_pick_active && x_quantity === auto_picked_x_quantity
    const preferred = component_owned ? requested_x_quantity : x_quantity
    if (preferred !== undefined && x_quantity_options.includes(preferred)) return preferred
    if (x_quantity_options.includes(`time`)) return `time`
    if (x_quantity_options.includes(`step`)) return `step`
    return `frame`
  })
  let x_map = $derived(
    build_x_map(frame_step_samples, chosen_x_quantity, {
      time_step: trajectory?.time_step,
      time_unit: trajectory?.time_unit,
    }),
  )
  // Report the axis actually in effect so hosts binding x_quantity see the resolved
  // value rather than undefined (auto-pick) or a quantity the data does not support.
  // Skip empty samples: writing `frame` before data loads would lock the prop and
  // prevent time→step→frame auto-pick once the trajectory arrives.
  $effect(() => {
    if (frame_step_samples.frame_numbers.length === 0) return
    const component_owned = auto_pick_active && x_quantity === auto_picked_x_quantity
    if (!component_owned) requested_x_quantity = x_quantity
    if (x_quantity !== x_map.quantity) {
      x_quantity = x_map.quantity
      auto_picked_x_quantity = x_map.quantity
      auto_pick_active = true
    } else if (!component_owned) {
      auto_pick_active = false
    }
  })
  // Time between frames, so displacement analyses report D in real units instead of
  // asking the user to retype a timestep the file already stated
  let frame_time_step = $derived(
    get_frame_time_step(frame_step_samples, trajectory?.time_step),
  )
  let x_axis = $derived({
    label: x_map.unit ? `${x_map.label} (${x_map.unit})` : x_map.label,
    // step_label_positions are frame indices; the axis is drawn in x units
    ticks: step_label_positions.map(x_map.to_x),
  })
  // Generate axis labels based on first visible series on each axis
  let y_axis_labels = $derived(generate_axis_labels(plot_series))
  // Axes whose visible series are all-positive and span many decades (e.g. SCF
  // convergence residuals) default to log scale instead of a linear hockey stick
  let y_axis_scale_types = $derived(generate_axis_scale_types(plot_series))
  let y_axis = $derived({
    label: y_axis_labels.y1,
    label_shift: { y: 10 },
    scale_type: y_axis_scale_types.y1,
  })
  let y2_axis = $derived({
    label: y_axis_labels.y2,
    label_shift: { y: 80 },
    scale_type: y_axis_scale_types.y2,
  })
  // hide plot if all plotted values are constant (no variation)
  let show_plot = $derived(
    display_mode !== `structure` &&
      (plot_metadata_loading || !should_hide_plot(trajectory, plot_series)),
  )
  let show_structure = $derived(![`scatter`, `histogram`].includes(display_mode))

  // Check if there are any Y2 series to determine padding
  let has_y2_series = $derived(plot_series.some((srs) => srs.y_axis === `y2` && srs.visible))
  // Report the current step to on_step_change consumers. Also wired to the step
  // slider/number input whose bind:value bypasses the navigation functions
  // below — those handlers pass the event target's value explicitly because
  // bind:value may not have written the binding yet when oninput fires.
  function notify_step_change(step_idx: number = current_step_idx) {
    if (!trajectory || !Number.isFinite(step_idx)) return
    const last_frame = Math.max(total_frames - 1, 0)
    const clamped_step = Math.min(Math.max(Math.round(step_idx), 0), last_frame)
    on_step_change?.({
      trajectory,
      step_idx: clamped_step,
      frame_count: total_frames,
      frame: current_frame || undefined,
    })
  }
  // Step navigation functions (streaming frame loading is handled by the reactive effect)
  function commit_step(idx: number) {
    if (idx < 0 || idx >= total_frames || idx === current_step_idx) return
    current_step_idx = idx
    notify_step_change()
    wrapper?.dispatchEvent(
      new CustomEvent(`matterviz:trajectory-step-commit`, { detail: { step_idx: idx } }),
    )
  }

  function queue_scrub_step(idx: number) {
    if (idx < 0 || idx >= total_frames || idx === pending_scrub_step) return
    pending_scrub_step = idx
    if (scrub_animation_frame !== undefined) return
    scrub_active = true
    if (scrub_settle_timeout !== undefined) clearTimeout(scrub_settle_timeout)
    scrub_settle_timeout = undefined
    scrub_animation_frame = requestAnimationFrame(() => {
      scrub_animation_frame = undefined
      const next_step_idx = pending_scrub_step
      pending_scrub_step = undefined
      if (next_step_idx !== undefined) commit_step(next_step_idx)
      scrub_settle_timeout = setTimeout(() => {
        scrub_settle_timeout = undefined
        scrub_active = false
      }, SCRUB_SETTLE_MS)
    })
  }

  function flush_scrub_step(idx = pending_scrub_step) {
    if (scrub_animation_frame !== undefined) {
      cancelAnimationFrame(scrub_animation_frame)
      scrub_animation_frame = undefined
    }
    if (scrub_settle_timeout !== undefined) clearTimeout(scrub_settle_timeout)
    scrub_settle_timeout = undefined
    scrub_active = false
    pending_scrub_step = undefined
    if (idx !== undefined) commit_step(idx)
  }

  function next_step() {
    commit_step(current_step_idx + 1)
  }

  function prev_step() {
    commit_step(current_step_idx - 1)
  }

  function go_to_step(idx: number) {
    flush_scrub_step(idx)
  }

  // Handle plot point clicks to jump to that step. x is in axis units (frame, step or
  // time), so it has to be mapped back before it can index a frame.
  function handle_plot_change(data: (Point & { series: DataSeries }) | null) {
    if (data?.x !== undefined && typeof data.x === `number`) {
      queue_scrub_step(x_map.to_frame(data.x))
    } else flush_scrub_step()
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
        trajectory,
        step_idx: current_step_idx,
        frame_count: total_frames,
      })
    }
  }
  // Advance one frame (or loop back to start), firing the matching callbacks
  function advance_playback() {
    if (current_step_idx >= total_frames - 1) {
      if (trajectory) {
        on_end?.({
          trajectory,
          step_idx: current_step_idx,
          frame_count: total_frames,
          frame: current_frame || undefined,
        })
      }
      go_to_step(0) // loop back to 1st step
      if (trajectory) on_loop?.({ trajectory, frame_count: total_frames })
    } else next_step()
  }

  // rAF playback loop. Only tracks `is_playing`; `fps`/`current_step_idx`/`total_frames` are read
  // live in the untracked tick, so changing fps mid-play retargets the cadence without restarting.
  // Clamped delta + at most one advance per tick lets a background tab resume cleanly (no jump),
  // but also caps playback at the ~60fps refresh rate (= default fps_range max; higher won't help).
  $effect(() => {
    if (!is_playing) return
    let last = performance.now()
    let accumulated_ms = 0
    const tick = (now: number) => {
      // stop if the trajectory went away or is no longer animatable (e.g. swapped mid-play)
      if (!trajectory || total_frames <= 1) {
        is_playing = false
        return
      }
      accumulated_ms += Math.min(now - last, 250)
      last = now
      const step_ms = 1000 / Math.max(0.1, fps)
      if (accumulated_ms >= step_ms) {
        accumulated_ms = Math.min(accumulated_ms - step_ms, step_ms)
        advance_playback()
      }
      play_raf = requestAnimationFrame(tick)
    }
    play_raf = requestAnimationFrame(tick)
    return () => {
      if (play_raf !== undefined) cancelAnimationFrame(play_raf)
      play_raf = undefined
    }
  })

  // Handle internal file format drops
  async function handle_internal_file_drop(internal_data: string): Promise<boolean> {
    try {
      const file_info = JSON.parse(internal_data)
      const source = { source_filename: file_info.name }

      // Check if this is a binary file
      let content = file_info.content
      if (file_info.is_binary && !(content instanceof ArrayBuffer)) {
        if (!file_info.content_url) {
          console.warn(`Binary file without ArrayBuffer or blob URL:`, file_info.name)
          return true
        }
        const response = await fetch(file_info.content_url)
        content = await response.arrayBuffer()
      }
      await load_trajectory_data(content, file_info.name, source)
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
    let source_filename: string | undefined

    try {
      // Check for our custom internal file format first
      const internal_data = event.dataTransfer?.getData(`application/x-matterviz-file`)
      if (internal_data) {
        const handled = await handle_internal_file_drop(internal_data)
        if (handled) return
      }

      // Handle URL-based files (e.g. from FilePicker)
      const handled = await io
        .handle_url_drop(event, (content, filename, metadata) => {
          current_filename = filename
          file_size =
            content instanceof ArrayBuffer ? content.byteLength : new Blob([content]).size
          return load_trajectory_data(content, filename, metadata)
        })
        .catch(() => false)

      if (handled) return

      // Handle file system drops with optimized large file support
      const file = event.dataTransfer?.files[0]
      if (file) {
        source_filename = file.name
        current_filename = file.name
        file_size = file.size
        current_file_path = file.webkitRelativePath || file.name
        file_object = file

        const { content, filename } = await io.decompress_file(file)
        await load_trajectory_data(content, filename, { source_filename: file.name })
        // Don't fall through: drops from IDEs/file managers often also carry a
        // text/plain payload (the file path) which would clobber the loaded data
        return
      }

      // Check for plain text data (fallback)
      const text_data = event.dataTransfer?.getData(`text/plain`)
      if (text_data) {
        file_size = new Blob([text_data]).size // Calculate byte size of text data
        await load_trajectory_data(text_data, `trajectory.json`)
      }
    } catch (error) {
      console.error(`File drop failed:`, error)
      error_msg = `Failed to load file: ${error}`
      on_error?.({ error_msg, filename: current_filename, source_filename, file_size })
    } finally {
      loading = false
    }
  }

  // Load trajectory from URL when data_url is provided. Track the model produced by
  // this effect so caller-owned trajectory props keep precedence while URL-owned
  // models can reload when data_url changes.
  $effect(() => {
    const requested_url = data_url
    const current_trajectory = trajectory
    const caller_owns_trajectory = Boolean(
      current_trajectory && current_trajectory !== url_owned_trajectory,
    )
    if (!requested_url || caller_owns_trajectory) {
      loaded_data_url = undefined
      url_owned_trajectory = undefined
      return
    }
    if (loaded_data_url === requested_url) return

    const load_id = ++data_url_load_id
    const is_current = () => load_id === data_url_load_id
    loading = true
    error_msg = null

    io.load_from_url(requested_url, (content, filename, metadata) => {
      if (!is_current()) return
      current_filename = filename
      file_size =
        content instanceof ArrayBuffer ? content.byteLength : new Blob([content]).size
      return load_trajectory_data(content, filename, {
        ...metadata,
        on_trajectory_loaded: (loaded_trajectory) => {
          if (!is_current()) return
          url_owned_trajectory = loaded_trajectory
          loaded_data_url = requested_url
        },
        should_commit: is_current,
      })
    })
      .catch((err: Error) => {
        if (!is_current()) return
        console.error(`Failed to load trajectory from URL:`, err)
        error_msg = `Failed to load trajectory: ${err.message}`
        current_filename = undefined
        file_size = undefined
        on_error?.({ error_msg, filename: io.basename_from_url(requested_url) })
      })
      .finally(() => {
        if (is_current()) loading = false
      })

    return () => {
      if (is_current()) {
        data_url_load_id += 1
        loading = false
      }
    }
  })

  // Watch for frame rate changes
  $effect(() => {
    on_frame_rate_change?.({ trajectory, fps })
  })

  async function load_trajectory_data(
    data: string | ArrayBuffer,
    filename: string,
    options: {
      on_trajectory_loaded?: (loaded_trajectory: TrajectoryType) => void
      should_commit?: () => boolean
    } & Partial<io.FileLoadMeta> = {},
  ) {
    const { on_trajectory_loaded, should_commit = () => true, ...source } = options
    loading = true
    error_msg = null
    parsing_progress = null

    // Reset previous loading state
    orig_data = null
    const file_size_bytes =
      data instanceof ArrayBuffer ? data.byteLength : new Blob([data]).size

    try {
      const data_size = data instanceof ArrayBuffer ? data.byteLength : data.length

      // Determine loading strategy based on file size
      const bin_file_threshold = loading_options.bin_file_threshold ?? MAX_BIN_FILE_SIZE
      const text_file_threshold = loading_options.text_file_threshold ?? MAX_TEXT_FILE_SIZE
      const is_large_file =
        (data instanceof ArrayBuffer && data_size > bin_file_threshold) ||
        (typeof data === `string` && data_size > text_file_threshold)

      // Large files get indexed loading by default (loading_options can override)
      const parsed_trajectory = await parse_trajectory_async(
        data,
        filename,
        (progress) => {
          if (should_commit()) parsing_progress = progress
        },
        {
          ...(is_large_file ? { use_indexing: true } : {}),
          ...loading_options,
          atom_type_mapping,
        },
      )
      if (!should_commit()) return
      trajectory = parsed_trajectory
      if (trajectory) on_trajectory_loaded?.(trajectory)
      // Keep original data only when parsing attached a frame_loader for on-demand loads.
      // Direct-parse fallbacks load all frames upfront, so retaining a duplicate wastes memory.
      orig_data = trajectory?.frame_loader ? data : null

      current_step_idx = 0
      current_filename = filename
      file_size = file_size_bytes

      const loaded_trajectory = trajectory
      on_file_load?.({
        // emit file load event
        trajectory: loaded_trajectory,
        frame_count: loaded_trajectory?.frames.length ?? 0,
        total_atoms: loaded_trajectory?.frames[0]?.structure.sites.length ?? 0,
        filename,
        ...source,
        file_size: file_size_bytes,
      })
    } catch (err) {
      if (!should_commit()) return
      const unsupported_message = get_unsupported_format_message(
        filename,
        typeof data === `string` ? data : ``,
      )
      error_msg = unsupported_message || `Failed to parse trajectory: ${err}`
      on_error?.({ error_msg, filename, ...source, file_size: file_size_bytes })
      current_filename = undefined
      file_size = undefined
    } finally {
      if (should_commit()) {
        parsing_progress = null
        loading = false
      }
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
  let analysis_menu_open = $state(false)

  // Handle click outside to close dropdowns
  function handle_click_outside(event: MouseEvent) {
    const target = event.target
    if (!(target instanceof Element)) return
    if (view_mode_dropdown_open && !target.closest(`.view-mode-dropdown-wrapper`)) {
      view_mode_dropdown_open = false
    }
    if (analysis_menu_open && !target.closest(`.analysis-dropdown-wrapper`)) {
      analysis_menu_open = false
    }
  }

  // Handle keyboard shortcuts. Returns true if the key was handled, so the caller
  // (handle_and_prevent / forward_window_keydown) can suppress the browser default.
  function onkeydown(event: KeyboardEvent): boolean {
    if (!trajectory) return false

    // Don't handle shortcuts if user is typing in an input field (but allow if it's our step input and not focused)
    const target = event.target instanceof HTMLElement ? event.target : null
    const is_step_input = target?.classList.contains(`step-input`) ?? false
    const is_input_focused = target?.tagName === `INPUT` || target?.tagName === `TEXTAREA`

    // Skip if typing in an input that's not our step input
    if (is_input_focused && !is_step_input) return false

    // If typing in step input, only handle certain navigation keys
    if (is_step_input && is_input_focused) {
      // Allow normal typing, but handle special navigation keys
      if ([`Escape`, `Enter`].includes(event.key)) target?.blur() // Remove focus from input
      return false
    }

    const is_cmd_or_ctrl = event.metaKey || event.ctrlKey

    // Only the Arrow keys intentionally use Cmd/Ctrl (jump to first/last). For any
    // other key a Cmd/Ctrl combo is a browser/OS shortcut (find, tab switch, zoom)
    // — bail so we neither hijack it nor preventDefault the browser's own action.
    if (is_cmd_or_ctrl && event.key !== `ArrowLeft` && event.key !== `ArrowRight`) return false

    // Track whether a shortcut fired so callers suppress browser defaults (page
    // scroll on Space/arrows/PageUp-Down/Home/End) only when we handled the key.
    let handled = true
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
    }  // Interface shortcuts
    else if (event.key === `f` && fullscreen_toggle) toggle_fullscreen(wrapper)
    // 'i' key handled by the TrajectoryInfoPane's built-in toggle
    // Playback speed shortcuts (only when playing)
    else if ((event.key === `=` || event.key === `+`) && is_playing) {
      fps = Math.min(fps_range[1], fps + 0.2)
      on_frame_rate_change?.({ trajectory, fps })
    } else if (event.key === `-` && is_playing) {
      fps = Math.max(fps_range[0], fps - 0.2)
      on_frame_rate_change?.({ trajectory, fps })
    }  // System shortcuts
    else if (event.key === `Escape`) {
      if (document.fullscreenElement) document.exitFullscreen()
      else if (view_mode_dropdown_open) view_mode_dropdown_open = false
      else if (analysis_menu_open) analysis_menu_open = false
      // Escape key for info pane handled by DraggablePane
    }  // Number keys 0-9 - jump to percentage of trajectory
    else if (event.key >= `0` && event.key <= `9`) {
      go_to_step(Math.floor((Number(event.key) / 10) * (total_frames - 1)))
    } else handled = false

    return handled
  }

  // Shared by every analysis pane: each keeps its DraggablePane toggle for layout anchoring
  // but hides it, since the analysis menu owns the clicks.
  let analysis_pane_props = $derived({
    trajectory,
    pane_props: { style: pane_max_height },
    toggle_props: {
      class: `analysis-toggle-anchor`,
      tabindex: -1,
      'aria-hidden': true,
      title: ``,
    },
  })
  // MSD and VACF both sweep the whole file and both label a time axis with the timestep the
  // file recorded, leaving the component and its open flag as the only difference between them.
  let correlation_pane_props = $derived({
    ...analysis_pane_props,
    raw_data: orig_data,
    default_dt: frame_time_step,
    default_time_unit: trajectory?.time_unit,
  })

  // Separate state variables for each pane to match component prop types
  let structure_info_open = $state(false)
  let scatter_controls = $state<ControlsConfig>({ open: false })
  let trajectory_export_open = $state(false)

  // Analyses offered by the Graph menu. Each pane is mounted separately below (they take
  // different props) but every menu entry is described here, so adding one is a list entry
  // plus a mount rather than another copy of the button markup.
  type AnalysisEntry = {
    // matches the `hidden` control name consumers pass via show_controls
    control_name: string
    label: string
    icon: IconName
    is_open: boolean
    toggle: () => void
  }
  let analysis_entries: AnalysisEntry[] = $derived([
    {
      control_name: `msd-pane`,
      label: `Mean squared displacement`,
      icon: `Graph`,
      is_open: msd_pane_open,
      toggle: () => (msd_pane_open = !msd_pane_open),
    },
    {
      control_name: `vacf-pane`,
      label: `Velocity autocorrelation & VDOS`,
      icon: `Graph`,
      is_open: vacf_pane_open,
      toggle: () => (vacf_pane_open = !vacf_pane_open),
    },
    {
      control_name: `structure-id-pane`,
      label: `Structure identification`,
      icon: `Atom`,
      is_open: structure_id_pane_open,
      toggle: () => (structure_id_pane_open = !structure_id_pane_open),
    },
    {
      control_name: `data-inspector-pane`,
      label: `Data inspector`,
      icon: `Database`,
      is_open: data_inspector_open,
      toggle: () => (data_inspector_open = !data_inspector_open),
    },
  ])
  let visible_analyses = $derived(
    analysis_entries.filter((entry) => controls_config.visible(entry.control_name)),
  )
  let any_analysis_open = $derived(analysis_entries.some((entry) => entry.is_open))

  sync_fullscreen({
    get_wrapper: () => wrapper,
    get_fullscreen: () => fullscreen,
    set_fullscreen: (val) => (fullscreen = val),
    get_bg_css_var: () => `--traj-bg-fullscreen`,
    on_change: (val) => on_fullscreen_change?.({ trajectory, fullscreen: val }),
  })
</script>

<div
  class:dragover
  class:active={is_playing ||
    structure_info_open ||
    controls_open ||
    scatter_controls.open ||
    trajectory_export_open ||
    info_pane_open ||
    any_analysis_open}
  bind:this={wrapper}
  role="button"
  tabindex="0"
  aria-label="Drop trajectory file here to load"
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
  ondrop={handle_file_drop}
  {...io.drag_over_handlers({
    allow: () => allow_file_drop,
    set_dragover: (over) => (dragover = over),
  })}
  onclick={handle_click_outside}
  onkeydown={handle_and_prevent(onkeydown)}
  {...rest}
  class={[`trajectory`, actual_layout, rest.class]}
  class:show-both-views={[`structure+scatter`, `structure+histogram`].includes(display_mode) &&
    show_plot &&
    show_structure}
  {@attach forward_window_keydown({ handle: onkeydown })}
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
    <TrajectoryError {error_msg} on_dismiss={() => (error_msg = null)} {error_snippet} />
  {:else if trajectory}
    {#if parse_warning_msg}
      <StatusMessage
        bind:message={parse_warning_msg}
        type="warning"
        dismissible
        style="position: absolute; bottom: 4pt; left: 4pt; right: 4pt; z-index: 2; font-size: 0.85em"
      />
    {/if}
    <!-- Trajectory Controls -->
    {#if controls_config.mode !== `never`}
      <!-- z-index inline, not in the scoped block: content-area follows in the DOM, so
        without a stacking value the open view-mode menu paints under the scatter traces -->
      <div
        class="trajectory-controls {controls_config.class}"
        style="z-index: var(--traj-controls-z-index, var(--z-index-viewer-pane, 10)); {controls_config.style ??
          ``}"
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
              {@attach tooltip({ allow_html: true })}
              onclick={() => {
                if (current_filename) {
                  navigator.clipboard.writeText(current_filename)
                  filename_copied = true
                  setTimeout(() => (filename_copied = false), 1000)
                }
              }}
            >
              {current_filename}
              {#if filename_copied}
                <Icon
                  icon="Check"
                  style="--icon-size: 16px; color: var(--success-color); position: absolute; right: 3pt; top: 50%; transform: translateY(-50%); animation: fade-in 0.1s; background: var(--surface-bg-hover); border-radius: 50%; padding: 2px; box-sizing: content-box"
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
                title="Previous step (←) · Home: first · j: −10 · PageUp: −25"
              >
                ⏮
              </button>
              <button
                onclick={toggle_play}
                disabled={total_frames <= 1}
                title={`${
                  is_playing ? `Pause` : `Play`
                } (Space) · ←/→ step · 0-9 jump % · +/- speed · f fullscreen`}
                class="play-button"
                class:playing={is_playing}
              >
                {is_playing ? `⏸` : `▶`}
              </button>
              <button
                onclick={next_step}
                disabled={current_step_idx === total_frames - 1 || is_playing}
                title="Next step (→) · End: last · l: +10 · PageDown: +25"
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
                value={current_step_idx}
                oninput={(event) => go_to_step(event.currentTarget.valueAsNumber)}
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
                  value={current_step_idx}
                  oninput={(event) => queue_scrub_step(event.currentTarget.valueAsNumber)}
                  onchange={(event) => flush_scrub_step(event.currentTarget.valueAsNumber)}
                  class="step-slider"
                  title="Drag to navigate steps"
                />
                {#if step_label_positions.length > 0}
                  <div class="step-labels">
                    {#each step_label_positions as step_idx (step_idx)}
                      {@const position_percent =
                        total_frames > 1 ? (step_idx / (total_frames - 1)) * 100 : 0}
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

          <!-- Frame rate control: shown for any multi-frame trajectory so speed can be set before play -->
          {#if total_frames > 1 && controls_config.visible(`fps`)}
            <label class="fps-section">
              FPS
              <input
                type="range"
                min={fps_range[0]}
                max={fps_range[1]}
                bind:value={fps}
                title="Frame rate: {format_num(fps, `.2~s`)} fps"
                style="width: clamp(60px, 8cqw, 90px)"
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
                {current_frame}
                {current_step_idx}
                {current_filename}
                {current_file_path}
                {file_size}
                {file_object}
                bind:pane_open={info_pane_open}
                pane_props={{ style: pane_max_height }}
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
                {resolve_frame}
                pane_props={{ style: pane_max_height }}
              />
            {/if}
            <!-- Analysis menu. These plot their own x axis (MSD plots lag time, not frame
            index) so they cannot share the step-linked scatter/histogram display modes. -->
            {#if trajectory && visible_analyses.length > 0}
              <div class="analysis-dropdown-wrapper">
                <button
                  type="button"
                  class="analysis-button"
                  class:active={analysis_menu_open || any_analysis_open}
                  title="Analysis"
                  aria-label="Analysis"
                  aria-expanded={analysis_menu_open}
                  onclick={() => {
                    analysis_menu_open = !analysis_menu_open
                    view_mode_dropdown_open = false
                  }}
                  style="background-color: transparent; padding: 0"
                >
                  <Icon icon="Graph" />
                  <Icon icon={analysis_menu_open ? `ArrowUp` : `ArrowDown`} />
                </button>
                {#if analysis_menu_open}
                  <div class="view-mode-dropdown analysis-dropdown">
                    {#each visible_analyses as entry (entry.control_name)}
                      <button
                        type="button"
                        class="view-mode-option"
                        class:selected={entry.is_open}
                        title={entry.label}
                        aria-pressed={entry.is_open}
                        onclick={() => {
                          entry.toggle()
                          analysis_menu_open = false
                        }}
                      >
                        <Icon icon={entry.icon} />
                        <span>{entry.label}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
                <TrajectoryMsdPane
                  {...correlation_pane_props}
                  bind:pane_open={msd_pane_open}
                />
                <TrajectoryVacfPane
                  {...correlation_pane_props}
                  bind:pane_open={vacf_pane_open}
                />
                <TrajectoryStructureIdPane
                  {...analysis_pane_props}
                  raw_data={orig_data}
                  bind:pane_open={structure_id_pane_open}
                />
                <!-- current_frame is only ever assigned for the index that was current when
                the load was issued (see load_frame_on_demand's request_is_current), so the
                two props below always describe the same frame even mid-scrub. -->
                <TrajectoryDataInspectorPane
                  {...analysis_pane_props}
                  {current_step_idx}
                  {current_frame}
                  {data_extractor}
                  bind:pane_open={data_inspector_open}
                  on_step_change={go_to_step}
                />
              </div>
            {/if}
            <!-- X-axis quantity: only offered when the file records steps (or a timestep)
            that say more than the frame index already does -->
            {#if plot_series.length > 0 && x_quantity_options.length > 1 && controls_config.visible(`x-axis`)}
              <select
                bind:value={() => x_map.quantity, (choice) => (x_quantity = choice)}
                class="x-quantity-select"
                title="Plot x axis"
                aria-label="Plot x axis"
              >
                {#each x_quantity_options as option (option)}
                  <option value={option}>{X_QUANTITY_LABELS[option]}</option>
                {/each}
              </select>
            {/if}
            <!-- Display mode dropdown -->
            {#if plot_series.length > 0 && controls_config.visible(`view-mode`)}
              <div class="view-mode-dropdown-wrapper">
                <button
                  onclick={() => {
                    view_mode_dropdown_open = !view_mode_dropdown_open
                    analysis_menu_open = false
                  }}
                  title={current_view_label}
                  class="view-mode-button"
                  class:active={view_mode_dropdown_open}
                  style="background-color: transparent; padding: 0"
                >
                  <Icon
                    icon={(
                      {
                        structure: `Atom`,
                        'structure+scatter': `TwoColumns`,
                        'structure+histogram': `TwoColumns`,
                        scatter: `ScatterPlot`,
                        histogram: `Histogram`,
                      } as const
                    )[display_mode]}
                  />
                  <Icon icon={view_mode_dropdown_open ? `ArrowUp` : `ArrowDown`} />
                </button>
                {#if view_mode_dropdown_open}
                  <div class="view-mode-dropdown">
                    {#each [{ mode: `structure`, icon: `Atom`, label: `Structure-only` }, { mode: `structure+scatter`, icon: `TwoColumns`, label: `Structure + Scatter` }, { mode: `structure+histogram`, icon: `TwoColumns`, label: `Structure + Histogram` }, { mode: `scatter`, icon: `ScatterPlot`, label: `Scatter-only` }, { mode: `histogram`, icon: `Histogram`, label: `Histogram-only` }] as const as option (option.mode)}
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
            {#if fullscreen_toggle && controls_config.visible(`fullscreen`)}
              <FullscreenButton
                bind:fullscreen
                children={typeof fullscreen_toggle === `function`
                  ? fullscreen_toggle
                  : undefined}
                class="fullscreen-button"
              />
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <div
      class="content-area"
      bind:clientWidth={content_size.width}
      bind:clientHeight={content_size.height}
      class:hide-plot={!show_plot}
      class:hide-structure={!show_structure}
      class:show-both={[`structure+scatter`, `structure+histogram`].includes(display_mode)}
      class:show-structure-only={display_mode === `structure`}
      class:show-plot-only={[`scatter`, `histogram`].includes(display_mode)}
    >
      {#if show_structure}
        <Structure
          structure={current_structure}
          allow_file_drop={false}
          style="height: 100%; min-height: 0; border-radius: var(--struct-border-radius, 0)"
          {...{
            show_image_atoms: false, // Default to false to avoid atoms popping in/out at cell edges
            ...structure_props,
            scene_props: trail_scene_props,
          }}
          bind:show_trajectory_lines
          bind:controls_open
          bind:info_pane_open={structure_info_open}
          bind:hidden_elements
        />
      {/if}

      {#if show_plot}
        {#if plot_metadata_loading}
          <Spinner
            text="Sampling trajectory plot data..."
            style="display: flex; justify-content: center; min-height: 0; margin: 0; color: var(--text-muted, currentColor); background: var(--surface-bg); --spinner-size: 1.4em"
          />
        {:else if display_mode === `scatter` || display_mode === `structure+scatter`}
          <ScatterPlot
            series={plot_series}
            {x_axis}
            {y_axis}
            {y2_axis}
            controls={scatter_controls}
            current_x_value={x_map.to_x(current_step_idx)}
            change={plot_skimming ? handle_plot_change : undefined}
            padding={{ t: 20, b: 60, r: has_y2_series ? 100 : 20 }}
            range_padding={0}
            style="height: 100%"
            {...scatter_props}
            legend={{
              ...(scatter_props.legend ?? {}),
              on_toggle: (series_idx: number) => {
                handle_legend_toggle(series_idx)
                scatter_props.legend?.on_toggle?.(series_idx)
              },
            }}
            class={scatter_props.class}
          >
            {#snippet tooltip({ x, y, metadata, label }: ScatterHandlerProps)}
              {@const formatted_y = typeof y === `number` ? format_num(y) : y}
              {x_axis.label}: {format_num(x, `~g`)}<br />
              {@html sanitize_html(metadata?.series_label || label || `Value`)}: {formatted_y}
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
            on_series_toggle={(series_idx: number) => {
              handle_legend_toggle(series_idx)
              histogram_props.on_series_toggle?.(series_idx)
            }}
            style="height: 100%"
            class={histogram_props.class}
            --ctrl-btn-top="6ex"
          >
            {#snippet tooltip({
              value,
              count,
              property,
            }: {
              value: number
              count: number
              property?: string
            })}
              {#if property}<div><strong>{property}</strong></div>{/if}
              <div>Value: {format_num(value)}</div>
              <div>Count: {count}</div>
            {/snippet}
          </Histogram>
        {/if}
      {/if}
    </div>
  {:else}
    <EmptyState class="trajectory-empty-state">
      <h3>Load Trajectory</h3>
      <p>
        Drop a trajectory file here (.xyz, .extxyz, .json, .json.gz, XDATCAR, .traj, .h5) or
        provide trajectory data via props
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
      <p>💡 Force vectors will be automatically displayed when present in trajectory data</p>
    </EmptyState>
  {/if}
</div>

<style>
  .trajectory {
    --min-height: 500px;
    --traj-pane-divider: color-mix(in srgb, currentColor 15%, transparent);
    display: flex;
    flex-direction: column;
    height: var(--traj-height, 100%);
    position: relative;
    min-height: var(--traj-min-height, var(--min-height));
    /* Square by default; opt into rounding with --traj-border-radius. */
    border-radius: var(--traj-border-radius, 0);
    /* Follow host theme; avoid transparent shells sitting on a dark parent fallback. */
    background: var(--traj-bg, var(--surface-bg, var(--page-bg, Canvas)));
    color: var(--traj-color, var(--text-color, CanvasText));
    box-sizing: border-box;
    contain: layout;
    z-index: var(--traj-z-index, 1);
    container-type: size; /* enable cqh for panes if explicit height is set */
    &.active {
      z-index: 2; /* needed so info/control panes from an active viewer overlay those of the next (if there is one) */
    }
    &:fullscreen {
      height: 100vh !important;
      width: 100vw !important;
      border-radius: 0 !important;
      background: var(--traj-bg-fullscreen, var(--traj-bg, var(--surface-bg)));
      overflow: hidden;
    }
    /* Equal tracks, plus a hairline between them drawn as a shadow so the 1px
       cannot nudge either pane's layout. The structure paints above the plot
       (z-index 3), so its shadow lands on top of the plot's background. */
    &.horizontal .content-area {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      &.show-both:not(.hide-plot):not(.hide-structure) > :global(.structure) {
        box-shadow: 1px 0 0 var(--traj-pane-divider);
      }
    }
    &.vertical .content-area {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
      &.show-both:not(.hide-plot):not(.hide-structure) > :global(.structure) {
        box-shadow: 0 1px 0 var(--traj-pane-divider);
      }
    }
    /* Display mode specific layouts */
    &:is(.horizontal, .vertical) .content-area:is(.show-structure-only, .show-plot-only) {
      grid-template-columns: minmax(0, 1fr) !important;
      grid-template-rows: minmax(0, 1fr) !important;
    }
    &.dragover {
      background-color: var(--traj-dragover-bg, var(--dragover-bg));
      border: var(--traj-dragover-border, var(--dragover-border));
    }
    /* Mode: hover - controls visible on component hover */
    &:hover .trajectory-controls.hover-visible,
    &:focus-within .trajectory-controls.hover-visible {
      opacity: 1;
      pointer-events: auto;
    }
  }
  /* Content area - grid container for equal sizing */
  .content-area {
    display: grid;
    flex: 1;
    min-height: 0; /* important for tall structure viewers not to overflow */
    /* The panes split this box evenly, so a plot's own floor (350px for scatter,
       300px for histogram) must not bid for track space: in a fixed-height card
       it wins the row and leaves the structure with the remainder. minmax(0, 1fr)
       above caps the track; without this the plot would just overflow it. */
    --scatter-min-height: 0;
    --histogram-min-height: 0;
    /* When plot or structure is hidden, the other takes full space */
    &:is(.hide-plot, .hide-structure) {
      grid-template-columns: minmax(0, 1fr) !important;
      grid-template-rows: minmax(0, 1fr) !important;
    }
  }
  .trajectory-controls {
    display: flex;
    align-items: center;
    gap: clamp(4pt, 1.6cqw, 1.5ex);
    padding: clamp(2pt, 0.5cqw, 1ex) clamp(4pt, 1cqw, 1.2ex);
    font-size: var(--traj-controls-font-size, 0.85rem);
    /* Square icon boxes: Export's viewBox is taller than wide, so height:auto
       from svelte-widgets Icon makes it overshoot neighboring glyphs. */
    --icon-size: var(--traj-controls-icon-size, 1.05em);
    /* Pair chrome + ink with light-dark so a light toolbar hosted in a dark app
       (chat attachments) does not inherit near-white --text-color onto FPS/labels. */
    background: var(--traj-controls-bg, var(--surface-bg-hover, light-dark(#f4f4f5, #2a2c33)));
    color: var(--traj-controls-color, light-dark(#1a1a1a, #e8e8e8));
    backdrop-filter: blur(4px);
    position: relative;
    border-radius: var(--traj-controls-border-radius, 0);
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
      z-index: var(--traj-controls-focus-z-index, var(--z-index-viewer-dropdown, 100));
    }
    button {
      background: var(--btn-bg);
      font-size: inherit;
      line-height: 1;
      &:hover:not(:disabled) {
        background: var(--btn-bg-hover);
      }
    }
    /* Force square icons inside panes/toggles that pierce scoped styles. */
    :global(svg) {
      width: var(--icon-size);
      height: var(--icon-size);
    }
    input[type='number'] {
      font: inherit;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
      padding: 1px 3px;
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
    gap: clamp(3pt, 1cqw, 9pt);
  }
  .step-section {
    display: flex;
    align-items: center;
    gap: clamp(0.25rem, 1.5cqw, 0.5rem);
    flex: 1;
    min-width: 0;
  }
  .step-section > span {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    opacity: 0.75;
  }
  .fps-section {
    display: flex;
    align-items: center;
    gap: 5pt;
    margin-inline: 6pt;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .step-input {
    border: 1px solid rgba(99, 179, 237, 0.3);
    text-align: center;
    margin: 0 -5px 0 0;
    min-width: 3.5em;
  }
  .slider-container {
    position: relative;
    flex: 1;
    min-width: var(--trajectory-slider-min-width, 100px);
  }
  .step-slider {
    width: 100%;
    position: relative;
    z-index: 1; /* keep the slider knob above the step labels (which follow it in the DOM) */
  }
  .step-labels {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
  }
  .step-tick {
    position: absolute;
    transform: translateX(-50%);
    width: var(--trajectory-step-tick-width, 1px);
    height: var(--trajectory-step-tick-height, 3px);
    background: var(--text-color-muted);
    top: var(--trajectory-step-tick-offset, 5px);
  }
  .step-label {
    position: absolute;
    transform: translateX(-50%);
    font-size: clamp(0.5em, 1.2cqw, 0.65em);
    color: var(--text-color-muted);
    white-space: nowrap;
    text-align: center;
    top: calc(
      var(--trajectory-step-tick-offset, 5px) + var(--trajectory-step-tick-height, 3px) + 1px
    );
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
  /* :global pierces into FullscreenButton's markup (anchored on local .info-section) */
  .info-section :global(.fullscreen-button) {
    background: transparent !important;
    padding: 0;
    &:hover:not(:disabled) {
      background: var(--border-color);
    }
  }
  .info-section {
    display: flex;
    align-items: center;
    gap: clamp(3pt, 0.6cqw, 1ex);
    position: relative;
  }
  .info-section :global(:is(.trajectory-info-toggle, .trajectory-export-toggle)) {
    font-size: inherit;
    line-height: 1;
    padding: 0;
    background: transparent;
  }
  .play-button {
    min-width: clamp(32px, 4cqw, 36px);
    &:hover:not(:disabled) {
      background: var(--traj-play-btn-bg-hover, var(--btn-bg-hover, rgba(0, 0, 0, 0.2)));
    }
    &.playing {
      background: var(--traj-pause-btn-bg, var(--btn-bg, rgba(0, 0, 0, 0.1)));
      &:hover:not(:disabled) {
        background: var(--traj-pause-btn-bg-hover, var(--btn-bg-hover, rgba(0, 0, 0, 0.1)));
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
        grid-template-columns: minmax(0, 1fr) !important;
        grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) !important;
      }
    }
  }
  .view-mode-dropdown-wrapper,
  .analysis-dropdown-wrapper {
    display: flex;
    position: relative;
    align-items: center;
    z-index: var(--trajectory-view-mode-z-index, 20);
  }
  .x-quantity-select {
    padding: 1pt 2pt;
    font-size: 0.85em;
    background: transparent;
    border: var(--tooltip-border);
    border-radius: 3pt;
  }
  .view-mode-button,
  .analysis-button {
    display: flex;
    align-items: center;
    gap: 1pt;
  }
  .analysis-button.active {
    color: var(--accent-color, #4a9eff);
  }
  /* Keep DraggablePane's toggle for layout anchoring; the analysis menu owns clicks. */
  .analysis-dropdown-wrapper :global(.analysis-toggle-anchor) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .view-mode-dropdown {
    position: absolute;
    top: 115%;
    right: 0;
    z-index: var(--trajectory-view-mode-dropdown-z-index, 30);
    min-width: max-content;
    background: var(--trajectory-view-mode-bg, var(--menu-bg));
    color: var(--trajectory-view-mode-color, var(--menu-color));
    border: 1px solid var(--trajectory-view-mode-border, var(--menu-border));
    border-radius: var(--trajectory-view-mode-border-radius, 4px);
    box-shadow:
      0 8px 16px -4px rgba(0, 0, 0, 0.3),
      0 4px 8px -2px rgba(0, 0, 0, 0.1);
    pointer-events: auto;
  }
  .view-mode-option {
    display: flex;
    align-items: center;
    gap: 1ex;
    width: 100%;
    padding: var(--trajectory-view-mode-option-padding, 5pt);
    box-sizing: border-box;
    background: transparent;
    color: inherit;
    border-radius: 0;
    text-align: left;
    transition: background-color 0.15s ease;
    &:hover,
    &:focus-visible {
      background: var(--trajectory-view-mode-option-hover-bg, var(--menu-option-hover-bg));
    }
    &:first-child {
      border-top-left-radius: 3px;
      border-top-right-radius: 3px;
    }
    &.selected {
      color: var(--accent-color, var(--menu-option-selected-color));
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

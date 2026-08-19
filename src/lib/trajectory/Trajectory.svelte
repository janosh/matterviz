<script lang="ts">
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import type { ElementSymbol } from '$lib/element'
  import EmptyState from '$lib/EmptyState.svelte'
  import { StatusMessage } from '$lib/feedback'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { Icon } from 'svelte-widgets'
  import {
    ArrowDown,
    ArrowUp,
    Atom,
    Check,
    Database,
    Graph,
    Histogram as HistogramIcon,
    ScatterPlot as ScatterPlotIcon,
    TwoColumns,
  } from 'svelte-widgets/icons'
  import * as io from '$lib/io'
  import { handle_and_prevent, to_error } from '$lib/utils'
  import { format_num, trajectory_property_config, type TrajPropertyConfig } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import { collect_msd_positions, suggest_msd_frame_stride } from '$lib/msd/collect'
  import TrajectoryMsdPane from '$lib/msd/TrajectoryMsdPane.svelte'
  import { has_all_frames_in_memory } from '$lib/trajectory/analysis'
  import { sanitize_html } from '$lib/sanitize'
  import { FullscreenButton } from '$lib/layout'
  import PaneDivider from '$lib/layout/PaneDivider.svelte'
  import { create_sequence_player } from '$lib/layout/sequence-player.svelte'
  import SequenceControlBar from '$lib/layout/SequenceControlBar.svelte'
  import SequenceControls from '$lib/layout/SequenceControls.svelte'
  import type { DataSeries, Orientation } from '$lib/plot'
  import type { ScatterHandlerProps } from '$lib/plot/core/types'
  import { Histogram, ScatterPlot } from '$lib/plot'
  import { toggle_series_visibility } from '$lib/plot/core/utils/series-visibility'
  import { DEFAULTS } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import Structure from '$lib/structure/Structure.svelte'
  import TrajectoryStructureIdPane from '$lib/structure-id/TrajectoryStructureIdPane.svelte'
  import TrajectorySpectroscopyPane from '$lib/spectral/TrajectorySpectroscopyPane.svelte'
  import {
    MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES,
    parse_trajectory_in_worker,
  } from '$lib/file-viewer/parse-in-worker'
  import { collected_frame_idx } from '$lib/structure/trajectory-lines'
  import TrajectoryVacfPane from '$lib/vacf/TrajectoryVacfPane.svelte'
  import { scaleLinear } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import { onDestroy, untrack } from 'svelte'
  import { forward_window_keydown, tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { full_data_extractor } from './extract'
  import type {
    FrameLoader,
    ParseProgress,
    TrajectoryDataExtractor,
    TrajectoryController,
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
  import { Hdf5TrajectoryGroupSelectionError } from './parse/hdf5'
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
    on_controller?: (controller: TrajectoryController | null) => void
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
  type PendingHdf5GroupSelection = {
    group_paths: string[]
    filename: string
    source: Partial<io.FileLoadMeta>
    on_trajectory_loaded?: (loaded_trajectory: TrajectoryType) => void
    should_commit: () => boolean
    data?: ArrayBuffer
  }
  type Hdf5PathGroup = { trunk: string; paths: string[] }
  const compare_hdf5_paths = (first_path: string, second_path: string): number =>
    first_path.localeCompare(second_path, undefined, { numeric: true })
  const group_hdf5_paths = (paths: string[]): Hdf5PathGroup[] =>
    Object.entries(
      paths.reduce<Record<string, string[]>>((groups, path) => {
        const slash_idx = path.lastIndexOf(`/`)
        const trunk = slash_idx > 0 ? path.slice(0, slash_idx) : `/`
        const group = groups[trunk] ?? (groups[trunk] = [])
        group.push(path)
        return groups
      }, {}),
    )
      .toSorted(([first_trunk], [second_trunk]) =>
        compare_hdf5_paths(first_trunk, second_trunk),
      )
      .map(([trunk, group_paths]) => ({
        trunk,
        paths: group_paths.toSorted(compare_hdf5_paths),
      }))
  const hdf5_path_leaf = (path: string) => path.slice(path.lastIndexOf(`/`) + 1)
  const DISPLAY_MODES = [
    { mode: `structure`, icon: Atom, label: `Structure-only` },
    { mode: `structure+scatter`, icon: TwoColumns, label: `Structure + Scatter` },
    { mode: `structure+histogram`, icon: TwoColumns, label: `Structure + Histogram` },
    { mode: `scatter`, icon: ScatterPlotIcon, label: `Scatter-only` },
    { mode: `histogram`, icon: HistogramIcon, label: `Histogram-only` },
  ] as const
  type TrajectoryControlName =
    | `filename`
    | `nav`
    | `step`
    | `fps`
    | `info-pane`
    | `export-pane`
    | `msd-pane`
    | `vacf-pane`
    | `spectroscopy-pane`
    | `structure-id-pane`
    | `data-inspector-pane`
    | `x-axis`
    | `view-mode`
    | `fullscreen`

  let {
    trajectory = $bindable(),
    data_url,
    current_step_idx = $bindable(0),
    data_extractor = full_data_extractor,
    allow_file_drop = true,
    layout = `auto`,
    pane_ratio = $bindable(0.5),
    structure_props = {},
    supercell_scaling = $bindable(structure_props.supercell_scaling ?? `1x1x1`),
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
    on_controller,
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
    spectroscopy_pane_open = $bindable(false),
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
      pane_ratio?: number
      // structure viewer props (passed to Structure component)
      structure_props?: ComponentProps<typeof Structure>
      // bindable supercell selector state forwarded to the structure viewer
      supercell_scaling?: string
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
      // Control names: 'filename', 'nav', 'step', 'fps', 'info-pane', 'export-pane', 'msd-pane', 'vacf-pane', 'structure-id-pane', 'data-inspector-pane', 'x-axis', 'view-mode', 'fullscreen'
      show_controls?: ShowControlsProp<TrajectoryControlName>
      // show/hide the fullscreen button
      fullscreen_toggle?: boolean
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
      fps_range?: Readonly<Vec2> // allowed FPS range [min_fps, max_fps]
      fps?: number // frame rate for playback
      // Loading options for large files
      loading_options?: LoadingOptions
      // Map LAMMPS atom types to element symbols (e.g. {1: 'Na', 2: 'Cl'})
      atom_type_mapping?: AtomTypeMapping
      // Disable plot navigation (clicking the plot doesn't update structure/step slider)
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
      // bindable: whether the finite-temperature IR / Raman / VDOS pane is open
      spectroscopy_pane_open?: boolean
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
  let controls_height = $state(0)
  let current_filename = $state<string | undefined>(undefined)
  let current_file_path = $state<string | null>(null)
  let file_size = $state<number | undefined>(undefined)
  let file_object = $state<File | null>(null)
  let hdf5_group_selection = $state<PendingHdf5GroupSelection | undefined>(undefined)
  let hdf5_path_groups = $derived(
    hdf5_group_selection ? group_hdf5_paths(hdf5_group_selection.group_paths) : [],
  )
  let load_id = 0
  let active_parse_controller: AbortController | null = null
  let load_owned_trajectory: TrajectoryType | undefined
  let previous_data_url: string | undefined
  let data_url_load_id = 0
  let parsing_progress = $state<ParseProgress | null>(null)
  let content_size = $state({ width: 0, height: 0 })
  // Cap panes to .content-area (controls bar is a flex sibling above it).
  let pane_max_height = $derived(
    content_size.height > 0 ? `max-height: ${content_size.height}px` : undefined,
  )
  let filename_copied = $state(false)
  let orig_data = $state<string | ArrayBuffer | null>(null)
  let trajectory_metadata_revision = $state(0)
  const data_url_loader = io.create_data_url_loader<TrajectoryType>()

  $effect(() => {
    if (trajectory === load_owned_trajectory) return
    load_id += 1
    active_parse_controller?.abort()
    active_parse_controller = null
    hdf5_group_selection = undefined
    loading = false
  })

  let controls_config = $derived(normalize_show_controls(show_controls))

  // Reactive layout based on the size of the box actually being split (for auto
  // mode). Measured on .content-area, not the wrapper: a mounted controls bar is
  // ~32px of the wrapper's height that no pane ever gets.
  let actual_layout = $derived.by(() => {
    if (layout === `horizontal` || layout === `vertical`) return layout
    const { width, height } = content_size
    return width > 0 && height > 0 ? pick_pane_orientation(width, height) : `horizontal`
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
    Boolean(
      trajectory &&
      total_frames >= 2 &&
      (has_all_frames_in_memory(trajectory) ||
        (trajectory.frame_loader?.requires_source === false &&
          trajectory.frame_loader.stream_positions)),
    ),
  )
  // Source-dependent indexed trajectories need a second full parse for an optional overlay.
  // In-memory and source-free streaming trajectories are collected only when trails are enabled.
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
  const PREFETCH_DELAY_MS = 40
  let scrub_active = $state(false)
  let scrub_animation_frame: number | undefined
  let scrub_settle_timeout: ReturnType<typeof setTimeout> | undefined
  let prefetch_timeout: ReturnType<typeof setTimeout> | undefined
  let pending_prefetch_from_idx: number | undefined
  let pending_scrub_step: number | undefined

  // Convert source-frame playhead to collected frames; collection and scrub deferral remain
  // owned by the trajectory interaction pipeline.
  let trail_end_owner: TrajectoryPositionStream | null = null
  let settled_trail_end_frame: number | undefined
  let trajectory_line_end_frame = $derived.by(() => {
    if (!trail_stream) {
      trail_end_owner = null
      settled_trail_end_frame = undefined
      return undefined
    }
    if (trail_stream !== trail_end_owner || !scrub_active) {
      trail_end_owner = trail_stream
      settled_trail_end_frame = collected_frame_idx(trail_stream, current_step_idx)
    }
    return settled_trail_end_frame
  })
  let trail_scene_props = $derived({
    ...structure_props.scene_props,
    trajectory_position_stream:
      !spectroscopy_pane_open && trajectory_lines_available ? trail_stream : undefined,
    trajectory_line_end_frame: spectroscopy_pane_open ? undefined : trajectory_line_end_frame,
    show_trajectory_lines: spectroscopy_pane_open ? false : show_trajectory_lines,
    defer_expensive_geometry: spectroscopy_pane_open ? false : scrub_active,
  })

  // Current frame - load on demand for indexed trajectories
  // Frames can contain thousands of sites and the owning trajectory can contain tens of
  // thousands of frames. Deep-proxying each selected frame makes pointer scrubbing pay proxy
  // traps throughout structure normalization, bonding, and scene-buffer updates.
  let current_frame = $state.raw<TrajectoryFrame | null>(null)
  let current_frame_idx: number | undefined
  let frame_read_active = false
  let pending_frame_idx: number | undefined
  const set_current_frame = (frame: TrajectoryFrame | null, frame_idx?: number): void => {
    current_frame = frame
    current_frame_idx = frame ? frame_idx : undefined
  }

  // Update current frame when step changes
  $effect(() => {
    if (trajectory && current_step_idx >= 0 && current_step_idx < total_frames) {
      if (trajectory.frame_loader) {
        // Load frame on demand (works for both indexed files and external streaming)
        set_current_frame(null)
        schedule_frame_load_on_demand(current_step_idx)
      } else {
        // Use in-memory frame for regular trajectories
        set_current_frame(trajectory.frames[current_step_idx] || null, current_step_idx)
      }
    } else {
      set_current_frame(null)
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
  let active_frame_loader: FrameLoader | undefined
  $effect(() => {
    const next_frame_loader = trajectory?.frame_loader
    if (next_frame_loader === active_frame_loader) return
    active_frame_loader?.dispose?.()
    active_frame_loader = next_frame_loader
  })
  let streaming_file_path = $derived(
    trajectory?.metadata?.streaming_file_path as string | undefined,
  )
  let plot_metadata_loading = $derived.by(() => {
    void trajectory_metadata_revision
    return trajectory?.metadata?.plot_metadata_loading === true
  })

  // Apply metadata in place so active indexed-frame loads and caches keep their owner.
  // No-op while a data_url switch is in flight so stale streams can't mutate the old model.
  const update_trajectory = (
    updates: Partial<Pick<TrajectoryType, `metadata` | `plot_metadata`>>,
  ) => {
    const { loaded_url } = data_url_loader
    if (!trajectory || (data_url && loaded_url && data_url !== loaded_url)) return
    Object.assign(trajectory, updates)
    trajectory_metadata_revision += 1
  }

  const merge_plot_metadata = (batch: TrajectoryMetadata[]) => {
    if (batch.length === 0) return
    update_trajectory({ plot_metadata: [...(trajectory?.plot_metadata ?? []), ...batch] })
  }

  const finish_plot_metadata_loading = () =>
    update_trajectory({
      metadata: { ...trajectory?.metadata, plot_metadata_loading: false },
    })

  const handle_plot_metadata_stream = (event: MessageEvent<PlotMetadataStreamMessage>) => {
    // Global listener: other code posts arbitrary messages (including null data)
    if (typeof event.data !== `object` || event.data === null) return
    const { command, file_path, is_complete, plot_metadata } = event.data
    if (command !== `plot_metadata_stream` || file_path !== streaming_file_path) return
    if (Array.isArray(plot_metadata)) merge_plot_metadata(plot_metadata)
    if (is_complete) finish_plot_metadata_loading()
  }

  onDestroy(() => {
    if (scrub_animation_frame !== undefined) cancelAnimationFrame(scrub_animation_frame)
    if (scrub_settle_timeout !== undefined) clearTimeout(scrub_settle_timeout)
    if (prefetch_timeout !== undefined) clearTimeout(prefetch_timeout)
    active_frame_loader?.dispose?.()
    active_parse_controller?.abort()
  })

  // Reset per-trajectory caches when the trajectory changes (frames belong to the old one)
  function ensure_frame_cache_owner() {
    if (frame_cache_owner !== trajectory) {
      frame_cache = new SvelteMap()
      frame_cache_atom_count = 0
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
  const frame_atom_count = (frame: TrajectoryFrame): number => frame.structure.sites.length
  function cache_put(frame_idx: number, frame: TrajectoryFrame) {
    untrack(() => {
      const previous = frame_cache.get(frame_idx)
      if (previous) {
        frame_cache_atom_count -= frame_atom_count(previous)
        frame_cache.delete(frame_idx)
      }
      frame_cache.set(frame_idx, frame)
      frame_cache_atom_count += frame_atom_count(frame)
      while (
        frame_cache.size > 1 &&
        (frame_cache.size > FRAME_CACHE_MAX || frame_cache_atom_count > FRAME_CACHE_MAX_ATOMS)
      ) {
        const oldest = frame_cache.keys().next().value
        if (oldest === undefined) break
        const oldest_frame = frame_cache.get(oldest)
        if (oldest_frame) frame_cache_atom_count -= frame_atom_count(oldest_frame)
        frame_cache.delete(oldest)
      }
    })
  }

  const emit_frame_load_state = (frame_idx: number) => {
    wrapper?.dispatchEvent(
      new CustomEvent(`matterviz:trajectory-load-state`, {
        detail: {
          frame_idx,
          inflight: frame_read_active ? 1 : 0,
          cached_frames: untrack(() => frame_cache.size),
          cached_atoms: frame_cache_atom_count,
        },
      }),
    )
  }

  const finish_frame_read = (frame_idx: number, prefetch_from_idx?: number) => {
    frame_read_active = false
    emit_frame_load_state(frame_idx)
    const next_frame_idx = pending_frame_idx
    pending_frame_idx = undefined
    if (next_frame_idx === current_step_idx) {
      schedule_frame_load_on_demand(next_frame_idx)
    } else if (prefetch_from_idx !== undefined) {
      prefetch_frames(prefetch_from_idx)
    }
  }

  const cancel_scheduled_prefetch = () => {
    if (prefetch_timeout !== undefined) clearTimeout(prefetch_timeout)
    prefetch_timeout = undefined
    pending_prefetch_from_idx = undefined
  }

  // Delay speculative work briefly so a pointer/slider burst can cancel it before it occupies
  // the single frame-read lane. Sequential playback still gets one warmed frame between ticks.
  function prefetch_frames(from_idx: number) {
    if (scrub_active) return
    pending_prefetch_from_idx = from_idx
    if (prefetch_timeout !== undefined) return
    prefetch_timeout = setTimeout(() => {
      prefetch_timeout = undefined
      const next_from_idx = pending_prefetch_from_idx
      pending_prefetch_from_idx = undefined
      if (next_from_idx !== undefined) start_frame_prefetch(next_from_idx)
    }, PREFETCH_DELAY_MS)
  }

  // Warm one adjacent frame only while the demand lane is idle. A new scrub target waits for
  // an already-started read instead of starting another, keeping decode/IPC backlog bounded.
  function start_frame_prefetch(from_idx: number) {
    const frame_loader = trajectory?.frame_loader
    if (
      scrub_active ||
      !frame_loader ||
      frame_read_active ||
      pending_frame_idx !== undefined
    ) {
      return
    }
    const owner = trajectory
    for (const ahead of [1, 2]) {
      const idx = from_idx + ahead
      if (idx >= total_frames || untrack(() => frame_cache.has(idx))) continue
      if (frame_loader.load_frame_sync) {
        const frame = frame_loader.load_frame_sync(idx)
        if (frame && frame_cache_owner === owner) cache_put(idx, frame)
        break
      }
      frame_read_active = true
      emit_frame_load_state(idx)
      frame_loader
        .load_frame(orig_data || ``, idx)
        .then((frame) => {
          if (frame && frame_cache_owner === owner) cache_put(idx, frame)
        })
        .catch((error) => console.warn(`Failed to prefetch trajectory frame ${idx}:`, error))
        .finally(() => finish_frame_read(idx))
      break
    }
  }

  function use_cached_or_in_memory_frame(
    load_trajectory: TrajectoryType,
    frame_idx: number,
  ): boolean {
    const cached = cache_get(frame_idx)
    const frame = cached ?? load_trajectory.frames[frame_idx]
    if (!frame) return false
    set_current_frame(frame, frame_idx)
    prefetch_frames(frame_idx)
    return true
  }

  function schedule_frame_load_on_demand(frame_idx: number) {
    const load_trajectory = trajectory
    if (!load_trajectory?.frame_loader) return
    cancel_scheduled_prefetch()
    ensure_frame_cache_owner()

    if (use_cached_or_in_memory_frame(load_trajectory, frame_idx)) {
      pending_frame_idx = undefined
      return
    }
    if (load_trajectory.frame_loader.load_frame_sync) {
      const frame = load_trajectory.frame_loader.load_frame_sync(frame_idx)
      if (frame) {
        cache_put(frame_idx, frame)
        set_current_frame(frame, frame_idx)
        prefetch_frames(frame_idx)
      }
      pending_frame_idx = undefined
      return
    }
    pending_frame_idx = frame_idx
    if (frame_read_active) return
    pending_frame_idx = undefined
    void load_frame_on_demand(load_trajectory, frame_idx)
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
    if (owner.frame_loader.load_frame_sync) {
      return owner.frame_loader.load_frame_sync(frame_idx)
    }
    const frame = await owner.frame_loader.load_frame(orig_data || ``, frame_idx)
    // A swap mid-export must not emit the old trajectory's frames into the new one's file.
    // Deliberately not cached: a whole-range export would evict every frame playback holds.
    return trajectory === owner ? frame : null
  }

  // Load frame on demand - works for both indexed files and external streaming
  async function load_frame_on_demand(load_trajectory: TrajectoryType, frame_idx: number) {
    const frame_loader = load_trajectory.frame_loader
    if (!frame_loader) return
    const request_is_current = () =>
      trajectory === load_trajectory && current_step_idx === frame_idx

    frame_read_active = true
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
      set_current_frame(frame, frame_idx)
      prefetch_from_idx = frame_idx
    } catch (error) {
      if (!request_is_current()) return
      console.error(`Failed to load frame ${frame_idx}:`, error)
      set_current_frame(null)
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
  let current_structure = $state.raw<AnyStructure | undefined>(undefined)
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
    void trajectory_metadata_revision
    if (syncing_visible_properties) return
    const keys_set = keys ? new SvelteSet(keys) : undefined

    if (traj?.plot_metadata) {
      const width_point_limit = Math.floor(content_size.width / 2)
      plot_series = generate_streaming_plot_series(traj.plot_metadata, {
        property_config: config,
        default_visible_properties: keys_set,
        max_points: Math.max(128, Math.min(1000, width_point_limit)),
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
  let frame_step_samples = $derived.by(() => {
    void trajectory_metadata_revision
    return trajectory ? get_frame_step_samples(trajectory) : { frame_numbers: [], steps: [] }
  })
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
  // Spectroscopy owns the plot region while open; otherwise hide a constant-value plot.
  let show_plot = $derived(
    spectroscopy_pane_open ||
      (display_mode !== `structure` &&
        (plot_metadata_loading || !should_hide_plot(trajectory, plot_series))),
  )
  let show_structure = $derived(
    spectroscopy_pane_open || ![`scatter`, `histogram`].includes(display_mode),
  )

  // Reserve y2 padding only when the secondary axis has a value it can render.
  let has_y2_series = $derived(
    plot_series.some(
      ({ y, y_axis: axis_name, visible }) =>
        axis_name === `y2` && visible && y.some(Number.isFinite),
    ),
  )
  // Keep plot configuration referentially stable while only the active frame changes.
  // Recreating these objects in the template invalidates ScatterPlot's layout scales and
  // spatial hover index, turning a cursor move into an O(n_frames) update on long trajectories.
  let trajectory_scatter_padding = $derived({
    t: 20,
    b: 60,
    r: has_y2_series ? 100 : 20,
  })
  const handle_scatter_legend_toggle = (series_idx: number) => {
    handle_legend_toggle(series_idx)
    scatter_props.legend?.on_toggle?.(series_idx)
  }
  let trajectory_scatter_legend = $derived({
    ...scatter_props.legend,
    on_toggle: handle_scatter_legend_toggle,
  })
  let trajectory_hover_config = $derived({
    ...scatter_props.hover_config,
    mode: `x` as const,
  })
  // The structure tracks every scrub frame, but repainting the entire plot merely to move its
  // small active-frame tick competes with that 3D update. Hold the tick still during a pointer
  // burst and snap it to the selected frame when the scrub settles.
  let settled_plot_step_idx = $state(current_step_idx)
  $effect(() => {
    if (!scrub_active) settled_plot_step_idx = current_step_idx
  })
  // Report the current step to consumers after explicit slider, input, or plot navigation.
  function notify_step_change(step_idx: number = current_step_idx) {
    if (!trajectory || !Number.isFinite(step_idx)) return
    const last_frame = Math.max(total_frames - 1, 0)
    const clamped_step = Math.min(Math.max(Math.round(step_idx), 0), last_frame)
    on_step_change?.({
      trajectory,
      step_idx: clamped_step,
      frame_count: total_frames,
      frame: current_frame_idx === clamped_step ? current_frame || undefined : undefined,
    })
  }
  // Step navigation (streaming frame loading is handled by the reactive effect).
  function commit_step(idx: number) {
    if (idx < 0 || idx >= total_frames || idx === current_step_idx) return
    current_step_idx = idx
    if (trajectory && !trajectory.frame_loader) {
      set_current_frame(trajectory.frames[idx] || null, idx)
    }
    notify_step_change()
    wrapper?.dispatchEvent(
      new CustomEvent(`matterviz:trajectory-step-commit`, { detail: { step_idx: idx } }),
    )
  }

  function begin_scrub() {
    scrub_active = true
    cancel_scheduled_prefetch()
    if (scrub_settle_timeout !== undefined) clearTimeout(scrub_settle_timeout)
    scrub_settle_timeout = undefined
  }

  function schedule_scrub_settle() {
    scrub_settle_timeout = setTimeout(() => {
      scrub_settle_timeout = undefined
      scrub_active = false
      prefetch_frames(current_step_idx)
    }, SCRUB_SETTLE_MS)
  }

  function queue_scrub_step(idx: number) {
    if (idx < 0 || idx >= total_frames || idx === pending_scrub_step) return
    pending_scrub_step = idx
    if (scrub_animation_frame !== undefined) return
    begin_scrub()
    scrub_animation_frame = requestAnimationFrame(() => {
      scrub_animation_frame = undefined
      const next_step_idx = pending_scrub_step
      pending_scrub_step = undefined
      try {
        if (next_step_idx !== undefined) commit_step(next_step_idx)
      } finally {
        schedule_scrub_settle()
      }
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
    cancel_scheduled_prefetch()
    pending_scrub_step = undefined
    if (idx !== undefined) commit_step(idx)
  }

  const controller: TrajectoryController = {
    set_step: (step_idx) => {
      if (!Number.isFinite(step_idx))
        throw new Error(`Step index must be finite, got ${step_idx}`)
      const bounded_step_idx = Math.min(
        Math.max(Math.floor(step_idx), 0),
        Math.max(total_frames - 1, 0),
      )
      playback.go_to(bounded_step_idx)
      return bounded_step_idx
    },
    state: () => ({ current_step_idx, total_frames }),
  }

  $effect(() => {
    on_controller?.(controller)
    return () => on_controller?.(null)
  })

  // Map the clicked plot coordinate back to the corresponding trajectory frame.
  const handle_plot_click = (data: { x: number }) => commit_step(x_map.to_frame(data.x))

  const emit_playback = (
    handler: ((data: TrajHandlerData) => void) | undefined,
    extra: TrajHandlerData = {},
  ) => {
    if (trajectory) handler?.({ trajectory, frame_count: total_frames, ...extra })
  }

  const playback = create_sequence_player({
    count: () => total_frames,
    index: () => current_step_idx,
    set_index: flush_scrub_step,
    set_step_index: commit_step,
    fps: () => fps,
    set_fps: (value) => (fps = value),
    fps_range: () => fps_range,
    should_auto_play: () => auto_play && Boolean(trajectory) && !spectroscopy_pane_open,
    on_play: () => emit_playback(on_play, { step_idx: current_step_idx }),
    on_pause: () => emit_playback(on_pause, { step_idx: current_step_idx }),
    on_end: () => {
      emit_playback(on_end, {
        step_idx: current_step_idx,
        frame: current_frame || undefined,
      })
    },
    on_loop: () => emit_playback(on_loop),
  })
  let active_sequence = $derived({
    playback,
    index: current_step_idx,
    count: total_frames,
    step_label_positions,
    item_name: `step`,
    on_index_input: queue_scrub_step,
  })
  $effect(() => {
    if (spectroscopy_pane_open) playback.pause()
  })

  async function select_hdf5_group(path: string): Promise<void> {
    const selection = hdf5_group_selection
    if (!selection || !selection.should_commit()) return
    hdf5_group_selection = undefined
    loading = true
    try {
      let data = selection.data
      let filename = selection.filename
      if (!data) {
        const file = selection.source.file
        if (!file) throw new Error(`HDF5 group selection is missing source data`)
        const decompressed = await io.decompress_file(file)
        if (!(decompressed.content instanceof ArrayBuffer)) {
          throw new Error(`HDF5 group data must be binary`)
        }
        data = decompressed.content
        filename = decompressed.filename
      }
      await load_trajectory_data(data, filename, {
        ...selection.source,
        on_trajectory_loaded: selection.on_trajectory_loaded,
        hdf5_group_path: path,
        should_commit: selection.should_commit,
      })
    } catch (error) {
      if (!selection.should_commit()) return
      const load_error_msg = `Failed to load HDF5 group: ${to_error(error).message}`
      on_error?.({
        error_msg: load_error_msg,
        filename: selection.filename,
        ...selection.source,
        file_size: selection.source.file?.size,
      })
      error_msg = load_error_msg
    } finally {
      if (selection.should_commit()) loading = false
    }
  }

  // Handle internal file format drops
  async function handle_internal_file_drop(
    internal_data: string,
    should_commit: () => boolean,
  ): Promise<boolean> {
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
      await load_trajectory_data(content, file_info.name, { ...source, should_commit })
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

    const drop_id = ++load_id
    active_parse_controller?.abort()
    const should_commit = () => drop_id === load_id
    hdf5_group_selection = undefined
    loading = true
    let dropped_file: File | undefined

    try {
      // Check for our custom internal file format first
      const internal_data = event.dataTransfer?.getData(`application/x-matterviz-file`)
      if (internal_data) {
        const handled = await handle_internal_file_drop(internal_data, should_commit)
        if (handled) return
      }

      // Handle URL-based files (e.g. from FilePicker)
      const handled = await io
        .handle_url_drop(event, (content, filename, metadata) =>
          load_trajectory_data(content, filename, { ...metadata, should_commit }),
        )
        .catch(() => false)

      if (handled) return

      // Handle file system drops with optimized large file support
      const file = event.dataTransfer?.files[0]
      if (file) {
        dropped_file = file

        const { content, filename } = await io.decompress_file(file)
        await load_trajectory_data(content, filename, {
          source_filename: file.name,
          file,
          should_commit,
        })
        // Don't fall through: drops from IDEs/file managers often also carry a
        // text/plain payload (the file path) which would clobber the loaded data
        return
      }

      // Check for plain text data (fallback)
      const text_data = event.dataTransfer?.getData(`text/plain`)
      if (text_data) {
        await load_trajectory_data(text_data, `trajectory.json`, { should_commit })
      }
    } catch (error) {
      if (!should_commit()) return
      console.error(`File drop failed:`, error)
      error_msg = `Failed to load file: ${error}`
      on_error?.({
        error_msg,
        filename: dropped_file?.name ?? current_filename,
        source_filename: dropped_file?.name,
        file_size: dropped_file?.size ?? file_size,
      })
    } finally {
      if (should_commit()) loading = false
    }
  }

  // Load trajectory from URL when data_url is provided. Track the model produced by
  // this effect so caller-owned trajectory props keep precedence while URL-owned
  // models can reload when data_url changes.
  $effect(() => {
    if (data_url !== previous_data_url) {
      previous_data_url = data_url
      data_url_load_id = ++load_id
      active_parse_controller?.abort()
      hdf5_group_selection = undefined
    }
    const should_commit = () => data_url_load_id === load_id
    return data_url_loader.request({
      url: data_url,
      current_value: trajectory,
      set_loading: (value) => {
        if (should_commit()) loading = value
      },
      clear_error: () => {
        if (should_commit()) error_msg = null
      },
      on_load: ({ content, filename, metadata, is_current, mark_owned }) => {
        return load_trajectory_data(content, filename, {
          ...metadata,
          on_trajectory_loaded: mark_owned,
          should_commit: () => should_commit() && is_current(),
        })
      },
      on_error: (err, filename) => {
        if (!should_commit()) return
        console.error(`Failed to load trajectory from URL:`, err)
        error_msg = `Failed to load trajectory: ${err.message}`
        current_filename = undefined
        file_size = undefined
        on_error?.({ error_msg, filename })
      },
    })
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
      hdf5_group_path?: string
    } & Partial<io.FileLoadMeta> = {},
  ) {
    const {
      on_trajectory_loaded,
      should_commit = () => true,
      hdf5_group_path,
      ...source
    } = options
    if (!should_commit()) return
    loading = true
    hdf5_group_selection = undefined
    error_msg = null
    parsing_progress = null
    active_parse_controller?.abort()
    const parse_controller = new AbortController()
    active_parse_controller = parse_controller

    const file_size_bytes = io.content_byte_size(data)

    try {
      // Determine loading strategy based on file size
      const bin_file_threshold = loading_options.bin_file_threshold ?? MAX_BIN_FILE_SIZE
      const text_file_threshold = loading_options.text_file_threshold ?? MAX_TEXT_FILE_SIZE
      const is_large_file =
        file_size_bytes >
        (data instanceof ArrayBuffer ? bin_file_threshold : text_file_threshold)

      // Large files get indexed loading by default (loading_options can override)
      const on_progress = (progress: ParseProgress): void => {
        if (should_commit()) parsing_progress = progress
      }
      const parse_options = {
        ...(is_large_file ? { use_indexing: true } : {}),
        ...loading_options,
        atom_type_mapping,
        ...(hdf5_group_path ? { hdf5_group_path } : {}),
      }
      const parsed_trajectory = is_large_file
        ? await parse_trajectory_in_worker(data, filename, on_progress, parse_options, {
            signal: parse_controller.signal,
            transfer_source:
              data instanceof ArrayBuffer &&
              Boolean(source.file) &&
              file_size_bytes > MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES,
          })
        : await parse_trajectory_async(data, filename, on_progress, parse_options)
      if (!should_commit()) return
      trajectory = parsed_trajectory
      load_owned_trajectory = trajectory
      if (trajectory) on_trajectory_loaded?.(trajectory)
      // Keep original data only when parsing attached a frame_loader for on-demand loads.
      // Direct-parse fallbacks load all frames upfront, so retaining a duplicate wastes memory.
      orig_data =
        parsed_trajectory.frame_loader &&
        parsed_trajectory.frame_loader.requires_source !== false
          ? data
          : null

      current_step_idx = 0
      current_filename = filename
      file_size = file_size_bytes
      if (source.file) {
        current_file_path = source.file.webkitRelativePath || source.file.name
        file_object = source.file
      }

      on_file_load?.({
        // emit file load event
        trajectory: parsed_trajectory,
        frame_count: parsed_trajectory.total_frames ?? parsed_trajectory.frames.length,
        total_atoms: parsed_trajectory.frames[0]?.structure.sites.length ?? 0,
        filename,
        ...source,
        file_size: file_size_bytes,
      })
    } catch (err) {
      if (!should_commit()) return
      if (err instanceof Hdf5TrajectoryGroupSelectionError && data instanceof ArrayBuffer) {
        hdf5_group_selection = {
          group_paths: err.group_paths,
          filename,
          source,
          on_trajectory_loaded,
          should_commit,
          data: source.file ? undefined : data,
        }
        return
      }
      const unsupported_message = get_unsupported_format_message(
        filename,
        typeof data === `string` ? data : ``,
      )
      error_msg = unsupported_message || `Failed to parse trajectory: ${err}`
      on_error?.({ error_msg, filename, ...source, file_size: file_size_bytes })
      current_filename = undefined
      file_size = undefined
    } finally {
      if (active_parse_controller === parse_controller) active_parse_controller = null
      if (should_commit()) {
        parsing_progress = null
        loading = false
      }
    }
  }

  let current_display_mode = $derived.by(() => {
    const option = DISPLAY_MODES.find((entry) => entry.mode === display_mode)
    if (option) return option
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
    if (hdf5_group_selection && event.key === `Escape`) {
      hdf5_group_selection = undefined
      return true
    }
    if (!trajectory) return false

    // Don't handle shortcuts while the user is editing form or rich-text content.
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target && (target.matches(`input, textarea, select`) || target.isContentEditable)) {
      if (target.classList.contains(`step-input`) && [`Escape`, `Enter`].includes(event.key)) {
        target.blur()
      }
      return false
    }

    const is_cmd_or_ctrl = event.metaKey || event.ctrlKey
    if (is_cmd_or_ctrl && event.key !== `ArrowLeft` && event.key !== `ArrowRight`) return false

    const {
      index: sequence_index,
      count: sequence_count,
      playback: sequence_player,
    } = active_sequence
    let handled = true
    if (event.key === ` `) sequence_player.toggle()
    else if (event.key === `ArrowLeft`) {
      if (is_cmd_or_ctrl) sequence_player.go_to(0)
      else sequence_player.previous()
    } else if (event.key === `ArrowRight`) {
      if (is_cmd_or_ctrl) sequence_player.go_to(sequence_count - 1)
      else sequence_player.next()
    } else if (event.key === `Home`) sequence_player.go_to(0)
    else if (event.key === `End`) sequence_player.go_to(sequence_count - 1)
    else if (event.key === `j`) sequence_player.go_to(sequence_index - 10)
    else if (event.key === `l`) sequence_player.go_to(sequence_index + 10)
    else if (event.key === `PageUp`) sequence_player.go_to(sequence_index - 25)
    else if (event.key === `PageDown`) sequence_player.go_to(sequence_index + 25)
    else if (event.key === `f` && fullscreen_toggle) fullscreen = !fullscreen
    // 'i' key handled by the TrajectoryInfoPane's built-in toggle
    else if (sequence_player.is_playing && [`=`, `+`, `-`].includes(event.key)) {
      sequence_player.fps +=
        event.key === `-` ? -sequence_player.fps_step : sequence_player.fps_step
    } else if (event.key === `Escape`) {
      if (document.fullscreenElement) document.exitFullscreen()
      else if (view_mode_dropdown_open) view_mode_dropdown_open = false
      else if (analysis_menu_open) analysis_menu_open = false
      // Escape key for info pane handled by ViewerPane
    } else if (event.key >= `0` && event.key <= `9`) {
      sequence_player.go_to(Math.floor((Number(event.key) / 10) * (sequence_count - 1)))
    } else handled = false
    return handled
  }

  // Shared by floating analysis panes: each keeps its ViewerPane toggle for layout anchoring
  // but hides it, since the analysis menu owns the clicks. Spectroscopy renders in the plot.
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
  let scatter_controls_open = $derived(scatter_props.controls_open ?? false)
  let trajectory_export_open = $state(false)

  // Analyses offered by the Graph menu. Floating panes mount beside the menu; spectroscopy
  // mounts once in the plot region so its controls and calculated result survive toggling.
  let analysis_entries = $derived([
    {
      control_name: `msd-pane`,
      label: `Mean squared displacement`,
      icon: Graph,
      is_open: msd_pane_open,
      toggle: () => (msd_pane_open = !msd_pane_open),
    },
    {
      control_name: `vacf-pane`,
      label: `Velocity autocorrelation & VDOS`,
      icon: Graph,
      is_open: vacf_pane_open,
      toggle: () => (vacf_pane_open = !vacf_pane_open),
    },
    {
      control_name: `spectroscopy-pane`,
      label: `Trajectory IR/Raman & VDOS`,
      icon: Graph,
      is_open: spectroscopy_pane_open,
      toggle: () => (spectroscopy_pane_open = !spectroscopy_pane_open),
    },
    {
      control_name: `structure-id-pane`,
      label: `Structure identification`,
      icon: Atom,
      is_open: structure_id_pane_open,
      toggle: () => (structure_id_pane_open = !structure_id_pane_open),
    },
    {
      control_name: `data-inspector-pane`,
      label: `Data inspector`,
      icon: Database,
      is_open: data_inspector_open,
      toggle: () => (data_inspector_open = !data_inspector_open),
    },
  ])
  let visible_analyses = $derived(
    analysis_entries.filter((entry) => controls_config.visible(entry.control_name)),
  )
  let any_analysis_open = $derived(analysis_entries.some((entry) => entry.is_open))
</script>

<svelte:window onmessage={handle_plot_metadata_stream} />

<div
  class:dragover
  class:active={active_sequence.playback.is_playing ||
    structure_info_open ||
    controls_open ||
    scatter_controls_open ||
    trajectory_export_open ||
    info_pane_open ||
    any_analysis_open}
  bind:this={wrapper}
  data-scrubbing={scrub_active}
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
  class={[`trajectory sequence-viewer`, actual_layout, rest.class]}
  class:show-both-views={show_plot && show_structure && !spectroscopy_pane_open}
  class:spectroscopy-mode={spectroscopy_pane_open}
  {@attach forward_window_keydown({ handle: onkeydown })}
>
  {#if hdf5_group_selection}
    <EmptyState
      class="hdf5-group-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Choose HDF5 trajectory"
      style="justify-content: flex-start"
    >
      <h3>Choose trajectory</h3>
      <p>
        <code>{hdf5_group_selection.filename}</code> contains multiple trajectories; choose one to
        load.
      </p>
      <div
        class="hdf5-group-options"
        class:flat={hdf5_path_groups.length === 1}
        role="group"
        aria-label="HDF5 trajectory groups"
      >
        {#each hdf5_path_groups as { trunk, paths }, group_idx (trunk)}
          <div
            class="hdf5-path-group"
            style={`--hdf5-path-hue: ${(200 + group_idx * 89) % 360}deg`}
          >
            {#if trunk !== `/`}
              <div class="hdf5-path-trunk" title={trunk}><code>{trunk}</code></div>
            {/if}
            <div class="hdf5-path-leaves">
              {#each paths as group_path (group_path)}
                <button
                  class="hdf5-group-option"
                  data-hdf5-group={group_path}
                  title={group_path}
                  onclick={() => void select_hdf5_group(group_path)}
                >
                  <code>{hdf5_path_leaf(group_path)}</code>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <button onclick={() => (hdf5_group_selection = undefined)}>Cancel</button>
    </EmptyState>
  {:else if loading}
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
    <SequenceControlBar
      class="trajectory-controls"
      {controls_config}
      bind:height={controls_height}
    >
      {#if trajectory_controls}
        {@render trajectory_controls({
          trajectory,
          current_step_idx,
          total_frames,
          on_step_change: flush_scrub_step,
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
                icon={Check}
                style="--icon-size: 16px; color: var(--success-color); position: absolute; right: 3pt; top: 50%; transform: translateY(-50%); animation: fade-in 0.1s; background: var(--surface-bg-hover); border-radius: 50%; padding: 2px; box-sizing: content-box"
              />
            {/if}
          </button>
        {/if}

        <SequenceControls
          {controls_config}
          index={active_sequence.index}
          count={active_sequence.count}
          playback={active_sequence.playback}
          step_label_positions={active_sequence.step_label_positions}
          item_name={active_sequence.item_name}
          previous_title={`Previous ${active_sequence.item_name} (←) · Home: first · j: −10 · PageUp: −25`}
          play_title={`${active_sequence.playback.is_playing ? `Pause` : `Play`} (Space) · ←/→ step · 0-9 jump % · +/- speed · f fullscreen`}
          next_title={`Next ${active_sequence.item_name} (→) · End: last · l: +10 · PageDown: +25`}
          on_index_input={active_sequence.on_index_input}
        />

        <!-- Frame info section -->
        <div class="info-section">
          {#if controls_config.visible(`info-pane`)}
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
              on_step_change={flush_scrub_step}
              {resolve_frame}
              pane_props={{ style: pane_max_height }}
            />
          {/if}
          <!-- Analysis menu. These plot their own x axis (MSD plots lag time, not frame
            index) so they cannot share the step-linked scatter/histogram display modes. -->
          {#if visible_analyses.length > 0}
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
                <Icon icon={Graph} />
                <Icon icon={analysis_menu_open ? ArrowUp : ArrowDown} />
              </button>
              {#if analysis_menu_open}
                <div class="view-mode-dropdown analysis-dropdown">
                  {#each visible_analyses as entry (entry.control_name)}
                    <button
                      type="button"
                      class={['view-mode-option', { selected: entry.is_open }]}
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
              <TrajectoryMsdPane {...correlation_pane_props} bind:pane_open={msd_pane_open} />
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
                on_step_change={flush_scrub_step}
              />
            </div>
          {/if}
          <!-- X-axis quantity: only offered when the file records steps (or a timestep)
            that say more than the frame index already does -->
          {#if !spectroscopy_pane_open && plot_series.length > 0 && x_quantity_options.length > 1 && controls_config.visible(`x-axis`)}
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
                title={current_display_mode.label}
                class={['view-mode-button', { active: view_mode_dropdown_open }]}
                style="background-color: transparent; padding: 0"
              >
                <Icon icon={current_display_mode.icon} />
                <Icon icon={view_mode_dropdown_open ? ArrowUp : ArrowDown} />
              </button>
              {#if view_mode_dropdown_open}
                <div class="view-mode-dropdown">
                  {#each DISPLAY_MODES as option (option.mode)}
                    <button
                      class={['view-mode-option', { selected: display_mode === option.mode }]}
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
              {wrapper}
              bg_css_var="--traj-bg-fullscreen"
              on_change={(value) => on_fullscreen_change?.({ trajectory, fullscreen: value })}
              class="fullscreen-button"
            />
          {/if}
        </div>
      {/if}
    </SequenceControlBar>

    <div
      class="content-area"
      bind:clientWidth={content_size.width}
      bind:clientHeight={content_size.height}
      class:hide-plot={!show_plot}
      class:hide-structure={!show_structure}
      class:show-both={show_structure && show_plot}
      class:show-structure-only={show_structure && !show_plot}
      class:show-plot-only={!show_structure && show_plot}
      style:--viewer-buttons-top={controls_config.mode === `hover`
        ? `calc(${controls_height}px + 1ex)`
        : undefined}
    >
      {#if show_structure}
        <Structure
          structure={current_structure}
          structure_series_key={trajectory}
          allow_file_drop={false}
          style="height: 100%; min-height: 0; border-radius: var(--struct-border-radius, 0)"
          {...{
            show_image_atoms: false, // Default to false to avoid atoms popping in/out at cell edges
            // Coordinate playback is not a stream of new crystals to classify. Running Moyo
            // symmetry analysis on every slider event dominated small-molecule scrubbing and
            // started stale async work that the next frame immediately discarded.
            analyze_symmetry: false,
            ...structure_props,
            scene_props: trail_scene_props,
          }}
          bind:show_trajectory_lines
          bind:supercell_scaling
          bind:controls_open
          bind:info_pane_open={structure_info_open}
          bind:hidden_elements
        />
      {/if}

      {#if show_structure && show_plot}
        <PaneDivider
          orientation={actual_layout}
          bind:ratio={pane_ratio}
          aria-label="Resize structure and plot panes"
        />
      {/if}

      <TrajectorySpectroscopyPane
        inline
        {trajectory}
        raw_data={orig_data}
        bind:pane_open={spectroscopy_pane_open}
      />

      {#if show_plot && !spectroscopy_pane_open}
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
            bind:controls_open={scatter_controls_open}
            current_x_value={x_map.to_x(settled_plot_step_idx)}
            on_plot_click={plot_skimming ? handle_plot_click : undefined}
            padding={trajectory_scatter_padding}
            range_padding={0}
            style="height: 100%"
            {...scatter_props}
            hover_config={trajectory_hover_config}
            legend={trajectory_scatter_legend}
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
            legend={histogram_props.legend}
            on_series_toggle={(series_idx: number) => {
              handle_legend_toggle(series_idx)
              histogram_props.on_series_toggle?.(series_idx)
            }}
            style="height: 100%"
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
    display: flex;
    flex-direction: column;
    height: var(--traj-height, 100%);
    position: relative;
    min-height: var(--traj-min-height, var(--min-height));
    --traj-surface-bg: var(
      --traj-bg,
      color-mix(in srgb, var(--page-bg, Canvas) 97%, var(--text-color, CanvasText) 3%)
    );
    --struct-bg: var(--traj-surface-bg);
    --plot-bg: var(--traj-surface-bg);
    border-radius: var(--traj-border-radius, 4px);
    background: var(--traj-surface-bg);
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
      background: var(--traj-bg-fullscreen, var(--traj-surface-bg));
      overflow: hidden;
    }
    &.horizontal .content-area {
      grid-template-columns: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
    }
    &.vertical .content-area {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
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
  }
  /* Content area - resizable pane grid */
  .content-area {
    display: grid;
    position: relative;
    flex: 1;
    min-height: 0; /* important for tall structure viewers not to overflow */
    /* The panes share this box, so a plot's own floor (350px for scatter,
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
  :global(.hdf5-group-picker) {
    max-height: 100cqh;
    min-height: 0;
    overflow: hidden;
  }
  .hdf5-group-options {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
    align-content: start;
    min-height: 0;
    overflow-y: auto;
    gap: 0.5rem;
    width: 100%;
    &.flat {
      display: block;
      .hdf5-path-leaves {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
        gap: 0.5rem;
      }
      .hdf5-group-option {
        text-align: left;
      }
    }
    &:not(.flat) {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 23rem), 1fr));
      width: min(100%, 52rem);
      margin-inline: auto;
    }
  }
  .hdf5-path-group {
    --hdf5-path-color: hsl(var(--hdf5-path-hue) 55% 45%);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    padding: 0.25rem;
    background: color-mix(in srgb, var(--hdf5-path-color) 8%, transparent);
    border-inline-start: 3px solid var(--hdf5-path-color);
    border-radius: var(--border-radius, 3pt);
  }
  .hdf5-path-trunk {
    overflow: hidden;
    color: color-mix(in srgb, var(--hdf5-path-color) 72%, var(--text-color, CanvasText));
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hdf5-path-leaves {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(3rem, 1fr));
    gap: 0.25rem;
  }
  .hdf5-group-option {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
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
      &.show-both-views:not(.spectroscopy-mode) {
        min-height: calc(var(--min-height) * 2);
      }
      /* Modern browsers: use :has() for same effect */
      @supports selector(:has(.content-area)) {
        &:not(.spectroscopy-mode):has(
            .content-area.show-both:not(.hide-plot):not(.hide-structure)
          ) {
          min-height: calc(var(--min-height) * 2);
        }
      }
      &.vertical .content-area.show-both:not(.hide-plot):not(.hide-structure) {
        grid-template-columns: minmax(0, 1fr) !important;
        grid-template-rows: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr) !important;
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
  /* Keep ViewerPane's toggle for layout anchoring; the analysis menu owns clicks. */
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

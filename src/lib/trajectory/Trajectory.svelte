<script lang="ts">
  // Pure viewer over a TrajectoryRun: playback, the structure + plot split, analysis panes
  // and export. It borrows the run and never parses or disposes it; acquisition (URLs, drops,
  // decompression, HDF5 group choice, errors) lives in TrajectoryFileViewer.svelte.
  import { create_flash } from '$lib/effects.svelte'
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import type { ElementSymbol } from '$lib/element'
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
  import { handle_and_prevent, to_error } from '$lib/utils'
  import { is_editable_event_target } from 'svelte-widgets/utils'
  import { format_num, plural, trajectory_property_config } from '$lib/labels'
  import type { TrajPropertyConfig } from '$lib/labels'
  import { clamp } from '$lib/math'
  import type { Vec2 } from '$lib/math'
  import TrajectoryMsdPane from '$lib/msd/TrajectoryMsdPane.svelte'
  import TrajectoryRdfPane from '$lib/rdf/TrajectoryRdfPane.svelte'
  import { sanitize_html } from '$lib/sanitize'
  import { FullscreenButton } from '$lib/layout'
  import { ToolbarMenu } from '$lib/overlays'
  import PaneDivider from '$lib/layout/PaneDivider.svelte'
  import SequenceControlBar from '$lib/layout/SequenceControlBar.svelte'
  import SequenceControls from '$lib/layout/SequenceControls.svelte'
  import type { DataSeries, HistogramSeries, Orientation } from '$lib/plot'
  import { first_point_style } from '$lib/plot/core/data-transform'
  import type { ScatterHandlerProps } from '$lib/plot/core/types'
  import { Histogram, ScatterPlot } from '$lib/plot'
  import { toggle_series_visibility } from '$lib/plot/core/utils/series-visibility'
  import { DEFAULTS } from '$lib/settings'
  import type { StructurePane } from '$lib/structure'
  import Structure from '$lib/structure/Structure.svelte'
  import TrajectoryStructureIdPane from '$lib/structure-id/TrajectoryStructureIdPane.svelte'
  import TrajectorySpectroscopyPane from '$lib/spectral/TrajectorySpectroscopyPane.svelte'
  import { collected_frame_idx } from '$lib/structure/trajectory-lines'
  import TrajectoryVacfPane from '$lib/vacf/TrajectoryVacfPane.svelte'
  import { scaleLinear } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { forward_window_keydown, tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import type {
    TrajectoryController,
    TrajectoryPositionStream,
    TrajectoryXQuantity,
    TrajHandlerData,
  } from './index'
  import {
    pick_pane_orientation,
    TrajectoryDataInspectorPane,
    TrajectoryExportPane,
    TrajectoryInfoPane,
  } from './index'
  import { collect_trajectory_positions } from './analysis'
  import { suggest_frame_stride } from './runs/accumulate'
  import {
    available_x_quantities,
    build_x_map,
    generate_axis_labels,
    generate_axis_scale_types,
    generate_plot_series,
    get_frame_step_samples,
    get_frame_time_step,
    prepare_trajectory_scatter_series,
    property_key,
    should_hide_plot,
    X_QUANTITY_LABELS,
  } from './plotting'
  import type { TrajectoryRun } from './run'
  import { create_trajectory_session } from './session.svelte'

  export type TrajectoryPane =
    | `controls`
    | `info`
    | `msd`
    | `vacf`
    | `rdf`
    | `spectroscopy`
    | `structure-id`
    | `data-inspector`
    | `export`
  export type TrajectoryDisplayMode =
    | `structure+scatter`
    | `structure`
    | `scatter`
    | `histogram`
    | `structure+histogram`
  export type TrajectoryControlName =
    | `filename`
    | `nav`
    | `step`
    | `fps`
    | `info-pane`
    | `export-pane`
    | `msd-pane`
    | `vacf-pane`
    | `rdf-pane`
    | `spectroscopy-pane`
    | `structure-id-pane`
    | `data-inspector-pane`
    | `x-axis`
    | `view-mode`
    | `fullscreen`
  type ControlsProps = {
    trajectory: TrajectoryRun
    current_step_idx: number
    total_frames: number
    on_step_change: (idx: number) => void
  }
  type EventHandler = (data: TrajHandlerData) => void

  const DISPLAY_MODES = [
    { mode: `structure`, icon: Atom, label: `Structure-only` },
    { mode: `structure+scatter`, icon: TwoColumns, label: `Structure + Scatter` },
    { mode: `structure+histogram`, icon: TwoColumns, label: `Structure + Histogram` },
    { mode: `scatter`, icon: ScatterPlotIcon, label: `Scatter-only` },
    { mode: `histogram`, icon: HistogramIcon, label: `Histogram-only` },
  ] as const
  // Trails get a 64 MB position budget; larger runs trade smoothness for frame stride
  const TRAIL_POSITION_MAX_BYTES = 64 * 1024 * 1024

  let {
    trajectory,
    current_step_idx = $bindable(0),
    fps = $bindable(DEFAULTS.trajectory.fps),
    fps_range = DEFAULTS.trajectory.fps_range,
    auto_play = DEFAULTS.trajectory.auto_play,
    display_mode = $bindable(DEFAULTS.trajectory.display_mode),
    layout = DEFAULTS.trajectory.layout,
    pane_ratio = $bindable(0.5),
    structure_props = {},
    supercell_scaling = $bindable(structure_props.supercell_scaling ?? `1x1x1`),
    scatter_props = {},
    histogram_props = {},
    property_labels,
    x_quantity = $bindable(),
    visible_properties = $bindable(),
    step_labels = DEFAULTS.trajectory.step_labels,
    plot_skimming = true,
    show_controls,
    fullscreen_toggle = DEFAULTS.trajectory.fullscreen_toggle,
    fullscreen = $bindable(false),
    hovered = $bindable(false),
    wrapper = $bindable(),
    trajectory_controls,
    active_pane = $bindable(null),
    on_step_change,
    on_play,
    on_pause,
    on_end,
    on_loop,
    on_frame_rate_change,
    on_display_mode_change,
    on_fullscreen_change,
    on_controller,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    trajectory: TrajectoryRun
    // bindable: frame on display
    current_step_idx?: number
    fps?: number
    fps_range?: Readonly<Vec2>
    auto_play?: boolean
    display_mode?: TrajectoryDisplayMode
    // 'auto' adapts to the element size, 'horizontal'/'vertical' force a split direction
    layout?: `auto` | Orientation
    pane_ratio?: number
    structure_props?: ComponentProps<typeof Structure>
    supercell_scaling?: string
    scatter_props?: ComponentProps<typeof ScatterPlot>
    histogram_props?: Omit<ComponentProps<typeof Histogram>, `series`>
    // Display labels per property key, merged with trajectory_property_config
    property_labels?: Record<string, string>
    // What the plot's x axis counts: 'frame' (position in the run), 'step' (the MD step
    // recorded in the file) or 'time' (step x the file's timestep). Unset picks the most
    // informative one the data supports; the resolved choice is written back.
    x_quantity?: TrajectoryXQuantity
    // bindable: property keys currently plotted
    visible_properties?: string[]
    // Slider labels: n evenly spaced ticks (n > 0), every |n|th step (n < 0), or exact indices
    step_labels?: number | number[]
    // Clicking the plot moves the playhead
    plot_skimming?: boolean
    // 'always' | 'hover' | 'never' | { mode, hidden: TrajectoryControlName[], style }
    show_controls?: ShowControlsProp<TrajectoryControlName>
    fullscreen_toggle?: boolean
    fullscreen?: boolean
    // bindable: pointer is over the viewer (drives hover-scoped shortcuts)
    hovered?: boolean
    wrapper?: HTMLDivElement
    trajectory_controls?: Snippet<[ControlsProps]>
    // bindable: the one floating pane that is open (structure controls, info, analyses, export)
    active_pane?: TrajectoryPane | null
    on_step_change?: EventHandler
    on_play?: EventHandler
    on_pause?: EventHandler
    on_end?: EventHandler
    on_loop?: EventHandler
    on_frame_rate_change?: EventHandler
    on_display_mode_change?: EventHandler
    on_fullscreen_change?: EventHandler
    on_controller?: (controller: TrajectoryController | null) => void
  } = $props()

  // === session: frames, playback, scrub/commit, cache ===
  let frame_error = $state.raw<{ run: TrajectoryRun; idx: number; message: string } | null>(
    null,
  )
  const event_data = (): TrajHandlerData => ({
    step_idx: current_step_idx,
    frame_count: session.frame_count,
    frame: session.current_frame ?? undefined,
  })
  const session = create_trajectory_session({
    run: () => trajectory,
    index: () => current_step_idx,
    set_index: (idx) => (current_step_idx = idx),
    fps: () => fps,
    set_fps: (value) => (fps = value),
    fps_range: () => fps_range,
    should_auto_play: () => auto_play && active_pane !== `spectroscopy`,
    on_play: () => on_play?.(event_data()),
    on_pause: () => on_pause?.(event_data()),
    on_end: () => on_end?.(event_data()),
    on_loop: () => on_loop?.(event_data()),
    on_step_change: () => on_step_change?.(event_data()),
    on_frame_error: (frame_idx, error) => {
      console.error(`Failed to load frame ${frame_idx}:`, error)
      const message = `Failed to load frame ${frame_idx}: ${error.message}`
      frame_error = { run: trajectory, idx: frame_idx, message }
    },
  })
  const { player, controller } = session
  let total_frames = $derived(session.frame_count)
  let current_frame = $derived(session.current_frame)
  let scrub_active = $derived(session.scrubbing)
  // Shown while the failed frame is still the one requested: a new run, another step or a
  // frame that did load clears it, and the banner's dismiss button overrides it. Derived
  // rather than cleared by an effect so a synchronous read failure (which nulls
  // current_frame in the same batch that reports it) is not wiped before it renders.
  let frame_error_msg = $derived(
    frame_error &&
      frame_error.run === trajectory &&
      frame_error.idx === current_step_idx &&
      !current_frame
      ? frame_error.message
      : undefined,
  )
  $effect(() => {
    on_controller?.(controller)
    return () => on_controller?.(null)
  })
  $effect(() => {
    if (active_pane === `spectroscopy`) player.pause()
  })
  $effect(() => {
    void fps
    untrack(() => on_frame_rate_change?.(event_data()))
  })

  // === layout ===
  let controls_config = $derived(normalize_show_controls(show_controls, `always`))
  let controls_height = $state(0)
  let content_size = $state({ width: 0, height: 0 })
  // Cap panes to .content-area (controls bar is a flex sibling above it)
  let pane_max_height = $derived(
    content_size.height > 0 ? `--pane-max-height: ${content_size.height}px` : undefined,
  )
  // Measured on .content-area, not the wrapper: a mounted controls bar is ~32px of the
  // wrapper's height that no pane ever gets
  let actual_layout = $derived.by(() => {
    if (layout === `horizontal` || layout === `vertical`) return layout
    const { width, height } = content_size
    return width > 0 && height > 0 ? pick_pane_orientation(width, height) : `horizontal`
  })
  const filename_copied = create_flash(false, 1000)
  let view_mode_dropdown_open = $state(false)
  let analysis_menu_open = $state(false)
  // Structure's own info/export panes; its controls pane is this viewer's `controls` pane
  let structure_pane = $state<Exclude<StructurePane, `controls`> | null>(null)
  let scatter_controls_open = $derived(scatter_props.controls_open ?? false)
  let hidden_elements = $state(new SvelteSet<ElementSymbol>())
  // Writable so the banner can be dismissed
  let warning_msg = $derived(
    trajectory.warnings.length > 0
      ? `${plural(trajectory.warnings.length, `parse warning`)}: ${trajectory.warnings.join(`; `)}`
      : undefined,
  )

  const is_pane_open = (pane: TrajectoryPane): boolean => active_pane === pane
  const set_pane_open = (pane: TrajectoryPane, open: boolean): void => {
    if (open) active_pane = pane
    else if (active_pane === pane) active_pane = null
  }

  // === trails ===
  let trail_stream = $state.raw<TrajectoryPositionStream | null>(null)
  // Writable: the structure controls toggle it, a host-side scene_props change resets it.
  // Goes through a value-level derived so a host rebuilding structure_props with the same
  // configured value does not discard the user's toggle.
  let configured_trajectory_lines = $derived(
    structure_props.scene_props?.show_trajectory_lines,
  )
  let show_trajectory_lines = $derived(
    configured_trajectory_lines ?? DEFAULTS.structure.show_trajectory_lines,
  )
  let trajectory_lines_available = $derived(
    total_frames >= 2 && trajectory.collect_positions !== undefined,
  )
  $effect(() => {
    const owner = trajectory
    const enabled = show_trajectory_lines && trajectory_lines_available
    trail_stream = null
    if (!enabled) return
    const trail_controller = new AbortController()
    // The stride budget throws synchronously (a single frame over budget); the async wrapper
    // turns that into a rejection so one catch covers it and the stream failures alike
    const collect_trails = async () => {
      const frame_stride = suggest_frame_stride(
        owner.frame_count,
        owner.preview.structure.sites.length,
        TRAIL_POSITION_MAX_BYTES,
      )
      return collect_trajectory_positions(owner, {
        frame_stride,
        max_bytes: TRAIL_POSITION_MAX_BYTES,
        signal: trail_controller.signal,
        analysis_name: `Trajectory trails`,
      })
    }
    collect_trails()
      .then((stream) => {
        if (!trail_controller.signal.aborted) trail_stream = stream
      })
      .catch((exc: unknown) => {
        if (trail_controller.signal.aborted) return
        // Trails are optional, so a failure here hides them rather than breaking the viewer
        console.error(`Trajectory trails: position collection failed`, to_error(exc).message)
      })
    return () => trail_controller.abort()
  })
  // Convert the source-frame playhead to collected frames; held still while scrubbing
  let settled_trail_end: number | undefined
  let trajectory_line_end_frame = $derived.by(() => {
    if (!trail_stream) return (settled_trail_end = undefined)
    if (!scrub_active || settled_trail_end === undefined) {
      settled_trail_end = collected_frame_idx(trail_stream, current_step_idx)
    }
    return settled_trail_end
  })
  let spectroscopy_open = $derived(active_pane === `spectroscopy`)
  let trail_scene_props = $derived({
    ...structure_props.scene_props,
    trajectory_position_stream: spectroscopy_open ? undefined : trail_stream,
    trajectory_line_end_frame: spectroscopy_open ? undefined : trajectory_line_end_frame,
    defer_expensive_geometry: spectroscopy_open ? false : scrub_active,
  })

  // === plot ===
  let step_label_positions = $derived.by((): number[] => {
    if (!step_labels || total_frames <= 1) return []
    if (Array.isArray(step_labels)) {
      return step_labels.filter((idx) => idx >= 0 && idx < total_frames)
    }
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
    const spacing = Math.abs(step_labels)
    const positions = Array.from(
      { length: Math.ceil(total_frames / spacing) },
      (_, idx) => idx * spacing,
    )
    return positions.at(-1) === total_frames - 1 ? positions : [...positions, total_frames - 1]
  })

  let extended_config = $derived.by(() => {
    if (!property_labels) return trajectory_property_config
    const custom_config: Record<string, TrajPropertyConfig> = {}
    for (const [key, label] of Object.entries(property_labels)) {
      const existing =
        trajectory_property_config[key] || trajectory_property_config[key.toLowerCase()]
      // Spread the existing config so fields like axis_group survive the label override
      custom_config[key] = { ...existing, label, unit: existing?.unit || `` }
    }
    return { ...trajectory_property_config, ...custom_config }
  })

  let frame_step_samples = $derived(get_frame_step_samples(session.property_rows))
  let x_quantity_options = $derived(
    available_x_quantities(
      frame_step_samples,
      trajectory.time_step?.value,
      trajectory.time_step?.unit,
    ),
  )
  // The host's (or the user's, via the select) standing request; only an x_quantity value
  // the component did not write back itself counts as one, and it survives runs that cannot
  // honour it so it is restored once one can.
  let requested_x_quantity: TrajectoryXQuantity | undefined = untrack(() => x_quantity)
  let written_x_quantity: TrajectoryXQuantity | undefined
  let chosen_x_quantity = $derived.by((): TrajectoryXQuantity => {
    if (x_quantity !== written_x_quantity) requested_x_quantity = x_quantity
    const preferred = requested_x_quantity
    if (preferred !== undefined && x_quantity_options.includes(preferred)) return preferred
    if (x_quantity_options.includes(`time`)) return `time`
    if (x_quantity_options.includes(`step`)) return `step`
    return `frame`
  })
  let x_map = $derived(
    build_x_map(frame_step_samples, chosen_x_quantity, {
      time_step: trajectory.time_step?.value,
      time_unit: trajectory.time_step?.unit,
    }),
  )
  // Report the axis actually in effect so hosts binding x_quantity see the resolved value.
  // Skip empty samples: writing `frame` before rows arrive would lock the prop.
  $effect(() => {
    if (frame_step_samples.frame_numbers.length === 0) return
    written_x_quantity = x_map.quantity
    if (x_quantity !== x_map.quantity) x_quantity = x_map.quantity
  })
  // Time between frames, so displacement analyses report D in real units
  let frame_time_step = $derived(
    get_frame_time_step(frame_step_samples, trajectory.time_step?.value),
  )

  // Plot series state (not derived so legend toggles can replace it). `.raw`, since both
  // writers reassign the whole array: a deep proxy over N series x N frames of numbers put a
  // signal behind every element, and smooth_moving_average's ~2M reads per series then went
  // through the proxy trap - 4.9 s instead of 144 ms at 10k frames, on every resize tick.
  let plot_series = $state.raw<DataSeries[]>([])
  let syncing_visible_properties = false
  // Read ALL reactive deps before the syncing guard can return: a guarded run that reads no
  // dependencies leaves the effect dep-less, and Svelte permanently unlinks such effects
  $effect(() => {
    const [rows, config, keys, active_x_map] = [
      session.property_rows,
      extended_config,
      visible_properties,
      x_map,
    ]
    if (syncing_visible_properties) return
    plot_series = generate_plot_series(rows, {
      property_config: config,
      default_visible_properties: keys ? new SvelteSet(keys) : undefined,
      x_map: active_x_map,
    })
  })
  // Legend toggles flow back into the bindable visible_properties
  $effect(() => {
    if (plot_series.length === 0) return
    const visible_keys = plot_series.flatMap((srs) => {
      const key = srs.visible ? property_key(srs) : undefined
      return key === undefined ? [] : [key]
    })
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
  const handle_legend_toggle = (series_idx: number): void => {
    plot_series = toggle_series_visibility(plot_series, series_idx)
  }
  let scatter_point_limit = $derived(clamp(content_size.width / 2, 128, 1000))
  let scatter_series = $derived(
    prepare_trajectory_scatter_series(plot_series, scatter_point_limit),
  )
  // Histogram mode bins each property's values; keep index alignment with plot_series so
  // legend toggles map back onto the same series_idx
  let histogram_series = $derived<HistogramSeries[]>(
    plot_series.map((srs) => ({
      id: srs.id,
      values: srs.y,
      label: srs.label,
      visible: srs.visible,
      legend_group: srs.legend_group,
      color: srs.line_style?.stroke ?? first_point_style(srs)?.fill,
      y_axis: srs.y_axis,
    })),
  )
  let x_axis = $derived({
    label: x_map.unit ? `${x_map.label} (${x_map.unit})` : x_map.label,
    // step_label_positions are frame indices; the axis is drawn in x units
    ticks: step_label_positions.map(x_map.to_x),
  })
  let y_axis_labels = $derived(generate_axis_labels(plot_series))
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
  let plot_loading = $derived(!session.properties_complete && plot_series.length === 0)
  // Spectroscopy owns the plot region while open; otherwise hide a constant-value plot
  let show_plot = $derived(
    spectroscopy_open ||
      (display_mode !== `structure` &&
        (plot_loading || !should_hide_plot(total_frames, plot_series))),
  )
  let show_structure = $derived(
    spectroscopy_open || ![`scatter`, `histogram`].includes(display_mode),
  )
  let has_y2_series = $derived(
    plot_series.some(
      ({ y, y_axis: axis_name, visible }) =>
        axis_name === `y2` && visible && y.some(Number.isFinite),
    ),
  )
  // Keep plot configuration referentially stable while only the active frame changes:
  // recreating these objects would invalidate ScatterPlot's scales and hover index per frame
  // Caller padding is honoured as a floor: the y2 axis needs its right margin whatever the
  // caller asked for, and a caller cannot know whether a y2 series is currently visible
  let trajectory_scatter_padding = $derived.by(() => {
    const { t = 20, b = 60, r = 0, ...user } = scatter_props.padding ?? {}
    return { ...user, t, b, r: Math.max(r, has_y2_series ? 100 : 20) }
  })
  let trajectory_scatter_legend = $derived({
    ...scatter_props.legend,
    on_toggle: (series_idx: number) => {
      handle_legend_toggle(series_idx)
      scatter_props.legend?.on_toggle?.(series_idx)
    },
  })
  let trajectory_hover_config = $derived({ ...scatter_props.hover_config, mode: `x` as const })
  // Hold the plot's active-frame tick still during a pointer burst; snap it when settled
  let last_settled_step = untrack(() => current_step_idx)
  let settled_plot_step_idx = $derived.by(() => {
    if (!scrub_active) last_settled_step = current_step_idx
    return last_settled_step
  })
  const handle_plot_click = (data: { x: number }): void =>
    session.commit(x_map.to_frame(data.x))

  let current_display_mode = $derived.by(() => {
    const option = DISPLAY_MODES.find((entry) => entry.mode === display_mode)
    if (option) return option
    throw new Error(`Unexpected display mode: ${display_mode}`)
  })

  // === keyboard ===
  // Returns true if the key was handled, so the caller can suppress the browser default
  function onkeydown(event: KeyboardEvent): boolean {
    // Bound on the root and on the window: a click leaves the viewer focused *and*
    // hovered, so both would run and a toggle would cancel itself out. The root fires
    // first and prevents the default, which makes the window pass a no-op.
    if (event.defaultPrevented) return false
    // Leave form fields alone; sequence controls handle their own navigation keys and let
    // the viewer shortcuts they do not use bubble here
    const target = event.target instanceof HTMLElement ? event.target : null
    const is_sequence_slider = target?.classList.contains(`step-slider`)
    if (!is_sequence_slider && target && is_editable_event_target(event.target)) {
      if (target.classList.contains(`step-input`) && [`Escape`, `Enter`].includes(event.key)) {
        target.blur()
      }
      return false
    }
    if (player.handle_keydown(event)) return true
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (event.metaKey || event.ctrlKey) return false
    // `f` is owned by FullscreenButton; panes dismiss themselves via ViewerPane. Escape
    // leaves fullscreen to the browser, which exits on its own and lets the flag follow
    // fullscreenchange — exiting here would steal it from a host that owns it (a slide
    // deck embedding the viewer) and swallow the key.
    if (key !== `Escape`) return false
    if (view_mode_dropdown_open) view_mode_dropdown_open = false
    else if (analysis_menu_open) analysis_menu_open = false
    else return false
    return true
  }

  // === analysis menu ===
  // Each floating pane keeps its ViewerPane toggle for layout anchoring but hides it, since
  // the analysis menu owns the clicks. Spectroscopy renders inline in the plot region.
  let analysis_pane_props = $derived({
    run: trajectory,
    // Mirrored copies, because a run is rune-free and its `properties.rows` cannot be tracked
    property_rows: session.property_rows,
    properties_complete: session.properties_complete,
    pane_props: { style: pane_max_height },
    toggle_props: {
      class: `analysis-toggle-anchor`,
      tabindex: -1,
      'aria-hidden': true,
      title: ``,
    },
  })
  let correlation_pane_props = $derived({
    ...analysis_pane_props,
    default_dt: frame_time_step,
    default_time_unit: trajectory.time_step?.unit,
  })
  // oxfmt-ignore
  const ANALYSES = (
    [
      [`msd`, `Mean squared displacement`, Graph],
      [`vacf`, `Velocity autocorrelation & VDOS`, Graph],
      [`rdf`, `Radial distribution function`, Graph],
      [`spectroscopy`, `Trajectory IR/Raman & VDOS`, Graph],
      [`structure-id`, `Structure identification`, Atom],
      [`data-inspector`, `Data inspector`, Database],
    ] as const
  ).map(([pane, label, icon]) => ({
    pane: pane as TrajectoryPane,
    control_name: `${pane}-pane` as TrajectoryControlName,
    label,
    icon,
  }))
  let visible_analyses = $derived(
    ANALYSES.filter((entry) => controls_config.visible(entry.control_name)),
  )
  let any_analysis_open = $derived(ANALYSES.some((entry) => entry.pane === active_pane))
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class:active={player.is_playing ||
    structure_pane !== null ||
    scatter_controls_open ||
    active_pane !== null}
  bind:this={wrapper}
  data-scrubbing={scrub_active}
  role="application"
  aria-label="Trajectory viewer"
  tabindex="0"
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
  onkeydown={handle_and_prevent(onkeydown)}
  {...rest}
  class={[`trajectory sequence-viewer`, actual_layout, rest.class]}
  class:show-both-views={show_plot && show_structure && !spectroscopy_open}
  class:spectroscopy-mode={spectroscopy_open}
  {@attach forward_window_keydown({ handle: onkeydown })}
>
  <!-- z-index 3: above the structure viewer's AtomLegend (2), which shares the bottom edge -->
  {#if warning_msg}
    <StatusMessage
      bind:message={warning_msg}
      type="warning"
      dismissible
      style="position: absolute; bottom: 4pt; left: 4pt; right: 4pt; z-index: 3; font-size: 0.85em"
    />
  {/if}
  {#if frame_error_msg}
    <StatusMessage
      bind:message={frame_error_msg}
      type="error"
      dismissible
      style="position: absolute; bottom: 4pt; left: 4pt; right: 4pt; z-index: 3; font-size: 0.85em"
    />
  {/if}
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
        on_step_change: session.commit,
      })}
    {:else}
      {#if trajectory.provenance.filename && controls_config.visible(`filename`)}
        {@const filename = trajectory.provenance.filename}
        <button
          class="filename"
          title="Click to copy filename <code>{filename}</code>"
          {@attach tooltip({ allow_html: true })}
          onclick={() => {
            navigator.clipboard.writeText(filename)
            filename_copied.show(true)
          }}
        >
          {filename}
          {#if filename_copied.value}
            <Icon
              icon={Check}
              style="--icon-size: 16px; color: var(--success-color); position: absolute; right: 3pt; top: 50%; transform: translateY(-50%); animation: fade-in 0.1s; background: var(--surface-bg-hover); border-radius: 50%; padding: 2px; box-sizing: content-box"
            />
          {/if}
        </button>
      {/if}

      <SequenceControls
        {controls_config}
        index={current_step_idx}
        count={total_frames}
        playback={player}
        {step_label_positions}
        item_name="step"
        previous_title="Previous step (←) · Home: first · j: −10 · PageUp: −25"
        play_title={`${player.is_playing ? `Pause` : `Play`} (Space) · ←/→ step · 0-9 jump % · +/- speed · f fullscreen`}
        next_title="Next step (→) · End: last · l: +10 · PageDown: +25"
        on_index_input={session.scrub}
      />

      <div class="info-section">
        {#if session.loading}
          <Spinner style="--spinner-size: 1em; margin: 0" />
        {/if}
        {#if controls_config.visible(`info-pane`)}
          <TrajectoryInfoPane
            run={trajectory}
            {current_frame}
            {current_step_idx}
            property_rows={session.property_rows}
            properties_complete={session.properties_complete}
            bind:pane_open={() => is_pane_open(`info`), (open) => set_pane_open(`info`, open)}
            pane_props={{ style: pane_max_height }}
          />
        {/if}
        {#if controls_config.visible(`export-pane`)}
          <TrajectoryExportPane
            bind:export_pane_open={
              () => is_pane_open(`export`), (open) => set_pane_open(`export`, open)
            }
            run={trajectory}
            {wrapper}
            filename={trajectory.provenance.filename || `trajectory`}
            on_step_change={session.commit}
            resolve_frame={session.resolve_frame}
            pane_props={{ style: pane_max_height }}
          />
        {/if}
        <!-- Analyses plot their own x axis (MSD plots lag time, not frame index) so they
          cannot share the step-linked scatter/histogram display modes -->
        {#if visible_analyses.length > 0}
          <ToolbarMenu
            bind:open={analysis_menu_open}
            label="Analysis"
            active={analysis_menu_open || any_analysis_open}
            button_class="analysis-button"
            menu_class="analysis-dropdown"
            class="analysis-dropdown-wrapper"
          >
            {#snippet button()}
              <Icon icon={Graph} />
              <Icon icon={analysis_menu_open ? ArrowUp : ArrowDown} />
            {/snippet}
            {#each visible_analyses as entry (entry.pane)}
              <button
                type="button"
                class={['view-mode-option', { selected: active_pane === entry.pane }]}
                title={entry.label}
                aria-pressed={active_pane === entry.pane}
                onclick={() => {
                  set_pane_open(entry.pane, active_pane !== entry.pane)
                  analysis_menu_open = false
                }}
              >
                <Icon icon={entry.icon} />
                <span>{entry.label}</span>
              </button>
            {/each}
            {#snippet trailing()}
              <TrajectoryMsdPane
                {...correlation_pane_props}
                bind:pane_open={
                  () => is_pane_open(`msd`), (open) => set_pane_open(`msd`, open)
                }
              />
              <TrajectoryVacfPane
                {...correlation_pane_props}
                bind:pane_open={
                  () => is_pane_open(`vacf`), (open) => set_pane_open(`vacf`, open)
                }
              />
              <TrajectoryRdfPane
                {...analysis_pane_props}
                bind:pane_open={
                  () => is_pane_open(`rdf`), (open) => set_pane_open(`rdf`, open)
                }
              />
              <TrajectoryStructureIdPane
                {...analysis_pane_props}
                bind:pane_open={
                  () => is_pane_open(`structure-id`),
                  (open) => set_pane_open(`structure-id`, open)
                }
              />
              <TrajectoryDataInspectorPane
                {...analysis_pane_props}
                {current_step_idx}
                {current_frame}
                bind:pane_open={
                  () => is_pane_open(`data-inspector`),
                  (open) => set_pane_open(`data-inspector`, open)
                }
                on_step_change={session.commit}
              />
            {/snippet}
          </ToolbarMenu>
        {/if}
        {#if !spectroscopy_open && plot_series.length > 0 && x_quantity_options.length > 1 && controls_config.visible(`x-axis`)}
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
        {#if plot_series.length > 0 && controls_config.visible(`view-mode`)}
          <ToolbarMenu
            bind:open={view_mode_dropdown_open}
            label={current_display_mode.label}
            class="view-mode-dropdown-wrapper"
          >
            {#snippet button()}
              <Icon icon={current_display_mode.icon} />
              <Icon icon={view_mode_dropdown_open ? ArrowUp : ArrowDown} />
            {/snippet}
            {#each DISPLAY_MODES as option (option.mode)}
              <button
                class={['view-mode-option', { selected: display_mode === option.mode }]}
                onclick={() => {
                  display_mode = option.mode
                  on_display_mode_change?.(event_data())
                  view_mode_dropdown_open = false
                }}
              >
                <Icon icon={option.icon} />
                <span>{option.label}</span>
              </button>
            {/each}
          </ToolbarMenu>
        {/if}
        {#if fullscreen_toggle && controls_config.visible(`fullscreen`)}
          <FullscreenButton
            bind:fullscreen
            {wrapper}
            bg_css_var="--traj-bg-fullscreen"
            on_change={() => on_fullscreen_change?.(event_data())}
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
        structure={session.current_structure}
        structure_series_key={trajectory}
        allow_file_drop={false}
        style="height: 100%; min-height: 0; border-radius: var(--struct-border-radius, 0)"
        {...{
          show_image_atoms: false, // avoid atoms popping in/out at cell edges during playback
          // Coordinate playback is not a stream of new crystals to classify: symmetry
          // analysis on every slider event dominated small-molecule scrubbing
          analyze_symmetry: false,
          ...structure_props,
          scene_props: trail_scene_props,
        }}
        bind:show_trajectory_lines={
          () => (spectroscopy_open ? false : show_trajectory_lines),
          (value) => (show_trajectory_lines = value)
        }
        bind:supercell_scaling
        bind:active_pane={
          () => (active_pane === `controls` ? `controls` : structure_pane),
          (pane) => {
            set_pane_open(`controls`, pane === `controls`)
            structure_pane = pane === `controls` ? null : pane
          }
        }
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
      run={trajectory}
      bind:pane_open={
        () => is_pane_open(`spectroscopy`), (open) => set_pane_open(`spectroscopy`, open)
      }
    />

    {#if show_plot && !spectroscopy_open}
      {#if plot_loading}
        <Spinner
          text="Sampling trajectory plot data..."
          style="display: flex; justify-content: center; min-height: 0; margin: 0; color: var(--text-muted, currentColor); background: var(--surface-bg); --spinner-size: 1.4em"
        />
      {:else if display_mode === `scatter` || display_mode === `structure+scatter`}
        <ScatterPlot
          series={scatter_series}
          {x_axis}
          {y_axis}
          {y2_axis}
          bind:controls_open={scatter_controls_open}
          current_x_value={x_map.to_x(settled_plot_step_idx)}
          on_plot_click={plot_skimming ? handle_plot_click : undefined}
          range_padding={0}
          style="height: 100%"
          {...scatter_props}
          padding={trajectory_scatter_padding}
          hover_config={trajectory_hover_config}
          legend={trajectory_scatter_legend}
        >
          {#snippet tooltip({ x, y, raw_y, metadata, label }: ScatterHandlerProps)}
            {x_axis.label}: {format_num(x, `~g`)}<br />
            {@html sanitize_html(metadata?.series_label || label || `Value`)}: {format_num(y)}
            {#if typeof raw_y === `number`}
              <small style="opacity: 0.65">&nbsp;(raw: {format_num(raw_y)})</small>
            {/if}
          {/snippet}
        </ScatterPlot>
      {:else}
        <Histogram
          {...histogram_props}
          series={histogram_series}
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
    overflow: var(--traj-overflow, visible);
    background: var(--traj-surface-bg);
    color: var(--traj-color, var(--text-color, CanvasText));
    box-sizing: border-box;
    contain: layout;
    z-index: var(--traj-z-index, 1);
    container: trajectory / size; /* cqw/cqh for chrome and panes */
    &.active {
      z-index: 2; /* info/control panes of an active viewer overlay those of the next one */
    }
    &:fullscreen {
      height: 100vh !important;
      width: 100vw !important;
      border-radius: 0 !important;
      background: var(--traj-bg-fullscreen, var(--traj-surface-bg));
      overflow: hidden;
    }
    &:has(:global(.viewer-pane-open)) {
      overflow: visible;
    }
    &.horizontal .content-area {
      grid-template-columns: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
    }
    &.vertical .content-area {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr);
    }
  }
  .content-area {
    display: grid;
    position: relative;
    flex: 1;
    min-height: 0; /* important for tall structure viewers not to overflow */
    /* The panes share this box, so a plot's own floor (350px for scatter, 300px for
       histogram) must not bid for track space: minmax(0, 1fr) above caps the track;
       without this the plot would just overflow it. */
    --scatter-min-height: 0;
    --histogram-min-height: 0;
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
    max-width: min(250px, 20cqw);
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-block;
    position: relative;
    font-family: monospace;
    font-size: 0.9em;
    background: var(--code-bg, rgba(0, 0, 0, 0.1));
    @container trajectory (max-width: 1024px) {
      display: none;
    }
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  .info-section {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: clamp(3pt, 0.6cqw, 1ex);
    position: relative;
    --view-mode-button-padding: 0;
  }
  .info-section :global(:is(.trajectory-info-toggle, .trajectory-export-toggle)) {
    font-size: inherit;
    line-height: 1;
    padding: 0;
    background: transparent;
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
  @media (orientation: portrait) {
    .trajectory {
      &.show-both-views:not(.spectroscopy-mode) {
        min-height: calc(var(--min-height) * 2);
      }
      &.vertical .content-area.show-both:not(.hide-plot):not(.hide-structure) {
        grid-template-columns: minmax(0, 1fr) !important;
        grid-template-rows: minmax(0, var(--split-pane-size, 50%)) minmax(0, 1fr) !important;
      }
    }
  }
  .x-quantity-select {
    padding: 1pt 2pt;
    font-size: 0.85em;
    background: transparent;
    border: var(--tooltip-border);
    border-radius: 3pt;
  }
  /* Keep ViewerPane's toggle for layout anchoring; the analysis menu owns clicks. Fully
     global: the wrapper is ToolbarMenu's root (a child component), so a scoped selector
     would never match and the four pane toggles would render as bare toolbar icons. */
  :global(.analysis-dropdown-wrapper .analysis-toggle-anchor) {
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
</style>

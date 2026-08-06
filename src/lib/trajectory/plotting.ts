// Plotting utilities for trajectory visualization
import { PLOT_COLORS } from '$lib/colors'
import { SCF_AXIS_GROUP, trajectory_property_config } from '$lib/labels'
import type { TrajPropertyConfig } from '$lib/labels'
import { get_coefficient_of_variation } from '$lib/math'
import {
  assign_axes,
  axis_group_key,
  axis_labels as get_axis_labels,
  axis_scale_types as get_axis_scale_types,
  group_axis_series,
} from '$lib/plot/core/axis-assignment'
import type { DataSeries } from '$lib/plot/core/types'
import type {
  TrajectoryDataExtractor,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryType,
} from './index'

// Configuration constants
const ENERGY_UNITS = [`eV`, `eV/atom`, `hartree`, `kcal/mol`, `kJ/mol`]
const ENERGY_PROPERTIES = [`energy`, `total_energy`, `potential_energy`]
const FORCE_PROPERTIES = [`force`, `fmax`, `f`]
// scf_energy_delta lives in its own axis group (see trajectory_property_config), so
// listing it here only surfaces it when higher-priority groups (energy/force/stress)
// don't fill both axes — i.e. single-point SCF convergence views.
const DEFAULT_VISIBLE = new Set([
  `energy`,
  `force_max`,
  `stress_frobenius`,
  `scf_energy_delta`,
])

// Shared per-series line/point styling derived from a single color
const series_color_styles = (color: string) => ({
  line_style: { stroke: color, stroke_width: 2 },
  point_style: { fill: color, stroke: color, stroke_width: 1 },
})

export interface PlotSeriesOptions {
  property_config?: Record<string, TrajPropertyConfig>
  colors?: readonly string[]
  default_visible_properties?: Set<string>
  // Maps frame index to x coordinate. Defaults to the frame index itself.
  x_map?: TrajectoryXMap
}

// What the plot's x axis counts. `frame` is the position in the trajectory (always
// available), `step` the MD/ionic step recorded in the file, `time` that step scaled by
// the file's timestep. Plotting a 500-step-interval dump against the frame index and
// labelling it "Step" is the bug this type exists to prevent.
export type TrajectoryXQuantity = `frame` | `step` | `time`

export interface TrajectoryXMap {
  quantity: TrajectoryXQuantity
  label: string
  unit: string
  // x coordinate of a frame index. Interpolated between samples for indexed trajectories,
  // whose step numbers are only known at the sampled frames.
  to_x: (frame_idx: number) => number
  // Inverse of to_x, rounded to the nearest frame index and clamped to the trajectory.
  to_frame: (x_value: number) => number
}

// Frame numbers paired with the MD steps recorded at them. For an eagerly parsed
// trajectory that is every frame; for an indexed one only the sampled frames.
export interface FrameStepSamples {
  frame_numbers: readonly number[]
  steps: readonly number[]
}

const strictly_increasing = (values: readonly number[]): boolean =>
  values.every(
    (value, idx) => Number.isFinite(value) && (idx === 0 || value > values[idx - 1]),
  )

// Which x quantities the data actually supports. Step and time interpolation both need a
// monotonic frame/step grid. Steps only earn their own option when they differ from frame
// numbering; time remains informative even when steps are exactly 0, 1, 2, …
export function available_x_quantities(
  samples: FrameStepSamples,
  time_step?: number,
  time_unit?: string,
): TrajectoryXQuantity[] {
  const { frame_numbers, steps } = samples
  const usable_grid =
    steps.length === frame_numbers.length &&
    steps.length > 1 &&
    strictly_increasing(frame_numbers) &&
    strictly_increasing(steps)
  if (!usable_grid) return [`frame`]

  const quantities: TrajectoryXQuantity[] = [`frame`]
  if (steps.some((step, idx) => step !== frame_numbers[idx])) quantities.push(`step`)
  if (time_step !== undefined && Number.isFinite(time_step) && time_step > 0 && time_unit) {
    quantities.push(`time`)
  }
  return quantities
}

export const X_QUANTITY_LABELS: Record<TrajectoryXQuantity, string> = {
  frame: `Frame`,
  step: `Step`,
  time: `Time`,
}

// Read `ys` at `value` on the strictly increasing `xs` grid, interpolating between grid
// points and clamping past either end. Running it with the two arrays swapped inverts the
// map, which is how to_frame undoes to_x.
function interpolate(xs: readonly number[], ys: readonly number[], value: number): number {
  if (xs.length === 0) return value
  if (value <= xs[0]) return ys[0]
  const last_idx = xs.length - 1
  if (value >= xs[last_idx]) return ys[last_idx]
  // An eagerly parsed trajectory grids on the frame index itself, so the search collapses
  // to a lookup. Valid whenever it hits: xs[value] === value means value IS that grid point.
  if (Number.isInteger(value) && xs[value] === value) return ys[value]

  let low = 0
  let high = last_idx
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (xs[mid] <= value) low = mid
    else high = mid
  }
  const span = xs[high] - xs[low]
  if (span === 0) return ys[low]
  return ys[low] + ((value - xs[low]) / span) * (ys[high] - ys[low])
}

// Frame numbering for a trajectory with no samples to grid on
export const FRAME_X_MAP: TrajectoryXMap = {
  quantity: `frame`,
  label: X_QUANTITY_LABELS.frame,
  unit: ``,
  to_x: (frame_idx) => frame_idx,
  to_frame: (x_value) => Math.round(x_value),
}

// Build the frame <-> x mapping for one quantity. Falls back to frame numbering when the
// requested quantity is unsupported by the data rather than fabricating an axis. Frame
// numbering is the identity read of the grid against itself, so it clamps like the others.
export function build_x_map(
  samples: FrameStepSamples,
  quantity: TrajectoryXQuantity,
  time_options: { time_step?: number; time_unit?: string } = {},
): TrajectoryXMap {
  const { time_step, time_unit = `` } = time_options
  const { frame_numbers, steps } = samples
  if (frame_numbers.length === 0) return FRAME_X_MAP

  const usable = available_x_quantities(samples, time_step, time_unit).includes(quantity)
    ? quantity
    : `frame`
  const values = usable === `frame` ? frame_numbers : steps
  // available_x_quantities only returns `time` for a positive time_step
  const scale = usable === `time` ? (time_step ?? 1) : 1

  return {
    quantity: usable,
    label: X_QUANTITY_LABELS[usable],
    unit: usable === `time` ? time_unit : ``,
    // Frame numbering is its own x axis, taken directly rather than read off the grid:
    // interpolating an array against itself round-trips through a divide and comes back
    // a few eps off the integer that went in.
    to_x:
      usable === `frame`
        ? (frame_idx) => frame_idx
        : (frame_idx) => interpolate(frame_numbers, values, frame_idx) * scale,
    to_frame: (x_value) => Math.round(interpolate(values, frame_numbers, x_value / scale)),
  }
}

// Simulation time between consecutive frames, for analyses (MSD, VACF) that need one dt
// rather than a per-frame axis. Null when the file records no timestep, or when frame
// spacing varies, since a single dt would then misreport every derived quantity.
export function get_frame_time_step(
  samples: FrameStepSamples,
  time_step?: number,
): number | null {
  const { frame_numbers, steps } = samples
  if (!time_step || time_step <= 0 || steps.length < 2) return null
  if (frame_numbers.length !== steps.length) return null
  if (!strictly_increasing(steps) || !strictly_increasing(frame_numbers)) return null

  // Steps per SOURCE frame, not per sample. An indexed trajectory only records a step at
  // every Nth frame, so the step delta between two samples spans N frames; dividing by the
  // sample count alone reports a dt N times too large.
  const step_delta = steps[1] - steps[0]
  const frame_delta = frame_numbers[1] - frame_numbers[0]
  // Cross-multiplied rather than compared as ratios: both sides are integers, so this is
  // exact and needs no tolerance, and any tolerance picked here would be arbitrary.
  const uniform = steps.every(
    (step, idx) =>
      idx === 0 ||
      (step - steps[idx - 1]) * frame_delta ===
        (frame_numbers[idx] - frame_numbers[idx - 1]) * step_delta,
  )
  return uniform ? (step_delta / frame_delta) * time_step : null
}

// Frame/step pairs from whichever source the trajectory has: an eagerly parsed frame list,
// or the sampled plot metadata an indexed trajectory carries instead.
export function get_frame_step_samples(trajectory: TrajectoryType): FrameStepSamples {
  if (trajectory.plot_metadata?.length) {
    const ordered = [...trajectory.plot_metadata].toSorted(
      (meta_a, meta_b) => meta_a.frame_number - meta_b.frame_number,
    )
    return {
      frame_numbers: ordered.map((meta) => meta.frame_number),
      steps: ordered.map((meta) => meta.step),
    }
  }
  return {
    frame_numbers: trajectory.frames.map((_frame, frame_idx) => frame_idx),
    steps: trajectory.frames.map((frame) => frame.step),
  }
}

// Cache the per-frame walk per trajectory so re-renders that only change visible_properties or
// labels/config reuse it (legend toggles mutate plot_series directly and skip regeneration, so they
// don't hit this). Keyed by trajectory identity (WeakMap auto-evicts) and invalidated on extractor
// or frame identity changes.
const same_frames = (
  cached_frames: readonly TrajectoryFrame[],
  current_frames: readonly TrajectoryFrame[],
): boolean =>
  cached_frames.length === current_frames.length &&
  cached_frames.every((frame, frame_idx) => frame === current_frames[frame_idx])

// frame_indices runs parallel to values: a property absent from some frames yields fewer
// values than there are frames, and pairing them by array position would slide every
// later point one frame to the left.
type PropertyStats = Map<
  string,
  {
    values: number[]
    frame_indices: number[]
    has_variation: boolean
    is_energy: boolean
  }
>

const stats_cache = new WeakMap<
  TrajectoryType,
  {
    extractor: TrajectoryDataExtractor
    frames: TrajectoryFrame[]
    stats: PropertyStats
  }
>()

// Unified property extraction and series generation
export function generate_plot_series(
  trajectory: TrajectoryType,
  data_extractor: TrajectoryDataExtractor,
  options: PlotSeriesOptions = {},
): DataSeries[] {
  if (!trajectory?.frames?.length) return []

  const {
    property_config = trajectory_property_config,
    colors = PLOT_COLORS,
    default_visible_properties = DEFAULT_VISIBLE,
    x_map = FRAME_X_MAP,
  } = options

  // Single-pass extraction with variance detection, cached per trajectory (see stats_cache above)
  const cached = stats_cache.get(trajectory)
  let property_stats: PropertyStats
  if (cached?.extractor === data_extractor && same_frames(cached.frames, trajectory.frames)) {
    property_stats = cached.stats
  } else {
    property_stats = extract_property_statistics(trajectory, data_extractor)
    stats_cache.set(trajectory, {
      extractor: data_extractor,
      frames: [...trajectory.frames],
      stats: property_stats,
    })
  }

  // Create all series
  const all_series = create_series_from_stats(property_stats, property_config, colors, x_map)

  const assigned_series = assign_trajectory_axes(all_series, (srs) => {
    const metadata = Array.isArray(srs.metadata) ? srs.metadata[0] : srs.metadata
    const property_key = ((metadata?.property_key as string) || srs.label) ?? ``
    return is_default_visible(property_key, default_visible_properties)
  })
  return assigned_series.toSorted((a, b) => Number(b.visible) - Number(a.visible))
}

// Extract statistics for all properties in a single pass
function extract_property_statistics(
  trajectory: TrajectoryType,
  data_extractor: TrajectoryDataExtractor,
): PropertyStats {
  const property_stats = new Map<string, { values: number[]; frame_indices: number[] }>()

  // Extract all data in single pass
  trajectory.frames.forEach((frame, frame_idx) => {
    const data = data_extractor(frame, trajectory)

    Object.entries(data).forEach(([key, value]) => {
      if (typeof value !== `number` || key === `Step` || key.startsWith(`constant_`)) {
        return
      }

      const stat = property_stats.get(key) ?? { values: [], frame_indices: [] }
      property_stats.set(key, stat)
      stat.values.push(value)
      stat.frame_indices.push(frame_idx)
    })
  })

  // Convert to final format with variation detection
  const result: PropertyStats = new Map()

  for (const [key, stat] of property_stats) {
    if (stat.values.length <= 1) continue

    const is_energy = key.toLowerCase() === `energy`
    const has_variation = get_coefficient_of_variation(stat.values) >= 1e-6

    // Skip constant properties except energy
    if (!has_variation && !is_energy) continue

    result.set(key, { ...stat, has_variation, is_energy })
  }

  return result
}

// Create series from statistics
function create_series_from_stats(
  property_stats: PropertyStats,
  property_config: Record<string, TrajPropertyConfig>,
  colors: readonly string[],
  x_map: TrajectoryXMap,
): DataSeries[] {
  const all_series: DataSeries[] = []
  let color_idx = 0

  for (const [key, stat] of property_stats) {
    const n_values = stat.values.length
    const { clean_label, unit, axis_group } = extract_label_and_unit(key, property_config)
    const color = colors[color_idx % colors.length]

    // shared per-series metadata (consumers only read metadata[0]); one object, not n copies
    const series_metadata = {
      series_label: unit ? `${clean_label} (${unit})` : clean_label,
      property_key: key, // Store original property key for robust lookups
    }
    all_series.push({
      x: stat.frame_indices.map(x_map.to_x),
      y: stat.values,
      label: clean_label,
      unit,
      ...(axis_group ? { axis_group } : {}),
      markers: n_values < 30 ? `line+points` : `line`,
      metadata: Array.from({ length: n_values }, () => series_metadata),
      ...series_color_styles(color),
    })
    color_idx++
  }

  return all_series
}

// Helper functions
export function extract_label_and_unit(
  key: string,
  property_config: Record<string, TrajPropertyConfig>,
): { clean_label: string; unit: string; axis_group?: string } {
  const config = property_config[key] || property_config[key.toLowerCase()]
  if (config) {
    return { clean_label: config.label, unit: config.unit, axis_group: config.axis_group }
  }
  return {
    clean_label: key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ` `),
    unit: ``,
  }
}

function calculate_priority(unit: string, group_series: readonly DataSeries[]): number {
  // Energy units get highest priority
  const unit_priority = ENERGY_UNITS.indexOf(unit)
  if (unit_priority !== -1) return unit_priority

  const has_property = (properties: readonly string[]): boolean =>
    group_series.some((srs) => {
      const label = srs.label?.toLowerCase() ?? ``
      return properties.some((property) => label.includes(property))
    })
  if (has_property(ENERGY_PROPERTIES)) return 10
  if (has_property(FORCE_PROPERTIES)) return 100

  return 1000 // Default low priority
}

// Keep Trajectory's group-level visibility, priority, and two-axis cap.
function assign_trajectory_axes(
  series: readonly DataSeries[],
  is_visible: (series: DataSeries, series_idx: number) => boolean,
): DataSeries[] {
  const groups = group_axis_series(series, {
    is_visible: () => true,
    priority: calculate_priority,
  })
  const requested_groups = groups.filter((group) =>
    group.series.some((srs, group_idx) => is_visible(srs, group.series_indices[group_idx])),
  )
  const selected_groups = requested_groups.length > 0 ? requested_groups : groups.slice(0, 1)
  const { assignments } = assign_axes(series, {
    is_visible: (srs) => selected_groups.some((group) => group.key === axis_group_key(srs)),
    priority: calculate_priority,
  })
  return series.map((srs, series_idx) => ({
    ...srs,
    visible: assignments[series_idx] !== undefined,
    y_axis: assignments[series_idx] ?? `y1`,
  }))
}

// Normalize property keys for robust matching (handles case, underscores, and common aliases)
const normalize_property_key = (key: string): string => {
  const normalized = key
    .toLowerCase()
    .replaceAll(/<[^>]*>/g, ``)
    .replaceAll('_', ` `)
    .trim()
  // Map common force property aliases to canonical form
  return [`fmax`, `f`, `force maximum`].includes(normalized) ? `force max` : normalized
}

const is_default_visible = (
  property_key: string,
  default_properties: Set<string>,
): boolean => {
  const normalized_key = normalize_property_key(property_key)
  for (const prop of default_properties) {
    if (normalize_property_key(prop) === normalized_key) return true
  }
  return false
}

// Utility functions
export function should_hide_plot(
  trajectory: TrajectoryType | undefined,
  plot_series: DataSeries[],
  tolerance = 1e-10,
): boolean {
  if (!trajectory || trajectory.frames.length <= 1 || plot_series.length === 0) {
    return true
  }

  const visible_series = plot_series.filter((srs) => srs.visible)
  if (visible_series.length === 0) return false // Show empty plot with legend

  return visible_series.every((srs) => {
    if (srs.y.length <= 1) return true

    // Check if all values are NaN
    if (srs.y.every(isNaN)) return true

    // Check if values are constant (ignoring NaN values)
    const valid_values = srs.y.filter((val) => !isNaN(val))
    if (valid_values.length <= 1) return true

    const first_valid = valid_values[0]
    return valid_values.every((value) => Math.abs(value - first_valid) <= tolerance)
  })
}

const series_is_visible = (series: DataSeries): boolean => series.visible === true

export const generate_axis_labels = (
  plot_series: DataSeries[],
): {
  y1: string
  y2: string
} => get_axis_labels(plot_series, { is_visible: series_is_visible })

// Log-scale heuristic: a y-axis defaults to log scale when every visible series on
// it is strictly positive AND their combined values span at least three decades.
// SCF convergence residuals (|ΔE|, density rms) span 6+ decades and degenerate into
// hockey sticks on linear axes; plain energies (large negative) stay linear.
export const TRAJECTORY_AXIS_SCALE_OPTIONS = {
  can_use_log_scale: (series: DataSeries) => series.axis_group === SCF_AXIS_GROUP,
  is_visible: series_is_visible,
  min_log_decades: 3,
} as const

export const generate_axis_scale_types = (plot_series: DataSeries[]) =>
  get_axis_scale_types(plot_series, TRAJECTORY_AXIS_SCALE_OPTIONS)

// Streaming plot generation (simplified)
interface StreamingPlotOptions {
  property_config?: Record<string, TrajPropertyConfig>
  colors?: readonly string[]
  default_visible_properties?: Set<string>
  max_points?: number
  // Maps frame number to x coordinate. Defaults to the frame number itself.
  x_map?: TrajectoryXMap
}

export function generate_streaming_plot_series(
  metadata_list: TrajectoryMetadata[],
  options: StreamingPlotOptions = {},
): DataSeries[] {
  if (metadata_list.length === 0) return []

  const {
    property_config = trajectory_property_config,
    colors = PLOT_COLORS,
    default_visible_properties = DEFAULT_VISIBLE,
    max_points = 10_000, // 10,000 plot points provides good visual fidelity while maintaining browser performance
    x_map = FRAME_X_MAP,
  } = options

  const ordered_metadata = [...metadata_list]
    .toSorted((metadata_a, metadata_b) => metadata_a.frame_number - metadata_b.frame_number)
    .filter(
      (metadata, idx, sorted_metadata) =>
        idx === 0 || metadata.frame_number !== sorted_metadata[idx - 1].frame_number,
    )
  const sampled_metadata =
    ordered_metadata.length > max_points
      ? downsample_metadata(ordered_metadata, max_points)
      : ordered_metadata

  const all_properties = new Set<string>()
  sampled_metadata.forEach((metadata) => {
    Object.keys(metadata.properties).forEach((prop) => all_properties.add(prop))
  })

  const all_series: DataSeries[] = []
  let color_idx = 0

  for (const property_key of all_properties) {
    const data_points = sampled_metadata
      .filter((metadata) => property_key in metadata.properties)
      .map((metadata) => ({
        x: x_map.to_x(metadata.frame_number),
        y: metadata.properties[property_key],
      }))

    if (data_points.length < 2) continue

    const is_energy = property_key.toLowerCase() === `energy`
    const values = data_points.map((point) => point.y)
    if (!is_energy && get_coefficient_of_variation(values) < 1e-6) continue

    const { clean_label, unit, axis_group } = extract_label_and_unit(
      property_key,
      property_config,
    )
    const is_visible =
      is_default_visible(property_key, default_visible_properties) || color_idx < 2
    const color = colors[color_idx % colors.length]

    all_series.push({
      x: data_points.map((point) => point.x),
      y: data_points.map((point) => point.y),
      label: clean_label,
      unit,
      ...(axis_group ? { axis_group } : {}),
      visible: is_visible,
      markers: data_points.length < 1000 ? `line+points` : `line`,
      metadata: data_points.map(() => ({
        series_label: unit ? `${clean_label} (${unit})` : clean_label,
        property_key, // Store original property key for robust lookups
      })),
      ...series_color_styles(color),
    })

    color_idx++
  }

  return assign_trajectory_axes(all_series, series_is_visible)
}

// Down-sample to at most target_points entries (callers guarantee the list is longer)
function downsample_metadata(
  metadata_list: TrajectoryMetadata[],
  target_points: number,
): TrajectoryMetadata[] {
  const total_count = metadata_list.length
  const points = Math.max(2, target_points)
  // Evenly spaced indices in [0, total_count-1], guaranteed to include first and last.
  const sampled: TrajectoryMetadata[] = []
  for (let idx = 0; idx < points; idx++) {
    const source_idx = Math.floor((idx * (total_count - 1)) / (points - 1))
    if (sampled.length === 0 || sampled.at(-1) !== metadata_list[source_idx]) {
      sampled.push(metadata_list[source_idx])
    }
  }
  return sampled
}

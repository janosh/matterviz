// Plotting utilities for trajectory visualization
import { PLOT_COLORS } from '$lib/colors'
import { humanize, SCF_AXIS_GROUP, trajectory_property_config } from '$lib/labels'
import type { TrajPropertyConfig } from '$lib/labels'
import {
  array_extent,
  first_non_increasing_index,
  get_coefficient_of_variation,
  mean,
  sample_std,
} from '$lib/math'
import {
  assign_axes,
  axis_group_key,
  axis_labels as get_axis_labels,
  axis_scale_types as get_axis_scale_types,
  group_axis_series,
} from '$lib/plot/core/axis-assignment'
import { smooth_moving_average } from '$lib/plot/core/data-cleaning'
import { assert_series_lengths, type DataSeries } from '$lib/plot/core/types'
import { strip_html } from '$lib/utils'
import type { TrajectoryMetadata } from './index'

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
// Values already represented by the horizontal axis are navigation coordinates, not
// observables. Plotting them again on y produces tautologies such as Time vs Time and can
// consume one of the two default-visible axes before a scientific quantity does.
const AXIS_COORDINATE_PROPERTIES = new Set([
  `frame`,
  `frame index`,
  `frame id`,
  `frame number`,
  `step`,
  `steps`,
  `md step`,
  `step index`,
  `ionic step`,
  `simulation step`,
  `production step`,
  `time`,
  `time fs`,
  `time ps`,
  `time ns`,
  `time s`,
  `simulation time`,
  `md time`,
  `elapsed time`,
  `timestamp`,
])

export interface PlotSeriesOptions {
  property_config?: Record<string, TrajPropertyConfig>
  default_visible_properties?: Set<string>
  // Maps frame index to x coordinate. Defaults to the frame index itself.
  x_map?: TrajectoryXMap
}

// What the plot's x axis counts. `frame` is the position in the trajectory (always
// available), `step` the MD/ionic step recorded in the file, `time` that step scaled by
// the file's timestep. Plotting a 500-step-interval dump against the frame index and
// labelling it "Step" is the bug this type exists to prevent.
export type TrajectoryXQuantity = keyof typeof X_QUANTITY_LABELS

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
  values.every(Number.isFinite) && first_non_increasing_index(values) === null

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

export const X_QUANTITY_LABELS = {
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
const FRAME_X_MAP: TrajectoryXMap = {
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

// Frame/step pairs of a run's property rows (sorted by frame_number; every frame for an
// eager run, a sample for HDF5). Cached per rows array so the viewer's derived values share
// one pair of arrays per property batch.
const samples_cache = new WeakMap<readonly TrajectoryMetadata[], FrameStepSamples>()
export function get_frame_step_samples(rows: readonly TrajectoryMetadata[]): FrameStepSamples {
  let samples = samples_cache.get(rows)
  if (!samples) {
    const frame_numbers = rows.map((row) => row.frame_number)
    samples_cache.set(rows, (samples = { frame_numbers, steps: rows.map((row) => row.step) }))
  }
  return samples
}

// frame_indices runs parallel to values: a property absent from some frames yields fewer
// values than there are frames, and pairing them by array position would slide every
// later point one frame to the left.
type PropertyStats = Map<string, { values: number[]; frame_indices: number[] }>

// Normalize property keys for robust matching (handles case, underscores, and common aliases)
const normalize_property_key = (key: string): string => {
  const normalized = strip_html(key.toLowerCase())
    .replaceAll(/[_()[\]]/g, ` `)
    .replaceAll(/\s+/g, ` `)
    .trim()
  // Map common force property aliases to canonical form
  return [`fmax`, `f`, `force maximum`].includes(normalized) ? `force max` : normalized
}

const is_energy_property = (key: string): boolean =>
  ENERGY_PROPERTIES.some(
    (property) => normalize_property_key(property) === normalize_property_key(key),
  )

const is_axis_coordinate_property = (key: string): boolean =>
  AXIS_COORDINATE_PROPERTIES.has(normalize_property_key(key))

const is_default_visible = (
  property_key: string,
  default_properties: Set<string>,
): boolean => {
  const normalized_key = normalize_property_key(property_key)
  return [...default_properties].some(
    (prop) => normalize_property_key(prop) === normalized_key,
  )
}

// Keep every property that varies (plus energy, kept even when flat so a converged run
// still shows its energy) and was observed in at least two frames.
const filter_plottable = (stats: PropertyStats): PropertyStats =>
  new Map(
    [...stats].filter(
      ([key, stat]) =>
        stat.values.length > 1 &&
        (is_energy_property(key) || get_coefficient_of_variation(stat.values) >= 1e-6),
    ),
  )

// Per-property value lists from the rows, keyed by property. Rows arrive sorted and
// deduplicated (TrajectoryProperties), so this is one linear pass.
function row_property_statistics(rows: readonly TrajectoryMetadata[]): PropertyStats {
  const stats: PropertyStats = new Map()
  for (const { frame_number, properties } of rows) {
    for (const [key, value] of Object.entries(properties)) {
      if (typeof value !== `number` || is_axis_coordinate_property(key)) continue
      let stat = stats.get(key)
      if (!stat) stats.set(key, (stat = { values: [], frame_indices: [] }))
      stat.values.push(value)
      stat.frame_indices.push(frame_number)
    }
  }
  return filter_plottable(stats)
}

// Cache the per-row walk per rows array so re-renders that only change visible_properties or
// labels reuse it (legend toggles mutate plot_series directly and skip regeneration).
const stats_cache = new WeakMap<readonly TrajectoryMetadata[], PropertyStats>()
const cached_property_statistics = (rows: readonly TrajectoryMetadata[]): PropertyStats => {
  let stats = stats_cache.get(rows)
  if (!stats) stats_cache.set(rows, (stats = row_property_statistics(rows)))
  return stats
}

export interface PropertySummary {
  key: string
  n_samples: number
  mean: number
  // Sample standard deviation over the sampled frames
  std: number
  min: number
  max: number
  // Least-squares slope of value against x times the x span: the systematic change over the
  // run, separated from the fluctuation `std` measures. A well-equilibrated NVT run has a
  // temperature drift far below its std; a relaxation has an energy drift that IS the story.
  drift: number
}

// Run-level statistics of every plottable property (see filter_plottable), keyed by property.
// `x_of` maps a row to the abscissa the drift is taken against (frame number by default; a
// time axis gives the same drift with the slope in per-time units).
export function summarize_properties(
  rows: readonly TrajectoryMetadata[],
  x_of: (row: TrajectoryMetadata) => number = (row) => row.frame_number,
): PropertySummary[] {
  const by_frame = new Map(rows.map((row) => [row.frame_number, x_of(row)]))
  return [...cached_property_statistics(rows)].map(([key, { values, frame_indices }]) => {
    const n_samples = values.length
    const xs = frame_indices.map((frame_number) => by_frame.get(frame_number) ?? frame_number)
    const mean_x = mean(xs)
    const mean_y = mean(values)
    let [sxx, sxy] = [0, 0]
    for (const [idx, value] of values.entries()) {
      const dx = xs[idx] - mean_x
      sxx += dx * dx
      sxy += dx * (value - mean_y)
    }
    const [min, max] = array_extent(values)
    const span = xs.length > 1 ? xs[xs.length - 1] - xs[0] : 0
    return {
      key,
      n_samples,
      mean: mean_y,
      std: sample_std(values),
      min,
      max,
      drift: sxx > 0 ? (sxy / sxx) * span : 0,
    }
  })
}

export function extract_label_and_unit(
  key: string,
  property_config: Record<string, TrajPropertyConfig>,
): { clean_label: string; unit: string; axis_group?: string } {
  const config = property_config[key] || property_config[key.toLowerCase()]
  return config
    ? { clean_label: config.label, unit: config.unit, axis_group: config.axis_group }
    : { clean_label: humanize(key), unit: `` }
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

// Series from property statistics: one per property, coloured in order, visible when the
// property (or another in its unit group) is requested, capped at two axes by priority. With
// nothing requested the highest-priority group shows so the plot is never empty.
function build_series(stats: PropertyStats, options: PlotSeriesOptions): DataSeries[] {
  const {
    property_config = trajectory_property_config,
    default_visible_properties = DEFAULT_VISIBLE,
    x_map = FRAME_X_MAP,
  } = options
  const series: DataSeries[] = []
  for (const [key, stat] of stats) {
    const n_values = stat.values.length
    const { clean_label, unit, axis_group } = extract_label_and_unit(key, property_config)
    const color = PLOT_COLORS[series.length % PLOT_COLORS.length]
    series.push({
      x: stat.frame_indices.map(x_map.to_x),
      y: stat.values,
      label: clean_label,
      unit,
      ...(axis_group ? { axis_group } : {}),
      markers: n_values < 30 ? `line+points` : `line`,
      // Series-level (not per point): every consumer resolves a scalar metadata object
      metadata: {
        series_label: unit ? `${clean_label} (${unit})` : clean_label,
        property_key: key, // original property key for robust lookups
      },
      line_style: { stroke: color, stroke_width: 2 },
      point_style: { fill: color, stroke: color, stroke_width: 1 },
    })
  }

  const groups = group_axis_series(series, {
    is_visible: () => true,
    priority: calculate_priority,
  })
  const requested_groups = groups.filter((group) =>
    group.series.some((srs) =>
      is_default_visible(property_key(srs) ?? srs.label ?? ``, default_visible_properties),
    ),
  )
  const selected_groups = requested_groups.length > 0 ? requested_groups : groups.slice(0, 1)
  const { assignments } = assign_axes(series, {
    is_visible: (srs) => selected_groups.some((group) => group.key === axis_group_key(srs)),
    priority: calculate_priority,
  })
  return series
    .map((srs, series_idx) => ({
      ...srs,
      visible: assignments[series_idx] !== undefined,
      y_axis: assignments[series_idx] ?? `y1`,
    }))
    .toSorted((srs_a, srs_b) => Number(srs_b.visible) - Number(srs_a.visible))
}

export const property_key = (series: DataSeries): string | undefined => {
  const metadata = Array.isArray(series.metadata) ? series.metadata[0] : series.metadata
  const key = metadata?.property_key
  return typeof key === `string` ? key : undefined
}

// Plot series from a run's property rows
export const generate_plot_series = (
  rows: readonly TrajectoryMetadata[],
  options: PlotSeriesOptions = {},
): DataSeries[] =>
  rows.length > 0 ? build_series(cached_property_statistics(rows), options) : []

// A plot of one frame, or of nothing but flat lines, says nothing: hide it
export function should_hide_plot(
  frame_count: number,
  plot_series: DataSeries[],
  tolerance = 1e-10,
): boolean {
  if (frame_count <= 1 || plot_series.length === 0) return true

  const visible_series = plot_series.filter((srs) => srs.visible)
  if (visible_series.length === 0) return false // Show empty plot with legend

  // Hide when every visible series is constant (ignoring NaN) or has nothing to plot
  return visible_series.every((srs) => {
    const valid = srs.y.filter((val) => !isNaN(val))
    return valid.length <= 1 || valid.every((val) => Math.abs(val - valid[0]) <= tolerance)
  })
}

const series_is_visible = (series: DataSeries): boolean => series.visible === true

export const generate_axis_labels = (plot_series: DataSeries[]) =>
  get_axis_labels(plot_series, { is_visible: series_is_visible })

// Log-scale heuristic: a y-axis defaults to log scale when every visible series on
// it is strictly positive AND their combined values span at least three decades.
// SCF convergence residuals (|ΔE|, density rms) span 6+ decades and degenerate into
// hockey sticks on linear axes; plain energies (large negative) stay linear.
export const generate_axis_scale_types = (plot_series: DataSeries[]) =>
  get_axis_scale_types(plot_series, {
    can_use_log_scale: (series) => series.axis_group === SCF_AXIS_GROUP,
    is_visible: series_is_visible,
    min_log_decades: 3,
  })

type PlotDataPoint = { x: number; y: number; source_idx: number }

export function prepare_trajectory_scatter_series(
  series: readonly DataSeries[],
  max_points: number,
): DataSeries[] {
  if (!Number.isFinite(max_points) || max_points < 2) {
    throw new RangeError(`max_points must be finite and at least 2, got ${max_points}`)
  }
  const limit = Math.floor(max_points)
  return series.map((data_series, series_idx) => {
    assert_series_lengths(data_series, series_idx)
    if (data_series.x.length <= limit) return data_series
    const source_raw_y = data_series.raw_y ?? data_series.y
    let window_size = Math.max(5, Math.round(data_series.x.length / 50))
    if (window_size % 2 === 0) window_size++
    const smoothed_y = smooth_moving_average(data_series.y, window_size)
    const sampled_points = downsample_data_points(
      data_series.x.map((x, source_idx) => ({ x, y: source_raw_y[source_idx], source_idx })),
      limit,
    )
    const sampled_x = sampled_points.map((point) => point.x)
    const sampled_raw_y = sampled_points.map((point) => point.y)
    const color = data_series.line_style?.stroke ?? `currentColor`
    return {
      ...data_series,
      x: sampled_x,
      y: sampled_points.map(({ source_idx }) => smoothed_y[source_idx]),
      raw_y: sampled_raw_y,
      markers: `line`,
      metadata: data_series.metadata,
      line_underlays: [
        {
          x: sampled_x,
          y: sampled_raw_y,
          line_style: {
            stroke: `color-mix(in srgb, ${color} 18%, transparent)`,
            stroke_width: 1,
            curve: `linear`,
          },
        },
      ],
      line_style: { stroke: color, stroke_width: 2.5, curve: `monotone` },
    }
  })
}

// Largest-Triangle-Three-Buckets keeps endpoints and visually important extrema while
// limiting long trajectories to roughly one point per plot pixel. Uniform decimation can
// miss narrow energy spikes; drawing all 24k+ samples turns quantized thermal noise into a
// solid wall and makes hover/layout work scale with the file instead of the viewport.
function downsample_data_points(data_points: PlotDataPoint[], limit: number): PlotDataPoint[] {
  if (data_points.length <= limit) return data_points
  const last_point = data_points[data_points.length - 1]
  if (limit === 2) return [data_points[0], last_point]

  const sampled = [data_points[0]]
  const bucket_width = (data_points.length - 2) / (limit - 2)
  let anchor_idx = 0
  for (let bucket_idx = 0; bucket_idx < limit - 2; bucket_idx++) {
    const anchor = data_points[anchor_idx]
    const average_start = Math.floor((bucket_idx + 1) * bucket_width) + 1
    const average_end = Math.min(
      Math.floor((bucket_idx + 2) * bucket_width) + 1,
      data_points.length,
    )
    let average_x = 0
    let average_y = 0
    let average_count = 0
    for (let point_idx = average_start; point_idx < average_end; point_idx++) {
      const point = data_points[point_idx]
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      average_x += point.x
      average_y += point.y
      average_count++
    }
    if (average_count > 0) {
      average_x /= average_count
      average_y /= average_count
    } else {
      average_x = Number.isFinite(anchor.x) ? anchor.x : 0
      average_y = Number.isFinite(anchor.y) ? anchor.y : 0
    }

    const bucket_start = Math.floor(bucket_idx * bucket_width) + 1
    const bucket_end = Math.min(
      Math.floor((bucket_idx + 1) * bucket_width) + 1,
      data_points.length - 1,
    )
    const anchor_x = Number.isFinite(anchor.x) ? anchor.x : average_x
    const anchor_y = Number.isFinite(anchor.y) ? anchor.y : average_y
    let selected_idx = -1
    let max_area = -1
    for (let point_idx = bucket_start; point_idx < bucket_end; point_idx++) {
      const point = data_points[point_idx]
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      const area = Math.abs(
        (anchor_x - average_x) * (point.y - anchor_y) -
          (anchor_x - point.x) * (average_y - anchor_y),
      )
      if (area > max_area) {
        max_area = area
        selected_idx = point_idx
      }
    }
    if (selected_idx < 0) selected_idx = bucket_start
    sampled.push(data_points[selected_idx])
    anchor_idx = selected_idx
  }
  sampled.push(last_point)
  return sampled
}

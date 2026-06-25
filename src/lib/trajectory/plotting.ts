// Plotting utilities for trajectory visualization
import { PLOT_COLORS } from '$lib/colors'
import { trajectory_property_config } from '$lib/labels'
import { get_coefficient_of_variation } from '$lib/math'
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
const DEFAULT_VISIBLE = new Set([`energy`, `force_max`, `stress_frobenius`])

type VisibleProp = Readonly<{ property: string; unit: string }>

// Shared per-series line/point styling derived from a single color
const series_color_styles = (color: string) => ({
  line_style: { stroke: color, stroke_width: 2 },
  point_style: { fill: color, radius: 4, stroke: color, stroke_width: 1 },
})

export interface PlotSeriesOptions {
  property_config?: Record<string, { label: string; unit: string }>
  colors?: readonly string[]
  default_visible_properties?: Set<string>
}

interface UnitGroup {
  unit: string
  series: DataSeries[]
  priority: number
  is_visible: boolean
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

const stats_cache = new WeakMap<
  TrajectoryType,
  {
    extractor: TrajectoryDataExtractor
    frames: TrajectoryFrame[]
    stats: ReturnType<typeof extract_property_statistics>
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
  } = options

  // Single-pass extraction with variance detection, cached per trajectory (see stats_cache above)
  const cached = stats_cache.get(trajectory)
  let property_stats: ReturnType<typeof extract_property_statistics>
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
  const all_series = create_series_from_stats(property_stats, property_config, colors)

  // Group by units and assign axes/visibility
  const unit_groups = group_and_assign_series(all_series, default_visible_properties)

  // Apply final assignments to series
  apply_group_assignments(all_series, unit_groups)

  return all_series.sort((a, b) => Number(b.visible) - Number(a.visible))
}

// Extract statistics for all properties in a single pass
function extract_property_statistics(
  trajectory: TrajectoryType,
  data_extractor: TrajectoryDataExtractor,
): Map<
  string,
  {
    values: number[]
    has_variation: boolean
    is_energy: boolean
  }
> {
  const property_stats = new Map<string, { values: number[] }>()

  // Extract all data in single pass
  trajectory.frames.forEach((frame) => {
    const data = data_extractor(frame, trajectory)

    Object.entries(data).forEach(([key, value]) => {
      if (typeof value !== `number` || key === `Step` || key.startsWith(`constant_`)) {
        return
      }

      const stat = property_stats.get(key) ?? { values: [] }
      property_stats.set(key, stat)
      stat.values.push(value)
    })
  })

  // Convert to final format with variation detection
  const result = new Map<
    string,
    {
      values: number[]
      has_variation: boolean
      is_energy: boolean
    }
  >()

  for (const [key, stat] of property_stats) {
    const n_values = stat.values.length
    if (n_values <= 1) continue

    const coefficient_of_variation = get_coefficient_of_variation(stat.values)

    const lower_key = key.toLowerCase()
    const is_energy = lower_key === `energy`
    const has_variation = coefficient_of_variation >= 1e-6

    // Skip constant properties except energy
    if (!has_variation && !is_energy) continue

    result.set(key, {
      values: stat.values,
      has_variation,
      is_energy,
    })
  }

  return result
}

// Create series from statistics
function create_series_from_stats(
  property_stats: Map<
    string,
    {
      values: number[]
      has_variation: boolean
      is_energy: boolean
    }
  >,
  property_config: Record<string, { label: string; unit: string }>,
  colors: readonly string[],
): DataSeries[] {
  const all_series: DataSeries[] = []
  let color_idx = 0

  for (const [key, stat] of property_stats) {
    if (!stat) continue
    const n_values = stat.values.length
    const { clean_label, unit } = extract_label_and_unit(key, property_config)
    const color = colors[color_idx % colors.length]

    // shared per-series metadata (consumers only read metadata[0]); one object, not n copies
    const series_metadata = {
      series_label: unit ? `${clean_label} (${unit})` : clean_label,
      property_key: key, // Store original property key for robust lookups
    }
    all_series.push({
      x: Array.from({ length: n_values }, (_, idx) => idx),
      y: stat.values,
      label: clean_label,
      unit,
      y_axis: `y1`, // Will be reassigned
      visible: false, // Will be assigned
      markers: n_values < 30 ? `line+points` : `line`,
      metadata: Array.from({ length: n_values }, () => series_metadata),
      ...series_color_styles(color),
    })
    color_idx++
  }

  return all_series
}

// Group series and assign visibility/axes
function group_and_assign_series(
  series: DataSeries[],
  default_visible_properties: Set<string>,
): UnitGroup[] {
  // Group by unit
  const unit_map = new Map<string, DataSeries[]>()
  for (const srs of series) {
    const unit = srs.unit ?? `dimensionless`
    const group = unit_map.get(unit) ?? []
    group.push(srs)
    unit_map.set(unit, group)
  }

  // Create unit groups with priority and visibility
  const groups = Array.from(unit_map.entries())
    .map(([unit, group_series]) => {
      const priority = calculate_priority(unit, group_series)
      const is_visible = group_series.some((srs) => {
        const metadata = Array.isArray(srs.metadata) ? srs.metadata[0] : srs.metadata
        const property_key = ((metadata?.property_key as string) || srs.label) ?? ``
        return is_default_visible(property_key, default_visible_properties)
      })

      return { unit, series: group_series, priority, is_visible }
    })
    .sort((a, b) => a.priority - b.priority)

  // Apply 2-group visibility limit
  const visible_groups = groups.filter((group) => group.is_visible)
  if (visible_groups.length > 2) {
    // Keep only first 2 (highest priority)
    groups.forEach((group) => {
      group.is_visible = visible_groups.slice(0, 2).includes(group)
    })
  } else if (visible_groups.length === 0 && groups.length > 0) {
    groups[0].is_visible = true
  }

  return groups
}

// Apply group assignments to individual series
function apply_group_assignments(series: DataSeries[], unit_groups: UnitGroup[]): void {
  const visible_groups = unit_groups.filter((group) => group.is_visible)
  const axis_map = new Map<UnitGroup, `y1` | `y2`>()

  // Assign axes
  if (visible_groups.length === 1) {
    axis_map.set(visible_groups[0], `y1`)
  } else if (visible_groups.length === 2) {
    axis_map.set(visible_groups[0], `y1`)
    axis_map.set(visible_groups[1], `y2`)
  }

  // Apply to series
  for (const srs of series) {
    const group = unit_groups.find((unit_group) => unit_group.series.includes(srs))
    if (group) {
      srs.visible = group.is_visible
      srs.y_axis = axis_map.get(group) ?? `y1`
    }
  }
}

// Helper functions
function extract_label_and_unit(
  key: string,
  property_config: Record<string, { label: string; unit: string }>,
): { clean_label: string; unit: string } {
  const config = property_config[key] || property_config[key.toLowerCase()]
  if (config) return { clean_label: config.label, unit: config.unit }
  return {
    clean_label: key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ` `),
    unit: ``,
  }
}

function calculate_priority(unit: string, group_series: DataSeries[]): number {
  // Energy units get highest priority
  const unit_priority = ENERGY_UNITS.indexOf(unit)
  if (unit_priority !== -1) return unit_priority

  // Energy properties get high priority
  const has_energy = group_series.some((srs) => {
    const label = srs.label?.toLowerCase() ?? ``
    return ENERGY_PROPERTIES.some((prop) => label.includes(prop))
  })
  if (has_energy) return 10

  // Force properties get medium priority
  const has_force = group_series.some((srs) => {
    const label = srs.label?.toLowerCase() ?? ``
    return FORCE_PROPERTIES.some((prop) => label.includes(prop))
  })
  if (has_force) return 100

  return 1000 // Default low priority
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

function get_axis_label(axis_series: DataSeries[]): string {
  const visible_series = axis_series.filter((srs) => srs.visible)
  if (visible_series.length === 0) return `Value`

  const unit_groups = new Map<string, string[]>()
  visible_series.forEach((srs) => {
    const unit = srs.unit ?? ``
    const label = srs.label ?? `Value`
    if (!unit_groups.has(unit)) unit_groups.set(unit, [])
    const group = unit_groups.get(unit)
    if (group) group.push(label)
  })

  const unit_entries = Array.from(unit_groups.entries())
  if (unit_entries.length === 0) return `Value`

  const [unit, labels] = unit_entries[0]
  const unique_labels = [...new Set(labels)].sort().join(` / `)
  return unit ? `${unique_labels} (${unit})` : unique_labels
}

export function generate_axis_labels(plot_series: DataSeries[]): {
  y1: string
  y2: string
} {
  if (plot_series.length === 0) return { y1: `Value`, y2: `Value` }

  return {
    y1: get_axis_label(plot_series.filter((srs) => (srs.y_axis ?? `y1`) === `y1`)),
    y2: get_axis_label(plot_series.filter((srs) => srs.y_axis === `y2`)),
  }
}

// Streaming plot generation (simplified)
interface StreamingPlotOptions {
  property_config?: Record<string, { label: string; unit: string }>
  colors?: readonly string[]
  default_visible_properties?: Set<string>
  max_points?: number
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
  } = options

  const sampled_metadata =
    metadata_list.length > max_points
      ? downsample_metadata(metadata_list, max_points)
      : metadata_list

  const all_properties = new Set<string>()
  sampled_metadata.forEach((metadata) => {
    Object.keys(metadata.properties).forEach((prop) => all_properties.add(prop))
  })

  const all_series: DataSeries[] = []
  const visible_props: VisibleProp[] = []
  let color_idx = 0

  for (const property_key of all_properties) {
    const data_points = sampled_metadata
      .filter((metadata) => property_key in metadata.properties)
      .map((metadata) => ({ x: metadata.step, y: metadata.properties[property_key] }))

    if (data_points.length < 2) continue

    const is_energy = property_key.toLowerCase() === `energy`
    if (!is_energy && !has_significant_variation(data_points.map((point) => point.y))) continue

    const { clean_label, unit } = extract_label_and_unit(property_key, property_config)
    const is_visible =
      is_default_visible(property_key, default_visible_properties) || color_idx < 2
    const color = colors[color_idx % colors.length]

    if (is_visible) visible_props.push({ property: property_key, unit })

    all_series.push({
      x: data_points.map((point) => point.x),
      y: data_points.map((point) => point.y),
      label: clean_label,
      unit,
      y_axis: determine_axis_from_groups(property_key, unit, visible_props),
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

  return all_series
}

// Helper functions for streaming
function downsample_metadata(
  metadata_list: TrajectoryMetadata[],
  target_points: number,
): TrajectoryMetadata[] {
  const total_count = metadata_list.length
  if (total_count <= target_points) return metadata_list
  const points = Math.max(2, Math.min(target_points, total_count))
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

function has_significant_variation(values: number[], tolerance = 1e-6): boolean {
  if (values.length <= 1) return false

  const coefficient_of_variation = get_coefficient_of_variation(values)
  return coefficient_of_variation >= tolerance
}

function determine_axis_from_groups(
  property: string,
  unit: string,
  visible_properties: VisibleProp[],
): `y1` | `y2` {
  const mock_series = visible_properties.map(({ property: prop, unit: u }) => ({
    label: prop,
    unit: u,
  })) as DataSeries[]

  const groups = group_and_assign_series(mock_series, new Set([property]))
  const target_group = groups.find((group) =>
    group.series.some((srs) => srs.label === property && srs.unit === unit),
  )

  return target_group && groups.filter((group) => group.is_visible).indexOf(target_group) === 1
    ? `y2`
    : `y1`
}

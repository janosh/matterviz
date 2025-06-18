// Plotting utilities for trajectory visualization
import { plot_colors } from '$lib/colors'
import { get_label_with_unit } from '$lib/labels'
import type { DataSeries } from '$lib/plot'
import type { Trajectory, TrajectoryDataExtractor } from './index'

// Properties that should be assigned to the secondary y-axis
export const Y2_PROPERTIES = new Set([
  `force_max`,
  `force_norm`,
  `stress_max`,
  `stress_frobenius`,
  `volume`,
  `density`,
  `pressure`,
  `temperature`,
])

export interface PlotSeriesOptions {
  property_labels?: Record<string, string>
  units?: Record<string, string>
  colors?: string[]
  y2_properties?: Set<string>
  default_visible_properties?: Set<string>
}

// Generate plot data series from trajectory
export function generate_plot_series(
  trajectory: Trajectory,
  data_extractor: TrajectoryDataExtractor,
  options: PlotSeriesOptions = {},
): DataSeries[] {
  if (!trajectory || trajectory.frames.length === 0) return []

  const {
    property_labels,
    units,
    colors = plot_colors,
    y2_properties = Y2_PROPERTIES,
    default_visible_properties = new Set([`energy`, `force_max`, `stress_frobenius`]),
  } = options

  // Single pass: extract data and detect constants simultaneously
  const property_data = new Map<string, {
    values: number[]
    sum: number
    sum_squares: number
    min: number
    max: number
  }>()

  // Extract data from all frames in a single pass
  trajectory.frames.forEach((frame) => {
    const data = data_extractor(frame, trajectory)

    for (const [key, value] of Object.entries(data)) {
      // Skip non-numeric values, step, and marker properties
      if (typeof value !== `number` || key === `Step` || key.startsWith(`_constant_`)) {
        continue
      }

      if (!property_data.has(key)) {
        property_data.set(key, {
          values: [],
          sum: 0,
          sum_squares: 0,
          min: value,
          max: value,
        })
      }

      const prop = property_data.get(key)
      if (!prop) continue

      prop.values.push(value)
      prop.sum += value
      prop.sum_squares += value * value
      prop.min = Math.min(prop.min, value)
      prop.max = Math.max(prop.max, value)
    }
  })

  // Filter out constant properties and create series
  const series: DataSeries[] = []
  let color_idx = 0

  for (const [key, prop] of property_data) {
    const n = prop.values.length
    if (n <= 1) continue

    // Fast constant detection using coefficient of variation
    const mean = prop.sum / n
    const variance = (prop.sum_squares - prop.sum * prop.sum / n) / n
    const coefficient_of_variation = Math.abs(mean) > 1e-10
      ? Math.sqrt(variance) / Math.abs(mean)
      : Math.sqrt(variance)

    // Skip properties with very low variation (effectively constant)
    if (coefficient_of_variation < 1e-6) {
      continue
    }

    // Create series data
    const lower_key = key.toLowerCase()
    const x_values = Array.from({ length: n }, (_, idx) => idx)
    const y_values = prop.values
    const color = colors[color_idx % colors.length]
    const y_axis: `y1` | `y2` = y2_properties.has(lower_key) ? `y2` : `y1`
    const is_default_visible = default_visible_properties.has(lower_key) ||
      default_visible_properties.has(key)
    const label = get_label_with_unit(key, property_labels, units)

    series.push({
      x: x_values,
      y: y_values,
      label,
      y_axis,
      visible: is_default_visible,
      markers: n < 30 ? `line+points` : `line`,
      metadata: x_values.map(() => ({ series_label: label })),
      line_style: {
        stroke: color,
        stroke_width: 2,
      },
      point_style: {
        fill: color,
        radius: 4,
        stroke: color,
        stroke_width: 1,
      },
    })
    color_idx++
  }

  // Fallback visibility for volume/density if no priority properties are visible
  const has_visible_priority = series.some((s) =>
    s.visible &&
    ![`volume`, `density`].some((prop) => s.label?.toLowerCase().includes(prop))
  )

  if (!has_visible_priority) {
    series.forEach((s) => {
      const label_lower = s.label?.toLowerCase() || ``
      if (label_lower.includes(`volume`) || label_lower.includes(`density`)) {
        s.visible = true
      }
    })
  }

  // Sort by visibility for legend ordering
  series.sort((a, b) => Number(b.visible) - Number(a.visible))

  return series
}

// Check if all plotted values are constant (should hide plot)
export function should_hide_plot(
  trajectory: Trajectory | undefined,
  plot_series: DataSeries[],
  tolerance = 1e-10,
): boolean {
  if (!trajectory || trajectory.frames.length <= 1) return false

  // If there are no series to plot, hide the plot
  if (plot_series.length === 0) return true

  // Get all visible series, and if none are visible, check fallback properties
  let visible_series = plot_series.filter((s) => s.visible)

  // If no explicit properties are visible, fall back to volume and density if they exist
  if (visible_series.length === 0) {
    const fallback_properties = [`volume`, `density`]
    visible_series = plot_series.filter((s) =>
      fallback_properties.some((prop) =>
        s.label?.toLowerCase().includes(prop.toLowerCase())
      )
    )
  }

  if (visible_series.length === 0) return true

  for (const series of visible_series) {
    if (series.y.length <= 1) continue

    const first_value = series.y[0]
    const has_variation = series.y.some(
      (value) => Math.abs(value - first_value) > tolerance,
    )

    if (has_variation) {
      return false // Found variation, don't hide plot
    }
  }

  return true // All series are constant, hide plot
}

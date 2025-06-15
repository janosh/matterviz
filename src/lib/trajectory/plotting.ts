// Plotting utilities for trajectory visualization
import { plot_colors } from '$lib/colors'
import { get_label_with_unit } from '$lib/labels'
import type { DataSeries } from '$lib/plot'
import { lattice_param_keys } from '$lib/structure'
import type { Trajectory, TrajectoryDataExtractor } from './index'

// Properties that should be assigned to the secondary y-axis
export const Y2_PROPERTIES = new Set([
  `force_max`,
  `force_norm`,
  `stress_max`,
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
    default_visible_properties = new Set([`energy`, `force_max`]),
  } = options

  // Extract data from all frames
  const all_extracted_data = trajectory.frames.map((frame) =>
    data_extractor(frame, trajectory)
  )

  if (all_extracted_data.length === 0) return []

  // Get all unique keys from extracted data
  const all_keys = new Set<string>()
  for (const data of all_extracted_data) {
    Object.keys(data).forEach((key) => all_keys.add(key))
  }

  // Check if lattice parameters are constant (using marker from full_data_extractor)
  const has_constant_lattice_params = all_extracted_data.some(
    (data) => data._constant_lattice_params === 1,
  )

  // Create a series for each property
  const series: DataSeries[] = []
  let color_idx = 0

  for (const key of all_keys) {
    // Skip Step for x-axis (we use step index instead)
    if (key === `Step`) continue
    // Skip the marker property used for lattice parameter detection
    if (key === `_constant_lattice_params`) continue

    const x_values: number[] = []
    const y_values: number[] = []

    for (let idx = 0; idx < all_extracted_data.length; idx++) {
      const data = all_extracted_data[idx]
      if (key in data && typeof data[key] === `number`) {
        x_values.push(idx) // step index as x (0-based)
        y_values.push(data[key])
      }
    }

    if (x_values.length > 0) {
      const color = colors[color_idx % colors.length]
      const lower_key = key.toLowerCase()

      // Determine which y-axis to use based on property type
      const y_axis: `y1` | `y2` = y2_properties.has(lower_key) ? `y2` : `y1`

      // Determine default visibility
      let is_default_visible = default_visible_properties.has(lower_key) ||
        default_visible_properties.has(key)

      // If lattice parameters are constant, don't show them by default
      if (
        has_constant_lattice_params &&
        lattice_param_keys.includes(
          lower_key as (typeof lattice_param_keys)[number],
        )
      ) {
        is_default_visible = false
      }

      const label = get_label_with_unit(key, property_labels, units)

      series.push({
        x: x_values,
        y: y_values,
        label,
        y_axis,
        visible: is_default_visible,
        markers: x_values.length < 30 ? `line+points` : `line`,
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
  }

  // If no priority properties are visible, make volume and density visible by default
  const has_visible_priority_properties = series.some(
    (s) =>
      s.visible &&
      ![`volume`, `density`].some((prop) =>
        s.label?.toLowerCase().includes(prop.toLowerCase())
      ),
  )

  if (!has_visible_priority_properties) {
    for (const s of series) {
      const label_lower = s.label?.toLowerCase() || ``
      if (label_lower.includes(`volume`) || label_lower.includes(`density`)) {
        s.visible = true
      }
    }
  }

  // Sort by visible series so they appear first in legend
  series.sort((s1, s2) => {
    // If a is visible and b is not, a should come first (negative)
    if (s1.visible === true && s2.visible !== true) return -1
    // If b is visible and a is not, b should come first (positive)
    if (s2.visible === true && s1.visible !== true) return 1
    // Otherwise maintain original order
    return 0
  })

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

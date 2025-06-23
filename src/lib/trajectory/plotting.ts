// Plotting utilities for trajectory visualization
import { plot_colors } from '$lib/colors'
import { trajectory_property_config } from '$lib/labels'
import type { DataSeries } from '$lib/plot'
import type { Trajectory, TrajectoryDataExtractor } from '$lib/trajectory'

// Priority order for y1 axis (higher priority = more likely to be on y1)
const Y1_PRIORITY_UNITS = [`eV`, `eV/atom`, `hartree`, `kcal/mol`, `kJ/mol`] // Energy units get highest priority
const Y1_PRIORITY_PROPERTIES = [`energy`, `total_energy`, `potential_energy`]

export interface PlotSeriesOptions {
  property_config?: Record<string, { label: string; unit: string }>
  colors?: string[]
  default_visible_properties?: Set<string>
}

export interface UnitGroup {
  unit: string
  series: DataSeries[]
  priority: number // Lower number = higher priority for y1 axis
  is_visible: boolean
}

// Helper function to extract clean label and unit from property configuration
function extract_label_and_unit(
  key: string,
  property_config: Record<string, { label: string; unit: string }>,
): { clean_label: string; unit: string } {
  const lower_key = key.toLowerCase()
  const config = property_config[key] || property_config[lower_key]

  if (config) {
    return { clean_label: config.label, unit: config.unit }
  } else { // Use key as fallback label if no config found
    return {
      clean_label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ` `),
      unit: ``,
    }
  }
}

// Helper function to calculate unit group priority based on unit and series
function calculate_unit_group_priority(unit: string, group_series: DataSeries[]): number {
  let priority = 1000 // Default low priority

  // Check for energy units (highest priority)
  const unit_priority = Y1_PRIORITY_UNITS.indexOf(unit)
  if (unit_priority !== -1) priority = unit_priority

  // Check for energy properties (high priority)
  const has_priority_property = group_series.some((s) => {
    const label_lower = s.label?.toLowerCase() || ``
    return Y1_PRIORITY_PROPERTIES.some((prop) => label_lower.includes(prop))
  })
  if (has_priority_property) priority = Math.min(priority, 10)

  // Force-related properties have medium priority (should go to y2 when energy is present)
  const has_force_property = group_series.some((s) => {
    const label_lower = s.label?.toLowerCase() || ``
    return label_lower.includes(`force`) || label_lower.includes(`f`)
  })
  if (has_force_property && priority > 100) priority = 100 // Medium priority, lower than energy

  return priority
}

// Generate plot data series from trajectory with robust unit-based grouping
export function generate_plot_series(
  trajectory: Trajectory,
  data_extractor: TrajectoryDataExtractor,
  options: PlotSeriesOptions = {},
): DataSeries[] {
  if (!trajectory || trajectory.frames.length === 0) return []

  const {
    property_config = trajectory_property_config,
    colors = plot_colors,
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

  // Create all series first (without visibility assignment)
  const all_series: DataSeries[] = []
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

    const lower_key = key.toLowerCase()
    const is_energy = lower_key === `energy`
    const has_significant_variation = coefficient_of_variation >= 1e-6

    // Skip properties with very low variation (effectively constant)
    // Exception: always include energy regardless of variation
    if (!has_significant_variation && !is_energy) continue

    // Create series data
    const x_values = Array.from({ length: n }, (_, idx) => idx)
    const y_values = prop.values
    const color = colors[color_idx % colors.length]

    // Extract clean label and unit using structured configuration
    const { clean_label, unit } = extract_label_and_unit(key, property_config)

    const full_label = unit ? `${clean_label} (${unit})` : clean_label

    all_series.push({
      x: x_values,
      y: y_values,
      label: clean_label, // Use clean label without units for legend (units added by axis labeling)
      unit,
      y_axis: `y1`, // Will be reassigned later based on unit groups
      visible: false, // Will be assigned later based on unit group logic
      markers: n < 30 ? `line+points` : `line`,
      metadata: x_values.map(() => ({ series_label: full_label })), // Use full label with units for tooltips
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

  // Group series by units
  const unit_groups = group_series_by_units(all_series, default_visible_properties)

  // Apply robust visibility and axis assignment
  const { axis_assignments } = assign_visibility_and_axes(unit_groups)

  // Apply the assignments back to series
  all_series.forEach((series) => {
    const group = unit_groups.find((g) => g.series.some((s) => s === series))
    if (group) {
      series.visible = group.is_visible
      series.y_axis = axis_assignments.get(group) || `y1`
    }
  })

  // Sort by visibility for legend ordering
  all_series.sort((a, b) => Number(b.visible) - Number(a.visible))

  return all_series
}

// Group series by their units and calculate priority
function group_series_by_units(
  series: DataSeries[],
  default_visible_properties: Set<string>,
): UnitGroup[] {
  const unit_map = new Map<string, DataSeries[]>()

  // Group series by unit
  series.forEach((s) => {
    const unit = s.unit || `dimensionless`
    if (!unit_map.has(unit)) unit_map.set(unit, [])
    unit_map.get(unit)?.push(s)
  })

  // Create unit groups with priority calculation
  const groups: UnitGroup[] = Array.from(unit_map.entries()).map(
    ([unit, group_series]) => {
      // Calculate priority using shared helper
      const priority = calculate_unit_group_priority(unit, group_series)

      // Check if any series in this group should be visible by default
      const has_default_visible = group_series.some((s) => {
        const label = s.label?.toLowerCase().replace(/<[^>]*>/g, ``) || ``
        return Array.from(default_visible_properties).some((prop) => {
          const prop_lower = prop.toLowerCase()
          // Special case for force_max which might appear as 'fmax' or just 'f'
          if (prop_lower === `force_max`) {
            return label.includes(`force`) || label.includes(`fmax`) || label === `f`
          }
          return label.includes(prop_lower)
        })
      })

      return {
        unit,
        series: group_series,
        priority,
        is_visible: has_default_visible,
      }
    },
  )

  // Sort groups by priority (ascending = higher priority first)
  groups.sort((a, b) => a.priority - b.priority)

  return groups
}

// Assign visibility and axes ensuring max 2 unit groups visible
function assign_visibility_and_axes(unit_groups: UnitGroup[]): {
  visible_groups: UnitGroup[]
  axis_assignments: Map<UnitGroup, `y1` | `y2`>
} {
  const axis_assignments = new Map<UnitGroup, `y1` | `y2`>()

  // First, identify which groups should be visible
  let visible_groups = unit_groups.filter((g) => g.is_visible)

  // If more than 2 groups are visible, keep only the highest priority ones
  if (visible_groups.length > 2) {
    visible_groups = visible_groups.slice(0, 2) // Keep first 2 (highest priority)
    // Mark the rest as not visible
    unit_groups.forEach((group) => {
      group.is_visible = visible_groups.includes(group)
    })
  }

  // If no groups are visible, make the highest priority group visible
  if (visible_groups.length === 0 && unit_groups.length > 0) {
    unit_groups[0].is_visible = true
    visible_groups = [unit_groups[0]]
  }

  // Assign axes
  if (visible_groups.length === 1) {
    // Single group goes to y1
    axis_assignments.set(visible_groups[0], `y1`)
  } else if (visible_groups.length === 2) {
    // Two groups: higher priority goes to y1, other to y2
    axis_assignments.set(visible_groups[0], `y1`)
    axis_assignments.set(visible_groups[1], `y2`)
  }

  return { visible_groups, axis_assignments }
}

// Toggle visibility of a series, respecting unit group constraints
export function toggle_series_visibility(
  series: DataSeries[],
  target_series_idx: number,
): DataSeries[] {
  if (target_series_idx < 0 || target_series_idx >= series.length) {
    return series
  }

  const target_series = series[target_series_idx]
  const new_visibility = !target_series.visible

  const series_map = new Map(series.map((s, idx) => [`${s.label}|${s.unit}`, idx])) // use map for O(1) series lookup

  // Group current series by units, preserve current visibility state
  const unit_groups = series.reduce((groups, s) => {
    const unit = s.unit || `dimensionless`
    let group = groups.find((g) => g.unit === unit)

    if (!group) {
      group = {
        unit,
        series: [],
        priority: calculate_unit_group_priority(unit, [s]), // Use shared helper
        is_visible: false,
      }
      groups.push(group)
    }

    group.series.push(s)
    // If any series in the group is visible, mark group as visible
    if (s.visible) group.is_visible = true

    return groups
  }, [] as UnitGroup[])

  // Update priorities after all series are grouped (more accurate)
  unit_groups.forEach((group) => {
    group.priority = calculate_unit_group_priority(group.unit, group.series)
  })

  // Sort by priority
  unit_groups.sort((a, b) => a.priority - b.priority)

  // Find the target unit group and update its visibility
  const target_group = unit_groups.find((g) => g.series.some((s) => s === target_series))
  if (!target_group) return series

  // Handle smart unit group replacement when turning ON a series
  if (new_visibility && target_group) {
    // Count currently visible groups (before the toggle)
    const currently_visible_groups = unit_groups.filter((g) => g.is_visible)

    // Only make room if we're adding a NEW unit group (not already visible)
    if (currently_visible_groups.length >= 2 && !target_group.is_visible) {
      // We need to make room for the new group
      // Sort existing visible groups by priority (descending = lowest priority first)
      currently_visible_groups.sort((a, b) => b.priority - a.priority)

      // Hide the lowest priority group to make room
      const group_to_hide = currently_visible_groups[0]
      group_to_hide.is_visible = false

      // Also hide all individual series in this group to prevent recalculation from overriding
      group_to_hide.series.forEach((s) => {
        const series_idx = series_map.get(`${s.label}|${s.unit}`)
        if (series_idx !== undefined && series_idx !== -1) {
          series[series_idx] = { ...series[series_idx], visible: false }
        }
      })
    }
  }

  // Toggle the target series specifically
  const updated_series = series.map((s) => {
    if (s === target_series) {
      return { ...s, visible: new_visibility }
    }
    return { ...s }
  })

  // Recalculate unit group visibility based on individual series
  unit_groups.forEach((group) => {
    group.is_visible = group.series.some((s) => {
      const series_idx = series_map.get(`${s.label}|${s.unit}`)
      if (series_idx !== undefined) {
        const updated_s = updated_series[series_idx]
        return updated_s?.visible || false
      }
      return false
    })
  })

  // Apply standard 2-group limit (fallback safety)
  const visible_groups = unit_groups.filter((g) => g.is_visible)
  if (visible_groups.length > 2) {
    // Default behavior: keep the 2 highest priority groups
    visible_groups.sort((a, b) => a.priority - b.priority)
    const groups_to_hide = visible_groups.slice(2)

    groups_to_hide.forEach((group) => {
      group.is_visible = false
      // Hide all series in this group
      group.series.forEach((s) => {
        const idx = series_map.get(`${s.label}|${s.unit}`)
        if (idx !== undefined && idx !== -1) {
          updated_series[idx] = { ...updated_series[idx], visible: false }
        }
      })
    })
  }

  // Reassign axes
  const final_visible_groups = unit_groups.filter((g) => g.is_visible)
  const axis_assignments = new Map<UnitGroup, `y1` | `y2`>()

  if (final_visible_groups.length === 1) {
    axis_assignments.set(final_visible_groups[0], `y1`)
  } else if (final_visible_groups.length === 2) {
    // Sort by priority to ensure consistent assignment
    final_visible_groups.sort((a, b) => a.priority - b.priority)
    axis_assignments.set(final_visible_groups[0], `y1`)
    axis_assignments.set(final_visible_groups[1], `y2`)
  }

  // Apply axis assignments
  return updated_series.map((s) => {
    const group = unit_groups.find((g) =>
      g.series.some((gs) => gs.label === s.label && gs.unit === s.unit)
    )
    if (group && axis_assignments.has(group)) {
      return { ...s, y_axis: axis_assignments.get(group) }
    }
    return s
  })
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

  const visible_series = plot_series.filter((s) => s.visible)
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

// Generate dynamic y-axis labels based on visible series with proper concatenation
export function generate_axis_labels(
  plot_series: DataSeries[],
): { y1: string; y2: string } {
  if (plot_series.length === 0) return { y1: `Value`, y2: `Value` }

  const get_axis_label = (axis_series: DataSeries[]): string => {
    const visible_series = axis_series.filter((s) => s.visible)
    if (visible_series.length === 0) return `Value`

    // Group by unit
    const unit_groups = new Map<string, string[]>()
    visible_series.forEach((s) => {
      const unit = s.unit || ``
      const label = s.label || `Value`
      if (!unit_groups.has(unit)) unit_groups.set(unit, [])
      unit_groups.get(unit)?.push(label)
    })

    // Should only have one unit group per axis due to our grouping logic
    const unit_entries = Array.from(unit_groups.entries())
    if (unit_entries.length === 0) return `Value`

    const [unit, labels] = unit_entries[0]
    const unique_labels = [...new Set(labels)].sort()
    const concatenated_labels = unique_labels.join(` / `)

    return unit ? `${concatenated_labels} (${unit})` : concatenated_labels
  }

  const y1_series = plot_series.filter((s) => (s.y_axis ?? `y1`) === `y1`)
  const y2_series = plot_series.filter((s) => s.y_axis === `y2`)

  return {
    y1: get_axis_label(y1_series),
    y2: get_axis_label(y2_series),
  }
}

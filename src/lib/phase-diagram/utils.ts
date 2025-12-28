import { format_num } from '$lib'
import * as math from '$lib/math'
import type { Sides } from '$lib/plot'
import { line } from 'd3-shape'
import type {
  LeverRuleResult,
  PhaseDiagramConfig,
  PhaseDiagramData,
  PhaseHoverInfo,
  PhaseRegion,
} from './types'

// Centralized defaults for phase diagram configuration (single source of truth)
export const PHASE_DIAGRAM_DEFAULTS = Object.freeze({
  // Visibility
  show_boundaries: true,
  show_labels: true,
  show_special_points: true,
  show_grid: true,
  show_component_labels: true,
  // Appearance
  font_size: 12,
  special_point_radius: 5,
  // Axes
  x_ticks: 5,
  y_ticks: 6,
  // Tie-line
  tie_line: Object.freeze({
    stroke_width: 1.5,
    endpoint_radius: 4,
    cursor_radius: 5,
  }),
  // Colors
  colors: Object.freeze({
    background: `transparent`,
    grid: `rgba(128, 128, 128, 0.3)`,
    axis: `var(--text-color, #333)`,
    text: `var(--text-color, #333)`,
    boundary: `#333`,
    special_point: `#d32f2f`,
  }),
  // Margins
  margin: Object.freeze({ t: 25, r: 15, b: 50, l: 55 } as Required<Sides>),
  // Export
  png_dpi: 150,
})

// Merge partial config with defaults - single helper for consistent merging
export function merge_phase_diagram_config(config: Partial<PhaseDiagramConfig>) {
  return {
    margin: { ...PHASE_DIAGRAM_DEFAULTS.margin, ...config.margin },
    font_size: config.font_size ?? PHASE_DIAGRAM_DEFAULTS.font_size,
    special_point_radius: config.special_point_radius ??
      PHASE_DIAGRAM_DEFAULTS.special_point_radius,
    tie_line: { ...PHASE_DIAGRAM_DEFAULTS.tie_line, ...config.tie_line },
    colors: { ...PHASE_DIAGRAM_DEFAULTS.colors, ...config.colors },
  }
}

// Phase colors - single source of truth as [R, G, B, alpha] tuples
const PHASE_COLOR_BASE = {
  liquid: [135, 206, 250, 0.6],
  alpha: [144, 238, 144, 0.6],
  beta: [255, 182, 193, 0.6],
  gamma: [255, 218, 185, 0.6],
  two_phase: [200, 200, 200, 0.5],
  default: [180, 180, 180, 0.5],
  tie_line: [255, 107, 107, 1], // #ff6b6b
} as const

// Derive RGB string format for use with custom alpha
export const PHASE_COLOR_RGB = Object.freeze(
  Object.fromEntries(
    Object.entries(PHASE_COLOR_BASE).map(([key, [r, g, b]]) => [key, `${r}, ${g}, ${b}`]),
  ),
) as Record<keyof typeof PHASE_COLOR_BASE, string>

// Derive rgba() format with default alpha
export const PHASE_COLORS = Object.freeze(
  Object.fromEntries(
    Object.entries(PHASE_COLOR_BASE).map((
      [key, [r, g, b, a]],
    ) => [key, `rgba(${r}, ${g}, ${b}, ${a})`]),
  ),
) as Record<keyof typeof PHASE_COLOR_BASE, string>

// Find which phase region contains the given composition and temperature
export function find_phase_at_point(
  composition: number,
  temperature: number,
  data: PhaseDiagramData,
): PhaseRegion | null {
  // Search regions in reverse order so later-defined regions take precedence
  for (let idx = data.regions.length - 1; idx >= 0; idx--) {
    const region = data.regions[idx]
    if (math.point_in_polygon(composition, temperature, region.vertices)) return region
  }
  return null
}

// SVG path generator using d3-shape
const path_line = line<[number, number]>().x((d) => d[0]).y((d) => d[1])

// Generate closed SVG path for polygon regions (min 3 points)
export const generate_region_path = (vertices: [number, number][]): string =>
  vertices.length < 3 ? `` : `${path_line(vertices)} Z`

// Generate open SVG path for boundary curves (min 2 points)
export const generate_boundary_path = (points: [number, number][]): string =>
  points.length < 2 ? `` : path_line(points) ?? ``

// Re-export from math.ts for backwards compatibility
export const calculate_polygon_centroid = math.polygon_centroid

// Calculate bounding box of a polygon (wrapper for math.compute_bounding_box_2d)
export function calculate_polygon_bounds(vertices: [number, number][]) {
  const { min, max, width, height } = math.compute_bounding_box_2d(vertices)
  return { min_x: min[0], max_x: max[0], min_y: min[1], max_y: max[1], width, height }
}

// Compute label properties (rotation, wrapping, scale) to fit within region bounds
export function compute_label_properties(
  label: string,
  bounds: { width: number; height: number },
  font_size: number,
): { rotation: number; lines: string[]; scale: number } {
  if (bounds.width <= 0 || bounds.height <= 0 || !label || font_size <= 0) {
    return { rotation: 0, lines: label ? [label] : [], scale: 1 }
  }

  const char_width = font_size * 0.6 // approximate character width
  const line_height = font_size * 1.2
  const padding = 0.8 // 20% margin

  const label_width = label.length * char_width
  const avail_w = bounds.width * padding
  const avail_h = bounds.height * padding

  // Try horizontal fit
  if (label_width <= avail_w && line_height <= avail_h) {
    return { rotation: 0, lines: [label], scale: 1 }
  }

  // Try vertical for tall narrow regions
  const is_tall = bounds.width < bounds.height
  if (is_tall && label_width <= avail_h && line_height <= avail_w) {
    return { rotation: -90, lines: [label], scale: 1 }
  }

  // Try wrapping multi-word labels
  if (/[\s_-]/.test(label)) {
    const chars_per_line = Math.max(3, Math.floor(avail_w / char_width))
    const lines = wrap_text(label, chars_per_line)
    const wrapped_w = Math.max(...lines.map((ln) => ln.length)) * char_width
    const wrapped_h = lines.length * line_height

    if (wrapped_w <= avail_w && wrapped_h <= avail_h) {
      return { rotation: 0, lines, scale: 1 }
    }
    if (is_tall && wrapped_w <= avail_h && wrapped_h <= avail_w) {
      return { rotation: -90, lines, scale: 1 }
    }
  }

  // Scale down as last resort (min 70%)
  const scale = Math.max(0.7, Math.min(avail_w / label_width, avail_h / line_height, 1))
  const rotation = is_tall && avail_h / label_width > avail_w / label_width ? -90 : 0
  return { rotation, lines: [label], scale }
}

// Wrap text into multiple lines at delimiter boundaries (underscore, hyphen, space)
// Delimiters are removed to produce clean wrapped output
function wrap_text(text: string, max_chars: number): string[] {
  // Split into words, removing delimiters
  const words = text.split(/[_\s-]+/).filter((word) => word.length > 0)
  if (words.length === 0) return [text]

  const lines: string[] = []
  let current_line = ``

  for (const word of words) {
    const separator = current_line.length > 0 ? `_` : ``
    const candidate = current_line + separator + word

    if (candidate.length <= max_chars) {
      current_line = candidate
    } else if (current_line.length > 0) {
      lines.push(current_line)
      current_line = word
    } else {
      // Single word too long - add it anyway
      current_line = word
    }
  }

  if (current_line.length > 0) {
    lines.push(current_line)
  }

  return lines.length > 0 ? lines : [text]
}

// Transform data coordinates to SVG coordinates using scale functions
export function transform_vertices(
  vertices: [number, number][],
  x_scale: (val: number) => number,
  y_scale: (val: number) => number,
): [number, number][] {
  return vertices.map(([comp, temp]) => [x_scale(comp), y_scale(temp)])
}

// Get default color for a phase region based on its name
export function get_default_phase_color(phase_name: string): string {
  const name_lower = phase_name.toLowerCase()

  // Check for two-phase regions first (contains '+')
  if (name_lower.includes(`+`)) return PHASE_COLORS.two_phase
  // Common single-phase colors
  if (name_lower.includes(`liquid`) || name_lower === `l`) return PHASE_COLORS.liquid
  if (name_lower.includes(`α`) || name_lower.includes(`alpha`)) return PHASE_COLORS.alpha
  if (name_lower.includes(`β`) || name_lower.includes(`beta`)) return PHASE_COLORS.beta
  if (name_lower.includes(`γ`) || name_lower.includes(`gamma`)) return PHASE_COLORS.gamma
  return PHASE_COLORS.default
}

// Get RGB color string (without alpha) for a phase name - used for tie-line endpoints
export function get_phase_color_rgb(phase_name: string): string {
  const name_lower = phase_name.toLowerCase()

  if (name_lower.includes(`liquid`) || name_lower === `l`) return PHASE_COLOR_RGB.liquid
  if (name_lower.includes(`α`) || name_lower.includes(`alpha`)) {
    return PHASE_COLOR_RGB.alpha
  }
  if (name_lower.includes(`β`) || name_lower.includes(`beta`)) return PHASE_COLOR_RGB.beta
  if (name_lower.includes(`γ`) || name_lower.includes(`gamma`)) {
    return PHASE_COLOR_RGB.gamma
  }
  return PHASE_COLOR_RGB.default
}

// Format composition value for display
export function format_composition(
  value: number,
  unit: string = `at%`,
): string {
  if (unit === `fraction`) return format_num(value, `.3f`)
  return `${format_num(value * 100, `.1f`)} ${unit}`
}

// Format temperature value for display
export function format_temperature(value: number, unit: string = `K`): string {
  return `${format_num(value, `.0f`)} ${unit}`
}

// Check if a region is a two-phase region based on its name
export function is_two_phase_region(region: PhaseRegion): boolean {
  return region.name.includes(`+`)
}

// Find horizontal intersection points with polygon edges at a given temperature
// Returns [left_x, right_x] or null if no valid intersection
function find_horizontal_intersections(
  vertices: [number, number][],
  temperature: number,
): [number, number] | null {
  const intersections: number[] = []
  const num_vertices = vertices.length

  for (let idx = 0; idx < num_vertices; idx++) {
    const [x1, y1] = vertices[idx]
    const [x2, y2] = vertices[(idx + 1) % num_vertices]

    // Check if the edge crosses the temperature line
    if (
      (y1 <= temperature && y2 > temperature) || (y2 <= temperature && y1 > temperature)
    ) {
      // Calculate x at the intersection
      const t_ratio = (temperature - y1) / (y2 - y1)
      const x_intersect = x1 + t_ratio * (x2 - x1)
      intersections.push(x_intersect)
    }
  }

  if (intersections.length < 2) return null

  // Sort and return leftmost and rightmost intersections
  intersections.sort((a, b) => a - b)
  return [intersections[0], intersections[intersections.length - 1]]
}

// Parse phase names from a two-phase region name like "α + β" or "Liquid + α"
function parse_phase_names(region_name: string): [string, string] {
  const parts = region_name.split(/\s*\+\s*/)
  if (parts.length >= 2) {
    return [parts[0].trim(), parts[1].trim()]
  }
  // Defensive fallback - should not be reached since caller checks is_two_phase_region
  return [parts[0]?.trim() || `Phase 1`, `Phase 2`]
}

// Calculate lever rule for a point in a two-phase region
// Returns null if the region is not a two-phase region or calculation fails
export function calculate_lever_rule(
  region: PhaseRegion,
  composition: number,
  temperature: number,
): LeverRuleResult | null {
  // Only works for two-phase regions
  if (!is_two_phase_region(region)) return null

  // Find the left and right phase boundary compositions at this temperature
  const intersections = find_horizontal_intersections(region.vertices, temperature)
  if (!intersections) return null

  const [left_composition, right_composition] = intersections

  // Ensure the composition is within the two-phase region
  if (composition < left_composition || composition > right_composition) return null

  // Calculate phase fractions using the lever rule
  const total_width = right_composition - left_composition
  // Use tolerance for floating point safety (avoid division by near-zero)
  if (total_width < 1e-10) return null

  // Lever rule: fraction of left phase = distance to right / total width
  const fraction_right = (composition - left_composition) / total_width
  const fraction_left = 1 - fraction_right

  // Parse phase names
  const [left_phase, right_phase] = parse_phase_names(region.name)

  return {
    left_phase,
    right_phase,
    left_composition,
    right_composition,
    fraction_left,
    fraction_right,
  }
}

// Format hover info as copyable text for clipboard
export function format_hover_info_text(
  info: PhaseHoverInfo,
  temp_unit: string = `K`,
  comp_unit: string = `at%`,
  component_a: string = `A`,
  component_b: string = `B`,
): string {
  const lines: string[] = [
    `Phase: ${info.region.name}`,
    `Temperature: ${format_temperature(info.temperature, temp_unit)}`,
    `Composition: ${format_composition(info.composition, comp_unit)} ${component_b} (${
      format_composition(1 - info.composition, comp_unit)
    } ${component_a})`,
  ]

  if (info.lever_rule) {
    const lr = info.lever_rule
    lines.push(
      ``,
      `Lever Rule:`,
      `  ${lr.left_phase}: ${format_num(lr.fraction_left * 100, `.1f`)}% (at ${
        format_composition(lr.left_composition, comp_unit)
      })`,
      `  ${lr.right_phase}: ${format_num(lr.fraction_right * 100, `.1f`)}% (at ${
        format_composition(lr.right_composition, comp_unit)
      })`,
    )
  }

  return lines.join(`\n`)
}

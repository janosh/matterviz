import { format_num } from '$lib'
import type { Sides } from '$lib/plot'
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

// Base RGB values for phase colors (without alpha) - single source of truth
export const PHASE_COLOR_RGB = Object.freeze({
  liquid: `135, 206, 250`,
  alpha: `144, 238, 144`,
  beta: `255, 182, 193`,
  gamma: `255, 218, 185`,
  two_phase: `200, 200, 200`,
  default: `180, 180, 180`,
  tie_line: `255, 107, 107`, // #ff6b6b - used for tie-line visualization
})

// Common phase colors for consistent styling (derived from RGB values)
export const PHASE_COLORS = Object.freeze({
  liquid: `rgba(${PHASE_COLOR_RGB.liquid}, 0.6)`,
  alpha: `rgba(${PHASE_COLOR_RGB.alpha}, 0.6)`,
  beta: `rgba(${PHASE_COLOR_RGB.beta}, 0.6)`,
  gamma: `rgba(${PHASE_COLOR_RGB.gamma}, 0.6)`,
  two_phase: `rgba(${PHASE_COLOR_RGB.two_phase}, 0.5)`,
  default: `rgba(${PHASE_COLOR_RGB.default}, 0.5)`,
})

// Point-in-polygon test using ray casting algorithm
// Returns true if point (x, y) is inside the polygon defined by vertices
export function point_in_polygon(
  point_x: number,
  point_y: number,
  vertices: [number, number][],
): boolean {
  if (vertices.length < 3) return false

  let inside = false
  const num_vertices = vertices.length

  let prev_idx = num_vertices - 1
  for (let idx = 0; idx < num_vertices; idx++) {
    const [x_i, y_i] = vertices[idx]
    const [x_j, y_j] = vertices[prev_idx]

    // Skip horizontal edges to avoid division by zero
    if (y_i === y_j) {
      prev_idx = idx
      continue
    }

    // Check if the ray from the point crosses this edge
    const intersects = y_i > point_y !== y_j > point_y &&
      point_x < ((x_j - x_i) * (point_y - y_i)) / (y_j - y_i) + x_i

    if (intersects) inside = !inside
    prev_idx = idx
  }

  return inside
}

// Find which phase region contains the given composition and temperature
export function find_phase_at_point(
  composition: number,
  temperature: number,
  data: PhaseDiagramData,
): PhaseRegion | null {
  // Search regions in reverse order so later-defined regions take precedence
  for (let idx = data.regions.length - 1; idx >= 0; idx--) {
    const region = data.regions[idx]
    if (point_in_polygon(composition, temperature, region.vertices)) return region
  }
  return null
}

// Generate SVG path string from vertices (closed polygon or open polyline)
function generate_svg_path(
  vertices: [number, number][],
  min_points: number,
  closed: boolean,
): string {
  const [first, ...rest] = vertices
  if (!first || rest.length < min_points - 1) return ``
  return `M ${first[0]} ${first[1]} ${rest.map(([x, y]) => `L ${x} ${y}`).join(` `)}${
    closed ? ` Z` : ``
  }`
}

// Generate closed SVG path for polygon regions
export const generate_region_path = (vertices: [number, number][]): string =>
  generate_svg_path(vertices, 3, true)

// Generate open SVG path for boundary curves
export const generate_boundary_path = (points: [number, number][]): string =>
  generate_svg_path(points, 2, false)

// Calculate the centroid of a polygon for label placement
export function calculate_polygon_centroid(
  vertices: [number, number][],
): [number, number] {
  if (vertices.length === 0) return [0, 0]

  let sum_x = 0
  let sum_y = 0

  for (const [x_coord, y_coord] of vertices) {
    sum_x += x_coord
    sum_y += y_coord
  }

  return [sum_x / vertices.length, sum_y / vertices.length]
}

// Calculate bounding box of a polygon
export function calculate_polygon_bounds(vertices: [number, number][]) {
  if (vertices.length === 0) {
    return { min_x: 0, max_x: 0, min_y: 0, max_y: 0, width: 0, height: 0 }
  }

  let [min_x, max_x] = [Infinity, -Infinity]
  let [min_y, max_y] = [Infinity, -Infinity]

  for (const [x_coord, y_coord] of vertices) {
    if (x_coord < min_x) min_x = x_coord
    if (x_coord > max_x) max_x = x_coord
    if (y_coord < min_y) min_y = y_coord
    if (y_coord > max_y) max_y = y_coord
  }

  const width = max_x - min_x
  const height = max_y - min_y
  return { min_x, max_x, min_y, max_y, width, height }
}

// Label positioning constants - tune these to adjust behavior
const LABEL_CONFIG = {
  CHAR_WIDTH_RATIO: 0.6, // Approximate ratio of character width to font size (monospace ~0.6, proportional ~0.5-0.7)
  LINE_HEIGHT_RATIO: 1.2, // Line height as multiple of font size
  PADDING_FACTOR: 0.8, // Padding factor (0.8 means 20% margin on each side)
  VERTICAL_ROTATION_THRESHOLD: 0.5, // Aspect ratio threshold for vertical rotation (width/height < this triggers rotation)
  WRAPPED_VERTICAL_THRESHOLD: 0.7, // Aspect ratio threshold for wrapped vertical text
  MIN_SCALE_FACTOR: 1.0, // Minimum scale factor - labels never shrink
  ACCEPTABLE_SCALE: 1.0, // Scale factor threshold for accepting scaled text
  MIN_CHARS_PER_LINE: 3, // Minimum characters per line when wrapping
} as const

// Compute smart label properties (rotation, lines) based on region dimensions
export function compute_label_properties(
  label: string,
  bounds: { width: number; height: number },
  font_size: number,
): { rotation: number; lines: string[]; scale: number } {
  // Guard against degenerate bounds (zero width/height) to prevent NaN/Infinity
  if (bounds.width <= 0 || bounds.height <= 0 || !label || font_size <= 0) {
    return { rotation: 0, lines: label ? [label] : [], scale: 1 }
  }

  const char_width = font_size * LABEL_CONFIG.CHAR_WIDTH_RATIO
  const line_height = font_size * LABEL_CONFIG.LINE_HEIGHT_RATIO

  const label_width = label.length * char_width
  const label_height = line_height

  const available_width = bounds.width * LABEL_CONFIG.PADDING_FACTOR
  const available_height = bounds.height * LABEL_CONFIG.PADDING_FACTOR

  // Case 1: Label fits horizontally
  if (label_width <= available_width && label_height <= available_height) {
    return { rotation: 0, lines: [label], scale: 1 }
  }

  // Case 2: Region is narrow but tall - try vertical rotation
  const aspect_ratio = bounds.width / bounds.height
  if (
    aspect_ratio < LABEL_CONFIG.VERTICAL_ROTATION_THRESHOLD &&
    label_width <= available_height &&
    label_height <= available_width
  ) {
    return { rotation: -90, lines: [label], scale: 1 }
  }

  // Case 3: Try line breaking for multi-word labels
  const has_delimiters = /[_\s-]/.test(label)
  if (has_delimiters) {
    const max_chars_per_line = Math.max(
      LABEL_CONFIG.MIN_CHARS_PER_LINE,
      Math.floor(available_width / char_width),
    )
    const wrapped_lines = wrap_text(label, max_chars_per_line)
    const wrapped_height = wrapped_lines.length * line_height
    const max_line_width = Math.max(...wrapped_lines.map((line) => line.length)) *
      char_width

    if (max_line_width <= available_width && wrapped_height <= available_height) {
      return { rotation: 0, lines: wrapped_lines, scale: 1 }
    }

    // Try vertical with wrapped lines
    if (
      aspect_ratio < LABEL_CONFIG.WRAPPED_VERTICAL_THRESHOLD &&
      max_line_width <= available_height &&
      wrapped_height <= available_width
    ) {
      return { rotation: -90, lines: wrapped_lines, scale: 1 }
    }
  }

  // Case 4: Scale down if nothing else works
  const scale_factor = Math.min(
    available_width / label_width,
    available_height / label_height,
    1,
  )

  if (scale_factor >= LABEL_CONFIG.ACCEPTABLE_SCALE) {
    return { rotation: 0, lines: [label], scale: scale_factor }
  }

  // Case 5: Try vertical with scaling
  if (aspect_ratio < 1) {
    const vertical_scale = Math.min(
      available_height / label_width,
      available_width / label_height,
      1,
    )
    if (vertical_scale >= LABEL_CONFIG.ACCEPTABLE_SCALE) {
      return { rotation: -90, lines: [label], scale: vertical_scale }
    }
  }

  // Fallback: use smallest reasonable scale
  return {
    rotation: 0,
    lines: [label],
    scale: Math.max(LABEL_CONFIG.MIN_SCALE_FACTOR, scale_factor),
  }
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

// Format composition value for display
export function format_composition(
  value: number,
  unit: string = `at%`,
): string {
  if (unit === `fraction`) {
    return format_num(value, `.3f`)
  }
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

// Calculate tooltip position with viewport clamping and flip logic
export function calculate_tooltip_position(
  cursor: { x: number; y: number },
  tooltip_size: { width: number; height: number },
  viewport: { width: number; height: number },
  offset: number = 15,
): { x: number; y: number } {
  const { width: tw, height: th } = tooltip_size
  const { width: vw, height: vh } = viewport

  // Flip direction if too close to edge
  const flip_x = cursor.x + offset + tw > vw
  const flip_y = cursor.y + offset + th > vh

  const raw_x = flip_x ? cursor.x - offset - tw : cursor.x + offset
  const raw_y = flip_y ? cursor.y - offset - th : cursor.y + offset

  // Clamp to viewport bounds
  return {
    x: Math.max(0, Math.min(raw_x, vw - tw)),
    y: Math.max(0, Math.min(raw_y, vh - th)),
  }
}

import { add_alpha } from '$lib/colors'
import { DEFAULT_PNG_DPI } from '$lib/constants'
import { format_num } from '$lib/labels'
import { point_in_polygon, type Vec2 } from '$lib/math'
import type { Sides } from '$lib/plot/core/layout'
import { line } from 'd3-shape'
import type {
  CompUnit,
  LeverRuleMode,
  LeverRuleResult,
  PhaseDiagramConfig,
  PhaseDiagramData,
  PhaseHoverInfo,
  PhaseRegion,
  TempUnit,
  VerticalLeverRuleResult,
} from './types'

// Convert temperature between units (K, °C, °F)
export function convert_temp(value: number, from: TempUnit, to: TempUnit): number {
  if (from === to) return value
  // Convert to Kelvin first
  const kelvin =
    from === `°C` ? value + 273.15 : from === `°F` ? (value - 32) * (5 / 9) + 273.15 : value
  // Convert from Kelvin to target
  return to === `K` ? kelvin : to === `°C` ? kelvin - 273.15 : (kelvin - 273.15) * (9 / 5) + 32
}

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
  // Axes (tick *targets* for d3 scale.ticks; 5 keeps a 1600 K span at 500 K steps)
  x_ticks: 5,
  y_ticks: 5,
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
  margin: Object.freeze({ t: 25, r: 25, b: 50, l: 60 } as Required<Sides>),
  // Export
  png_dpi: DEFAULT_PNG_DPI,
})

// Merge partial config with defaults - single helper for consistent merging
export const merge_phase_diagram_config = (config: Partial<PhaseDiagramConfig>) => ({
  margin: { ...PHASE_DIAGRAM_DEFAULTS.margin, ...config.margin },
  font_size: config.font_size ?? PHASE_DIAGRAM_DEFAULTS.font_size,
  special_point_radius:
    config.special_point_radius ?? PHASE_DIAGRAM_DEFAULTS.special_point_radius,
  tie_line: { ...PHASE_DIAGRAM_DEFAULTS.tie_line, ...config.tie_line },
  colors: { ...PHASE_DIAGRAM_DEFAULTS.colors, ...config.colors },
})

// Phase colors as hex - single source of truth
// Extended palette supports 3+ phase regions (Greek letters α through λ)
const PHASE_COLOR_HEX = {
  liquid: `#87cefc`, // light sky blue
  alpha: `#90ee90`, // light green
  beta: `#ffb6c1`, // light pink
  gamma: `#ffdab9`, // peach puff
  delta: `#dda0dd`, // plum
  epsilon: `#f0e68c`, // khaki
  zeta: `#fa8072`, // salmon (distinct from liquid's light blue)
  eta: `#e6e6fa`, // lavender (distinct from alpha's light green)
  theta: `#f5deb3`, // wheat
  iota: `#20b2aa`, // light sea green
  kappa: `#deb887`, // burlywood
  lambda: `#bc8f8f`, // rosy brown
  two_phase: `#c8c8c8`,
  default: `#b4b4b4`,
} as const

type PhaseColorKey = keyof typeof PHASE_COLOR_HEX

export const TIE_LINE_COLOR = `#ff6b6b`

// Phase pattern matching rules: [substrings to match, color key, optional prefix check]
// Order matters: theta before eta (since "theta" contains "eta" as substring)
const PHASE_PATTERNS: [string[], PhaseColorKey, string?][] = [
  [[`liquid`], `liquid`],
  [[`α`, `alpha`], `alpha`, `fcc`],
  [[`β`, `beta`], `beta`, `bcc`],
  [[`γ`, `gamma`], `gamma`, `hcp`],
  [[`δ`, `delta`], `delta`],
  [[`ε`, `epsilon`], `epsilon`],
  [[`ζ`, `zeta`], `zeta`],
  [[`θ`, `theta`], `theta`], // must come before eta
  [[`η`, `eta`], `eta`],
  [[`ι`, `iota`], `iota`],
  [[`κ`, `kappa`], `kappa`],
  [[`λ`, `lambda`], `lambda`],
]

// Get color key for a single phase name (supports Greek letters and common phase notation)
function get_phase_color_key(name: string): PhaseColorKey {
  const lower = name.toLowerCase().trim()
  if (lower === `l`) return `liquid` // exact match for shorthand "L"
  for (const [patterns, key, prefix] of PHASE_PATTERNS) {
    if (patterns.some((pattern) => lower.includes(pattern))) return key
    if (prefix && lower.startsWith(prefix)) return key
  }
  return `default`
}

// Phase fill color: translucent rgba() for region fills (two-phase/unknown regions are
// a bit more transparent), or the opaque hex for markers.
export function get_phase_color(name: string, format: `rgba` | `hex` = `rgba`): string {
  const key: PhaseColorKey = name.includes(`+`) ? `two_phase` : get_phase_color_key(name)
  const hex = PHASE_COLOR_HEX[key]
  if (format === `hex`) return hex
  return add_alpha(hex, key === `two_phase` || key === `default` ? 0.5 : 0.6)
}

// Get gradient colors for multi-phase regions (2+ phases separated by '+')
// Returns array of evenly-spaced gradient stops (offset in [0, 1], hex color), or null
// for single-phase regions
export function get_multi_phase_gradient(
  name: string,
): { offset: number; color: string }[] | null {
  if (!name.includes(`+`)) return null
  const phases = name
    .split(`+`)
    .map((phase) => phase.trim())
    .filter(Boolean)
  if (phases.length < 2) return null

  // Create evenly spaced gradient stops (phases.length >= 2 guaranteed by early return)
  return phases.map((phase, idx) => ({
    offset: idx / (phases.length - 1),
    color: PHASE_COLOR_HEX[get_phase_color_key(phase)],
  }))
}

// Find which phase region contains the given composition and temperature
// (later-defined regions take precedence)
export const find_phase_at_point = (
  composition: number,
  temperature: number,
  data: PhaseDiagramData,
): PhaseRegion | null =>
  data.regions.findLast((region) =>
    point_in_polygon(composition, temperature, region.vertices),
  ) ?? null

// SVG path generator using d3-shape
const path_line = line()
  .x((point) => point[0])
  .y((point) => point[1])

// Generate closed SVG path for polygon regions (min 3 points)
export const generate_region_path = (vertices: Vec2[]): string =>
  vertices.length < 3 ? `` : `${path_line(vertices)} Z`

// Generate open SVG path for boundary curves (min 2 points)
export const generate_boundary_path = (points: Vec2[]): string =>
  points.length < 2 ? `` : (path_line(points) ?? ``)

// Compute label properties (rotation, wrapping, scale) to fit within region bounds
export function compute_label_properties(
  label: string,
  bounds: { width: number; height: number },
  font_size: number,
): { rotation: number; lines: string[]; scale: number } {
  if (bounds.width <= 0 || bounds.height <= 0 || !label || font_size <= 0) {
    return { rotation: 0, lines: label ? [label] : [], scale: 1 }
  }
  // Handle whitespace-only labels that pass truthy check but have zero rendered width
  if (label.trim().length === 0) return { rotation: 0, lines: [], scale: 1 }

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
  const rotation = is_tall ? -90 : 0
  return { rotation, lines: [label], scale }
}

// Wrap text into multiple lines at delimiter boundaries
function wrap_text(text: string, max_chars: number): string[] {
  const words = text.split(/[_\s-]+/).filter((word) => word.length > 0)
  if (words.length === 0) return [text]

  const lines: string[] = []
  let current_line = ``

  for (const word of words) {
    const candidate = current_line ? `${current_line} ${word}` : word
    if (candidate.length <= max_chars) {
      current_line = candidate
    } else {
      if (current_line) lines.push(current_line)
      current_line = word
    }
  }

  if (current_line) lines.push(current_line)
  return lines
}

// Transform data coordinates to SVG coordinates using scale functions
export const transform_vertices = (
  vertices: Vec2[],
  x_scale: (val: number) => number,
  y_scale: (val: number) => number,
): Vec2[] => vertices.map(([comp, temp]) => [x_scale(comp), y_scale(temp)])

// Format composition value for display
export function format_composition(
  value: number,
  unit: CompUnit = `at%`,
  include_unit: boolean = true,
): string {
  if (unit === `fraction`) return format_num(value, `.3~f`)
  const formatted = format_num(value * 100, `.3~`)
  return include_unit ? `${formatted} ${unit}` : formatted
}

// Format temperature value for display
export const format_temperature = (value: number, unit: TempUnit = `K`): string =>
  `${format_num(value, `.0f`)} ${unit}`

// Find polygon edge intersections along a scan line (horizontal or vertical)
// For horizontal: fixed_val = temperature, returns x-intersections
// For vertical: fixed_val = composition, returns y-intersections
function find_polygon_intersections(
  vertices: Vec2[],
  fixed_val: number,
  axis: 0 | 1,
): number[] {
  const other = axis === 0 ? 1 : 0
  const intersections: number[] = []
  for (let idx = 0; idx < vertices.length; idx++) {
    const v1 = vertices[idx]
    const v2 = vertices[(idx + 1) % vertices.length]
    if (
      (v1[axis] <= fixed_val && v2[axis] > fixed_val) ||
      (v2[axis] <= fixed_val && v1[axis] > fixed_val)
    ) {
      intersections.push(
        v1[other] + ((fixed_val - v1[axis]) / (v2[axis] - v1[axis])) * (v2[other] - v1[other]),
      )
    }
  }
  return intersections.toSorted((val_a, val_b) => val_a - val_b)
}

function pick_bracketing_intersection_pair(
  intersections: number[],
  position: number,
): Vec2 | null {
  if (intersections.length < 2) return null

  const unique_intersections: number[] = []
  const dedup_tol = 1e-9
  for (const value of intersections) {
    const prev_value = unique_intersections.at(-1)
    if (prev_value === undefined || Math.abs(value - prev_value) > dedup_tol) {
      unique_intersections.push(value)
    }
  }
  if (unique_intersections.length < 2) return null

  const bound_tol = 1e-10
  for (let pair_idx = 0; pair_idx + 1 < unique_intersections.length; pair_idx += 2) {
    const low_bound = unique_intersections[pair_idx]
    const high_bound = unique_intersections[pair_idx + 1]
    if (position >= low_bound - bound_tol && position <= high_bound + bound_tol) {
      return [low_bound, high_bound]
    }
  }

  // Fallback for numerical edge cases where even-odd pairing fails:
  // pick nearest enclosing neighbors around the hovered point.
  const left_idx = unique_intersections.findLastIndex((val) => val <= position + bound_tol)
  if (left_idx === -1 || left_idx + 1 >= unique_intersections.length) return null

  const left_bound = unique_intersections[left_idx]
  const right_bound = unique_intersections[left_idx + 1]
  return right_bound - left_bound > bound_tol ? [left_bound, right_bound] : null
}

// Shared core for lever rule calculations (horizontal and vertical): splits the region name
// into exactly two phases, finds intersections along the scan axis, validates bounds, and
// computes the fractional position within the two-phase region.
function lever_rule_core(
  region: PhaseRegion,
  position: number,
  scan_val: number,
  axis: 0 | 1,
): { phases: [string, string]; lo: number; hi: number; fraction_hi: number } | null {
  const phases = region.name.includes(`+`)
    ? region.name
        .trim()
        .split(/\s*\+\s*/)
        .filter(Boolean)
    : []
  if (phases.length !== 2) return null

  const intersections = find_polygon_intersections(region.vertices, scan_val, axis)
  const bounds = pick_bracketing_intersection_pair(intersections, position)
  if (!bounds) return null
  const [lo, hi] = bounds

  const span = hi - lo
  if (span < 1e-10) return null

  return { phases: [phases[0], phases[1]], lo, hi, fraction_hi: (position - lo) / span }
}

// Calculate lever rule for a point in a two-phase region
// Returns null if the region is not exactly a two-phase region or calculation fails
// Note: Lever rule is thermodynamically defined only for two-phase equilibria
export function calculate_lever_rule(
  region: PhaseRegion,
  composition: number,
  temperature: number,
): LeverRuleResult | null {
  // Horizontal scan: fixed temperature, find composition intersections
  const core = lever_rule_core(region, composition, temperature, 1)
  if (!core) return null

  return {
    left_phase: core.phases[0],
    right_phase: core.phases[1],
    left_composition: core.lo,
    right_composition: core.hi,
    fraction_left: 1 - core.fraction_hi,
    fraction_right: core.fraction_hi,
  }
}

// Calculate vertical lever rule for a point in a two-phase region
// Uses constant composition (vertical line) to find temperature boundaries
export function calculate_vertical_lever_rule(
  region: PhaseRegion,
  composition: number,
  temperature: number,
): VerticalLeverRuleResult | null {
  // Vertical scan: fixed composition, find temperature intersections
  const core = lever_rule_core(region, temperature, composition, 0)
  if (!core) return null

  return {
    bottom_phase: core.phases[0],
    top_phase: core.phases[1],
    bottom_temperature: core.lo,
    top_temperature: core.hi,
    fraction_bottom: 1 - core.fraction_hi,
    fraction_top: core.fraction_hi,
  }
}

// Format hover info as copyable text for clipboard
// Only includes lever rule data for the active mode to match tooltip display
export function format_hover_info_text(
  info: PhaseHoverInfo,
  temp_unit: TempUnit = `K`,
  comp_unit: CompUnit = `at%`,
  component_a: string = `A`,
  component_b: string = `B`,
  data_temp_unit: TempUnit = temp_unit,
  lever_rule_mode: LeverRuleMode = `horizontal`,
): string {
  // Convert temperature from data unit to display unit
  const to_display = (temp: number) => convert_temp(temp, data_temp_unit, temp_unit)

  const lines: string[] = [
    `Phase: ${info.region.name}`,
    `Temperature: ${format_temperature(to_display(info.temperature), temp_unit)}`,
    `Composition: ${format_composition(info.composition, comp_unit)} ${component_b} (${format_composition(
      1 - info.composition,
      comp_unit,
    )} ${component_a})`,
  ]

  const { lever_rule: lr, vertical_lever_rule: vlr } = info
  const lever_line = (phase: string, fraction: number, location: string) =>
    `  ${phase}: ${format_num(fraction * 100, `.1f`)}% (at ${location})`
  if (lever_rule_mode === `horizontal` && lr) {
    const comp = (val: number) => format_composition(val, comp_unit)
    lines.push(
      ``,
      `Lever Rule:`,
      lever_line(lr.left_phase, lr.fraction_left, comp(lr.left_composition)),
      lever_line(lr.right_phase, lr.fraction_right, comp(lr.right_composition)),
    )
  } else if (lever_rule_mode === `vertical` && vlr) {
    const temp = (val: number) => format_temperature(to_display(val), temp_unit)
    lines.push(
      ``,
      `Vertical Lever Rule:`,
      lever_line(vlr.bottom_phase, vlr.fraction_bottom, temp(vlr.bottom_temperature)),
      lever_line(vlr.top_phase, vlr.fraction_top, temp(vlr.top_temperature)),
    )
  }

  return lines.join(`\n`)
}

// Calculate temperature stability range for a phase at given composition
export function get_phase_stability_range(
  region: PhaseRegion,
): { t_min: number; t_max: number } | null {
  if (!region.vertices?.length) return null
  const temps = region.vertices.map(([, temp]) => temp)
  return { t_min: Math.min(...temps), t_max: Math.max(...temps) }
}

// Compute the x-axis domain for a binary phase diagram.
// Uses explicit range if fully specified, otherwise derives from data extent
// and auto-extends to 0/1 when edge regions contain pure components.
export function compute_x_domain(
  x_range: [number | null, number | null] | undefined,
  data: PhaseDiagramData | null,
): Vec2 {
  const [lo, hi] = x_range ?? [null, null]
  if (lo != null && hi != null) return [lo, hi]
  if (!data) return [lo ?? 0, hi ?? 1]

  let data_min = Infinity
  let data_max = -Infinity
  const x_values = [
    ...data.regions.flatMap((region) => region.vertices),
    ...data.boundaries.flatMap((boundary) => boundary.points),
    ...(data.special_points ?? []).map((point) => point.position),
  ]
  for (const [x_val] of x_values) {
    if (x_val < data_min) data_min = x_val
    if (x_val > data_max) data_max = x_val
  }
  if (data_min > data_max) return [lo ?? 0, hi ?? 1] // no finite data

  // Auto-extend to 0/1 when an edge region is named after the pure component AND the
  // data already nearly reaches that boundary
  const comp_at_edge = (comp: string, x_val: number) => {
    if (!comp) return false
    const re = new RegExp(`\\b${comp.replaceAll(/[.*+?^${}()|[\]\\]/g, `\\$&`)}\\b`)
    return data.regions.some(
      (region) =>
        re.test(region.name) &&
        region.vertices.some((vertex) => Math.abs(vertex[0] - x_val) < 1e-6),
    )
  }
  const x_min = data_min < 0.05 && comp_at_edge(data.components[0], data_min) ? 0 : data_min
  const x_max = data_max > 0.95 && comp_at_edge(data.components[1], data_max) ? 1 : data_max
  return [lo ?? x_min, hi ?? x_max]
}

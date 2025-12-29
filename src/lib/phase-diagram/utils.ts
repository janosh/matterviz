import { format_num } from '$lib'
import { add_alpha } from '$lib/colors'
import { point_in_polygon, type Vec2 } from '$lib/math'
import type { Sides } from '$lib/plot'
import { line } from 'd3-shape'
import type {
  CompUnit,
  LeverRuleResult,
  PhaseDiagramConfig,
  PhaseDiagramData,
  PhaseHoverInfo,
  PhaseRegion,
  TempUnit,
} from './types'

// Convert temperature between units (K, °C, °F)
export function convert_temp(value: number, from: TempUnit, to: TempUnit): number {
  if (from === to) return value
  // Convert to Kelvin first
  const kelvin = from === `°C`
    ? value + 273.15
    : from === `°F`
    ? (value - 32) * (5 / 9) + 273.15
    : value
  // Convert from Kelvin to target
  return to === `K`
    ? kelvin
    : to === `°C`
    ? kelvin - 273.15
    : (kelvin - 273.15) * (9 / 5) + 32
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
  margin: Object.freeze({ t: 25, r: 15, b: 50, l: 60 } as Required<Sides>),
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

// Phase colors as hex - single source of truth
// Extended palette supports 3+ phase regions (Greek letters α through λ)
export const PHASE_COLOR_HEX = {
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
  tie_line: `#ff6b6b`,
} as const

export type PhaseColorKey = keyof typeof PHASE_COLOR_HEX

// Derive RGB string format (e.g. "135, 206, 250") for custom alpha usage
export const PHASE_COLOR_RGB = Object.freeze(
  Object.fromEntries(
    Object.entries(PHASE_COLOR_HEX).map(([key, hex]) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return [key, `${r}, ${g}, ${b}`]
    }),
  ),
) as Record<PhaseColorKey, string>

// Derive rgba() format with default alpha using add_alpha
const PHASE_ALPHA = { two_phase: 0.5, default: 0.5, tie_line: 1 } as const
export const PHASE_COLORS = Object.freeze(
  Object.fromEntries(
    Object.entries(PHASE_COLOR_HEX).map(([key, hex]) => [
      key,
      add_alpha(hex, (PHASE_ALPHA as Record<string, number>)[key] ?? 0.6),
    ]),
  ),
) as Record<PhaseColorKey, string>

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
export function get_phase_color_key(name: string): PhaseColorKey {
  const lower = name.toLowerCase().trim()
  if (lower === `l`) return `liquid` // exact match for shorthand "L"
  for (const [patterns, key, prefix] of PHASE_PATTERNS) {
    if (patterns.some((p) => lower.includes(p))) return key
    if (prefix && lower.startsWith(prefix)) return key
  }
  return `default`
}

// Get phase color - returns rgba() by default, or RGB string if format='rgb'
export function get_phase_color(name: string, format: `rgba` | `rgb` = `rgba`): string {
  const lower = name.toLowerCase()
  const key: PhaseColorKey = lower.includes(`+`) ? `two_phase` : get_phase_color_key(name)
  return format === `rgb` ? PHASE_COLOR_RGB[key] : PHASE_COLORS[key]
}

// Gradient stop for multi-phase region gradients
export interface GradientStop {
  offset: number // 0-1 range
  color: string // hex color
}

// Get gradient colors for multi-phase regions (2+ phases separated by '+')
// Returns array of evenly-spaced gradient stops, or null for single-phase regions
export function get_multi_phase_gradient(name: string): GradientStop[] | null {
  if (!name.includes(`+`)) return null
  const phases = name.split(`+`).map((s) => s.trim()).filter(Boolean)
  if (phases.length < 2) return null

  // Create evenly spaced gradient stops (phases.length >= 2 guaranteed by early return)
  return phases.map((phase, idx) => ({
    offset: idx / (phases.length - 1),
    color: PHASE_COLOR_HEX[get_phase_color_key(phase)],
  }))
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

// SVG path generator using d3-shape
const path_line = line<Vec2>().x((d) => d[0]).y((d) => d[1])

// Generate closed SVG path for polygon regions (min 3 points)
export const generate_region_path = (vertices: Vec2[]): string =>
  vertices.length < 3 ? `` : `${path_line(vertices)} Z`

// Generate open SVG path for boundary curves (min 2 points)
export const generate_boundary_path = (points: Vec2[]): string =>
  points.length < 2 ? `` : path_line(points) ?? ``

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
  const rotation = is_tall && avail_h / label_width > avail_w / label_width ? -90 : 0
  return { rotation, lines: [label], scale }
}

// Wrap text into multiple lines at delimiter boundaries
function wrap_text(text: string, max_chars: number): string[] {
  const words = text.split(/[_\s-]+/).filter((word) => word.length > 0)
  if (words.length === 0) return [text]

  const lines: string[] = []
  let current_line = ``

  for (const word of words) {
    const candidate = current_line ? `${current_line}_${word}` : word
    if (candidate.length <= max_chars) {
      current_line = candidate
    } else if (current_line) {
      lines.push(current_line)
      current_line = word
    } else {
      current_line = word
    }
  }

  if (current_line) lines.push(current_line)
  return lines.length > 0 ? lines : [text]
}

// Transform data coordinates to SVG coordinates using scale functions
export function transform_vertices(
  vertices: Vec2[],
  x_scale: (val: number) => number,
  y_scale: (val: number) => number,
): Vec2[] {
  return vertices.map(([comp, temp]) => [x_scale(comp), y_scale(temp)])
}

// Format composition value for display
export function format_composition(
  value: number,
  unit: CompUnit | string = `at%`,
  include_unit: boolean = true,
): string {
  if (unit === `fraction`) return format_num(value, `.3f`)
  const formatted = format_num(value * 100, `.3`)
  return include_unit ? `${formatted} ${unit}` : formatted
}

// Format temperature value for display
export function format_temperature(
  value: number,
  unit: TempUnit | string = `K`,
): string {
  return `${format_num(value, `.0f`)} ${unit}`
}

// Calculate lever rule for a point in a two-phase region
// Returns null if the region is not exactly a two-phase region or calculation fails
// Note: Lever rule is thermodynamically defined only for two-phase equilibria
export function calculate_lever_rule(
  region: PhaseRegion,
  composition: number,
  temperature: number,
): LeverRuleResult | null {
  // Only works for exactly two-phase regions (lever rule undefined for 3+ phases)
  if (!region.name.includes(`+`)) return null
  const phase_count = region.name.split(`+`).filter((s) => s.trim()).length
  if (phase_count !== 2) return null

  // Find horizontal intersections with polygon edges at this temperature
  const intersections: number[] = []
  const n = region.vertices.length

  for (let idx = 0; idx < n; idx++) {
    const [x1, y1] = region.vertices[idx]
    const [x2, y2] = region.vertices[(idx + 1) % n]
    if (
      (y1 <= temperature && y2 > temperature) || (y2 <= temperature && y1 > temperature)
    ) {
      intersections.push(x1 + ((temperature - y1) / (y2 - y1)) * (x2 - x1))
    }
  }

  if (intersections.length < 2) return null
  intersections.sort((a, b) => a - b)

  const left_composition = intersections[0]
  const right_composition = intersections[intersections.length - 1]
  if (composition < left_composition || composition > right_composition) return null

  const total_width = right_composition - left_composition
  if (total_width < 1e-10) return null

  const fraction_right = (composition - left_composition) / total_width
  const fraction_left = 1 - fraction_right

  // Parse phase names from "α + β" format
  const parts = region.name.split(/\s*\+\s*/)
  const left_phase = parts[0]?.trim() || `Phase 1`
  const right_phase = parts[1]?.trim() || `Phase 2`

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

// Calculate temperature stability range for a phase at given composition
export function get_phase_stability_range(
  region: PhaseRegion,
): { t_min: number; t_max: number } | null {
  if (!region.vertices?.length) return null
  const temps = region.vertices.map(([, temp]) => temp)
  return { t_min: Math.min(...temps), t_max: Math.max(...temps) }
}

// Extract reference/citation from TDB comments
export function extract_tdb_reference(comments: string[]): string | null {
  const ref_keywords = [`reference`, `citation`, `database`, `assessed by`]
  for (const comment of comments) {
    const lower = comment.toLowerCase()
    if (ref_keywords.some((kw) => lower.includes(kw))) {
      const ref = comment.replace(/^\$\s*/, ``).trim()
      // Skip incomplete references (must have substantial content after keyword)
      if (ref.length > 30 && !ref.endsWith(`from`)) return ref
    }
  }
  return null
}

// Summarize sublattice models from TDB phases
export function summarize_models(
  phases: { sublattice_count: number; sublattice_sites: number[] }[],
): string {
  const counts = new Map<number, number>()
  for (const phase of phases) {
    counts.set(phase.sublattice_count, (counts.get(phase.sublattice_count) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, c]) => `${c}×${n}-SL`)
    .join(`, `)
}

import { add_alpha } from '$lib/colors'
import { format_num } from '$lib/labels'
import { point_in_polygon, type Vec2 } from '$lib/math'
import type { Sides } from '$lib/plot'
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
export function convert_temp(
  value: number,
  from: TempUnit,
  to: TempUnit,
): number {
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
  margin: Object.freeze({ t: 25, r: 25, b: 50, l: 60 } as Required<Sides>),
  // Export
  png_dpi: 150,
})

// Merge partial config with defaults - single helper for consistent merging
export function merge_phase_diagram_config(
  config: Partial<PhaseDiagramConfig>,
) {
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
      add_alpha(
        hex,
        key in PHASE_ALPHA ? PHASE_ALPHA[key as keyof typeof PHASE_ALPHA] : 0.6,
      ),
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
export function get_phase_color(
  name: string,
  format: `rgba` | `rgb` = `rgba`,
): string {
  const lower = name.toLowerCase().trim()
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
    if (point_in_polygon(composition, temperature, region.vertices)) {
      return region
    }
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
  const scale = Math.max(
    0.7,
    Math.min(avail_w / label_width, avail_h / line_height, 1),
  )
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
  unit: CompUnit = `at%`,
  include_unit: boolean = true,
): string {
  if (unit === `fraction`) return format_num(value, `.3~f`)
  const formatted = format_num(value * 100, `.3~`)
  return include_unit ? `${formatted} ${unit}` : formatted
}

// Format temperature value for display
export function format_temperature(
  value: number,
  unit: TempUnit = `K`,
): string {
  return `${format_num(value, `.0f`)} ${unit}`
}

// Parse a two-phase region name into its two phase names
// Returns null if the region is not exactly a two-phase region
function parse_two_phases(name: string): [string, string] | null {
  if (!name.includes(`+`)) return null
  const parts = name.trim().split(/\s*\+\s*/).filter(Boolean)
  return parts.length === 2 ? [parts[0], parts[1]] : null
}

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
        v1[other] +
          ((fixed_val - v1[axis]) / (v2[axis] - v1[axis])) * (v2[other] - v1[other]),
      )
    }
  }
  return intersections.sort((a, b) => a - b)
}

function pick_bracketing_intersection_pair(
  intersections: number[],
  position: number,
): [number, number] | null {
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
  let left_idx = -1
  for (let idx = 0; idx < unique_intersections.length; idx++) {
    if (unique_intersections[idx] <= position + bound_tol) left_idx = idx
  }
  if (left_idx < 0 || left_idx + 1 >= unique_intersections.length) return null

  const left_bound = unique_intersections[left_idx]
  const right_bound = unique_intersections[left_idx + 1]
  return right_bound - left_bound > bound_tol ? [left_bound, right_bound] : null
}

// Shared core for lever rule calculations (horizontal and vertical)
// Parses phases, finds intersections along the scan axis, validates bounds,
// and computes the fractional position within the two-phase region.
function lever_rule_core(
  region: PhaseRegion,
  position: number,
  scan_val: number,
  axis: 0 | 1,
): { phases: [string, string]; lo: number; hi: number; fraction_hi: number } | null {
  const phases = parse_two_phases(region.name)
  if (!phases) return null

  const intersections = find_polygon_intersections(region.vertices, scan_val, axis)
  const bounds = pick_bracketing_intersection_pair(intersections, position)
  if (!bounds) return null
  const [lo, hi] = bounds

  const span = hi - lo
  if (span < 1e-10) return null

  return { phases, lo, hi, fraction_hi: (position - lo) / span }
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
    `Composition: ${format_composition(info.composition, comp_unit)} ${component_b} (${
      format_composition(1 - info.composition, comp_unit)
    } ${component_a})`,
  ]

  if (lever_rule_mode === `horizontal` && info.lever_rule) {
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

  if (lever_rule_mode === `vertical` && info.vertical_lever_rule) {
    const vlr = info.vertical_lever_rule
    lines.push(
      ``,
      `Vertical Lever Rule:`,
      `  ${vlr.bottom_phase}: ${format_num(vlr.fraction_bottom * 100, `.1f`)}% (at ${
        format_temperature(to_display(vlr.bottom_temperature), temp_unit)
      })`,
      `  ${vlr.top_phase}: ${format_num(vlr.fraction_top * 100, `.1f`)}% (at ${
        format_temperature(to_display(vlr.top_temperature), temp_unit)
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
  let t_min = Infinity
  let t_max = -Infinity
  for (const [, temp] of region.vertices) {
    if (temp < t_min) t_min = temp
    if (temp > t_max) t_max = temp
  }
  return { t_min, t_max }
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
    counts.set(
      phase.sublattice_count,
      (counts.get(phase.sublattice_count) ?? 0) + 1,
    )
  }
  return [...counts.entries()]
    .sort(([sl_a], [sl_b]) => sl_a - sl_b)
    .map(([sublattices, count]) => `${count}×${sublattices}-SL`)
    .join(`, `)
}

// Chemical Formula Parsing Utilities (for pseudo-binary phase diagrams)

// Token from formula tokenization - can be text, subscript, or superscript
export interface FormulaToken {
  text?: string
  sub?: string
  sup?: string
}

// Check if a component name is a compound (vs single element)
// Returns true if name contains digits (e.g., "Fe3C", "SiO2") or multiple uppercase letters
// that indicate multiple elements (e.g., "MgO", "CaO")
// Single elements like "Fe", "Ca", "He" return false
export function is_compound(name: string): boolean {
  if (!name) return false
  // Contains digits -> likely a compound (Fe3C, SiO2, Al2O3)
  if (/\d/.test(name)) return true
  // Single element pattern: one uppercase followed by optional lowercase (Fe, Ca, He, C)
  if (/^[A-Z][a-z]?$/.test(name)) return false
  return (name.match(/[A-Z]/g)?.length ?? 0) >= 2
}

// Tokenize a chemical formula for rendering with subscripts/superscripts
// Examples:
//   "Fe3C" -> [{text: "Fe"}, {sub: "3"}, {text: "C"}]
//   "SiO2" -> [{text: "Si"}, {text: "O"}, {sub: "2"}]
//   "Al2O3" -> [{text: "Al"}, {sub: "2"}, {text: "O"}, {sub: "3"}]
//   "Fe" -> [{text: "Fe"}]
//   "α-Fe" -> [{text: "α-Fe"}] (Greek phases pass through unchanged)
export function tokenize_formula(formula: string): FormulaToken[] {
  if (!formula) return []

  // If it contains Greek letters or special phase notation, return as-is
  if (/[α-ωΑ-Ω]/.test(formula) || formula.includes(`+`)) {
    return [{ text: formula }]
  }

  const tokens: FormulaToken[] = []
  let idx = 0

  while (idx < formula.length) {
    const char = formula[idx]

    // Check for subscript digits (numbers following letters)
    if (/\d/.test(char)) {
      // Collect consecutive digits
      let num = ``
      while (idx < formula.length && /\d/.test(formula[idx])) {
        num += formula[idx]
        idx++
      }
      tokens.push({ sub: num })
      continue
    }

    // Check for superscript (- charge notation, e.g., "O2-" or "Cl-2")
    // Note: + is handled by the early return for phase notation like "α + β"
    // Treat '-' as charge when: at end of string, OR followed by digit
    // Otherwise preserve as text for hyphenated names like "Fe-Fe3C"
    if (char === `-`) {
      idx++
      if (idx >= formula.length || /\d/.test(formula[idx])) {
        // End of string or followed by digit - parse as charge superscript
        let charge = `-`
        while (idx < formula.length && /\d/.test(formula[idx])) {
          charge += formula[idx]
          idx++
        }
        tokens.push({ sup: charge })
      } else tokens.push({ text: `-` }) // Not at end and not followed by digit - preserve hyphen
      continue
    }

    // Check for element symbol (uppercase followed by optional lowercase)
    if (/[A-Z]/.test(char)) {
      let element = char
      idx++
      // Collect following lowercase letters
      while (idx < formula.length && /[a-z]/.test(formula[idx])) {
        element += formula[idx]
        idx++
      }
      tokens.push({ text: element })
      continue
    }

    // Any other character (lowercase, hyphen, etc.) - collect as text
    let text = char
    idx++
    while (idx < formula.length && !/[A-Z\d\-]/.test(formula[idx])) {
      text += formula[idx]
      idx++
    }
    // Merge with previous text token if possible
    if (tokens.length > 0 && tokens[tokens.length - 1].text !== undefined) {
      tokens[tokens.length - 1].text += text
    } else {
      tokens.push({ text })
    }
  }

  return tokens
}

// Baseline shifts for sub/superscript (SVG dy values are cumulative across tspans)
const DY = { sub: 0.25, sup: -0.4 } as const

// Format chemical formula as SVG tspan elements with subscripts
// Tracks cumulative baseline offset and adds trailing reset so concatenated text aligns
export function format_formula_svg(
  formula: string,
  use_subscripts = true,
): string {
  if (!use_subscripts || !is_compound(formula)) return formula

  let result = ``
  let offset = 0

  for (const token of tokenize_formula(formula)) {
    if (token.text !== undefined) {
      result += offset ? `<tspan dy="${-offset}em">${token.text}</tspan>` : token.text
      offset = 0
    } else {
      const dy = token.sub !== undefined ? DY.sub : DY.sup
      result += `<tspan dy="${dy}em" font-size="0.75em">${token.sub ?? token.sup}</tspan>`
      offset += dy
    }
  }

  // Reset baseline after trailing subscript/superscript using a zero-width space
  // (empty tspans may not apply dy in all SVG renderers)
  if (offset) result += `<tspan dy="${-offset}em">\u200B</tspan>`
  return result
}

// Split a multi-phase label on " + " and format each part with the given formatter
function format_label_parts(
  label: string,
  use_subscripts: boolean,
  formatter: (formula: string, use_sub: boolean) => string,
): string {
  if (!use_subscripts) return label
  return label.split(/(\s*\+\s*)/).map((part) => {
    if (part.trim() === `+`) return part
    return formatter(part.trim(), use_subscripts)
  }).join(``)
}

// Format a phase region label (e.g. "La2NiO4 + NiO") as SVG with subscripts
export const format_label_svg = (label: string, use_subscripts = true): string =>
  format_label_parts(label, use_subscripts, format_formula_svg)

// Format a phase region label as HTML with subscripts (splits on " + ")
export const format_label_html = (label: string, use_subscripts = true): string =>
  format_label_parts(label, use_subscripts, format_formula_html)

// Format chemical formula as HTML with <sub> and <sup> tags
export function format_formula_html(
  formula: string,
  use_subscripts = true,
): string {
  if (!use_subscripts || !is_compound(formula)) return formula

  return tokenize_formula(formula)
    .map((token) =>
      token.text ??
        (token.sub ? `<sub>${token.sub}</sub>` : `<sup>${token.sup}</sup>`)
    )
    .join(``)
}

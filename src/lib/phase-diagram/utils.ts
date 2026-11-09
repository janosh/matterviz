import { format_num } from '#lib/labels.js'
import { point_in_polygon, type Vec2 } from '#lib/math.js'
import type { Sides } from '#lib/plot/core/layout.js'
import { line } from 'd3-shape'
import type {
  CompUnit,
  DiagramRegion,
  LeverRuleResult,
  PhaseDiagramConfig,
  TempUnit,
} from './types'

// Convert temperature between units (K, °C, °F)
export function convert_temp(value: number, from: TempUnit, target: TempUnit): number {
  if (from === target) return value
  const kelvin =
    from === `°C` ? value + 273.15 : from === `°F` ? (value - 32) * (5 / 9) + 273.15 : value
  return target === `K`
    ? kelvin
    : target === `°C`
      ? kelvin - 273.15
      : (kelvin - 273.15) * (9 / 5) + 32
}

// A temperature difference in K expressed in `unit`: the same in K and °C, 9/5 larger in °F
export const temp_delta = (kelvin_delta: number, unit: TempUnit): number =>
  unit === `°F` ? kelvin_delta * (9 / 5) : kelvin_delta

// Defaults for phase diagram configuration
export const PHASE_DIAGRAM_DEFAULTS = Object.freeze({
  // Visibility
  show_boundaries: true,
  show_labels: true,
  show_special_points: true,
  show_grid: true,
  show_component_labels: true,
  show_overlay: true,
  show_observations: true,
  show_uncertainty: true,
  show_disagreement: true,
  lens: false,
  // Display units (data is always K and mole fraction)
  temp_unit: `K`,
  comp_unit: `at%`,
  // Appearance
  font_size: 12,
  special_point_radius: 5,
  // Axes (tick *targets* for d3 scale.ticks; 5 keeps a 1600 K span at 500 K steps)
  x_ticks: 5,
  y_ticks: 5,
  // Tie-line
  tie_line: Object.freeze({ stroke_width: 1.5, endpoint_radius: 4, cursor_radius: 5 }),
  // Colors
  colors: Object.freeze({
    background: `transparent`,
    grid: `rgba(128, 128, 128, 0.3)`,
    axis: `var(--text-color, #333)`,
    text: `var(--text-color, #333)`,
    special_point: `#d32f2f`,
    overlay: `#e6007e`,
  }),
  // Margins
  margin: Object.freeze({ t: 25, r: 25, b: 50, l: 60 } as Required<Sides>),
})

// Merge partial config with defaults
export const merge_phase_diagram_config = (config: Partial<PhaseDiagramConfig>) => ({
  margin: { ...PHASE_DIAGRAM_DEFAULTS.margin, ...config.margin },
  font_size: config.font_size ?? PHASE_DIAGRAM_DEFAULTS.font_size,
  special_point_radius:
    config.special_point_radius ?? PHASE_DIAGRAM_DEFAULTS.special_point_radius,
  tie_line: { ...PHASE_DIAGRAM_DEFAULTS.tie_line, ...config.tie_line },
  colors: { ...PHASE_DIAGRAM_DEFAULTS.colors, ...config.colors },
})

// Phase colors as hex: liquid and Greek-letter phases α through λ
const NAMED_PHASE_HEX = {
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
} as const

export const LIQUID_COLOR = NAMED_PHASE_HEX.liquid
// Solid-phase palette (pastels, no liquid blue) for phase_colors
export const SOLID_PHASE_PALETTE: readonly string[] = Object.values(NAMED_PHASE_HEX).slice(1)

export const TIE_LINE_COLOR = `#ff6b6b`

// Phase pattern matching rules: [substrings to match, color key, optional prefix check]
// Order matters: theta before eta (since "theta" contains "eta" as substring)
const PHASE_PATTERNS: [string[], keyof typeof NAMED_PHASE_HEX, string?][] = [
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

// Opaque palette color of a phase name matching one of the patterns (liquid, Greek letters),
// null for names the palette doesn't know
export function named_phase_color(name: string): string | null {
  const lower = name.toLowerCase().trim()
  if (lower === `l`) return NAMED_PHASE_HEX.liquid // exact match for shorthand "L"
  for (const [patterns, key, prefix] of PHASE_PATTERNS) {
    if (patterns.some((pattern) => lower.includes(pattern))) return NAMED_PHASE_HEX[key]
    if (prefix && lower.startsWith(prefix)) return NAMED_PHASE_HEX[key]
  }
  return null
}

// Last region containing (composition, temperature): later regions take precedence
export const find_region_at = (
  regions: readonly DiagramRegion[],
  composition: number,
  temperature: number,
): DiagramRegion | null =>
  regions.findLast((region) => point_in_polygon(composition, temperature, region.vertices)) ??
  null

const path_line = line()
  .x((point) => point[0])
  .y((point) => point[1])

// Generate closed SVG path for polygon regions (min 3 points)
export const generate_region_path = (vertices: Vec2[]): string =>
  vertices.length < 3 ? `` : `${path_line(vertices)} Z`

// Generate open SVG path for boundary curves (min 2 points)
export const generate_boundary_path = (points: Vec2[]): string =>
  points.length < 2 ? `` : (path_line(points) ?? ``)

// Approximate glyph width and line height of region labels, in units of the font size
export const CHAR_WIDTH_EM = 0.6
export const LINE_HEIGHT_EM = 1.2

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

  const char_width = font_size * CHAR_WIDTH_EM
  const line_height = font_size * LINE_HEIGHT_EM
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
    const wrapped_w = Math.max(...lines.map((label_line) => label_line.length)) * char_width
    const wrapped_h = lines.length * line_height

    if (wrapped_w <= avail_w && wrapped_h <= avail_h) {
      return { rotation: 0, lines, scale: 1 }
    }
    if (is_tall && wrapped_w <= avail_h && wrapped_h <= avail_w) {
      return { rotation: -90, lines, scale: 1 }
    }
  }

  // Scale down as last resort (min 70%). A rotated label runs along the region's height.
  const [along, across] = is_tall ? [avail_h, avail_w] : [avail_w, avail_h]
  const scale = Math.max(0.7, Math.min(along / label_width, across / line_height, 1))
  return { rotation: is_tall ? -90 : 0, lines: [label], scale }
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

// Format a mole fraction for display, as a fraction or in at.%
export function format_composition(
  value: number,
  unit: CompUnit = `at%`,
  include_unit: boolean = true,
): string {
  if (unit === `fraction`) return format_num(value, `.3~f`)
  const formatted = format_num(value * 100, `.3~`)
  return include_unit ? `${formatted} ${unit}` : formatted
}

// Format a temperature in K for display in `unit`
export const format_temperature = (kelvin: number, unit: TempUnit = `K`): string =>
  `${format_num(convert_temp(kelvin, `K`, unit), `.0f`)} ${unit}`

// Composition intersections of a polygon's edges with the isotherm T = temperature, sorted
export function find_isotherm_intersections(vertices: Vec2[], temperature: number): number[] {
  const intersections: number[] = []
  for (let idx = 0; idx < vertices.length; idx++) {
    const [comp_1, temp_1] = vertices[idx]
    const [comp_2, temp_2] = vertices[(idx + 1) % vertices.length]
    if (
      (temp_1 <= temperature && temp_2 > temperature) ||
      (temp_2 <= temperature && temp_1 > temperature)
    ) {
      intersections.push(
        comp_1 + ((temperature - temp_1) / (temp_2 - temp_1)) * (comp_2 - comp_1),
      )
    }
  }
  return intersections.toSorted((val_a, val_b) => val_a - val_b)
}

// Consecutive crossing pairs bound the region's intervals along the isotherm (half-open edge
// test above, so a vertex touching T from one side yields a zero-width pair, not a lone
// crossing that would shift every later pair)
function pick_bracketing_intersection_pair(
  intersections: number[],
  position: number,
): Vec2 | null {
  const bound_tol = 1e-10
  for (let pair_idx = 0; pair_idx + 1 < intersections.length; pair_idx += 2) {
    const [low_bound, high_bound] = [intersections[pair_idx], intersections[pair_idx + 1]]
    if (position >= low_bound - bound_tol && position <= high_bound + bound_tol) {
      return [low_bound, high_bound]
    }
  }
  return null
}

// Lever rule along the isothermal tie line (the only direction it is defined in). Null unless
// the region is exactly two-phase and the scan brackets the point. The format lists a
// two-phase region's phases left to right, so phases[0] sits at the tie line's low-x end.
export function calculate_lever_rule(
  region: DiagramRegion,
  composition: number,
  temperature: number,
): LeverRuleResult | null {
  if (region.phases.length !== 2) return null
  const bounds = pick_bracketing_intersection_pair(
    find_isotherm_intersections(region.vertices, temperature),
    composition,
  )
  if (!bounds) return null
  const [lower, upper] = bounds
  if (upper - lower < 1e-10) return null
  const fraction_right = (composition - lower) / (upper - lower)
  return {
    left_phase: region.phases[0],
    right_phase: region.phases[1],
    left_composition: lower,
    right_composition: upper,
    fraction_left: 1 - fraction_right,
    fraction_right,
  }
}

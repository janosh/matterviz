import { add_alpha } from '$lib/colors'
import { DEFAULT_PNG_DPI } from '$lib/constants'
import { format_num } from '$lib/labels'
import { array_extent, point_in_polygon, type Vec2 } from '$lib/math'
import type { Sides } from '$lib/plot/core/layout'
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
  const kelvin =
    from === `°C` ? value + 273.15 : from === `°F` ? (value - 32) * (5 / 9) + 273.15 : value
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

// Composition intersections of a polygon's edges with the isotherm T = temperature, sorted
function find_isotherm_intersections(vertices: Vec2[], temperature: number): number[] {
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

// Composition offsets (atomic fraction) probed outside a tie-line end to identify the adjacent
// single-phase field. Widening steps cover narrow terminal solid solutions.
const NEIGHBOR_PROBE_OFFSETS = [1e-4, 1e-3, 5e-3]

// Order the two phases as [left, right] along the tie line. A region name lists them in
// arbitrary order ("alpha + L" may have L on the left), so probe the field just past each end
// and match by name; when neither neighbour matches, the name order stands.
function order_phases_along_tie_line(
  region: PhaseRegion,
  all_regions: readonly PhaseRegion[],
  phases: [string, string],
  temperature: number,
  lo: number,
  hi: number,
): [string, string] {
  const swapped: [string, string] = [phases[1], phases[0]]
  const probe = (position: number, direction: -1 | 1): string | null => {
    for (const offset of NEIGHBOR_PROBE_OFFSETS) {
      const found = all_regions.findLast(
        (cand) =>
          cand !== region &&
          point_in_polygon(position + direction * offset, temperature, cand.vertices),
      )
      const name = found?.name.trim()
      if (name === phases[0] || name === phases[1]) return name
    }
    return null
  }
  const left_neighbor = probe(lo, -1)
  if (left_neighbor) return left_neighbor === phases[0] ? phases : swapped
  const right_neighbor = probe(hi, 1)
  if (right_neighbor) return right_neighbor === phases[1] ? phases : swapped
  return phases
}

// Lever rule along the isothermal tie line — the only direction it is defined in (along a
// vertical cut the coexisting phases change composition with T, so no ratio of temperatures is
// a phase fraction). Null unless the region is exactly two-phase and the scan brackets the
// point. `all_regions` assigns the phases to tie-line ends by geometry, not by name order.
export function calculate_lever_rule(
  region: PhaseRegion,
  composition: number,
  temperature: number,
  all_regions: readonly PhaseRegion[] = [],
): LeverRuleResult | null {
  const phases = region.name.includes(`+`)
    ? region.name
        .trim()
        .split(/\s*\+\s*/)
        .filter(Boolean)
    : []
  if (phases.length !== 2) return null

  // Horizontal scan: fixed temperature, find composition intersections
  const bounds = pick_bracketing_intersection_pair(
    find_isotherm_intersections(region.vertices, temperature),
    composition,
  )
  if (!bounds) return null
  const [lo, hi] = bounds
  if (hi - lo < 1e-10) return null

  const [left_phase, right_phase] = order_phases_along_tie_line(
    region,
    all_regions,
    [phases[0], phases[1]],
    temperature,
    lo,
    hi,
  )
  const fraction_right = (composition - lo) / (hi - lo)

  return {
    left_phase,
    right_phase,
    left_composition: lo,
    right_composition: hi,
    fraction_left: 1 - fraction_right,
    fraction_right,
  }
}

// Lever rule as one [phase, fraction, composition] row per tie-line end; null when the hover
// info carries no lever rule
export function lever_rule_rows(
  info: PhaseHoverInfo,
  comp_unit: CompUnit,
): [string, number, string][] | null {
  const { lever_rule: lr } = info
  if (!lr) return null
  const comp = (val: number) => format_composition(val, comp_unit)
  return [
    [lr.left_phase, lr.fraction_left, comp(lr.left_composition)],
    [lr.right_phase, lr.fraction_right, comp(lr.right_composition)],
  ]
}

export interface HoverTextOptions {
  temp_unit?: TempUnit // display unit, default K
  comp_unit?: CompUnit
  component_a?: string
  component_b?: string
  data_temp_unit?: TempUnit // unit of info.temperature, defaults to temp_unit
}

// Format hover info as copyable text for clipboard
export function format_hover_info_text(
  info: PhaseHoverInfo,
  options: HoverTextOptions = {},
): string {
  const {
    temp_unit = `K`,
    comp_unit = `at%`,
    component_a = `A`,
    component_b = `B`,
    data_temp_unit = temp_unit,
  } = options
  const to_display = (temp: number) => convert_temp(temp, data_temp_unit, temp_unit)

  const lines: string[] = [
    `Phase: ${info.region.name}`,
    `Temperature: ${format_temperature(to_display(info.temperature), temp_unit)}`,
    `Composition: ${format_composition(info.composition, comp_unit)} ${component_b} (${format_composition(
      1 - info.composition,
      comp_unit,
    )} ${component_a})`,
  ]

  const lever = lever_rule_rows(info, comp_unit)
  if (lever) {
    lines.push(``, `Lever Rule:`)
    for (const [phase, fraction, location] of lever) {
      lines.push(`  ${phase}: ${format_num(fraction * 100, `.1f`)}% (at ${location})`)
    }
  }

  return lines.join(`\n`)
}

// Calculate temperature stability range for a phase at given composition
export function get_phase_stability_range(
  region: PhaseRegion,
): { t_min: number; t_max: number } | null {
  if (region.vertices.length === 0) return null
  const [t_min, t_max] = array_extent(region.vertices.map(([, temp]) => temp))
  return { t_min, t_max }
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

  const [data_min, data_max] = array_extent(
    [
      ...data.regions.flatMap((region) => region.vertices),
      ...data.boundaries.flatMap((boundary) => boundary.points),
      ...(data.special_points ?? []).map((point) => point.position),
    ].map(([x_val]) => x_val),
  )
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

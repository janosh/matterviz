import type { ElementSymbol, EnergyModeInfo } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import { get_page_background } from '$lib/colors'
import { ELEM_SYMBOL_TO_NAME } from '$lib/composition'
import { format_fractional, format_num, symbol_map } from '$lib/labels'
import { scaleSequential } from 'd3-scale'
import * as d3_sc from 'd3-scale-chromatic'
import { symbol } from 'd3-shape'
import type { HighlightStyle, MarkerSymbol, PhaseData, PhaseDiagramConfig } from './types'
import { is_unary_entry } from './types'

// Energy color scale factory (shared)
export function get_energy_color_scale(
  color_mode: `stability` | `energy`,
  color_scale: D3InterpolateName,
  plot_entries: { e_above_hull?: number }[],
): ((value: number) => string) | null {
  if (color_mode !== `energy` || plot_entries.length === 0) return null
  const hull_distances = plot_entries
    .map((entry) => entry.e_above_hull)
    .filter((v): v is number => typeof v === `number`)
  if (hull_distances.length === 0) return null
  const lo = Math.min(...hull_distances)
  const hi_raw = Math.max(...hull_distances, 0.1)
  const hi = Math.max(hi_raw, lo + 1e-6)
  const interpolator =
    (d3_sc as unknown as Record<string, (t: number) => string>)[color_scale] ||
    d3_sc.interpolateViridis
  return scaleSequential(interpolator).domain([lo, hi])
}

// Point color resolver (shared)
export function get_point_color_for_entry(
  entry: { is_stable?: boolean; e_above_hull?: number },
  color_mode: `stability` | `energy`,
  colors: PhaseDiagramConfig[`colors`] | undefined,
  energy_scale: ((value: number) => string) | null,
): string {
  const is_stable = Boolean(entry.is_stable) || entry.e_above_hull === 0
  if (color_mode === `stability`) {
    return is_stable ? (colors?.stable || `#0072B2`) : (colors?.unstable || `#E69F00`)
  }
  return energy_scale && typeof entry.e_above_hull === `number`
    ? energy_scale(entry.e_above_hull)
    : `#666`
}

// Robust drag-and-drop JSON parsing for phase diagram entries
export async function parse_pd_entries_from_drop(
  event: DragEvent,
): Promise<PhaseData[] | null> {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (!file?.name.endsWith(`.json`)) return null
  try {
    const data = JSON.parse(await file.text()) as PhaseData[]
    if (!Array.isArray(data) || data.length === 0) return null
    if (!data[0].composition || typeof data[0].energy !== `number`) return null
    return data
  } catch (error) {
    console.error(`Error parsing dropped file:`, error)
    return null
  }
}

// Compute a consistent max energy threshold for controls (shared)
export function calc_max_hull_dist_in_data(
  processed_entries: PhaseData[],
): number {
  if (processed_entries.length === 0) return 0.5
  const hull_distances = processed_entries
    .map((e) => e.e_above_hull)
    .filter((v): v is number => typeof v === `number` && Number.isFinite(v))
  const max_val = (hull_distances.length ? Math.max(...hull_distances) : 0) + 0.001
  return Math.max(0.1, max_val)
}

// Smart threshold for showing unstable entries based on entry count.
// Few entries (≤25): show all. Many entries (≥100): use static default. Between: interpolate.
export function compute_auto_hull_dist_threshold(
  n_entries: number,
  max_hull_dist_in_data: number,
  static_default: number,
): number {
  const [LOW, HIGH] = [25, 100]
  if (n_entries <= LOW) return max_hull_dist_in_data
  if (n_entries >= HIGH) return static_default
  const t = (n_entries - LOW) / (HIGH - LOW)
  return max_hull_dist_in_data * (1 - t) + static_default * t
}

// Build a tooltip text for any phase entry (shared)
export function build_entry_tooltip_text(entry: PhaseData): string {
  const is_element = is_unary_entry(entry)
  const elem_symbol = is_element ? Object.keys(entry.composition)[0] : ``

  const elem_name = is_element
    ? ELEM_SYMBOL_TO_NAME[elem_symbol as ElementSymbol] ?? ``
    : ``

  let text = is_element
    ? `${elem_symbol}${elem_name ? ` (${elem_name})` : ``}\n`
    : `${entry.name || entry.reduced_formula || ``}\n`

  if (!is_element) {
    const total = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)
    if (total > 0) {
      const fractions = Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0)
        .map(([el, amt]) => `${el}: ${format_fractional(amt / total)}`)
      if (fractions.length > 1) text += `Composition: ${fractions.join(`, `)}\n`
    }
  }

  if (entry.e_above_hull !== undefined) {
    const e_hull_str = format_num(entry.e_above_hull, `.3~`)
    text += `E above hull: ${e_hull_str} eV/atom\n`
  }
  // Fallback to energy_per_atom if e_form_per_atom is absent
  const e_form_display = entry.e_form_per_atom !== undefined
    ? entry.e_form_per_atom
    : entry.energy_per_atom
  if (e_form_display !== undefined) {
    const e_form_str = format_num(e_form_display, `.3~`)
    text += `Formation Energy: ${e_form_str} eV/atom`
  }
  if (entry.entry_id) text += `\nID: ${entry.entry_id}`
  return text
}

// Generic mouse hit-testing for projected 3D points (shared)
export function find_pd_entry_at_mouse<
  T extends {
    x: number
    y: number
    z: number
    visible?: boolean
    size?: number
    is_stable?: boolean
    e_above_hull?: number
  },
>(
  canvas: HTMLCanvasElement | undefined,
  event: MouseEvent,
  plot_entries: T[],
  project_point: (x: number, y: number, z: number) => { x: number; y: number },
): T | null {
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const mouse_x = event.clientX - rect.left
  const mouse_y = event.clientY - rect.top
  const container_scale =
    Math.min(canvas.clientWidth || 600, canvas.clientHeight || 600) / 600
  for (const entry of plot_entries) {
    if (!entry.visible) continue
    const projected = project_point(entry.x, entry.y, entry.z)
    const distance = Math.hypot(mouse_x - projected.x, mouse_y - projected.y)
    const base = entry.size ?? ((entry.is_stable || entry.e_above_hull === 0) ? 6 : 4)
    if (distance < base * container_scale + 5) return entry
  }
  return null
}

// Calculate which side of the viewport has more space for modal placement
export function calculate_modal_side(wrapper: HTMLDivElement | undefined): boolean {
  if (!wrapper) return true
  const rect = wrapper.getBoundingClientRect()
  const viewport_width = globalThis.innerWidth
  const space_on_right = viewport_width - rect.right
  const space_on_left = rect.left
  return space_on_right >= space_on_left
}

// Setup fullscreen effect for phase diagrams with optional camera reset callback
export function setup_fullscreen_effect(
  fullscreen: boolean,
  wrapper: HTMLDivElement | undefined,
  on_fullscreen_change?: (entering_fullscreen: boolean) => void,
): void {
  if (typeof window === `undefined`) return

  if (fullscreen && !document.fullscreenElement && wrapper?.isConnected) {
    wrapper.requestFullscreen().catch(console.error)
    on_fullscreen_change?.(true)
  } else if (!fullscreen && document.fullscreenElement) {
    document.exitFullscreen()
    on_fullscreen_change?.(false)
  }
}

export function set_fullscreen_bg(
  wrapper: HTMLDivElement | undefined,
  fullscreen: boolean,
  css_var_name: string,
): void {
  if (!wrapper || !fullscreen) return
  const bg = get_page_background()
  if (bg) wrapper.style.setProperty(css_var_name, bg)
}

// Compute energy source mode information for phase diagram entries. Returns energy mode information including capability flags and resolved mode.
// This determines whether we can use precomputed energies or need to compute on-the-fly.
export function compute_energy_mode_info(
  entries: PhaseData[], // Array of phase entries to analyze
  find_lowest_energy_unary_refs_fn: (entries: PhaseData[]) => Record<string, PhaseData>, // Function to find unary references
  energy_source_mode: `precomputed` | `on-the-fly`, // User-specified energy source mode preference
): EnergyModeInfo {
  const has_precomputed_e_form = entries.length > 0 &&
    entries.every((e) => typeof e.e_form_per_atom === `number`)
  const has_precomputed_hull = entries.length > 0 &&
    entries.every((e) => typeof e.e_above_hull === `number`)

  const unary_refs = find_lowest_energy_unary_refs_fn(entries)

  const elements_in_entries = Array.from(
    new Set(entries.flatMap((e) => Object.keys(e.composition))),
  )
  const can_compute_e_form = elements_in_entries.every((el) => Boolean(unary_refs[el]))
  const can_compute_hull = can_compute_e_form

  // Resolve mode to avoid inconsistent states:
  // - If full precomputed available, honor user toggle
  // - Else if we can compute both, use on-the-fly automatically
  // - Else fall back to precomputed (best-effort)
  const energy_mode = has_precomputed_e_form && has_precomputed_hull
    ? energy_source_mode
    : can_compute_e_form && can_compute_hull
    ? `on-the-fly`
    : `precomputed`

  return {
    has_precomputed_e_form,
    has_precomputed_hull,
    can_compute_e_form,
    can_compute_hull,
    energy_mode,
    unary_refs,
  }
}

// Compute effective entries with formation energies based on the energy mode.
// Returns entries with formation energies populated (either precomputed or on-the-fly)
export function get_effective_entries(
  entries: PhaseData[], // Original phase entries
  energy_mode: `precomputed` | `on-the-fly`, // Energy source mode (precomputed or on-the-fly)
  unary_refs: Record<string, PhaseData>, // Unary reference entries for energy computation
  compute_e_form_fn: (
    entry: PhaseData,
    unary_refs: Record<string, PhaseData>,
  ) => number | null, // Function to compute formation energy per atom
): PhaseData[] {
  if (energy_mode === `precomputed`) return entries

  return entries.map((entry) => {
    const e_form = compute_e_form_fn(entry, unary_refs)
    if (e_form === null) return entry
    return { ...entry, e_form_per_atom: e_form }
  })
}

// Copy text to clipboard with visual feedback
export async function copy_entry_to_clipboard(
  entry: PhaseData,
  position: { x: number; y: number },
  on_feedback: (visible: boolean, pos: { x: number; y: number }) => void,
): Promise<void> {
  const text = build_entry_tooltip_text(entry)
  await navigator.clipboard.writeText(text)
  on_feedback(true, position)
  setTimeout(() => on_feedback(false, position), 1500)
}

export const DEFAULT_HIGHLIGHT_STYLE: Required<HighlightStyle> = {
  effect: `pulse`,
  color: `#ff4444`, // Bright red for visibility
  size_multiplier: 1.8, // Moderate base size
  opacity: 0.85, // High visibility
  pulse_speed: 3, // Smooth pulsing
}

export function merge_highlight_style(
  custom_style: HighlightStyle | undefined,
): Required<HighlightStyle> {
  return { ...DEFAULT_HIGHLIGHT_STYLE, ...custom_style }
}

export function is_entry_highlighted<T extends { entry_id?: string }>(
  entry: T,
  highlighted_list: (string | T)[],
): boolean {
  if (!highlighted_list.length) return false
  const { entry_id } = entry
  if (!entry_id) return false
  return highlighted_list.some((item) =>
    typeof item === `string` ? item === entry_id : item?.entry_id === entry_id
  )
}

// Calculate fractional composition (normalized composition) for an entry
export function get_fractional_composition(
  composition: Record<string, number>,
): Record<string, number> {
  const total = Object.values(composition).reduce((sum, amt) => sum + amt, 0)
  if (total <= 0) return {} // Return empty object if total is zero or negative (invalid composition)
  const fractional: Record<string, number> = {}
  for (const [elem, amt] of Object.entries(composition)) {
    // Only include positive amounts in fractional composition
    if (amt > 0) fractional[elem] = amt / total
  }
  return fractional
}

export interface PolymorphStats {
  total: number
  higher: number
  lower: number
  equal: number
}

// Energy metric types for consistent polymorph comparison
type EnergyMetric = `e_form_per_atom` | `energy_per_atom` | `e_above_hull` | null

// Check if value is a finite number
const is_finite = (val: unknown): val is number =>
  typeof val === `number` && Number.isFinite(val)

// Compute energy_per_atom from total energy and composition
function compute_energy_per_atom(entry: PhaseData): number | null {
  if (!is_finite(entry.energy)) return null
  const total_atoms = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)
  return total_atoms > 0 ? entry.energy / total_atoms : null
}

// Get energy value for an entry using a specific metric
// NOTE: We prioritize absolute energies (e_form_per_atom, energy_per_atom) over e_above_hull
// because polymorphs of the same composition on the hull all have e_above_hull=0
function get_entry_energy_by_metric(
  entry: PhaseData,
  metric: EnergyMetric,
): number | null {
  if (metric === `e_form_per_atom` && is_finite(entry.e_form_per_atom)) {
    return entry.e_form_per_atom
  }
  if (metric === `energy_per_atom`) {
    return is_finite(entry.energy_per_atom)
      ? entry.energy_per_atom
      : compute_energy_per_atom(entry)
  }
  if (metric === `e_above_hull` && is_finite(entry.e_above_hull)) {
    return entry.e_above_hull
  }
  return null
}

// Determine which energy metric to use for a composition group
// Returns the first metric that ALL entries in the group can provide
function select_group_energy_metric(polymorphs: PhaseData[]): EnergyMetric {
  // Try e_form_per_atom first (best for comparing polymorphs)
  if (polymorphs.every((entry) => is_finite(entry.e_form_per_atom))) {
    return `e_form_per_atom`
  }
  // Try energy_per_atom (either direct field or computed from total energy)
  if (
    polymorphs.every(
      (entry) =>
        is_finite(entry.energy_per_atom) || compute_energy_per_atom(entry) !== null,
    )
  ) return `energy_per_atom`
  // Last resort: e_above_hull (will fail to differentiate stable polymorphs with e_above_hull=0)
  if (polymorphs.every((entry) => is_finite(entry.e_above_hull))) return `e_above_hull`

  return null // No valid metric available for this group
}

// Pre-compute polymorph statistics for all entries at once (O(n²) but done once)
// Returns a Map keyed by entry_id for O(1) lookups during hover
export function compute_all_polymorph_stats(
  all_entries: PhaseData[],
): Map<string, PolymorphStats> {
  const stats_map = new Map<string, PolymorphStats>()
  const zero_stats = { total: 0, higher: 0, lower: 0, equal: 0 }

  // Group entries by fractional composition (normalized stoichiometry)
  const composition_groups = new Map<string, PhaseData[]>()
  for (const entry of all_entries) {
    const fractional = get_fractional_composition(entry.composition)
    const comp_key = Object.entries(fractional)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([elem, frac]) => `${elem}:${frac.toFixed(6)}`)
      .join(`|`)
    const group = composition_groups.get(comp_key) ?? []
    if (group.length === 0) composition_groups.set(comp_key, group)
    group.push(entry)
  }

  // Calculate stats for each polymorph group
  for (const polymorphs of composition_groups.values()) {
    // Select one consistent metric for the entire composition group
    const group_metric = select_group_energy_metric(polymorphs)

    // If no valid metric available, set all entries in group to zero stats
    if (group_metric === null) {
      for (const entry of polymorphs) {
        if (entry.entry_id) stats_map.set(entry.entry_id, zero_stats)
      }
      continue
    }

    // Compare entries using the consistent group metric
    for (const entry of polymorphs) {
      if (!entry.entry_id) continue

      const entry_energy = get_entry_energy_by_metric(entry, group_metric)
      if (entry_energy === null) {
        stats_map.set(entry.entry_id, zero_stats)
        continue
      }

      let [total, higher, lower, equal] = [0, 0, 0, 0]
      for (const other of polymorphs) {
        if (other === entry || other.entry_id === entry.entry_id) continue

        const other_energy = get_entry_energy_by_metric(other, group_metric)
        if (other_energy === null) continue

        total++
        if (other_energy > entry_energy) higher++
        else if (other_energy < entry_energy) lower++
        else equal++
      }

      stats_map.set(entry.entry_id, { total, higher, lower, equal })
    }
  }

  return stats_map
}

function apply_alpha_to_color(color: string, alpha: number): string {
  // Handle existing rgba format
  if (color.includes(`rgba`)) return color.replace(/[\d.]+\)$/, `${alpha})`)

  if (color.includes(`rgb(`)) { // Convert rgb to rgba
    return color.replace(/rgb\(/, `rgba(`).replace(/\)$/, `, ${alpha})`)
  }

  const hex_match = color.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) // Convert hex to rgba
  if (hex_match) {
    let hex = hex_match[1]
    // Expand short form (e.g., "03F") to full form (e.g., "0033FF")
    if (hex.length === 3) hex = [...hex].map((char) => char + char).join(``)

    const red = parseInt(hex.slice(0, 2), 16)
    const green = parseInt(hex.slice(2, 4), 16)
    const blue = parseInt(hex.slice(4, 6), 16)
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`
  }

  return color // Return unchanged if format not recognized
}

export function draw_highlight_effect(
  ctx: CanvasRenderingContext2D,
  projected: { x: number; y: number },
  size: number,
  container_scale: number,
  pulse_time: number,
  style: Required<HighlightStyle>,
): void {
  const { effect, color: hl_color, size_multiplier, opacity, pulse_speed } = style

  if (effect === `pulse`) {
    // Smooth pulsating effect with moderate size and opacity changes
    const pulse_val = 0.5 + 0.5 * Math.sin(pulse_time * pulse_speed)
    const hl_size = size * (size_multiplier + 0.5 * pulse_val) // Moderate pulse amplitude
    const hl_opacity = opacity * (0.5 + 0.5 * pulse_val) // Smooth opacity variation

    // Draw pulsating ring
    ctx.lineWidth = (1.5 + 1 * pulse_val) * container_scale
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, hl_size, 0, 2 * Math.PI)
    ctx.fillStyle = apply_alpha_to_color(hl_color, hl_opacity * 0.3)
    ctx.strokeStyle = apply_alpha_to_color(hl_color, hl_opacity)
    ctx.fill()
    ctx.stroke()
  } else if (effect === `glow`) {
    // Soft glow effect with layered circles for depth
    const hl_size = size * size_multiplier

    // Outer soft glow
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, hl_size * 1.3, 0, 2 * Math.PI)
    ctx.fillStyle = apply_alpha_to_color(hl_color, opacity * 0.15)
    ctx.fill()

    // Inner glow with stroke
    ctx.lineWidth = 1.5 * container_scale
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, hl_size, 0, 2 * Math.PI)
    ctx.fillStyle = apply_alpha_to_color(hl_color, opacity * 0.4)
    ctx.strokeStyle = apply_alpha_to_color(hl_color, opacity * 0.8)
    ctx.fill()
    ctx.stroke()
  } else if (effect === `size`) {
    // Simple size highlight with stroke
    const hl_size = size * size_multiplier
    ctx.lineWidth = 2 * container_scale
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, hl_size, 0, 2 * Math.PI)
    ctx.strokeStyle = hl_color
    ctx.stroke()
  }
  // effect === `color` is handled in the main drawing code
}

// Draw selection highlight for currently selected entry (with pulsing animation)
export function draw_selection_highlight(
  ctx: CanvasRenderingContext2D,
  projected: { x: number; y: number },
  base_size: number,
  container_scale: number,
  pulse_time: number,
  pulse_opacity: number,
): void {
  const highlight_size = base_size * (1.8 + 0.3 * Math.sin(pulse_time * 4))
  ctx.fillStyle = apply_alpha_to_color(`rgba(102, 240, 255, 1)`, pulse_opacity * 0.6)
  ctx.strokeStyle = apply_alpha_to_color(`rgba(102, 240, 255, 1)`, pulse_opacity)
  ctx.lineWidth = 2 * container_scale
  ctx.beginPath()
  ctx.arc(projected.x, projected.y, highlight_size, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
}

// Get text color for canvas rendering. Canvas 2D context doesn't understand CSS functions
// like light-dark() or var(), so we fall back to appropriate colors based on dark mode.
export function get_canvas_text_color(
  dark_mode: boolean,
  element?: HTMLElement | null,
): string {
  const fallback = dark_mode ? `#ffffff` : `#212121`
  if (typeof document === `undefined`) return fallback
  const css_value = getComputedStyle(element ?? document.documentElement)
    .getPropertyValue(`--text-color`)?.trim()
  // Check for unsupported CSS functions that canvas can't render
  return css_value && !/light-dark|var\(/i.test(css_value) ? css_value : fallback
}

// Create a Path2D for a marker symbol. Uses d3-shape for consistent rendering with ScatterPlot.
export function create_marker_path(
  size: number,
  marker: MarkerSymbol = `circle`,
): Path2D {
  // Capitalize first letter to get D3 symbol name (e.g., 'circle' -> 'Circle')
  const d3_name = marker.charAt(0).toUpperCase() + marker.slice(1)
  const symbol_type = symbol_map[d3_name as keyof typeof symbol_map]

  if (!symbol_type) {
    const path = new Path2D()
    path.arc(0, 0, size, 0, 2 * Math.PI)
    return path
  }

  const symbol_area = Math.PI * size * size
  const path_data = symbol().type(symbol_type).size(symbol_area)()

  if (!path_data) {
    const path = new Path2D()
    path.arc(0, 0, size, 0, 2 * Math.PI)
    return path
  }

  return new Path2D(path_data)
}

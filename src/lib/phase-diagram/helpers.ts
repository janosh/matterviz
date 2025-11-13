import type { ElementSymbol, EnergyModeInfo } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import { get_page_background } from '$lib/colors'
import { elem_symbol_to_name } from '$lib/composition'
import { format_fractional, format_num } from '$lib/labels'
import { scaleSequential } from 'd3-scale'
import * as d3_sc from 'd3-scale-chromatic'
import type { HighlightStyle, PhaseData, PhaseDiagramConfig } from './types'
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

// Build a tooltip text for any phase entry (shared)
export function build_entry_tooltip_text(entry: PhaseData): string {
  const is_element = is_unary_entry(entry)
  const elem_symbol = is_element ? Object.keys(entry.composition)[0] : ``

  const elem_name = is_element
    ? elem_symbol_to_name[elem_symbol as ElementSymbol] ?? ``
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
  color: `#6cf0ff`,
  size_multiplier: 1.8,
  opacity: 0.6,
  pulse_speed: 4,
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

// Check if two fractional compositions are equal (within numerical tolerance)
function are_fractional_compositions_equal(
  comp1: Record<string, number>,
  comp2: Record<string, number>,
  tolerance = 1e-6, // for comparing fractional compositions (due to floating-point precision)
): boolean {
  const keys1 = Object.keys(comp1)
  const keys2 = Object.keys(comp2)
  if (keys1.length !== keys2.length) return false
  for (const key of keys1) {
    if (!(key in comp2)) return false
    if (Math.abs(comp1[key] - comp2[key]) > tolerance) return false
  }
  return true
}

// Calculate polymorph statistics for a given entry among all entries
export function calculate_polymorph_stats(
  entry: PhaseData,
  all_entries: PhaseData[],
): { total: number; higher: number; lower: number; equal: number } {
  const entry_fractional = get_fractional_composition(entry.composition)

  // First, collect all polymorphs (entries with same fractional composition)
  const polymorphs = [entry]
  for (const other of all_entries) {
    if (other === entry) continue
    if (entry.entry_id && other.entry_id === entry.entry_id) continue

    const other_fractional = get_fractional_composition(other.composition)
    if (are_fractional_compositions_equal(entry_fractional, other_fractional)) {
      polymorphs.push(other)
    }
  }

  // Determine if all polymorphs have e_above_hull
  const all_have_hull = polymorphs.every(
    (phase) =>
      typeof phase.e_above_hull === `number` && Number.isFinite(phase.e_above_hull),
  )

  // Function to get comparable energy for an entry
  const get_comparable_energy = (phase: PhaseData): number | null => {
    if (all_have_hull) {
      // Use e_above_hull if all polymorphs have it
      return phase.e_above_hull ?? null
    }
    // Otherwise use per-atom energy
    if (
      typeof phase.energy_per_atom === `number` &&
      Number.isFinite(phase.energy_per_atom)
    ) {
      return phase.energy_per_atom
    }
    // Fall back to energy / total_atoms
    if (typeof phase.energy === `number` && Number.isFinite(phase.energy)) {
      const total_atoms = Object.values(phase.composition).reduce(
        (sum, amt) => sum + amt,
        0,
      )
      if (total_atoms > 0) {
        return phase.energy / total_atoms
      }
    }
    return null
  }

  const entry_energy = get_comparable_energy(entry)
  if (entry_energy === null) {
    return { total: 0, higher: 0, lower: 0, equal: 0 }
  }

  let total = 0
  let higher = 0 // count of polymorphs with higher energy (less stable)
  let lower = 0 // count of polymorphs with lower energy (more stable)
  let equal = 0 // count of polymorphs with equal energy

  for (const other of polymorphs) {
    // Skip the entry itself
    if (other === entry) continue
    if (entry.entry_id && other.entry_id === entry.entry_id) continue

    const other_energy = get_comparable_energy(other)
    if (other_energy === null) continue

    total += 1

    if (other_energy > entry_energy) higher += 1
    else if (other_energy < entry_energy) lower += 1
    else equal += 1
  }

  return { total, higher, lower, equal }
}

function apply_alpha_to_color(color: string, alpha: number): string {
  if (color.includes(`rgba`)) return color.replace(/[\d.]+\)$/, `${alpha})`)
  if (color.includes(`rgb(`)) {
    return color.replace(/rgb\(/, `rgba(`).replace(/\)$/, `, ${alpha})`)
  }

  const hex_match = color.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (hex_match) {
    let hex = hex_match[1]
    if (hex.length === 3) hex = hex.split(``).map((c) => c + c).join(``)
    const [red, green, blue] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`
  }
  return color
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
  const pulse_val = effect === `pulse`
    ? 0.5 + 0.5 * Math.sin(pulse_time * pulse_speed)
    : 0
  const hl_size = size * (size_multiplier + (effect === `pulse` ? 0.3 * pulse_val : 0))
  const hl_opacity = opacity * (effect === `pulse` ? 0.6 + 0.4 * pulse_val : 1)

  if (effect !== `color`) {
    ctx.lineWidth = 2 * container_scale
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, hl_size, 0, 2 * Math.PI)

    if (effect === `size`) {
      ctx.strokeStyle = hl_color
      ctx.stroke()
    } else {
      // pulse or glow - apply opacity to the color
      ctx.fillStyle = apply_alpha_to_color(hl_color, hl_opacity * 0.6)
      ctx.strokeStyle = apply_alpha_to_color(hl_color, hl_opacity)
      ctx.fill()
      ctx.stroke()
    }
  }
}

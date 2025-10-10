import type { ElementSymbol, EnergyModeInfo } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import { elem_symbol_to_name } from '$lib/composition'
import { format_fractional, format_num } from '$lib/labels'
import { scaleSequential } from 'd3-scale'
import * as d3_sc from 'd3-scale-chromatic'
import type { PhaseDiagramConfig, PhaseEntry } from './types'
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
): Promise<PhaseEntry[] | null> {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (!file?.name.endsWith(`.json`)) return null
  try {
    const data = JSON.parse(await file.text()) as PhaseEntry[]
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
  processed_entries: PhaseEntry[],
): number {
  if (processed_entries.length === 0) return 0.5
  const hull_distances = processed_entries
    .map((e) => e.e_above_hull)
    .filter((v): v is number => typeof v === `number` && Number.isFinite(v))
  const max_val = (hull_distances.length ? Math.max(...hull_distances) : 0) + 0.001
  return Math.max(0.1, max_val)
}

// Build a tooltip text for any phase entry (shared)
export function build_entry_tooltip_text(entry: PhaseEntry): string {
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

// Compute energy source mode information for phase diagram entries. Returns energy mode information including capability flags and resolved mode.
// This determines whether we can use precomputed energies or need to compute on-the-fly.
export function compute_energy_mode_info(
  entries: PhaseEntry[], // Array of phase entries to analyze
  find_lowest_energy_unary_refs_fn: (entries: PhaseEntry[]) => Record<string, PhaseEntry>, // Function to find unary references
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
  entries: PhaseEntry[], // Original phase entries
  energy_mode: `precomputed` | `on-the-fly`, // Energy source mode (precomputed or on-the-fly)
  unary_refs: Record<string, PhaseEntry>, // Unary reference entries for energy computation
  compute_e_form_fn: (
    entry: PhaseEntry,
    unary_refs: Record<string, PhaseEntry>,
  ) => number | null, // Function to compute formation energy per atom
): PhaseEntry[] {
  if (energy_mode === `precomputed`) return entries

  return entries.map((entry) => {
    const e_form = compute_e_form_fn(entry, unary_refs)
    if (e_form === null) return entry
    return { ...entry, e_form_per_atom: e_form }
  })
}

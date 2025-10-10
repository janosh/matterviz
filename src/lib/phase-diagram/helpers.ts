import type { ElementSymbol } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import { elem_symbol_to_name } from '$lib/composition'
import { format_fractional, format_num } from '$lib/labels'
import { scaleSequential } from 'd3-scale'
import * as d3_sc from 'd3-scale-chromatic'
import type { PDControlsType, PhaseDiagramConfig, PhaseEntry } from './types'
import { is_unary_entry } from './types'

// Default legend configuration shared by 3D and 4D diagrams
export const default_controls: PDControlsType = {
  title: ``,
  show: true,
  position: `top-right`,
  width: 280,
  show_counts: true,
  show_color_toggle: true,
  show_label_controls: true,
}

// Phase diagram defaults shared by 2D, 3D, and 4D
export const default_pd_config: PhaseDiagramConfig = {
  width: 600,
  height: 600,
  unstable_threshold: 0.2,
  show_labels: true,
  show_hull: true,
  point_size: 8,
  line_width: 2,
  font_size: 12,
  colors: {
    stable: `#0072B2`,
    unstable: `#E69F00`,
    hull_line: `var(--accent-color, #1976D2)`,
    background: `transparent`,
    text: `var(--text-color, #212121)`,
    edge: `var(--text-color, #212121)`,
    tooltip_bg: `var(--tooltip-bg, rgba(0, 0, 0, 0.85))`,
    tooltip_text: `var(--tooltip-text, white)`,
    annotation: `var(--text-color, #212121)`,
  },
}

// Shared PD styles (single source of truth shared by 2D, 3D, and 4D)
export const PD_STYLE = Object.freeze({
  structure_line: Object.freeze({
    color: `rgba(128, 128, 128, 0.6)`,
    dash: [3, 3] as [number, number],
    line_width: 2,
  }),
  z_index: Object.freeze({
    tooltip: 6000,
    copy_feedback: 10000,
  }),
})

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
export function compute_max_energy_threshold(processed_entries: PhaseEntry[]): number {
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

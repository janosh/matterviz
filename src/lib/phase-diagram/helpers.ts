import type { ElementSymbol } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import { elem_symbol_to_name } from '$lib/composition'
import { format_fractional, format_num } from '$lib/labels'
import { scaleSequential } from 'd3-scale'
import * as d3_sc from 'd3-scale-chromatic'
import type { PDLegendConfig, PhaseDiagramConfig, PhaseEntry } from './types'

// Default legend configuration shared by 3D and 4D diagrams
export const default_legend: PDLegendConfig = {
  title: ``,
  show: true,
  position: `top-right`,
  width: 280,
  show_counts: true,
  show_color_toggle: true,
  show_label_controls: true,
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
export function compute_energy_color_scale(
  color_mode: `stability` | `energy`,
  color_scale: D3InterpolateName,
  plot_entries: Array<{ e_above_hull?: number }>,
): ((value: number) => string) | null {
  if (color_mode !== `energy` || plot_entries.length === 0) return null
  const distances = plot_entries.map((entry) => entry.e_above_hull ?? 0)
  const lo = Math.min(...distances)
  const hi_raw = Math.max(...distances, 0.1)
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
  return energy_scale ? energy_scale(entry.e_above_hull || 0) : `#666`
}

// Robust drag-and-drop JSON parsing for phase diagram entries
export async function parse_phase_diagram_drop(
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
  const max_val = Math.max(...processed_entries.map((e) => e.e_above_hull || 0)) + 0.001
  return Math.max(0.1, max_val)
}

// Build a tooltip text for any phase entry (shared)
export function build_tooltip_text(entry: PhaseEntry): string {
  const is_element = Object.keys(entry.composition).length === 1
  const elem_symbol = is_element ? Object.keys(entry.composition)[0] : ``

  let text = is_element
    ? `${elem_symbol} (${elem_symbol_to_name[elem_symbol as ElementSymbol]})\n`
    : `${entry.name || entry.reduced_formula || ``}\n`

  if (!is_element) {
    const total = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)
    const fractions = Object.entries(entry.composition)
      .filter(([, amt]) => amt > 0)
      .map(([el, amt]) => `${el}: ${format_fractional(amt / total)}`)
    if (fractions.length > 1) text += `Composition: ${fractions.join(`, `)}\n`
  }

  if (entry.e_above_hull !== undefined) {
    const e_hull_str = format_num(entry.e_above_hull, `.3~`)
    text += `E above hull: ${e_hull_str} eV/atom\n`
  }
  if (entry.e_form_per_atom !== undefined) {
    const e_form_str = format_num(entry.e_form_per_atom, `.3~`)
    text += `Formation Energy: ${e_form_str} eV/atom`
  }
  if (entry.entry_id) text += `\nID: ${entry.entry_id}`
  return text
}

// Generic mouse hit-testing for projected 3D points (shared)
export function find_entry_at_mouse<
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

// Phase statistics (supports ternary and quaternary via max_arity)
export function compute_phase_stats(
  processed_entries: PhaseEntry[],
  elements: ElementSymbol[],
  max_arity: 3 | 4,
): {
  total: number
  unary: number
  binary: number
  ternary: number
  quaternary: number
  stable: number
  unstable: number
  energy_range: { min: number; max: number; avg: number }
  hull_distance: { max: number; avg: number }
  elements: number
  chemical_system: string
} | null {
  if (!processed_entries || processed_entries.length === 0) return null

  const composition_counts = (max_arity === 4 ? [1, 2, 3, 4] : [1, 2, 3]).map((target) =>
    processed_entries.filter((entry) =>
      Object.keys(entry.composition).filter((el) => entry.composition[el] > 0).length ===
        target
    ).length
  )
  const [unary, binary, ternary, quaternaryMaybe] = composition_counts as [
    number,
    number,
    number,
    number?,
  ]
  const quaternary = max_arity === 4 ? (quaternaryMaybe ?? 0) : 0

  const stable_count =
    processed_entries.filter((e) => e.is_stable || (e.e_above_hull ?? 0) < 1e-6).length
  const unstable_count = processed_entries.length - stable_count

  const energies = processed_entries
    .map((e) => e.e_form_per_atom || e.energy_per_atom)
    .filter((v): v is number => v !== null)

  const energy_range = energies.length > 0
    ? {
      min: Math.min(...energies),
      max: Math.max(...energies),
      avg: energies.reduce((a, b) => a + b, 0) / energies.length,
    }
    : { min: 0, max: 0, avg: 0 }

  const hull_distances = processed_entries.map((e) => e.e_above_hull || 0).filter((v) =>
    v >= 0
  )
  const hull_distance = hull_distances.length > 0
    ? {
      max: Math.max(...hull_distances),
      avg: hull_distances.reduce((a, b) => a + b, 0) / hull_distances.length,
    }
    : { max: 0, avg: 0 }

  return {
    total: processed_entries.length,
    unary,
    binary,
    ternary,
    quaternary,
    stable: stable_count,
    unstable: unstable_count,
    energy_range,
    hull_distance,
    elements: elements.length,
    chemical_system: elements.join(`-`),
  }
}

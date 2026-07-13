import { type D3InterpolateName, get_d3_interpolator } from '$lib/colors'
import { extract_formula_elements } from '$lib/composition/parse'
import type { PhaseData } from '$lib/convex-hull/types'
import type { Vec2 } from '$lib/math'
import { scaleSequential } from 'd3-scale'
import { best_form_energy_for_formula, type FormulaEnergyStats } from './compute'
import type { ChemPotColorMode } from './types'

// Categorical palette for arity mode (element count)
export const ARITY_COLORS = [`#3498db`, `#2ecc71`, `#e67e22`, `#9b59b6`] as const

const COLOR_MODE_LABELS: Record<string, string> = {
  energy: `Energy per atom (eV)`,
  formation_energy: `Formation energy (eV/atom)`,
  entries: `Entry count`,
}

// Resolve D3 interpolator with optional reverse for chempot color scales.
function get_chempot_interpolator(
  name: D3InterpolateName,
  reverse: boolean,
): (frac: number) => string {
  const raw = get_d3_interpolator(name)
  return reverse ? (frac: number) => raw(1 - frac) : raw
}

// Build sequential color scale from values and D3 interpolator name.
function make_chempot_color_scale(
  values: number[],
  interpolator_name: D3InterpolateName,
  reverse: boolean,
): ((val: number) => string) | null {
  const finite_values = values.filter(Number.isFinite)
  if (finite_values.length === 0) return null
  let [min_value, max_raw_value] = [finite_values[0], finite_values[0]]
  for (let idx = 1; idx < finite_values.length; idx++) {
    if (finite_values[idx] < min_value) min_value = finite_values[idx]
    if (finite_values[idx] > max_raw_value) max_raw_value = finite_values[idx]
  }
  const max_value = Math.max(max_raw_value, min_value + 1e-6)
  return scaleSequential(get_chempot_interpolator(interpolator_name, reverse)).domain([
    min_value,
    max_value,
  ])
}

// Resolve color bar props for chempot diagrams (interpolator + domain).
export function get_chempot_color_bar_config(
  color_scale: D3InterpolateName,
  reverse: boolean,
): { color_scale_fn: (frac: number) => string; color_scale_domain: Vec2 } {
  return {
    color_scale_fn: get_chempot_interpolator(color_scale, reverse),
    color_scale_domain: [0, 1],
  }
}

export interface ChemPotDomainColorData {
  colors: Map<string, string>
  // min/max of the active numeric mode's values, null for none/arity (categorical)
  color_range: { min: number; max: number; label: string } | null
}

// Per-formula domain colors plus color-bar range for the active color mode.
// Shared by ChemPotDiagram2D and ChemPotDiagram3D.
export function get_domain_color_data(opts: {
  formulas: string[]
  color_mode: ChemPotColorMode
  color_scale: D3InterpolateName
  reverse_color_scale: boolean
  // Entries + raw (non-renormalized) elemental refs for formation energy lookups
  entries: PhaseData[]
  el_refs: Record<string, PhaseData>
  energy_stats: Map<string, FormulaEnergyStats>
}): ChemPotDomainColorData {
  const { formulas, color_mode, entries, el_refs, energy_stats } = opts
  const colors = new Map<string, string>()
  if (color_mode === `none`) return { colors, color_range: null }

  if (color_mode === `arity`) {
    for (const formula of formulas) {
      const n_elements = extract_formula_elements(formula).length
      const color_idx = Math.min(n_elements, ARITY_COLORS.length) - 1
      colors.set(formula, ARITY_COLORS[Math.max(0, color_idx)])
    }
    return { colors, color_range: null }
  }

  const get_value = (formula: string): number | null => {
    if (color_mode === `energy`) {
      return energy_stats.get(formula)?.min_energy_per_atom ?? null
    }
    if (color_mode === `formation_energy`) {
      return best_form_energy_for_formula(entries, formula, el_refs) ?? null
    }
    return energy_stats.get(formula)?.matching_entry_count ?? 0
  }

  const value_by_formula = new Map<string, number>()
  for (const formula of formulas) {
    const value = get_value(formula)
    if (value == null || !Number.isFinite(value)) continue
    value_by_formula.set(formula, value)
  }
  const values = [...value_by_formula.values()]
  const scale = make_chempot_color_scale(values, opts.color_scale, opts.reverse_color_scale)
  for (const formula of formulas) {
    const value = value_by_formula.get(formula)
    colors.set(formula, value != null && scale ? scale(value) : `#999`)
  }

  if (values.length === 0) return { colors, color_range: null }
  let [min_val, max_val] = [values[0], values[0]]
  for (const value of values) {
    if (value < min_val) min_val = value
    if (value > max_val) max_val = value
  }
  return {
    colors,
    color_range: {
      min: min_val,
      max: Math.max(max_val, min_val + 1e-6),
      label: COLOR_MODE_LABELS[color_mode],
    },
  }
}

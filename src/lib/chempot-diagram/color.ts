import { type D3InterpolateName, get_d3_interpolator } from '$lib/colors'
import { extract_formula_elements } from '$lib/composition/parse'
import type { PhaseData } from '$lib/convex-hull/types'
import { array_extent } from '$lib/math'
import { group } from 'd3-array'
import { scaleSequential } from 'd3-scale'
import {
  best_form_energy_for_formula as best_form_energy,
  formula_key_from_composition,
} from './compute'
import type { FormulaEnergyStats } from './compute'
import type { ChemPotColorMode } from './types'

// Categorical palette for arity mode (element count), one swatch per ARITY_LABELS row
export const ARITY_COLORS = [`#3498db`, `#2ecc71`, `#e67e22`, `#9b59b6`] as const
const ARITY_LABELS = [`Unary`, `Binary`, `Ternary`, `4+`] as const

// Legend rows for arity mode, up to the highest element count among the drawn domains
export const arity_legend_labels = (formulas: string[]): string[] => {
  const max_arity = Math.max(
    1,
    ...formulas.map((formula) => extract_formula_elements(formula).length),
  )
  return ARITY_LABELS.slice(0, Math.min(max_arity, ARITY_LABELS.length))
}

// Exhaustively typed over the numeric color modes so adding a new mode
// fails compilation here instead of rendering an undefined colorbar title
const COLOR_MODE_LABELS: Record<Exclude<ChemPotColorMode, `none` | `arity`>, string> = {
  energy: `Energy per atom (eV)`,
  formation_energy: `Formation energy (eV/atom)`,
  entries: `Entry count`,
}

// Resolve D3 interpolator with optional reverse for chempot color scales.
export function get_chempot_interpolator(
  name: D3InterpolateName,
  reverse: boolean,
): (frac: number) => string {
  const raw = get_d3_interpolator(name)
  return reverse ? (frac: number) => raw(1 - frac) : raw
}

// min/max of the active numeric mode's values with the colour-bar title
export interface ChemPotColorRange {
  min: number
  max: number
  label: string
}

interface ChemPotDomainColorData {
  colors: Map<string, string>
  color_range: ChemPotColorRange | null // null for none/arity (categorical)
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

  const entries_by_formula =
    color_mode === `formation_energy`
      ? group(entries, (entry) => formula_key_from_composition(entry.composition))
      : new Map<string, PhaseData[]>()

  const get_value = (formula: string): number | null => {
    if (color_mode === `energy`) return energy_stats.get(formula)?.min_energy_per_atom ?? null
    if (color_mode === `formation_energy`) {
      return best_form_energy(entries_by_formula.get(formula) ?? [], formula, el_refs) ?? null
    }
    return energy_stats.get(formula)?.matching_entry_count ?? 0
  }

  const value_by_formula = new Map<string, number>()
  for (const formula of formulas) {
    const value = get_value(formula)
    if (value !== null && Number.isFinite(value)) value_by_formula.set(formula, value)
  }
  const values = [...value_by_formula.values()]
  if (values.length === 0) {
    for (const formula of formulas) colors.set(formula, `#999`)
    return { colors, color_range: null }
  }
  const [min_val, max_raw] = array_extent(values)
  const max_val = Math.max(max_raw, min_val + 1e-6) // a flat range still needs a domain
  const scale = scaleSequential(
    get_chempot_interpolator(opts.color_scale, opts.reverse_color_scale),
  ).domain([min_val, max_val])
  for (const formula of formulas) {
    const value = value_by_formula.get(formula)
    colors.set(formula, value === undefined ? `#999` : scale(value))
  }
  return {
    colors,
    color_range: { min: min_val, max: max_val, label: COLOR_MODE_LABELS[color_mode] },
  }
}

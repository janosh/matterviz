import { format_recipe_text } from './recipe'
// Agent-facing surface: a JSON schema for the request (drop-in tool `input_schema`), a compact
// text rendering of a plan for the model channel, and a ready-made tool definition. The full
// SynthesisPlan object is the structured channel; `format_plan_text` deliberately repeats only
// what a model needs to reason and reply.
import { GAS_SPECIES } from '$lib/convex-hull/types'
import { format_num, plural } from '$lib/labels'
import { format_mev } from './format-mev'
import { DEFAULT_SCORE_WEIGHTS } from './scoring'
import type { SynthesisPlan, SynthesisRoute } from './types'

// JSON Schema (draft 2020-12 compatible subset) for SynthesisPlanRequest minus `entries`, which
// callers normally inject from their own data source rather than have the model type out
export const SYNTHESIS_PLAN_REQUEST_SCHEMA = {
  type: `object`,
  additionalProperties: false,
  required: [`target`],
  properties: {
    target: {
      type: `string`,
      pattern: `\\S`,
      description: `Target phase as a formula (e.g. "LiCoO2", "BaTiO3") or an entry id present in the thermodynamic data. A formula picks the lowest-energy matching entry.`,
    },
    max_precursors: {
      type: `integer`,
      minimum: 1,
      maximum: 4,
      default: 2,
      description: `Largest number of precursors combined in one firing. 1 also finds single-precursor decomposition routes, 3-4 are slower and rarely cleaner.`,
    },
    two_step: {
      type: `boolean`,
      default: false,
      description: `Also search two-step routes: synthesize an intermediate first, then react it on to the target. Useful when every direct route has a more favorable competing phase.`,
    },
    conditions: {
      type: `object`,
      additionalProperties: false,
      properties: {
        temperature: {
          type: `number`,
          minimum: 0,
          maximum: 2000,
          default: 0,
          description: `Firing temperature in K. Solids keep their 0 K computed energies; gases get μ(T, p) so carbonate/hydroxide decomposition and O2 release become temperature dependent.`,
        },
        open_species: {
          type: `array`,
          items: { type: `string`, enum: [...GAS_SPECIES] },
          description: `Gases the reaction may release to or take from the atmosphere, e.g. ["O2", "CO2"] for firing carbonates in air. Required for precursors containing elements absent from the target (C in Li2CO3, H in LiOH).`,
        },
        partial_pressures: {
          type: `object`,
          additionalProperties: false,
          properties: Object.fromEntries(
            GAS_SPECIES.map((gas) => [gas, { type: `number`, exclusiveMinimum: 0 }]),
          ),
          description: `Partial pressures in bar. Default is ambient air (O2 0.21, CO2 4e-4, H2O 0.03).`,
        },
      },
    },
    precursors: {
      type: `object`,
      additionalProperties: false,
      properties: {
        allow: {
          type: `array`,
          items: { type: `string` },
          description: `Only these formulas/entry ids may be precursors (e.g. what is on the shelf).`,
        },
        block: {
          type: `array`,
          items: { type: `string` },
          description: `Never use these formulas/entry ids as precursors.`,
        },
        max_e_above_hull: {
          type: `number`,
          minimum: 0,
          default: 0.03,
          description: `Max 0 K hull distance (eV/atom) for a phase to count as an obtainable precursor.`,
        },
        only_common: {
          type: `boolean`,
          description: `Restrict to the built-in library of commercial precursors (carbonates, oxides, hydroxides, ...). Default: true when the library covers every target element.`,
        },
        max_elements: {
          type: `integer`,
          minimum: 1,
          description: `Max distinct elements per precursor. Default: one fewer than the target; library precursors always pass.`,
        },
      },
    },
    scoring: {
      type: `object`,
      additionalProperties: false,
      description: `Override ranking weights (defaults: selectivity 3, inverse_hull 2, driving_force 0.5, competition 1, practicality 2, simplicity 0.5).`,
      properties: Object.fromEntries(
        Object.keys(DEFAULT_SCORE_WEIGHTS).map((key) => [key, { type: `number`, minimum: 0 }]),
      ),
    },
    max_routes: { type: `integer`, minimum: 1, maximum: 200, default: 20 },
    keep_route_ids: {
      type: `array`,
      items: { type: `string` },
      description: `Also return these evaluated routes outside the top-ranked limit.`,
    },
    target_mass_g: {
      type: `number`,
      exclusiveMinimum: 0,
      default: 1,
      description: `Target mass the recipe quantities are scaled to.`,
    },
  },
} as const

export const SYNTHESIS_PLANNER_TOOL = {
  name: `plan_synthesis`,
  description: `Rank solid-state synthesis routes to a target inorganic phase from simulated convex-hull data (formation energies per atom from DFT, ML potentials or experiment). For every precursor set it balances the reaction (with optional gas release/uptake), computes the reaction energy, the competing phases that can form from the same mixture with their driving forces, the inverse hull energy (https://doi.org/10.1038/s44160-024-00502-y), the temperature at which gas-releasing reactions turn favorable, and an experiment card (calculated masses for each step, unreferenced precursor-library notes, editable experimental assumptions and checkpoints). Returns routes best-first with per-term score breakdowns and plain-language rationale. Needs thermodynamic entries covering the target's chemical system plus any precursor-only elements (C for carbonates, H for hydroxides) and the corresponding open_species.`,
  input_schema: SYNTHESIS_PLAN_REQUEST_SCHEMA,
} as const

export function format_route_text(route: SynthesisRoute, rank?: number): string {
  const { reaction, selectivity, thermodynamics, practicality } = route
  const lines: string[] = []
  const header = `${rank === undefined ? `` : `${rank}. `}${reaction.equation}  (score ${format_num(route.score, `.2~f`)}${
    route.kind === `two_step` ? `, two-step` : ``
  })`
  lines.push(header)
  if (route.intermediate_step)
    lines.push(`   step 1: ${route.intermediate_step.reaction.equation}`)
  const onset_text = thermodynamics.onset_temperature
    ? `, favorable above ${thermodynamics.onset_temperature} K`
    : ``
  lines.push(
    `   ΔE ${format_mev(reaction.energy_per_atom)} (${format_num(reaction.energy_per_fu, `.2~f`)} eV/fu)${onset_text}; gas exchange: ${thermodynamics.atmosphere}`,
  )
  const competitor_text = selectivity.competitors
    .slice(0, 4)
    .map(
      (comp) =>
        `${comp.phase.formula} ${format_mev(comp.driving_force)}${comp.more_favorable_than_target ? `*` : ``}`,
    )
    .join(`, `)
  const competitor_list = competitor_text ? ` [${competitor_text}]` : ` (none can form)`
  lines.push(
    `   selectivity: target ${format_mev(selectivity.target_driving_force)}, inverse hull ${format_mev(selectivity.inverse_hull_energy)}, ${plural(selectivity.n_more_favorable, `competitor`)} more favorable${competitor_list}`,
  )
  const non_target = selectivity.interfaces.filter((iface) => !iface.forms_target)
  if (selectivity.interfaces.length > 1 && non_target.length) {
    lines.push(
      `   interfaces: ${non_target
        .map(
          (iface) =>
            `${iface.precursors[0].formula}|${iface.precursors[1].formula} → ${iface.first_product?.phase.formula ?? `nothing`}`,
        )
        .join(`; `)}`,
    )
  }
  lines.push(format_recipe_text(route))
  if (practicality.notes.length) {
    lines.push(
      `   practicality ${format_num(practicality.score, `.2~f`)}: ${practicality.notes.slice(0, 3).join(`; `)}`,
    )
  }
  return lines.join(`\n`)
}

// Compact plain-text summary sized for a model's context: conditions, target stability, the top
// routes with their key numbers, and what was rejected. `*` marks competitors more favorable than
// the target.
export function format_plan_text(plan: SynthesisPlan, max_routes = 5): string {
  const { target, conditions, target_stability, routes, rejected } = plan
  const lines: string[] = []
  const atmosphere = conditions.open_species.length
    ? `open to ${conditions.open_species
        .map((gas) => `${gas} (${conditions.partial_pressures[gas]} bar)`)
        .join(`, `)}`
    : `closed system`
  lines.push(
    `Synthesis plan for ${target.formula} (${target.id}) in ${plan.chemical_system} at ${conditions.temperature} K, ${atmosphere}.`,
    target_stability.is_stable
      ? `Target is on the hull at these conditions.`
      : `Target is ${format_mev(target_stability.e_above_hull)} above the hull; decomposes to ${target_stability.decomposition
          .map(
            ({ phase, atom_fraction }) =>
              `${phase.formula} (${format_num(100 * atom_fraction, `.0f`)}%)`,
          )
          .join(` + `)}.`,
    `Precursor pool (${plan.precursor_pool.length}): ${plan.precursor_pool.map((phase) => phase.formula).join(`, `)}.`,
  )
  const n_rejected = Object.values(rejected).reduce((sum, count) => sum + count, 0)
  lines.push(
    `Evaluated ${plan.n_candidates} precursor sets: ${plural(routes.length, `viable route`)}, ${n_rejected} rejected (${
      Object.entries(rejected)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => `${count} ${reason}`)
        .join(`, `) || `none`
    }).`,
  )
  if (routes.length === 0) {
    lines.push(
      `No viable route. Widen the precursor pool, add open_species, or raise the temperature.`,
    )
  } else {
    lines.push(
      ``,
      `Top routes (ΔE per target atom; competitor driving forces per reactant atom, * = beats target):`,
    )
    routes
      .slice(0, max_routes)
      .forEach((route, idx) => lines.push(format_route_text(route, idx + 1)))
    if (routes.length > max_routes)
      lines.push(`… ${routes.length - max_routes} more routes in the structured result.`)
  }
  if (plan.warnings.length) lines.push(``, `Warnings: ${plan.warnings.join(` | `)}`)
  return lines.join(`\n`)
}

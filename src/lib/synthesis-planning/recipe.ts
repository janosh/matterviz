// Turn a balanced, evaluated reaction into bench quantities and a heating schedule template.
// Every heuristic that feeds the temperature window is named in `basis` so users and agents can
// weigh it; the thermodynamic onset comes from the planner, the rest from the precursor library.
import { format_num } from '$lib/labels'
import { lookup_precursor_info } from './precursor-library'
import type { SynthesisReaction, Recipe, RecipeItem, RouteThermodynamics } from './types'

// Kinetic margin above the thermodynamic onset: solid-state reactions need a driving force and
// diffusion, so firing right at ΔG = 0 is too cold
const ONSET_MARGIN_K = 100
// Tammann's rule: appreciable solid-state diffusion from about two thirds of the melting point
const TAMMANN_FRACTION = 2 / 3

const round_to = (value: number, step: number): number => Math.round(value / step) * step

export function build_recipe(
  reaction: SynthesisReaction,
  thermodynamics: RouteThermodynamics,
  target_mass_g: number,
): Recipe {
  const target_species = reaction.products[0]
  const target = target_species.phase
  const target_moles = target_mass_g / target.molar_mass
  // Coefficients are per `target_species.coefficient` formula units of target
  const moles_per_coefficient = target_moles / target_species.coefficient

  const items: RecipeItem[] = []
  for (const { phase, coefficient } of reaction.reactants) {
    const moles = coefficient * moles_per_coefficient
    const role = phase.is_gas ? `atmosphere` : `precursor`
    items.push({ phase, role, moles, mass_g: moles * phase.molar_mass })
  }
  items.push({ phase: target, role: `target`, moles: target_moles, mass_g: target_mass_g })
  for (const { phase, coefficient } of reaction.products.slice(1)) {
    const moles = coefficient * moles_per_coefficient
    items.push({ phase, role: `byproduct`, moles, mass_g: moles * phase.molar_mass })
  }
  const precursor_mass = items
    .filter((item) => item.role === `precursor`)
    .reduce((sum, item) => sum + item.mass_g, 0)
  for (const item of items) {
    if (item.role === `precursor`) item.mass_fraction = item.mass_g / precursor_mass
  }
  // Positive = mass lost as gas, negative = mass gained from the atmosphere
  const mass_by_role = (role: RecipeItem[`role`]): number =>
    items.filter((item) => item.role === role).reduce((sum, item) => sum + item.mass_g, 0)
  const mass_loss_percent =
    (100 * (mass_by_role(`byproduct`) - mass_by_role(`atmosphere`))) / precursor_mass

  // === Temperature window ===
  const basis: string[] = []
  const min_candidates: number[] = []
  const max_candidates: number[] = []
  const onset = thermodynamics.onset_temperature
  if (onset !== null && onset > 0) {
    min_candidates.push(onset + ONSET_MARGIN_K)
    basis.push(
      `thermodynamic onset ${onset} K at the given partial pressures + ${ONSET_MARGIN_K} K kinetic margin`,
    )
  }
  const precursors = reaction.reactants.filter(({ phase }) => !phase.is_gas)
  const infos = precursors.flatMap(({ phase }) => {
    const info = lookup_precursor_info(phase.formula)
    return info ? [{ formula: phase.formula, info }] : []
  })
  const released = new Set(reaction.products.slice(1).map(({ phase }) => phase.formula))
  for (const { formula, info } of infos) {
    if (info.decomposition_K && info.releases?.some((gas) => released.has(gas))) {
      min_candidates.push(info.decomposition_K)
      basis.push(
        `${formula} releases ${info.releases.join(`/`)} from ~${info.decomposition_K} K`,
      )
    }
    if (info.melting_K) {
      max_candidates.push(info.melting_K - 50)
      basis.push(
        `stay below ${formula} melting point (${info.melting_K} K) for a solid-state reaction`,
      )
    }
  }
  const melting_points = infos.flatMap(({ info }) => info.melting_K ?? [])
  if (min_candidates.length === 0 && melting_points.length) {
    const lowest = Math.min(...melting_points)
    min_candidates.push(TAMMANN_FRACTION * lowest)
    basis.push(`Tammann rule: ~2/3 of the lowest precursor melting point (${lowest} K)`)
  }
  const min_K = min_candidates.length ? round_to(Math.max(...min_candidates), 10) : null
  let max_K = max_candidates.length ? round_to(Math.min(...max_candidates), 10) : null
  if (min_K !== null && max_K !== null && max_K < min_K) {
    basis.push(
      `lowest precursor melting point lies below the required onset: expect a melt-assisted (flux) reaction`,
    )
    max_K = null
  }

  // === Procedure template ===
  const weigh = items
    .filter((item) => item.role === `precursor`)
    .map(
      (item) =>
        `${format_num(item.mass_g, `.4~f`)} g ${item.phase.formula}${item.phase.common_name ? ` (${item.phase.common_name})` : ``}`,
    )
  const needs_drying = infos.some(({ info }) => info.hygroscopic)
  const air_sensitive = infos.some(({ info }) => info.air_sensitive)
  const { atmosphere } = thermodynamics
  const hold =
    min_K === null ? `the chosen temperature` : `${min_K}${max_K ? `–${max_K}` : ``} K`
  const procedure = [
    ...(needs_drying
      ? [
          `Dry hygroscopic precursors (e.g. 2 h at 400 K) and store in a desiccator until weighing.`,
        ]
      : []),
    `Weigh ${weigh.join(`, `)} for ${format_num(target_mass_g, `.3~f`)} g of ${target.formula}${air_sensitive ? ` inside a glovebox` : ``}.`,
    `Grind intimately in an agate mortar (or ball-mill 30 min) to homogenize the stoichiometric mixture.`,
    `Press into a pellet and place in an alumina crucible${atmosphere.startsWith(`flowing`) ? ` inside a tube furnace` : ``}.`,
    `Heat at 3–5 K/min to ${hold} and hold 6–12 h in ${atmosphere}.`,
    ...(released.size
      ? [
          `Expect ${format_num(Math.abs(mass_loss_percent), `.1~f`)}% mass ${mass_loss_percent >= 0 ? `loss` : `gain`} (${[...released].join(`, `)} ${mass_loss_percent >= 0 ? `release` : `uptake`}); verify by weighing after firing.`,
        ]
      : []),
    `Cool, regrind, and check phase purity by XRD; repeat the firing if precursor or intermediate reflections remain.`,
  ]

  return {
    target_mass_g,
    items,
    mass_loss_percent,
    temperature_window: { min_K, max_K, basis },
    procedure,
  }
}

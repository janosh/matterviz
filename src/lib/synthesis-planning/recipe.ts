import { format_num } from '$lib/labels'
import { lookup_precursor_info } from './precursor-library'
import type {
  SynthesisReaction,
  SynthesisRoute,
  Recipe,
  RecipeAssumptions,
  RecipeItem,
  RouteThermodynamics,
} from './types'

export function build_recipe(
  reaction: SynthesisReaction,
  thermodynamics: RouteThermodynamics,
  target_mass_g: number,
): Recipe {
  if (!Number.isFinite(target_mass_g) || target_mass_g <= 0)
    throw new Error(`Target mass must be finite and positive, got ${target_mass_g}`)
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

  const guidance = reaction.reactants.flatMap(({ phase }) => {
    const info = lookup_precursor_info(phase.formula)
    if (!info) return []
    return [
      ...(info.decomposition_K
        ? [`${phase.formula}: approximate decomposition ${info.decomposition_K} K`]
        : []),
      ...(info.melting_K
        ? [`${phase.formula}: approximate melting point ${info.melting_K} K`]
        : []),
      ...(info.hygroscopic ? [`${phase.formula}: hygroscopic`] : []),
      ...(info.air_sensitive ? [`${phase.formula}: air-sensitive`] : []),
      ...(info.hazards?.length
        ? [`${phase.formula}: hazards — ${info.hazards.join(`, `)}`]
        : []),
      ...(info.notes ? [`${phase.formula}: ${info.notes}`] : []),
    ]
  })
  return {
    target_mass_g,
    items,
    mass_loss_percent,
    guidance,
    assumptions: {
      temperature_K: ``,
      ramp_K_min: ``,
      hold_hours: ``,
      preparation: ``,
      container: ``,
      atmosphere: ``,
      source: ``,
    },
    checkpoints: [
      `Compare measured mass change with the calculated ${format_num(Math.abs(mass_loss_percent), `.1~f`)}% ${mass_loss_percent >= 0 ? `loss` : `gain`}; agreement alone does not establish phase purity.`,
      `Identify the product phases before ${target.formula} is used or the experiment is considered complete.`,
      `Confirm the chosen atmosphere can support the modeled gas exchange: ${thermodynamics.atmosphere}.`,
    ],
  }
}

// Rebuild quantities for both firings, preserving the user's experimental choices.
export function build_route_recipe(
  route: SynthesisRoute,
  target_mass_g: number,
): Pick<SynthesisRoute, `recipe` | `intermediate_step`> {
  const recipe = {
    ...build_recipe(route.reaction, route.thermodynamics, target_mass_g),
    assumptions: route.recipe.assumptions,
  }
  const step = route.intermediate_step
  if (!step) return { recipe }
  const intermediate = recipe.items.find(
    ({ phase, role }) =>
      role === `precursor` && phase.id === step.reaction.products[0].phase.id,
  )
  if (!intermediate)
    throw new Error(
      `Intermediate ${step.reaction.products[0].phase.formula} is missing from route ${route.id}`,
    )
  return {
    recipe,
    intermediate_step: {
      ...step,
      recipe: {
        ...build_recipe(step.reaction, step.thermodynamics, intermediate.mass_g),
        assumptions: step.recipe.assumptions,
      },
    },
  }
}

export const RECIPE_ASSUMPTION_LABELS = {
  temperature_K: `Temperature (K)`,
  ramp_K_min: `Ramp (K/min)`,
  hold_hours: `Hold (h)`,
  preparation: `Preparation / mixing`,
  container: `Container`,
  atmosphere: `Chosen atmosphere`,
  source: `Protocol reference / rationale`,
} satisfies Record<keyof RecipeAssumptions, string>

export const RECIPE_ROLE_LABELS = {
  precursor: `Precursor`,
  atmosphere: `From atmosphere`,
  target: `Target`,
  byproduct: `Byproduct`,
} satisfies Record<RecipeItem[`role`], string>

// The same text drives clipboard and agent exports so neither loses first-step details or edits.
export function format_recipe_text(route: SynthesisRoute): string {
  return [route.intermediate_step, route]
    .filter((step) => step !== undefined)
    .flatMap((step, idx) => [
      `Step ${idx + 1}: ${step.reaction.equation}`,
      `Calculated recipe for ${format_num(step.recipe.target_mass_g, `.4~f`)} g (100% conversion, pure precursors)`,
      ...step.recipe.items.map(
        (item) =>
          `${RECIPE_ROLE_LABELS[item.role]}: ${format_num(item.mass_g, `.4~f`)} g ${item.phase.formula} (${format_num(item.moles * 1000, `.3~f`)} mmol)`,
      ),
      `Model conditions: ${step.thermodynamics.temperature} K; ${
        Object.entries(step.thermodynamics.partial_pressures)
          .map(([gas, pressure]) => `${gas}: ${pressure} bar`)
          .join(`, `) || `closed system`
      }`,
      `Modeled reaction energy: ${format_num(step.reaction.energy_per_atom, `.4~f`)} eV/atom; gas exchange: ${step.thermodynamics.atmosphere}`,
      `Thermodynamic onset: ${step.thermodynamics.onset_temperature === null ? `not identified` : `${step.thermodynamics.onset_temperature} K`}; this does not determine a firing schedule.`,
      `Library guidance (unreferenced; verify before use):`,
      ...step.recipe.guidance,
      `Experimental assumptions (user supplied; blank means undecided):`,
      ...Object.entries(RECIPE_ASSUMPTION_LABELS).map(
        ([key, label]) =>
          `${label}: ${step.recipe.assumptions[key as keyof RecipeAssumptions] || `undecided`}`,
      ),
      `Checkpoints:`,
      ...step.recipe.checkpoints,
    ])
    .join(`\n`)
}

// Route scoring: every term is mapped to roughly [-1, 1] before weighting so weights are
// comparable, and each term's contribution is reported so rankings stay explainable.
import type { GasSpecies } from '$lib/convex-hull/types'
import { format_num, plural } from '$lib/labels'
import { clamp01 } from '$lib/utils'
import { format_mev } from './format-mev'
import { lookup_precursor_info } from './precursor-library'
import type {
  CompetingPhase,
  PracticalityAssessment,
  ScoreWeights,
  SelectivityMetrics,
  SynthesisReaction,
} from './types'

// Selectivity terms dominate, practicality separates selective routes, and driving force gets
// little weight on purpose: a large driving force does not make a reaction cleaner
// (https://doi.org/10.1038/s44160-024-00502-y)
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  selectivity: 3,
  inverse_hull: 2,
  driving_force: 0.5,
  competition: 1,
  practicality: 2,
  simplicity: 0.5,
}

// Energy scale (eV/atom) at which inverse hull energy and driving force saturate
const ENERGY_SCALE = 0.1
// Smooth saturation of an energy onto (-1, 1)
const saturate = (energy: number): number => energy / (Math.abs(energy) + ENERGY_SCALE)

const solid_precursors = (reaction: SynthesisReaction) =>
  reaction.reactants.filter(({ phase }) => !phase.is_gas)

// Stoichiometric gas exchange does not determine a furnace atmosphere or container.
export function describe_atmosphere(
  gas_exchange: Partial<Record<GasSpecies, number>>,
): string {
  const gases = (sign: 1 | -1) =>
    Object.entries(gas_exchange)
      .filter(([, amount]) => Math.sign(amount) === sign)
      .map(([gas]) => gas)
  const consumed = gases(-1)
  const released = gases(1)
  return (
    [
      consumed.length ? `consumes ${consumed.join(`, `)}` : ``,
      released.length ? `releases ${released.join(`, `)}` : ``,
    ]
      .filter(Boolean)
      .join(`; `) || `no net gas exchange`
  )
}

// 0-1 handling/sourcing score of a reaction's reactants with the reasons behind it
export function assess_practicality(reaction: SynthesisReaction): PracticalityAssessment {
  const notes: string[] = []
  const takes_up_gas = reaction.reactants.some(({ phase }) => phase.is_gas)
  const precursors = solid_precursors(reaction)
  let score = 0
  for (const { phase } of precursors) {
    const info = lookup_precursor_info(phase.formula)
    let phase_score = 1
    if (Object.keys(phase.composition).length === 1 && takes_up_gas) {
      phase_score = 0.3
      notes.push(
        `${phase.formula} metal + gas is a combustion-type reaction that is hard to control`,
      )
    }
    if (!info) {
      const metastable = phase.e_above_hull > 1e-6
      score += Math.min(phase_score, metastable ? 0.2 : 0.3)
      notes.push(
        `${phase.formula} is not a common commercial precursor${
          metastable ? ` and is metastable (${format_mev(phase.e_above_hull)} above hull)` : ``
        }; it would need to be synthesized first`,
      )
      continue
    }
    if (info.hygroscopic) {
      phase_score -= 0.15
      notes.push(`${phase.formula} is hygroscopic: dry before weighing`)
    }
    if (info.air_sensitive) {
      phase_score -= 0.25
      notes.push(`${phase.formula} is air-sensitive: handle under inert atmosphere`)
    }
    if (info.hazards?.length) {
      phase_score -= Math.min(0.2, 0.1 * info.hazards.length)
      notes.push(`${phase.formula} hazards: ${info.hazards.join(`, `)}`)
    }
    if (info.notes) notes.push(`${phase.formula}: ${info.notes}`)
    score += Math.max(0, phase_score)
  }
  score = precursors.length ? score / precursors.length : 0

  // Gas uptake has to diffuse into the powder bed, so it slows the reaction and risks
  // inhomogeneous oxidation states; precursors that already carry the right oxygen content win
  for (const { phase } of reaction.reactants) {
    if (!phase.is_gas) continue
    score -= phase.formula === `O2` ? 0.1 : 0.25
    notes.push(`Takes up ${phase.formula} from the modeled gas reservoir`)
  }
  return { score: clamp01(score), notes }
}

const name_with_force = (comp: CompetingPhase): string =>
  `${comp.phase.formula} (${format_mev(comp.driving_force)})`

export function score_route(
  reaction: SynthesisReaction,
  selectivity: SelectivityMetrics,
  practicality: PracticalityAssessment,
  weights: ScoreWeights,
): { score: number; breakdown: Record<keyof ScoreWeights, number>; rationale: string[] } {
  const downhill = reaction.energy_per_atom < 0
  const terms: Record<keyof ScoreWeights, number> = {
    // with no competitors selectivity_margin collapses to the target's own driving force, so
    // saturating it would just echo the driving_force term; no competitor = full marks
    selectivity: !downhill
      ? -1
      : selectivity.competitors.length === 0
        ? 1
        : -saturate(selectivity.selectivity_margin),
    inverse_hull: saturate(selectivity.inverse_hull_energy),
    driving_force: downhill ? Math.min(1, -reaction.driving_force / (2 * ENERGY_SCALE)) : -0.5,
    competition: -Math.min(1, selectivity.n_more_favorable / 3),
    practicality: practicality.score,
    simplicity: 1 / solid_precursors(reaction).length,
  }
  const breakdown = Object.fromEntries(
    Object.entries(weights).map(([key, weight]) => [
      key,
      weight * terms[key as keyof ScoreWeights],
    ]),
  ) as Record<keyof ScoreWeights, number>
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0)

  // Verdicts the numbers alone don't convey
  const rationale: string[] = []
  const worse = selectivity.competitors.filter((comp) => comp.more_favorable_than_target)
  if (worse.length) {
    rationale.push(
      `${plural(worse.length, `competing phase`)} more favorable than the target: ${worse
        .slice(0, 3)
        .map(name_with_force)
        .join(`, `)}${worse.length > 3 ? `, …` : ``}; expect intermediates`,
    )
  } else {
    const closest = selectivity.competitors[0]
    rationale.push(
      `Target is the most favorable product of this mixture${
        closest
          ? ` (closest competitor ${name_with_force(closest)})`
          : ` (no competing phases can form)`
      }`,
    )
  }
  const off_target = selectivity.interfaces.filter((iface) => !iface.forms_target)
  if (selectivity.interfaces.length > 1 && off_target.length) {
    rationale.push(
      `${off_target.length} of ${selectivity.interfaces.length} precursor interfaces form something else first: ${off_target
        .map(
          (iface) =>
            `${iface.precursors[0].formula}|${iface.precursors[1].formula} → ${iface.first_product?.phase.formula ?? `nothing`}`,
        )
        .join(`, `)}`,
    )
  }
  if (practicality.notes.length) {
    rationale.push(
      `Practicality ${format_num(practicality.score, `.2~f`)}: ${practicality.notes.slice(0, 2).join(`; `)}`,
    )
  }
  return { score, breakdown, rationale }
}

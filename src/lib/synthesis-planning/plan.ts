// Entry point: enumerate precursor sets, balance and evaluate every candidate reaction, rank them
// and attach recipes. Pure function of its JSON-serializable request, so agents and UIs share it.
import { DEFAULT_GAS_PRESSURES } from '$lib/convex-hull/types'
import type { GasSpecies } from '$lib/convex-hull/types'
import { combinations } from '$lib/math'
import type { PhaseSet, PlannerPhase } from './phases'
import {
  assign_e_above_hull,
  ENERGY_TOL,
  hull_at,
  prepare_phase_set,
  resolve_phase,
  to_phase_ref,
} from './phases'
import { format_mev } from './format-mev'
import { lookup_precursor_info } from './precursor-library'
import { build_recipe } from './recipe'
import {
  assess_practicality,
  DEFAULT_SCORE_WEIGHTS,
  describe_atmosphere,
  score_route,
} from './scoring'
import {
  analyze_selectivity,
  balance_reaction,
  create_thermo_cache,
  make_reaction,
  onset_temperature,
  reaction_energy_at_temperature,
} from './thermo'
import type {
  RejectReason,
  ScoreWeights,
  SynthesisConditions,
  SynthesisPlan,
  SynthesisPlanProgress,
  SynthesisPlanRequest,
  SynthesisRoute,
} from './types'
import { validate_synthesis_plan_request } from './validation'

export const DEFAULT_MAX_E_ABOVE_HULL = 0.03
// Phases further above the hull than this are ignored as competitors: the analysis of https://doi.org/10.1038/s44160-024-00502-y uses the hull
// phases, and including every metastable polymorph mostly adds noise and cost
export const COMPETITOR_E_ABOVE_HULL = 0.02
const MAX_CANDIDATES = 100_000
// Elements whose standard state is a gas: never offered as "solid" elemental precursors
const GASEOUS_ELEMENTS = new Set([`H`, `N`, `O`, `F`, `Cl`])

interface PlannerContext {
  phase_set: PhaseSet
  target: PlannerPhase
  gases: PlannerPhase[]
  gas_species: GasSpecies[]
  // Per element of the phase set: can it be supplied or removed by an open gas?
  open_elements: boolean[]
  competitor_phases: PlannerPhase[]
  conditions: SynthesisConditions
  weights: ScoreWeights
  target_mass_g: number
  rejected: Record<RejectReason, number>
  warnings: string[]
  thermo_cache: ReturnType<typeof create_thermo_cache>
}

const empty_rejections = (): Record<RejectReason, number> => ({
  unbalanced: 0,
  redundant_precursor: 0,
  uphill: 0,
})

// Phases allowed to act as precursors for `target`
function build_precursor_pool(
  ctx: PlannerContext,
  target: PlannerPhase,
  options: SynthesisPlanRequest[`precursors`] = {},
): PlannerPhase[] {
  const { phase_set, open_elements } = ctx
  const max_e_above_hull = options.max_e_above_hull ?? DEFAULT_MAX_E_ABOVE_HULL
  // Precursor elements must end up in the target or leave as gas
  const allowed = phase_set.elements.map(
    (_, el_idx) => target.fractions[el_idx] > 0 || open_elements[el_idx],
  )
  const resolve_set = (queries: string[] | undefined): Set<string> | null => {
    if (!queries) return null
    const ids = new Set<string>()
    for (const query of queries) {
      const phase = resolve_phase(phase_set, query)
      if (phase) ids.add(phase.formula)
      else ctx.warnings.push(`Precursor filter entry "${query}" matches no phase`)
    }
    return ids
  }
  const allow = resolve_set(options.allow)
  const block = resolve_set(options.block)
  const n_target_elements = target.fractions.filter((fraction) => fraction > 0).length
  const max_elements = options.max_elements ?? Math.max(1, n_target_elements - 1)
  const candidates = phase_set.phases.filter((phase) => {
    if (phase.is_gas || phase.id === target.id || phase.formula === target.formula)
      return false
    // Shelf stability counts, not stability at firing temperature: BaCO3 is a fine precursor
    // even where it decomposes during the reaction
    if (phase.e_above_hull_0K > max_e_above_hull + ENERGY_TOL) return false
    if (phase.fractions.some((fraction, el_idx) => fraction > 0 && !allowed[el_idx]))
      return false
    const elements = phase_set.elements.filter((_, el_idx) => phase.fractions[el_idx] > 0)
    if (elements.length === 1 && GASEOUS_ELEMENTS.has(elements[0])) return false
    if (elements.length > max_elements && !lookup_precursor_info(phase.formula)) return false
    if (allow && !allow.has(phase.formula)) return false
    if (block?.has(phase.formula)) return false
    return true
  })
  const common = candidates.filter((phase) => lookup_precursor_info(phase.formula))
  const common_covers_target = target.fractions.every(
    (fraction, el_idx) =>
      fraction === 0 ||
      open_elements[el_idx] ||
      common.some((phase) => phase.fractions[el_idx] > 0),
  )
  if (!common_covers_target && options.only_common !== false) {
    ctx.warnings.push(
      `Library precursors cannot supply every element of ${target.formula}; ${
        options.only_common
          ? `only_common leaves the target unreachable`
          : `considering all near-hull phases as precursors`
      }`,
    )
  }
  return (options.only_common ?? common_covers_target) ? common : candidates
}

// Balance and fully evaluate one precursor set → product, or null when it is rejected
function evaluate_route(
  ctx: PlannerContext,
  precursors: PlannerPhase[],
  product: PlannerPhase,
  kind: SynthesisRoute[`kind`],
): SynthesisRoute | null {
  const { gases, gas_species, conditions, weights, rejected } = ctx
  const balanced = balance_reaction(precursors, product, gases, true)
  if (typeof balanced === `string`) {
    rejected[balanced]++
    return null
  }
  const gas_exchange = Object.fromEntries(
    gas_species.flatMap((species, idx) =>
      Math.abs(balanced.gas_exchange[idx]) > 1e-7
        ? [[species, balanced.gas_exchange[idx]]]
        : [],
    ),
  ) as Partial<Record<GasSpecies, number>>
  // Only gas-exchanging reactions change with temperature, so only they can have an onset
  const onset = Object.keys(gas_exchange).length
    ? onset_temperature(
        reaction_energy_at_temperature(
          balanced,
          gases,
          gas_species,
          conditions,
          ctx.thermo_cache,
        ),
      )
    : null
  if (balanced.energy_per_fu >= 0 && onset === null) {
    rejected.uphill++
    return null
  }
  const reaction = make_reaction(precursors, product, gases, balanced)
  const thermodynamics = {
    onset_temperature: onset,
    gas_exchange,
    atmosphere: describe_atmosphere(gas_exchange),
  }
  const selectivity = analyze_selectivity(
    precursors,
    product,
    gases,
    ctx.competitor_phases,
    reaction.driving_force,
    ctx.thermo_cache,
  )
  const practicality = assess_practicality(reaction)
  const { score, breakdown, rationale } = score_route(
    reaction,
    selectivity,
    practicality,
    weights,
  )
  return {
    id: `${product.id}<${precursors
      .map((phase) => phase.id)
      .toSorted()
      .join(`+`)}`,
    kind,
    reaction,
    selectivity,
    thermodynamics,
    practicality,
    score,
    score_breakdown: breakdown,
    rationale,
    recipe: build_recipe(reaction, thermodynamics, ctx.target_mass_g),
  }
}

// Every direct route to `product` from subsets of `pool` up to `max_precursors`, best first
function direct_routes(
  ctx: PlannerContext,
  pool: PlannerPhase[],
  product: PlannerPhase,
  max_precursors: number,
  on_progress?: (progress: SynthesisPlanProgress) => void,
): { routes: SynthesisRoute[]; n_candidates: number } {
  const routes: SynthesisRoute[] = []
  let n_candidates = 0
  let total_candidates = 0
  const candidate_sizes: number[] = []
  for (let size = 1; size <= Math.min(max_precursors, pool.length); size++) {
    const n_subsets = binomial(pool.length, size)
    if (total_candidates + n_subsets > MAX_CANDIDATES) {
      ctx.warnings.push(
        `Skipped ${size}-precursor sets for ${product.formula}: ${n_subsets} combinations exceed the ${MAX_CANDIDATES} candidate budget. Narrow the precursor pool.`,
      )
      break
    }
    candidate_sizes.push(size)
    total_candidates += n_subsets
  }
  const progress_interval = Math.max(1, Math.ceil(total_candidates / 100))
  on_progress?.({ stage: `direct_routes`, current: 0, total: total_candidates })
  for (const size of candidate_sizes) {
    for (const subset of combinations(pool, size)) {
      n_candidates++
      if (n_candidates % progress_interval === 0 || n_candidates === total_candidates) {
        on_progress?.({
          stage: `direct_routes`,
          current: n_candidates,
          total: total_candidates,
        })
      }
      // Every target element must come from a precursor or an open gas
      const covered = product.fractions.every(
        (fraction, el_idx) =>
          fraction === 0 ||
          ctx.open_elements[el_idx] ||
          subset.some((phase) => phase.fractions[el_idx] > 0),
      )
      if (!covered) {
        ctx.rejected.unbalanced++
        continue
      }
      const route = evaluate_route(ctx, subset, product, `direct`)
      if (route) routes.push(route)
    }
  }
  return {
    routes: routes.toSorted((route_a, route_b) => route_b.score - route_a.score),
    n_candidates,
  }
}

const binomial = (n_items: number, k_items: number): number => {
  let result = 1
  for (let idx = 1; idx <= k_items; idx++) result = (result * (n_items - k_items + idx)) / idx
  return Math.round(result)
}

// Routes through an intermediate: a near-hull phase that reacts with one pool precursor (or
// decomposes on its own) to give the target, and that itself has a direct route from the pool
function two_step_routes(
  ctx: PlannerContext,
  pool: PlannerPhase[],
  max_precursors: number,
  on_progress?: (progress: SynthesisPlanProgress) => void,
): SynthesisRoute[] {
  const { target } = ctx
  const pool_ids = new Set(pool.map((phase) => phase.id))
  const intermediates = ctx.competitor_phases.filter(
    (phase) =>
      !phase.is_gas &&
      phase.id !== target.id &&
      !pool_ids.has(phase.id) &&
      phase.fractions.every(
        (fraction, el_idx) =>
          fraction === 0 || target.fractions[el_idx] > 0 || ctx.open_elements[el_idx],
      ),
  )
  // Intermediate searches keep their own counters so the plan's stay about direct candidates
  const sub_ctx: PlannerContext = { ...ctx, rejected: empty_rejections(), warnings: [] }
  const best = (routes: SynthesisRoute[]) =>
    routes.toSorted((route_a, route_b) => route_b.score - route_a.score)[0]
  const routes: SynthesisRoute[] = []
  on_progress?.({ stage: `two_step_routes`, current: 0, total: intermediates.length })
  for (const [intermediate_idx, intermediate] of intermediates.entries()) {
    const step2 = best(
      [[intermediate], ...pool.map((phase) => [intermediate, phase])]
        .map((precursors) => evaluate_route(sub_ctx, precursors, target, `two_step`))
        .filter((route): route is SynthesisRoute => route !== null),
    )
    const step1 =
      step2 &&
      direct_routes(sub_ctx, pool, intermediate, Math.min(max_precursors, 2)).routes[0]
    if (step1) {
      routes.push({
        ...step2,
        id: `${step2.id}<<${step1.id}`,
        intermediate_step: step1.reaction,
        // The second firing costs an extra synthesis; the weaker step limits the route
        score: Math.min(step1.score, step2.score) - ctx.weights.simplicity,
        rationale: [
          `Two-step route via ${intermediate.formula}: first ${step1.reaction.equation} (${step1.rationale[0]}), then ${step2.reaction.equation}`,
          ...step2.rationale,
        ],
      })
    }
    on_progress?.({
      stage: `two_step_routes`,
      current: intermediate_idx + 1,
      total: intermediates.length,
    })
  }
  return routes
}

// Internal worker entry with progress reporting. Keep plan_synthesis as the deterministic public
// kernel: progress is observational and never changes enumeration, scoring or result ordering.
export function plan_synthesis_with_progress(
  request: SynthesisPlanRequest,
  options: { on_progress?: (progress: SynthesisPlanProgress) => void } = {},
): SynthesisPlan {
  validate_synthesis_plan_request(request)
  const { on_progress } = options
  on_progress?.({ stage: `preparing`, current: 0, total: 1 })
  const max_precursors = request.max_precursors ?? 2
  const conditions: SynthesisConditions = {
    temperature: request.conditions?.temperature ?? 0,
    open_species: request.conditions?.open_species ?? [],
    partial_pressures: request.conditions?.partial_pressures ?? {},
    gas_provider: request.conditions?.gas_provider,
  }
  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...request.scoring }

  const phase_set = prepare_phase_set(request.entries, conditions)
  on_progress?.({ stage: `preparing`, current: 1, total: 1 })
  const resolved = resolve_phase(phase_set, request.target)
  if (!resolved) {
    const examples = phase_set.phases
      .filter((phase) => !phase.is_gas)
      .slice(0, 8)
      .map((phase) => phase.formula)
      .join(`, `)
    throw new Error(
      `plan_synthesis: target "${request.target}" matches no entry id or formula. Available formulas include ${examples}`,
    )
  }
  // A higher-energy polymorph picked by id stands in for its formula in the working set; the
  // ground state is kept aside so the target's stability is still judged against it
  const working_idx = phase_set.phases.findIndex((phase) => phase.formula === resolved.formula)
  const ground_state = phase_set.phases[working_idx]
  if (ground_state.id !== resolved.id) {
    phase_set.warnings.push(
      `Target ${resolved.id} is a higher-energy polymorph of ${resolved.formula}; planning for this polymorph, but the ground state (${ground_state.id}) is thermodynamically preferred`,
    )
    phase_set.phases[working_idx] = { ...resolved, e_above_hull_0K: NaN }
  }
  const target = phase_set.phases[working_idx]
  assign_e_above_hull(phase_set.phases)

  const gases = phase_set.phases.filter((phase) => phase.is_gas)
  const gas_species = gases.map((gas) => gas.id.replace(`gas:`, ``) as GasSpecies)
  const ctx: PlannerContext = {
    thermo_cache: create_thermo_cache(),
    phase_set,
    target,
    gases,
    gas_species,
    open_elements: phase_set.elements.map((_, el_idx) =>
      gases.some((gas) => gas.fractions[el_idx] > 0),
    ),
    competitor_phases: phase_set.phases.filter(
      (phase) =>
        phase.e_above_hull <= COMPETITOR_E_ABOVE_HULL + ENERGY_TOL || phase.id === target.id,
    ),
    conditions,
    weights,
    target_mass_g: request.target_mass_g ?? 1,
    rejected: empty_rejections(),
    warnings: [...phase_set.warnings],
  }

  // Target stability at these conditions
  const others = phase_set.phases.filter((phase) => phase.id !== target.id)
  if (ground_state.id !== target.id) others.push(ground_state)
  const hull_without_target = hull_at(target.fractions, others)
  const e_above_hull = hull_without_target
    ? Math.max(0, target.energy_per_atom - hull_without_target.energy)
    : 0
  const is_stable = e_above_hull <= ENERGY_TOL
  if (!is_stable) {
    ctx.warnings.push(
      `Target ${target.formula} is ${format_mev(e_above_hull)} above the hull at these conditions; it is metastable with respect to ${hull_without_target?.decomposition
        .map(({ phase }) => phase.formula)
        .join(` + `)}`,
    )
  }

  const pool = build_precursor_pool(ctx, target, request.precursors)
  if (pool.length === 0) {
    ctx.warnings.push(
      `Precursor pool is empty: relax max_e_above_hull, allow/block filters or only_common`,
    )
  }
  const { routes, n_candidates } = direct_routes(
    ctx,
    pool,
    target,
    max_precursors,
    on_progress,
  )
  if (request.two_step) {
    routes.push(...two_step_routes(ctx, pool, max_precursors, on_progress))
  }
  on_progress?.({ stage: `ranking`, current: 0, total: 1 })
  if (request.two_step) routes.sort((route_a, route_b) => route_b.score - route_a.score)
  on_progress?.({ stage: `ranking`, current: 1, total: 1 })

  const partial_pressures = Object.fromEntries(
    gas_species.map((species) => [
      species,
      conditions.partial_pressures?.[species] ?? DEFAULT_GAS_PRESSURES[species],
    ]),
  ) as Partial<Record<GasSpecies, number>>

  return {
    target: to_phase_ref(target),
    chemical_system: phase_set.elements.join(`-`),
    elements: phase_set.elements,
    conditions: {
      temperature: conditions.temperature ?? 0,
      open_species: gas_species,
      partial_pressures,
    },
    target_stability: {
      e_above_hull,
      is_stable,
      decomposition:
        is_stable || !hull_without_target
          ? []
          : hull_without_target.decomposition.map(({ phase, atom_fraction }) => ({
              phase: to_phase_ref(phase),
              atom_fraction,
            })),
    },
    weights,
    routes: routes.slice(0, request.max_routes ?? 20),
    rejected: ctx.rejected,
    n_candidates,
    precursor_pool: pool.map(to_phase_ref),
    warnings: ctx.warnings,
  }
}

export const plan_synthesis = (request: SynthesisPlanRequest): SynthesisPlan =>
  plan_synthesis_with_progress(request)

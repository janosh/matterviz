// Scan a fixed set of routes. Balance each possible product once; only gas energies and
// condition-dependent hull membership change across the grid.
import {
  compute_gas_chemical_potential,
  get_default_gas_provider,
} from '$lib/convex-hull/gas-thermodynamics'
import { DEFAULT_GAS_PRESSURES } from '$lib/convex-hull/types'
import type { GasSpecies, PhaseData } from '$lib/convex-hull/types'
import { COMPETITOR_E_ABOVE_HULL } from './plan'
import {
  assign_e_above_hull,
  ENERGY_TOL,
  hull_at,
  prepare_phase_set,
  resolve_phase,
} from './phases'
import type { PlannerPhase } from './phases'
import { balance_reaction } from './thermo'
import type { SynthesisConditions } from './types'
import { validate_synthesis_plan_request } from './validation'

export interface OpportunityRequest {
  entries: PhaseData[]
  target: string
  routes: { id: string; precursor_ids: string[] }[]
  conditions: SynthesisConditions
  gas: GasSpecies
  temperatures: number[]
  log_pressures: number[]
}

export interface OpportunityCell {
  temperature: number
  pressure: number
  e_above_hull: number
  routes: { id: string; driving_force: number; selectivity_margin: number }[]
}

export function compute_opportunity_map(request: OpportunityRequest): OpportunityCell[] {
  const {
    entries,
    routes,
    target: target_id,
    conditions,
    gas,
    temperatures,
    log_pressures,
  } = request
  validate_synthesis_plan_request({ entries, target: target_id, conditions })
  if (!conditions.open_species?.includes(gas)) throw new Error(`Scan gas ${gas} must be open`)
  if (!routes.length || routes.length > 4)
    throw new Error(`Scan requires 1–4 routes, got ${routes.length}`)
  if (new Set(routes.map(({ id }) => id)).size !== routes.length)
    throw new Error(`Scan route IDs must be unique`)
  if (
    !temperatures.length ||
    !log_pressures.length ||
    temperatures.length * log_pressures.length > 225
  )
    throw new Error(`Scan requires 1–225 temperature/pressure cells`)
  if (
    temperatures.some((value) => !Number.isFinite(value) || value < 0 || value > 2000) ||
    log_pressures.some((value) => !Number.isFinite(value) || value < -12 || value > 2)
  )
    throw new Error(`Scan temperatures must be 0–2000 K and log10 pressures −12–2 bar`)
  const phase_set = prepare_phase_set(entries, conditions)
  const resolved = resolve_phase(phase_set, target_id)
  if (!resolved || resolved.is_gas)
    throw new Error(`Scan target ${target_id} is not a solid phase`)
  const target_idx = phase_set.phases.findIndex((phase) => phase.formula === resolved.formula)
  if (target_idx === -1)
    throw new Error(`Scan target ${target_id} is absent from the working phase set`)
  const ground_state = phase_set.phases[target_idx]
  const target = { ...resolved }
  phase_set.phases[target_idx] = target
  const { phases } = phase_set
  const gases = phases.filter((phase) => phase.is_gas)
  const gas_species = gases.map((phase) => phase.id.slice(4) as GasSpecies)
  const provider = conditions.gas_provider ?? get_default_gas_provider()
  const resolve_precursor = (id: string): PlannerPhase => {
    const phase = phases.find((candidate) => candidate.id === id)
    if (!phase || phase.is_gas)
      throw new Error(`Scan precursor ${id} is not a working solid phase`)
    return phase
  }
  const prepared = routes.map(({ id, precursor_ids }) => {
    const precursors = precursor_ids.map(resolve_precursor)
    const prepare_product = (product: PlannerPhase, require_all: boolean) => {
      const balanced = balance_reaction(precursors, product, gases, require_all)
      if (typeof balanced === `string`) return null
      const product_energy = product.energy_per_atom * product.n_atoms_per_fu
      const precursor_energy = precursors.reduce(
        (sum, phase, idx) =>
          sum + balanced.coefficients[idx] * (phase.energy_per_atom * phase.n_atoms_per_fu),
        0,
      )
      return {
        product,
        force: () =>
          (product_energy +
            gases.reduce(
              (sum, phase, idx) =>
                sum +
                balanced.gas_exchange[idx] * (phase.energy_per_atom * phase.n_atoms_per_fu),
              0,
            ) -
            precursor_energy) /
          balanced.reactant_atoms,
      }
    }
    const target_product = prepare_product(target, true)
    if (!target_product)
      throw new Error(`Scan route ${id} cannot balance to ${target.formula}`)
    const excluded = new Set([target.id, ...precursor_ids])
    const competitors = phases.flatMap((phase) => {
      if (phase.is_gas || excluded.has(phase.id)) return []
      const product = prepare_product(phase, false)
      return product ? [product] : []
    })
    return { id, target_product, competitors }
  })
  return temperatures.flatMap((temperature) =>
    log_pressures.map((log_pressure) => {
      const pressure = 10 ** log_pressure
      for (const [idx, phase] of gases.entries()) {
        const species = gas_species[idx]
        phase.energy_per_atom = compute_gas_chemical_potential(
          provider,
          species,
          temperature,
          species === gas
            ? pressure
            : (conditions.partial_pressures?.[species] ?? DEFAULT_GAS_PRESSURES[species]),
        )
      }
      assign_e_above_hull(phases)
      let e_above_hull = target.e_above_hull
      // Keep the replaced ground state for target stability, as in plan_synthesis.
      if (ground_state.id !== target.id) {
        const hull = hull_at(target.fractions, [...phases, ground_state])
        if (!hull) throw new Error(`No stability hull for scan target ${target_id}`)
        e_above_hull = Math.max(0, target.energy_per_atom - hull.energy)
      }
      return {
        temperature,
        pressure,
        e_above_hull,
        routes: prepared.map(({ id, target_product, competitors }) => {
          let strongest = 0
          for (const { product, force } of competitors) {
            if (product.e_above_hull > COMPETITOR_E_ABOVE_HULL + ENERGY_TOL) continue
            const driving_force = force()
            if (driving_force < -ENERGY_TOL) strongest = Math.min(strongest, driving_force)
          }
          const driving_force = target_product.force()
          return { id, driving_force, selectivity_margin: driving_force - strongest }
        }),
      }
    }),
  )
}

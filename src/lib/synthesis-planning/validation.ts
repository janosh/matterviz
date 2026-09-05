// Runtime validation for the public synthesis-planning request. Keep this aligned with
// SYNTHESIS_PLAN_REQUEST_SCHEMA so TypeScript, agent tools and direct JavaScript callers fail on
// the same bad inputs before the planner enters the numerical code.
import { GAS_SPECIES } from '$lib/convex-hull/types'
import type { GasThermodynamicsProvider } from '$lib/convex-hull/types'
import { DEFAULT_SCORE_WEIGHTS } from './scoring'
import type { SynthesisPlanRequest } from './types'

type PlainObject = Record<string, unknown>
const fail_validation = (message: string): never => {
  throw new TypeError(`plan_synthesis: ${message}`)
}

function assert_object(
  value: unknown,
  path: string,
  known_keys?: readonly string[],
): asserts value is PlainObject {
  if (value === null || typeof value !== `object` || Array.isArray(value))
    return fail_validation(`${path} must be an object`)
  if (!known_keys) return
  const unknown_keys = Object.keys(value).filter((key) => !known_keys.includes(key))
  if (unknown_keys.length)
    fail_validation(
      `${path} has unknown ${unknown_keys.length === 1 ? `property` : `properties`} ${unknown_keys.join(`, `)}`,
    )
}

interface NumberBounds {
  minimum?: number
  maximum?: number
  exclusive_minimum?: boolean
}

function assert_finite_number(
  value: unknown,
  path: string,
  { minimum = -Infinity, maximum = Infinity, exclusive_minimum = false }: NumberBounds = {},
): asserts value is number {
  if (
    typeof value !== `number` ||
    !Number.isFinite(value) ||
    (exclusive_minimum ? value <= minimum : value < minimum) ||
    value > maximum
  ) {
    const lower_bound = Number.isFinite(minimum)
      ? `${exclusive_minimum ? `>` : `>=`} ${minimum}`
      : null
    const upper_bound = Number.isFinite(maximum) ? `<= ${maximum}` : null
    const bounds = [lower_bound, upper_bound].filter(Boolean).join(` and `)
    fail_validation(
      `${path} must be a finite number${bounds ? ` ${bounds}` : ``}, got ${String(value)}`,
    )
  }
}

function assert_integer(
  value: unknown,
  path: string,
  bounds: NumberBounds = {},
): asserts value is number {
  assert_finite_number(value, path, bounds)
  if (!Number.isInteger(value)) fail_validation(`${path} must be an integer, got ${value}`)
}

function assert_string_array(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== `string`))
    fail_validation(`${path} must be an array of strings`)
}

function validate_gas_provider(value: unknown): asserts value is GasThermodynamicsProvider {
  assert_object(value, `conditions.gas_provider`)
  for (const method of [
    `get_standard_chemical_potential`,
    `get_supported_gases`,
    `get_temperature_range`,
  ]) {
    if (typeof value[method] !== `function`)
      fail_validation(`conditions.gas_provider.${method} must be a function`)
  }
}

const validate_conditions = (value: unknown): void => {
  assert_object(value, `conditions`, [
    `temperature`,
    `open_species`,
    `partial_pressures`,
    `gas_provider`,
  ])
  if (value.temperature !== undefined)
    assert_finite_number(value.temperature, `conditions.temperature`, {
      minimum: 0,
      maximum: 2000,
    })
  if (value.open_species !== undefined) {
    assert_string_array(value.open_species, `conditions.open_species`)
    const unsupported = value.open_species.filter(
      (species) => !GAS_SPECIES.includes(species as (typeof GAS_SPECIES)[number]),
    )
    if (unsupported.length)
      fail_validation(`conditions.open_species contains unsupported ${unsupported.join(`, `)}`)
  }
  if (value.partial_pressures !== undefined) {
    assert_object(value.partial_pressures, `conditions.partial_pressures`, GAS_SPECIES)
    for (const [species, pressure] of Object.entries(value.partial_pressures)) {
      assert_finite_number(pressure, `conditions.partial_pressures.${species}`, {
        minimum: 0,
        exclusive_minimum: true,
      })
    }
  }
  if (value.gas_provider !== undefined) validate_gas_provider(value.gas_provider)
}

const validate_precursors = (value: unknown): void => {
  assert_object(value, `precursors`, [
    `allow`,
    `block`,
    `max_e_above_hull`,
    `only_common`,
    `max_elements`,
  ])
  if (value.allow !== undefined) assert_string_array(value.allow, `precursors.allow`)
  if (value.block !== undefined) assert_string_array(value.block, `precursors.block`)
  if (value.max_e_above_hull !== undefined)
    assert_finite_number(value.max_e_above_hull, `precursors.max_e_above_hull`, {
      minimum: 0,
    })
  if (value.only_common !== undefined && typeof value.only_common !== `boolean`)
    fail_validation(`precursors.only_common must be a boolean`)
  if (value.max_elements !== undefined)
    assert_integer(value.max_elements, `precursors.max_elements`, { minimum: 1 })
}

const validate_scoring = (value: unknown): void => {
  assert_object(value, `scoring`, Object.keys(DEFAULT_SCORE_WEIGHTS))
  for (const [term, weight] of Object.entries(value)) {
    assert_finite_number(weight, `scoring.${term}`, { minimum: 0 })
  }
}

export function validate_synthesis_plan_request(
  request: unknown,
): asserts request is SynthesisPlanRequest {
  assert_object(request, `request`, [
    `entries`,
    `target`,
    `precursors`,
    `conditions`,
    `max_precursors`,
    `two_step`,
    `scoring`,
    `max_routes`,
    `keep_route_ids`,
    `target_mass_g`,
  ])
  if (!Array.isArray(request.entries) || request.entries.length === 0)
    fail_validation(`entries must be a non-empty array`)
  if (typeof request.target !== `string` || request.target.trim() === ``)
    fail_validation(`target must be a non-empty string`)
  if (request.conditions !== undefined) validate_conditions(request.conditions)
  if (request.precursors !== undefined) validate_precursors(request.precursors)
  if (request.max_precursors !== undefined)
    assert_integer(request.max_precursors, `max_precursors`, { minimum: 1, maximum: 4 })
  if (request.two_step !== undefined && typeof request.two_step !== `boolean`)
    fail_validation(`two_step must be a boolean`)
  if (request.scoring !== undefined) validate_scoring(request.scoring)
  if (request.max_routes !== undefined)
    assert_integer(request.max_routes, `max_routes`, { minimum: 1, maximum: 200 })
  if (request.keep_route_ids !== undefined)
    assert_string_array(request.keep_route_ids, `keep_route_ids`)
  if (request.target_mass_g !== undefined)
    assert_finite_number(request.target_mass_g, `target_mass_g`, {
      minimum: 0,
      exclusive_minimum: true,
    })
}

// Prediction interchange and publication validation. No Svelte/DOM imports: file workers use
// the same contract as live tools. Undefined object fields are omitted; array holes are errors.
import { grid_data_range, type VolumetricData } from '$lib/isosurface/types'
import { grid_dimensions } from '$lib/isosurface/grid'
import { det_3x3 } from '$lib/math'
import { is_elem_symbol } from '$lib/element/helpers'
import type { AnyStructure } from './index'

// Reuse IDs only for the same physical quantity, units and normalization.
export type StructureToolVolume = VolumetricData
export interface StructureToolOverlay {
  site_properties?: Record<string, unknown>[]
  volumes?: StructureToolVolume[]
  color_property?: string
  // Hosts define the calculation schema; the viewer validates JSON and preserves it on export.
  result?: Record<string, unknown> & { schema: string }
}
export interface StructureToolProvenance {
  model: string
  version: string
  units: Record<string, string>
  settings: Record<string, unknown>
}
export interface StructureToolPrediction extends StructureToolOverlay {
  input: AnyStructure
  run_id: number
  provenance: StructureToolProvenance
}

const invalid = (path: string, reason: string): never => {
  throw new TypeError(`${path}: ${reason}`)
}
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== `object` || Array.isArray(value))
    return invalid(path, `expected an object`)
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return invalid(
      path,
      `expected plain JSON metadata; copy shared buffers and convert special objects first`,
    )
  return value as Record<string, unknown>
}
const nonempty = (value: unknown, path: string): void => {
  if (typeof value !== `string` || !value.trim()) invalid(path, `must be a nonempty string`)
}

// Copy while validating, so Maps, typed arrays, cycles and non-finite numbers cannot be
// silently changed by JSON.stringify. Repeated references are fine; ancestor cycles aren't.
function copy_prediction_metadata<T>(source: T, root_path: string): T {
  const ancestors = new WeakSet<object>()
  function copy(value: unknown, path: string): unknown {
    if (value === null || typeof value === `string` || typeof value === `boolean`) return value
    if (typeof value === `number` && Number.isFinite(value)) return value
    if (!value || typeof value !== `object`)
      return invalid(path, `expected a finite JSON value`)
    if (ancestors.has(value)) return invalid(path, `cyclic metadata is not supported`)
    if (!Array.isArray(value)) record(value, path)
    if (Object.getOwnPropertySymbols(value).length) invalid(path, `symbol keys are not JSON`)
    ancestors.add(value)
    const copied = Array.isArray(value)
      ? Array.from(value, (entry, idx) => copy(entry, `${path}[${idx}]`))
      : Object.fromEntries(
          Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .map(([key, entry]) => [key, copy(entry, `${path}.${key}`)]),
        )
    ancestors.delete(value)
    return copied
  }
  return copy(source, root_path) as T
}

const vec3 = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
const matrix = (value: unknown, path: string): void => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(vec3))
    invalid(path, `expected a finite 3x3 lattice`)
  // Only cast after checking every row; a singular lattice cannot locate a density grid.
  const determinant = det_3x3(value as VolumetricData[`lattice`])
  if (!Number.isFinite(determinant) || determinant === 0)
    invalid(path, `lattice must be invertible`)
}

export function copy_prediction_input(value: unknown): AnyStructure {
  const input = record(copy_prediction_metadata(value, `input`), `input`)
  if (!Array.isArray(input.sites) || !input.sites.length)
    invalid(`input.sites`, `expected sites`)
  for (const [idx, raw] of (input.sites as unknown[]).entries()) {
    const site = record(raw, `input.sites[${idx}]`)
    if (!vec3(site.xyz) || !vec3(site.abc))
      invalid(`input.sites[${idx}]`, `expected xyz and abc vectors`)
    if (typeof site.label !== `string`)
      invalid(`input.sites[${idx}].label`, `expected a string`)
    record(site.properties, `input.sites[${idx}].properties`)
    if (!Array.isArray(site.species) || !site.species.length)
      invalid(`input.sites[${idx}].species`, `expected species`)
    for (const species of site.species as unknown[]) {
      const entry = record(species, `input.sites[${idx}].species`)
      if (typeof entry.element !== `string` || !is_elem_symbol(entry.element))
        invalid(`input.sites[${idx}].species.element`, `unknown element: ${entry.element}`)
      if (typeof entry.occu !== `number` || entry.occu < 0)
        invalid(`input.sites[${idx}].species.occu`, `expected nonnegative occupancy`)
    }
  }
  if (input.lattice !== undefined) {
    const lattice = record(input.lattice, `input.lattice`)
    matrix(lattice.matrix, `input.lattice.matrix`)
    if (
      !Array.isArray(lattice.pbc) ||
      lattice.pbc.length !== 3 ||
      !lattice.pbc.every((flag) => typeof flag === `boolean`)
    )
      invalid(`input.lattice.pbc`, `expected three booleans`)
    for (const key of [`a`, `b`, `c`, `alpha`, `beta`, `gamma`, `volume`])
      if (typeof lattice[key] !== `number` || lattice[key] <= 0)
        invalid(`input.lattice.${key}`, `expected a positive finite number`)
  }
  return input as unknown as AnyStructure
}

export function copy_prediction_provenance(value: unknown): StructureToolProvenance {
  const provenance = record(copy_prediction_metadata(value, `provenance`), `provenance`)
  nonempty(provenance.model, `provenance.model`)
  nonempty(provenance.version, `provenance.version`)
  record(provenance.settings, `provenance.settings`)
  for (const [key, unit] of Object.entries(record(provenance.units, `provenance.units`)))
    nonempty(unit, `provenance.units.${key}`)
  return provenance as unknown as StructureToolProvenance
}

export function copy_prediction_overlay(
  value: unknown,
  n_sites: number,
  from_json = false,
): StructureToolOverlay {
  const { volumes, ...rest } = record(value, `prediction`)
  const properties = copy_prediction_metadata(rest, `prediction`)
  if (properties.result !== undefined)
    nonempty(record(properties.result, `prediction.result`).schema, `prediction.result.schema`)
  const rows = properties.site_properties
  if (rows !== undefined) {
    if (!Array.isArray(rows) || rows.length !== n_sites)
      return invalid(`prediction.site_properties`, `expected ${n_sites} property rows`)
    rows.forEach((row, idx) => record(row, `prediction.site_properties[${idx}]`))
  }
  if (properties.color_property !== undefined)
    nonempty(properties.color_property, `prediction.color_property`)
  if (volumes === undefined) return properties
  if (!Array.isArray(volumes)) invalid(`prediction.volumes`, `expected an array`)
  const ids = new Set<string>()
  const copied_volumes = Array.from(volumes as unknown[], (raw, idx) => {
    const path = `prediction.volumes[${idx}]`
    const { values: raw_values, ...metadata_fields } = record(raw, path)
    const metadata = copy_prediction_metadata(metadata_fields, path)
    nonempty(metadata.id, `${path}.id`)
    const id = metadata.id as string
    if (ids.has(id)) invalid(`${path}.id`, `must be unique: ${id}`)
    ids.add(id)
    if (
      !(raw_values instanceof Float64Array) &&
      !(
        from_json &&
        Array.isArray(raw_values) &&
        raw_values.every((entry) => typeof entry === `number`)
      )
    )
      invalid(`${path}.values`, `expected ${from_json ? `a number array` : `Float64Array`}`)
    const values = new Float64Array(raw_values as Float64Array)
    if (!values.every(Number.isFinite)) invalid(`${path}.values`, `density must be finite`)
    const volume = { ...metadata, values } as StructureToolVolume
    try {
      grid_dimensions(volume)
    } catch (error) {
      invalid(path, String(error))
    }
    if (volume.order !== `z_fastest` || volume.dims.some((size) => size < 1))
      invalid(path, `expected positive dimensions and z_fastest ordering`)
    matrix(volume.lattice, `${path}.lattice`)
    if (!vec3(volume.origin)) invalid(`${path}.origin`, `expected a finite Vec3`)
    if (typeof volume.periodic !== `boolean`) invalid(`${path}.periodic`, `expected a boolean`)
    // Cached host statistics may be stale after a reused buffer was updated.
    volume.data_range = grid_data_range(values)
    if (!Object.values(volume.data_range).every(Number.isFinite))
      invalid(
        `${path}.data_range`,
        `density statistics overflowed; rescale the field and update its units`,
      )
    return volume
  })
  return {
    ...properties,
    volumes: copied_volumes,
  }
}

export const copy_prediction = (
  value: unknown,
  from_json = false,
): StructureToolPrediction => {
  const {
    input: raw_input,
    provenance,
    run_id,
    schema: _schema,
    ...overlay
  } = record(value, `prediction`)
  const input = copy_prediction_input(raw_input)
  if (!Number.isSafeInteger(run_id) || (run_id as number) < 1)
    invalid(`run_id`, `expected a positive safe integer`)
  return {
    ...copy_prediction_overlay(overlay, input.sites.length, from_json),
    input,
    run_id: run_id as number,
    provenance: copy_prediction_provenance(provenance),
  }
}

export function prediction_to_json(prediction: StructureToolPrediction): string {
  const snapshot = copy_prediction(prediction)
  return JSON.stringify({
    schema: `matterviz-prediction-v1`,
    ...snapshot,
    volumes: snapshot.volumes?.map(({ values, ...metadata }) => ({
      ...metadata,
      values: Array.from(values),
    })),
  })
}

// Accept JSON text or an already parsed document so file loading does not parse large grids twice.
export function prediction_from_json(content: unknown): StructureToolPrediction {
  const raw: unknown = typeof content === `string` ? JSON.parse(content) : content
  if (record(raw, `prediction`).schema !== `matterviz-prediction-v1`)
    invalid(`schema`, `expected matterviz-prediction-v1`)
  return copy_prediction(raw, true)
}

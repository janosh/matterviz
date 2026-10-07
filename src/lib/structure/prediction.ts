// Prediction interchange and publication validation. No Svelte/DOM imports: file workers use
// the same contract as live tools. Undefined object fields are omitted; array holes are errors.
import { grid_data_range, type VolumetricData } from '#lib/isosurface/types.js'
import { grid_dimensions } from '#lib/isosurface/grid.js'
import {
  calc_lattice_params,
  create_cart_to_frac,
  is_finite_matrix3x3,
  is_finite_vec3,
  is_pbc,
  matrix_inverse_3x3,
  type Matrix3x3,
  type Vec3,
} from '#lib/math.js'
import { is_elem_symbol } from '#lib/element/helpers.js'
import type { TrajectoryPositionStream } from '#lib/trajectory/index.js'
import type { AnyStructure } from './index'

// Reuse IDs only for the same physical quantity, units and normalization.
export type StructureToolVolume = VolumetricData
// Displayed geometry of the input sites, e.g. a relaxation step. The input stays the run's
// identity (selections, edits and structure exports address it); only the viewer moves.
export interface StructureToolGeometry {
  // Cartesian positions in Å, one per input site in input order.
  positions: Vec3[]
  // Lattice vectors as rows in Å, for cell relaxations of periodic inputs; omit to keep the
  // input cell.
  lattice?: Matrix3x3
}
export interface StructureToolOverlay {
  site_properties?: Record<string, unknown>[]
  geometry?: StructureToolGeometry
  // The path the input sites took (e.g. a relaxation's ionic steps, oldest first), each frame
  // continuous from the previous one rather than wrapped into the cell. Publishing it asks the
  // viewer to draw every atom's trail, which the user can still hide; it stays with the result
  // (undo and redo included) but is never exported.
  trail?: StructureToolGeometry[]
  volumes?: StructureToolVolume[]
  color_property?: string
  // A live preview (e.g. an unconverged density): drawn like a prediction, under the same
  // volume IDs as the final result, but never given to hosts, exported or reopened.
  transient?: boolean
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
  // The viewer run that published it. Viewers give each import a fresh id no run takes.
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

const matrix = (value: unknown, path: string): void => {
  if (!is_finite_matrix3x3(value)) invalid(path, `expected a finite 3x3 lattice`)
  // A singular or ill-conditioned lattice cannot locate a density grid or fractional sites.
  try {
    matrix_inverse_3x3(value as Matrix3x3)
  } catch {
    invalid(path, `lattice must be invertible`)
  }
}

function check_geometry(
  value: unknown,
  input: AnyStructure,
  path = `prediction.geometry`,
): void {
  const { positions, lattice } = record(value, path)
  const n_sites = input.sites.length
  if (!Array.isArray(positions) || positions.length !== n_sites)
    invalid(`${path}.positions`, `expected ${n_sites} positions, one per input site`)
  ;(positions as unknown[]).forEach((position, idx) => {
    if (!is_finite_vec3(position))
      invalid(`${path}.positions[${idx}]`, `expected a finite Cartesian Vec3`)
  })
  if (lattice === undefined) return
  if (!(`lattice` in input))
    invalid(`${path}.lattice`, `a molecule input has no cell to replace`)
  matrix(lattice, `${path}.lattice`)
}

// A host run's trail as a position stream in input-site order, for the trajectory trail
// renderer. Its frames are continuous rather than wrapped into the cell, so no lattice is needed
// to unwrap them or detect jumps.
export const tool_trail_stream = (
  input: AnyStructure,
  trail: readonly StructureToolGeometry[],
): TrajectoryPositionStream => {
  const n_atoms = input.sites.length
  const positions = new Float64Array(trail.length * n_atoms * 3)
  trail.forEach((frame, frame_idx) =>
    frame.positions.forEach((xyz, atom_idx) =>
      positions.set(xyz, (frame_idx * n_atoms + atom_idx) * 3),
    ),
  )
  return {
    positions,
    n_frames: trail.length,
    n_atoms,
    elements: input.sites.map(({ species }) => species[0].element),
    lattice_matrices: null,
    pbc: `lattice` in input ? input.lattice.pbc : null,
    coords_unwrapped: true,
    frame_stride: 1,
    steps: trail.map((_, frame_idx) => frame_idx),
  }
}

// The input with a tool's geometry applied, fractional coordinates recomputed in the
// (possibly relaxed) cell. Molecule sites mirror xyz into abc.
export function apply_tool_geometry(
  input: AnyStructure,
  { positions, lattice }: StructureToolGeometry,
): AnyStructure {
  const to_frac =
    `lattice` in input
      ? create_cart_to_frac(lattice ?? input.lattice.matrix)
      : (xyz: Vec3): Vec3 => xyz
  const sites = input.sites.map((site, idx) => ({
    ...site,
    xyz: positions[idx],
    abc: to_frac(positions[idx]),
  }))
  return lattice && `lattice` in input
    ? {
        ...input,
        sites,
        lattice: { ...input.lattice, matrix: lattice, ...calc_lattice_params(lattice) },
      }
    : { ...input, sites }
}

export function copy_prediction_input(value: unknown): AnyStructure {
  const input = record(copy_prediction_metadata(value, `input`), `input`)
  if (!Array.isArray(input.sites) || !input.sites.length)
    invalid(`input.sites`, `expected sites`)
  for (const [idx, raw] of (input.sites as unknown[]).entries()) {
    const site = record(raw, `input.sites[${idx}]`)
    if (!is_finite_vec3(site.xyz) || !is_finite_vec3(site.abc))
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
    if (!is_pbc(lattice.pbc)) invalid(`input.lattice.pbc`, `expected three booleans`)
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
  input: AnyStructure,
  from_json = false,
): StructureToolOverlay {
  const n_sites = input.sites.length
  const { volumes, ...rest } = record(value, `prediction`)
  const properties = copy_prediction_metadata(rest, `prediction`)
  if (properties.geometry !== undefined) check_geometry(properties.geometry, input)
  const trail: unknown = properties.trail
  if (trail !== undefined) {
    if (!Array.isArray(trail) || trail.length === 0)
      return invalid(`prediction.trail`, `expected a nonempty array of geometries`)
    trail.forEach((frame: unknown, idx) =>
      check_geometry(frame, input, `prediction.trail[${idx}]`),
    )
  }
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
    const identifier = metadata.id as string
    if (ids.has(identifier)) invalid(`${path}.id`, `must be unique: ${identifier}`)
    ids.add(identifier)
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
    if (!is_finite_vec3(volume.origin)) invalid(`${path}.origin`, `expected a finite Vec3`)
    if (typeof volume.periodic !== `boolean`) invalid(`${path}.periodic`, `expected a boolean`)
    if (volume.signed !== undefined && typeof volume.signed !== `boolean`)
      invalid(`${path}.signed`, `expected a boolean`)
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
  if (overlay.transient) invalid(`prediction.transient`, `live previews are not predictions`)
  if (from_json && overlay.trail !== undefined)
    invalid(`prediction.trail`, `trails are how a viewer draws a run, never exported`)
  const input = copy_prediction_input(raw_input)
  if (!Number.isSafeInteger(run_id) || (run_id as number) < 1)
    invalid(`run_id`, `expected a positive safe integer`)
  return {
    ...copy_prediction_overlay(overlay, input, from_json),
    input,
    run_id: run_id as number,
    provenance: copy_prediction_provenance(provenance),
  }
}

export function prediction_to_json(prediction: StructureToolPrediction): string {
  // A trail is how the viewer draws the run, not part of its result.
  const { trail: _trail, ...snapshot } = copy_prediction(prediction)
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

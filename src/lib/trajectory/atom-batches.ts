// Bounded numeric atom reads for spatial analysis.
import { element_by_symbol } from '$lib/element/data'
import { finite_vec3_from_values, partition_point, type Matrix3x3, type Vec3 } from '$lib/math'
import type { Pbc } from '$lib/structure'
import type { TrajectoryRunSignal } from './index'
import type { NumericFrame } from './frame'
import { element_from_atomic_number } from '$lib/element/helpers'

export const ATOM_BATCH_SIZE = 65_536
// Packed sites store atomic numbers as bytes: index both tables by that byte directly.
// Unknown numbers resolve to atomic number 0 and a NaN mass, which the mass check rejects.
const ELEMENT_TABLES = (() => {
  const numbers = new Uint8Array(256)
  const masses = new Float64Array(256).fill(Number.NaN)
  for (let atomic_number = 0; atomic_number < 256; atomic_number++) {
    const symbol = element_from_atomic_number(atomic_number)
    const element = symbol ? element_by_symbol.get(symbol) : undefined
    numbers[atomic_number] = element?.number ?? 0
    masses[atomic_number] = element?.atomic_mass ?? Number.NaN
  }
  return { numbers, masses }
})()
export interface AtomReadOptions {
  frame_idx: number
  start?: number
  count?: number
  velocity_key?: string
  energy_key?: string
  selection_key?: string
  mass_source?: `recorded` | `standard`
}
export interface AtomBatch {
  positions: Float64Array
  velocities?: Float64Array
  energies?: Float64Array
  masses?: Float64Array
  selected?: Uint8Array
  atomic_numbers: Uint8Array
  total_atoms: number
  start: number
  step: number
  time?: number
  cell?: Matrix3x3
  origin: Vec3
  pbc: Pbc
}
// Return independently owned buffers: the reducer can retain batches across later reads.
// Positions and origin share Cartesian coordinates; kinetic channels use the declared input units.
export type ReadAtoms = (
  options: AtomReadOptions,
  signal?: AbortSignal,
) => AtomBatch | Promise<AtomBatch>

export function atom_range(
  total: number,
  { start = 0, count = ATOM_BATCH_SIZE }: AtomReadOptions,
) {
  if (
    ![start, count].every(Number.isInteger) ||
    start < 0 ||
    start >= total ||
    count < 1 ||
    count > ATOM_BATCH_SIZE
  )
    throw new Error(`Invalid atom range: start=${start}, count=${count}, total=${total}`)
  return { start, count: Math.min(count, total - start) }
}

export function frame_atom_batch(
  frame: NumericFrame,
  options: AtomReadOptions,
  recorded_masses?: readonly number[],
  signals?: Record<string, TrajectoryRunSignal>,
): AtomBatch {
  const { sites, coordinates, vector_keys, header } = frame
  const { lattice } = frame.structure
  const { step, metadata } = header
  const origin: Vec3 = finite_vec3_from_values(metadata?.box_origin) ?? [0, 0, 0]
  const time = metadata?.time ?? metadata?.time_ps
  if (time !== undefined && (typeof time !== `number` || !Number.isFinite(time)))
    throw new Error(`Invalid time at step ${step}: ${JSON.stringify(time)}`)
  const { start, count } = atom_range(sites.length, options)
  const { velocity_key, energy_key, selection_key, mass_source } = options
  const batch: AtomBatch = {
    positions: new Float64Array(count * 3),
    atomic_numbers: new Uint8Array(count),
    total_atoms: sites.length,
    start,
    step,
    cell: structuredClone(lattice?.matrix),
    origin: [...origin],
    ...(typeof time === `number` && { time }),
    pbc: [...(lattice?.pbc ?? [false, false, false])],
    ...(velocity_key && { velocities: new Float64Array(count * 3) }),
    ...(energy_key && { energies: new Float64Array(count) }),
    ...(selection_key && { selected: new Uint8Array(count) }),
    ...(mass_source && { masses: new Float64Array(count) }),
  }
  const channels = [velocity_key, energy_key, selection_key].map((key) => {
    const channel = key ? signals?.[key] : undefined
    if (!channel) return undefined
    if (!(`values` in channel))
      throw new Error(`Signal ${key} requires a numeric source reader`)
    const sample_idx = partition_point(channel.steps, (sample_step) => sample_step < step)
    if (channel.steps[sample_idx] !== step)
      throw new Error(`Signal ${key} has no sample at step ${step}`)
    const width = key === velocity_key ? 3 : 1
    if (
      channel.sample_shape.join(`,`) !==
        (width === 3 ? `${sites.length},3` : `${sites.length}`) &&
      !(sites.length === 1 && width === 1 && channel.sample_shape.length === 0)
    )
      throw new Error(`Signal ${key} is not an aligned per-atom channel`)
    return channel.values.subarray(
      sample_idx * sites.length * width,
      (sample_idx + 1) * sites.length * width,
    )
  })
  const [velocity_signal, energy_signal, selection_signal] = channels
  const frame_width = 6 + 3 * vector_keys.length
  const velocity_column =
    velocity_key && !Object.hasOwn(frame.scalar_columns ?? {}, velocity_key)
      ? vector_keys.indexOf(velocity_key)
      : -1
  const records = sites instanceof Uint8Array ? undefined : sites
  // Resolve each channel's source once per batch; the atom loop only indexes into it.
  const property_reader = (key: string) => {
    const column = frame.scalar_columns?.[key]
    return (atom_idx: number): unknown =>
      column?.[atom_idx] ?? records?.[atom_idx].properties[key]
  }
  const { positions, atomic_numbers, masses, velocities, energies, selected } = batch
  const [origin_x, origin_y, origin_z] = origin
  for (let idx = 0; idx < count; idx++) {
    const offset = (start + idx) * frame_width
    positions[idx * 3] = coordinates[offset] + origin_x
    positions[idx * 3 + 1] = coordinates[offset + 1] + origin_y
    positions[idx * 3 + 2] = coordinates[offset + 2] + origin_z
  }
  // Standard elements by atomic number: packed sites take two table reads per atom instead
  // of a symbol lookup followed by a Map lookup. Written straight into the batch; missing
  // elements leave a NaN mass for the check below.
  const standard_masses = mass_source === `standard` ? masses : undefined
  if (sites instanceof Uint8Array) {
    const { numbers, masses: element_masses } = ELEMENT_TABLES
    for (let idx = 0; idx < count; idx++) {
      const atomic_number = sites[start + idx]
      atomic_numbers[idx] = numbers[atomic_number]
      if (standard_masses) standard_masses[idx] = element_masses[atomic_number]
    }
  } else {
    for (let idx = 0; idx < count; idx++) {
      const symbol = sites[start + idx].species[0]?.element
      const element = symbol ? element_by_symbol.get(symbol) : undefined
      atomic_numbers[idx] = element?.number ?? 0
      if (standard_masses) standard_masses[idx] = element?.atomic_mass ?? Number.NaN
    }
  }
  const mass_property = masses && !standard_masses ? property_reader(`mass`) : undefined
  const velocity_property =
    velocities && velocity_key && !velocity_signal && velocity_column < 0
      ? property_reader(velocity_key)
      : undefined
  const energy_property = energies && energy_key ? property_reader(energy_key) : undefined
  const selection_property =
    selected && selection_key ? property_reader(selection_key) : undefined
  // Per-atom validation keeps its original order (mass, velocity, energy, selection) so the
  // first invalid atom reports the same error as a one-atom-at-a-time reader.
  for (let idx = 0; idx < count; idx++) {
    const atom_idx = start + idx
    if (masses) {
      const mass = standard_masses
        ? standard_masses[idx]
        : (recorded_masses?.[atom_idx] ?? mass_property?.(atom_idx))
      if (typeof mass !== `number` || !Number.isFinite(mass) || mass <= 0)
        throw new Error(
          `Missing or invalid ${mass_source} mass at atom ${atom_idx}, step ${step}`,
        )
      masses[idx] = mass
    }
    if (velocities && velocity_key) {
      let velocity: ArrayLike<unknown> = coordinates
      let offset = atom_idx * frame_width + 6 + velocity_column * 3
      if (velocity_signal) {
        velocity = velocity_signal
        offset = atom_idx * 3
      } else if (velocity_property) {
        const value = velocity_property(atom_idx)
        if ((!Array.isArray(value) && !(value instanceof Float64Array)) || value.length !== 3)
          throw new Error(
            `Missing or invalid ${velocity_key} at atom ${atom_idx}, step ${step}`,
          )
        velocity = value
        offset = 0
      }
      for (let axis = 0; axis < 3; axis++) {
        const component = velocity[offset + axis]
        if (typeof component !== `number` || !Number.isFinite(component))
          throw new Error(
            `Invalid ${velocity_key} at atom ${atom_idx}, step ${step}, axis ${axis}`,
          )
        velocities[idx * 3 + axis] = component
      }
    }
    if (energies && energy_key) {
      const energy = energy_signal?.[atom_idx] ?? energy_property?.(atom_idx)
      if (typeof energy !== `number` || !Number.isFinite(energy) || energy < 0)
        throw new Error(`Missing or invalid ${energy_key} at atom ${atom_idx}, step ${step}`)
      energies[idx] = energy
    }
    if (selected && selection_key) {
      const value = selection_signal?.[atom_idx] ?? selection_property?.(atom_idx)
      if (value !== 0 && value !== 1 && typeof value !== `boolean`)
        throw new Error(
          `Selection ${selection_key} must be boolean or 0/1 at atom ${atom_idx}`,
        )
      selected[idx] = Number(value)
    }
  }
  return batch
}

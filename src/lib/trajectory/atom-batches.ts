// Numeric atom access shared by spatial analysis and compact trajectory rendering.
import { element_by_symbol } from '$lib/element/data'
import { partition_point, type Matrix3x3, type Vec3 } from '$lib/math'
import type { Pbc } from '$lib/structure'
import type { TrajectoryRunSignal } from './index'
import type { NumericFrame } from './frame'
import { element_from_atomic_number } from '$lib/element/helpers'

export const ATOM_BATCH_SIZE = 65_536
export interface AtomReadOptions {
  frame_idx: number
  start?: number
  count?: number
  stride?: number
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
  stride: number
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
  { start = 0, count = ATOM_BATCH_SIZE, stride = 1 }: AtomReadOptions,
) {
  if (
    ![start, count, stride].every(Number.isInteger) ||
    start < 0 ||
    start >= total ||
    count < 1 ||
    count > ATOM_BATCH_SIZE ||
    stride < 1
  )
    throw new Error(
      `Invalid atom range: start=${start}, count=${count}, stride=${stride}, total=${total}`,
    )
  return { start, stride, count: Math.min(count, Math.ceil((total - start) / stride)) }
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
  const box_origin = metadata?.box_origin
  const origin =
    Array.isArray(box_origin) && box_origin.length === 3 && box_origin.every(Number.isFinite)
      ? (box_origin as Vec3)
      : ([0, 0, 0] as Vec3)
  const time = metadata?.time ?? metadata?.time_ps
  if (time !== undefined && (typeof time !== `number` || !Number.isFinite(time)))
    throw new Error(`Invalid time at step ${step}: ${JSON.stringify(time)}`)
  const { start, count, stride } = atom_range(sites.length, options)
  const { velocity_key, energy_key, selection_key, mass_source } = options
  const batch: AtomBatch = {
    positions: new Float64Array(count * 3),
    atomic_numbers: new Uint8Array(count),
    total_atoms: sites.length,
    start,
    stride,
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
  const frame_width = 6 + 3 * vector_keys.length
  const velocity_column =
    velocity_key && !Object.hasOwn(frame.scalar_columns ?? {}, velocity_key)
      ? vector_keys.indexOf(velocity_key)
      : -1
  const property = (idx: number, key: string): unknown =>
    frame.scalar_columns?.[key]?.[idx] ??
    (sites instanceof Uint8Array ? undefined : sites[idx].properties[key])
  for (let idx = 0; idx < count; idx++) {
    const atom_idx = start + idx * stride
    const symbol =
      sites instanceof Uint8Array
        ? element_from_atomic_number(sites[atom_idx])
        : sites[atom_idx].species[0]?.element
    const element = symbol ? element_by_symbol.get(symbol) : undefined
    batch.atomic_numbers[idx] = element?.number ?? 0
    for (let axis = 0; axis < 3; axis++)
      batch.positions[idx * 3 + axis] =
        coordinates[atom_idx * frame_width + axis] + origin[axis]
    if (batch.masses) {
      const mass =
        mass_source === `standard`
          ? element?.atomic_mass
          : (recorded_masses?.[atom_idx] ?? property(atom_idx, `mass`))
      if (typeof mass !== `number` || !Number.isFinite(mass) || mass <= 0)
        throw new Error(
          `Missing or invalid ${mass_source} mass at atom ${atom_idx}, step ${step}`,
        )
      batch.masses[idx] = mass
    }
    if (batch.velocities && velocity_key) {
      const velocity =
        channels[0] ?? (velocity_column >= 0 ? coordinates : property(atom_idx, velocity_key))
      const offset = channels[0]
        ? atom_idx * 3
        : velocity_column >= 0
          ? atom_idx * frame_width + 6 + velocity_column * 3
          : 0
      if (
        (!Array.isArray(velocity) && !(velocity instanceof Float64Array)) ||
        (!channels[0] && velocity_column < 0 && velocity.length !== 3)
      )
        throw new Error(`Missing or invalid ${velocity_key} at atom ${atom_idx}, step ${step}`)
      for (let axis = 0; axis < 3; axis++) {
        const component = velocity[offset + axis]
        if (!Number.isFinite(component))
          throw new Error(
            `Invalid ${velocity_key} at atom ${atom_idx}, step ${step}, axis ${axis}`,
          )
        batch.velocities[idx * 3 + axis] = component
      }
    }
    if (batch.energies && energy_key) {
      const energy = channels[1]?.[atom_idx] ?? property(atom_idx, energy_key)
      if (typeof energy !== `number` || !Number.isFinite(energy) || energy < 0)
        throw new Error(`Missing or invalid ${energy_key} at atom ${atom_idx}, step ${step}`)
      batch.energies[idx] = energy
    }
    if (batch.selected && selection_key) {
      const selected = channels[2]?.[atom_idx] ?? property(atom_idx, selection_key)
      if (selected !== 0 && selected !== 1 && typeof selected !== `boolean`)
        throw new Error(
          `Selection ${selection_key} must be boolean or 0/1 at atom ${atom_idx}`,
        )
      batch.selected[idx] = Number(selected)
    }
  }
  return batch
}

export const atom_batch_transfers = (batch: AtomBatch): ArrayBuffer[] => [
  ...new Set(
    Object.values(batch).flatMap((value) =>
      ArrayBuffer.isView(value) ? [value.buffer as ArrayBuffer] : [],
    ),
  ),
]

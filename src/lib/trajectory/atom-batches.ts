// Numeric atom access shared by spatial analysis and compact trajectory rendering.
import { element_by_symbol } from '$lib/element/data'
import { partition_point, type Matrix3x3, type Vec3 } from '$lib/math'
import type { Pbc } from '$lib/structure'
import type { TrajectoryFrame, TrajectoryRunSignal } from './index'

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
  frame: TrajectoryFrame,
  options: AtomReadOptions,
  recorded_masses?: readonly number[],
  signals?: Record<string, TrajectoryRunSignal>,
): AtomBatch {
  const { sites } = frame.structure
  const box_origin = frame.metadata?.box_origin
  const origin =
    Array.isArray(box_origin) && box_origin.length === 3 && box_origin.every(Number.isFinite)
      ? (box_origin as Vec3)
      : ([0, 0, 0] as Vec3)
  const time = frame.metadata?.time ?? frame.metadata?.time_ps
  if (time !== undefined && (typeof time !== `number` || !Number.isFinite(time)))
    throw new Error(`Invalid time at step ${frame.step}: ${JSON.stringify(time)}`)
  const { start, count, stride } = atom_range(sites.length, options)
  const { velocity_key, energy_key, selection_key, mass_source } = options
  const batch: AtomBatch = {
    positions: new Float64Array(count * 3),
    atomic_numbers: new Uint8Array(count),
    total_atoms: sites.length,
    start,
    stride,
    step: frame.step,
    cell: `lattice` in frame.structure ? frame.structure.lattice.matrix : undefined,
    origin,
    ...(typeof time === `number` && { time }),
    pbc: `lattice` in frame.structure ? frame.structure.lattice.pbc : [false, false, false],
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
    const sample_idx = partition_point(channel.steps, (step) => step < frame.step)
    if (channel.steps[sample_idx] !== frame.step)
      throw new Error(`Signal ${key} has no sample at step ${frame.step}`)
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
  for (let idx = 0; idx < count; idx++) {
    const atom_idx = start + idx * stride
    const site = sites[atom_idx]
    const element = element_by_symbol.get(site.species[0]?.element)
    batch.atomic_numbers[idx] = element?.number ?? 0
    for (let axis = 0; axis < 3; axis++)
      batch.positions[idx * 3 + axis] = site.xyz[axis] + origin[axis]
    if (batch.masses) {
      const mass =
        mass_source === `standard`
          ? element?.atomic_mass
          : (recorded_masses?.[atom_idx] ?? site.properties.mass)
      if (typeof mass !== `number` || !Number.isFinite(mass) || mass <= 0)
        throw new Error(
          `Missing or invalid ${mass_source} mass at atom ${atom_idx}, step ${frame.step}`,
        )
      batch.masses[idx] = mass
    }
    if (batch.velocities && velocity_key) {
      const velocity = channels[0] ?? site.properties[velocity_key]
      if (
        (!Array.isArray(velocity) && !(velocity instanceof Float64Array)) ||
        (!channels[0] && velocity.length !== 3)
      )
        throw new Error(
          `Missing or invalid ${velocity_key} at atom ${atom_idx}, step ${frame.step}`,
        )
      for (let axis = 0; axis < 3; axis++) {
        const component = velocity[(channels[0] ? atom_idx * 3 : 0) + axis]
        if (!Number.isFinite(component))
          throw new Error(
            `Invalid ${velocity_key} at atom ${atom_idx}, step ${frame.step}, axis ${axis}`,
          )
        batch.velocities[idx * 3 + axis] = component
      }
    }
    if (batch.energies && energy_key) {
      const energy = channels[1]?.[atom_idx] ?? site.properties[energy_key]
      if (typeof energy !== `number` || !Number.isFinite(energy) || energy < 0)
        throw new Error(
          `Missing or invalid ${energy_key} at atom ${atom_idx}, step ${frame.step}`,
        )
      batch.energies[idx] = energy
    }
    if (batch.selected && selection_key) {
      const selected = channels[2]?.[atom_idx] ?? site.properties[selection_key]
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

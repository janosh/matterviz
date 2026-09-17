// Spatial kinetic-energy reduction with bounded atom batches and one frame of bin statistics.
import {
  cross_3d,
  dot,
  matrix_inverse_3x3,
  normalize_vec,
  type Matrix3x3,
  type Vec3,
} from '$lib/math'
import type { SliceResult } from '$lib/isosurface/slice'
import type { FrameRange, ParseProgress } from './index'
import { ATOM_BATCH_SIZE, type AtomBatch, type ReadAtoms } from './atom-batches'

export const BOLTZMANN_EV = 1.380649e-23 / 1.602176634e-19
const AMU_KG = 1.66053906892e-27
const JOULE_EV = 1 / 1.602176634e-19
export const VELOCITY_UNITS = { 'A/fs': 1e5, 'A/ps': 100, 'm/s': 1 } as const
export const ENERGY_UNITS = {
  eV: 1,
  J: JOULE_EV,
  'kcal/mol': (4184 / 6.02214076e23) * JOULE_EV,
} as const

export interface HotspotGrid {
  dims: Vec3
  origin: Vec3
  cell: Matrix3x3
  pbc: readonly [boolean, boolean, boolean]
}
export interface HotspotOptions extends FrameRange {
  frame_stride?: number
  grid?: HotspotGrid
  bins?: number
  coordinates?: `device` | `cell`
  motion?: `device` | `translation` | `local`
  velocity_key?: string
  velocity_unit?: keyof typeof VELOCITY_UNITS
  energy_key?: string
  energy_unit?: keyof typeof ENERGY_UNITS
  energy_reference?: string
  mass_source?: `recorded` | `standard`
  mass_unit?: `amu` | `kg`
  selection_key?: string
  elements?: number[]
  dimensions?: 2 | 3
  // Effective translational DOF before velocity correction, or AFTER the declared reference
  // correction for stored energies. Stored energies without explicit DOF cannot show Kelvin.
  dof_per_atom?: number
  max_bytes?: number
  batch_size?: number
}
export interface HotspotResult {
  grid: HotspotGrid
  // Time-integrated totals, retained so masks/units/thresholds never require rereading atoms.
  energy: Float64Array
  population: Float64Array
  dof: Float64Array
  occupied_frames: Uint32Array
  time_weight: number
  frames: number
  first_step: number
  last_step: number
  weighting: `recorded time` | `MD steps`
  excluded_atoms: number
  reserved_buffer_bytes: number
  options: HotspotOptions
}
export interface HotspotRequest extends HotspotOptions {
  // Buffers the caller retains while replacing a previous result.
  retained_bytes?: number
  signal?: AbortSignal
  on_progress?: (progress: HotspotProgress) => void
  // An instantaneous preview precedes the time average without changing its sampling.
  preview_frame?: number
  on_preview?: (result: HotspotResult) => void | Promise<void>
  on_partial?: (result: HotspotResult) => void | Promise<void>
}
export interface HotspotProgress extends ParseProgress {
  // Completed reductions only; current can include a partly read frame.
  completed: number
}
export interface HotspotCoverage {
  start: number
  stride: number
  total: number
  completed: number
  busy: boolean
  preview_frame?: number
}
export type HotspotMetric = `energy` | `temperature`

// Use the same source requirements for the form and the calculation entry point.
export function hotspot_requirements(options: HotspotOptions): string {
  const energy = options.energy_key !== undefined
  const unit = energy ? options.energy_unit : options.velocity_unit
  const units: Readonly<Record<string, number>> = energy ? ENERGY_UNITS : VELOCITY_UNITS
  return [
    !(energy ? options.energy_key : (options.velocity_key ?? `velocity`))?.trim() &&
      `Enter the ${energy ? `energy` : `velocity`} property.`,
    !Number.isFinite(unit && units[unit]) && `Select ${energy ? `energy` : `velocity`} units.`,
    energy
      ? !options.energy_reference?.trim() && `Describe the stored energy reference.`
      : options.mass_source !== `standard` &&
        !options.mass_unit &&
        `Select mass units for recorded masses, or choose standard elemental masses.`,
  ]
    .filter(Boolean)
    .join(` `)
}

// Prefer declared units. Otherwise sample atomic-scale masses, whose amu/kg magnitudes
// are disjoint; leave reduced, mixed or unrecognized units for an explicit choice.
export function infer_mass_unit(
  masses: readonly unknown[],
  declared?: unknown,
): HotspotOptions[`mass_unit`] {
  if (declared !== undefined) {
    const unit = typeof declared === `string` ? declared.trim().toLowerCase() : ``
    if ([`amu`, `u`, `da`, `dalton`, `daltons`].includes(unit)) return `amu`
    return unit === `kg` ? `kg` : undefined
  }
  let inferred: HotspotOptions[`mass_unit`]
  const samples = Math.min(masses.length, 64)
  for (let idx = 0; idx < samples; idx++) {
    const mass = masses[Math.floor((idx * masses.length) / samples)]
    if (typeof mass !== `number`) return undefined
    const unit =
      mass >= 0.5 && mass <= 1000
        ? `amu`
        : mass >= 0.5 * AMU_KG && mass <= 1000 * AMU_KG
          ? `kg`
          : undefined
    if (!unit || (inferred && inferred !== unit)) return undefined
    inferred = unit
  }
  return inferred
}

export function hotspot_values(
  result: HotspotResult,
  metric: HotspotMetric,
  min_atoms = 1,
): Float32Array {
  if (!Number.isFinite(min_atoms) || min_atoms < 0)
    throw new Error(`Invalid minimum population ${min_atoms}`)
  return Float32Array.from(result.energy, (energy, idx) => {
    if (
      !result.occupied_frames[idx] ||
      result.population[idx] / result.time_weight < min_atoms
    )
      return NaN
    if (metric === `temperature`)
      return result.dof[idx] > 0 ? (2 * energy) / (BOLTZMANN_EV * result.dof[idx]) : NaN
    return energy / result.population[idx]
  })
}

export const hotspot_mean = (result: HotspotResult, metric: HotspotMetric): number => {
  const energy = result.energy.reduce((sum, value) => sum + value, 0)
  const denominator = (metric === `energy` ? result.population : result.dof).reduce(
    (sum, value) => sum + value,
    0,
  )
  return denominator > 0
    ? (energy / denominator) * (metric === `temperature` ? 2 / BOLTZMANN_EV : 1)
    : NaN
}

export interface HotspotDisplayValues {
  values: Float32Array
  mean: number
}

// Display controls can be empty mid-edit; keep that normalization out of the strict
// analysis API and share these values between renderers instead of recomputing them.
export const hotspot_display_values = (
  result: HotspotResult,
  metric: HotspotMetric,
  min_atoms: number,
): HotspotDisplayValues => ({
  values: hotspot_values(
    result,
    metric,
    Number.isFinite(min_atoms) && min_atoms >= 0 ? min_atoms : 0,
  ),
  mean: hotspot_mean(result, metric),
})

export function validate_hotspot_grid(grid: HotspotGrid): number {
  if (grid.dims.length !== 3 || grid.dims.some((size) => !Number.isInteger(size) || size < 1))
    throw new Error(`Hotspot grid dimensions must be positive integers: ${grid.dims}`)
  if (
    grid.origin.length !== 3 ||
    !grid.origin.every(Number.isFinite) ||
    grid.cell.length !== 3 ||
    grid.cell.some((row) => row.length !== 3 || !row.every(Number.isFinite)) ||
    grid.pbc.length !== 3 ||
    grid.pbc.some((value) => typeof value !== `boolean`)
  )
    throw new Error(
      `Hotspot grid needs a finite origin, invertible cell and three periodic flags`,
    )
  matrix_inverse_3x3(grid.cell)
  return grid.dims[0] * grid.dims[1] * grid.dims[2]
}

// Cell vectors are rows: fractional = Cartesian row vector × inverse(cell).
export function hotspot_bin(
  xyz: ArrayLike<number>,
  offset: number,
  grid: HotspotGrid,
  inverse = matrix_inverse_3x3(grid.cell),
): number {
  const coord_x = xyz[offset] - grid.origin[0]
  const coord_y = xyz[offset + 1] - grid.origin[1]
  const coord_z = xyz[offset + 2] - grid.origin[2]
  let index = 0
  for (let axis = 0; axis < 3; axis++) {
    let fraction =
      coord_x * inverse[0][axis] + coord_y * inverse[1][axis] + coord_z * inverse[2][axis]
    if (grid.pbc[axis]) fraction -= Math.floor(fraction)
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return -1
    index =
      index * grid.dims[axis] +
      Math.min(grid.dims[axis] - 1, Math.floor(fraction * grid.dims[axis]))
  }
  return index
}

// Message tasks yield to cancellation and interactive reads without the browser's nested
// timer clamp adding 4 ms to every atom batch in a long scan.
const yield_turn = (): Promise<void> =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel()
    port1.addEventListener(`message`, () => {
      port1.close()
      port2.close()
      resolve()
    })
    port1.start()
    port2.postMessage(null)
  })

// Rasterize a cell-aligned plane in an orthonormal physical basis. Samples select a bin
// directly: there is no interpolation across bin boundaries or into unoccupied cells.
export function hotspot_slice(
  grid: HotspotGrid,
  values: Float32Array,
  axis: number,
  layer: number,
  minimum = -Infinity,
): SliceResult {
  const n_bins = validate_hotspot_grid(grid)
  if (
    ![0, 1, 2].includes(axis) ||
    !Number.isInteger(layer) ||
    layer < 0 ||
    layer >= grid.dims[axis] ||
    values.length !== n_bins
  )
    throw new Error(
      `Invalid hotspot slice: axis=${axis}, layer=${layer}, values=${values.length}`,
    )
  const [axis_u, axis_v] = [0, 1, 2].filter((value) => value !== axis)
  const { cell, dims, origin } = grid
  const u_axis = normalize_vec(cell[axis_u])
  const normal = normalize_vec(cross_3d(cell[axis_u], cell[axis_v]))
  const v_axis = cross_3d(normal, u_axis)
  const span_u = Math.hypot(...cell[axis_u])
  const shear = dot(cell[axis_v], u_axis)
  const span_v = dot(cell[axis_v], v_axis)
  const low_u = Math.min(0, shear)
  const high_u = span_u + Math.max(0, shear)
  const orthogonal = Math.abs(shear) <= Number.EPSILON * span_u * 8
  const width = orthogonal
    ? dims[axis_u]
    : Math.min(512, Math.max(64, Math.ceil((dims[axis_u] * 4 * (high_u - low_u)) / span_u)))
  const height = orthogonal ? dims[axis_v] : Math.max(64, Math.min(512, dims[axis_v] * 4))
  const data = new Float64Array(width * height).fill(NaN)
  const mask = new Uint8Array(data.length)
  const coordinates = [0, 0, 0]
  coordinates[axis] = layer
  let min = Infinity
  let max = -Infinity
  for (let row = 0; row < height; row++) {
    const fraction_v = (row + 0.5) / height
    coordinates[axis_v] = Math.min(dims[axis_v] - 1, Math.floor(fraction_v * dims[axis_v]))
    for (let col = 0; col < width; col++) {
      const coord_u = low_u + ((col + 0.5) / width) * (high_u - low_u)
      const fraction_u = (coord_u - shear * fraction_v) / span_u
      if (fraction_u < 0 || fraction_u >= 1) continue
      coordinates[axis_u] = Math.floor(fraction_u * dims[axis_u])
      const bin = (coordinates[0] * dims[1] + coordinates[1]) * dims[2] + coordinates[2]
      const value = values[bin]
      if (!Number.isFinite(value) || value < minimum) continue
      const pixel = row * width + col
      data[pixel] = value
      mask[pixel] = 1
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }
  return {
    data,
    mask,
    width,
    height,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 1,
    point: origin.map(
      (value, idx) => value + (cell[axis][idx] * (layer + 0.5)) / dims[axis],
    ) as Vec3,
    normal,
    u_axis,
    v_axis,
    u_range: [low_u, high_u],
    v_range: [0, span_v],
    polygon: [
      [0, 0],
      [span_u, 0],
      [span_u + shear, span_v],
      [shear, span_v],
    ],
  }
}

export async function calculate_hotspots(
  frame_count: number,
  read_atoms: ReadAtoms,
  request: HotspotRequest,
): Promise<HotspotResult> {
  const result = await reduce_hotspots(frame_count, read_atoms, request)
  if (!result.population.some((value) => value > 0))
    throw new Error(`No selected atoms lie inside the hotspot grid`)
  return result
}

// An empty preview is valid: the selection can be populated in later frames.
async function reduce_hotspots(
  frame_count: number,
  read_atoms: ReadAtoms,
  request: HotspotRequest,
): Promise<HotspotResult> {
  const {
    signal,
    on_progress,
    preview_frame,
    on_preview,
    on_partial,
    retained_bytes = 0,
    ...options
  } = request
  const {
    start_frame = 0,
    end_frame = frame_count,
    frame_stride = 1,
    motion = `device`,
    coordinates = `device`,
    dimensions = 3,
    dof_per_atom = options.energy_key ? 0 : dimensions,
    batch_size = ATOM_BATCH_SIZE,
    max_bytes = 128 * 1024 ** 2,
  } = options
  const required_bytes = (grid_bytes = 0, preview_bytes = 0) =>
    grid_bytes + retained_bytes + preview_bytes + batch_size * 3 * 66 + 16 * 1024 ** 2
  if (
    !Number.isFinite(retained_bytes) ||
    retained_bytes < 0 ||
    !Number.isFinite(max_bytes) ||
    max_bytes < required_bytes()
  )
    throw new Error(
      `Hotspot batches exceed the ${max_bytes}-byte budget before grid allocation`,
    )
  if (
    ![start_frame, end_frame, frame_stride, batch_size].every(Number.isInteger) ||
    start_frame < 0 ||
    end_frame > frame_count ||
    end_frame <= start_frame ||
    frame_stride < 1 ||
    batch_size < 1 ||
    batch_size > ATOM_BATCH_SIZE
  )
    throw new Error(
      `Invalid hotspot frame range or batch size: ${start_frame}:${end_frame}:${frame_stride}, batch=${batch_size}`,
    )
  if (
    preview_frame !== undefined &&
    (!Number.isInteger(preview_frame) || preview_frame < 0 || preview_frame >= frame_count)
  )
    throw new Error(`Invalid hotspot preview frame ${preview_frame}`)
  if (
    ![2, 3].includes(dimensions) ||
    (!(dof_per_atom > 0 && dof_per_atom <= dimensions) &&
      !(options.energy_key && options.dof_per_atom === undefined))
  )
    throw new Error(`Degrees of freedom must be > 0 and <= ${dimensions}, got ${dof_per_atom}`)
  if (
    ![`device`, `translation`, `local`].includes(motion) ||
    ![`device`, `cell`].includes(coordinates)
  )
    throw new Error(`Invalid hotspot motion/coordinate mode: ${motion}/${coordinates}`)
  if (options.energy_key && motion !== `device`)
    throw new Error(`Stored kinetic energy cannot remove motion; select velocities`)
  const requirements = hotspot_requirements(options)
  if (requirements) throw new Error(requirements)
  const velocity_factor = options.velocity_unit && VELOCITY_UNITS[options.velocity_unit]
  const energy_factor = options.energy_unit && ENERGY_UNITS[options.energy_unit]
  const mass_factor = options.mass_unit === `kg` ? 1 : AMU_KG
  if (
    (options.mass_unit !== undefined && ![`amu`, `kg`].includes(options.mass_unit)) ||
    (options.mass_source !== undefined &&
      ![`recorded`, `standard`].includes(options.mass_source))
  )
    throw new Error(
      `Invalid mass source or units: ${options.mass_source}/${options.mass_unit}`,
    )
  if (options.mass_source === `standard` && options.mass_unit === `kg`)
    throw new Error(`Standard elemental masses use amu`)
  let preview_bytes = 0
  if (preview_frame !== undefined && on_preview) {
    const preview = await reduce_hotspots(frame_count, read_atoms, {
      ...options,
      start_frame: preview_frame,
      end_frame: preview_frame + 1,
      frame_stride: 1,
      retained_bytes,
      signal,
    })
    signal?.throwIfAborted()
    preview_bytes = preview.energy.byteLength * 3 + preview.occupied_frames.byteLength
    await on_preview(preview)
    // Deliver the preview before allocating the average and reading further frames.
    await yield_turn()
    signal?.throwIfAborted()
  }
  const kinetic_factor = 0.5 * mass_factor * (velocity_factor ?? 1) ** 2 * JOULE_EV
  const frames = Math.ceil((end_frame - start_frame) / frame_stride)
  const channels = options.energy_key
    ? { energy_key: options.energy_key }
    : {
        velocity_key: options.velocity_key ?? `velocity`,
        mass_source: options.mass_source ?? `recorded`,
      }
  const read = async (frame_idx: number, start = 0, with_channels = true) => {
    signal?.throwIfAborted()
    const batch = await read_atoms(
      {
        frame_idx,
        start,
        count: batch_size,
        ...(with_channels ? channels : {}),
        selection_key: options.selection_key,
      },
      signal,
    )
    signal?.throwIfAborted()
    if (
      !Number.isInteger(batch.total_atoms) ||
      batch.total_atoms < 1 ||
      batch.start + batch.atomic_numbers.length > batch.total_atoms
    )
      throw new Error(`Invalid coordinates or atom count at frame ${frame_idx}, atom ${start}`)
    for (const position of batch.positions)
      if (!Number.isFinite(position))
        throw new Error(
          `Invalid coordinates or atom count at frame ${frame_idx}, atom ${start}`,
        )
    if (
      batch.positions.length !== batch.atomic_numbers.length * 3 ||
      batch.start !== start ||
      batch.stride !== 1 ||
      !batch.atomic_numbers.length ||
      batch.atomic_numbers.length > batch_size
    )
      throw new Error(`Invalid numeric atom batch at frame ${frame_idx}, atom ${start}`)
    const count = batch.atomic_numbers.length
    if (
      options.selection_key &&
      (!batch.selected ||
        batch.selected.length !== count ||
        batch.selected.some((value) => value !== 0 && value !== 1))
    )
      throw new Error(
        `Missing or invalid selection ${options.selection_key} at frame ${frame_idx}, atom ${start}`,
      )
    if (
      with_channels &&
      (options.energy_key
        ? batch.energies?.length !== count
        : batch.masses?.length !== count || batch.velocities?.length !== count * 3)
    )
      throw new Error(`Missing kinetic-energy inputs at frame ${frame_idx}, atom ${start}`)
    return batch
  }
  let first = await read(start_frame)
  let grid = options.grid
  if (!grid) {
    let cell = first.cell
    let origin: Vec3 = [...first.origin]
    if (!cell) {
      const low: Vec3 = [Infinity, Infinity, Infinity]
      const high: Vec3 = [-Infinity, -Infinity, -Infinity]
      let batch = first
      for (;;) {
        for (let idx = 0; idx < batch.positions.length; idx++) {
          const axis = idx % 3
          low[axis] = Math.min(low[axis], batch.positions[idx])
          high[axis] = Math.max(high[axis], batch.positions[idx])
        }
        const next = batch.start + batch.atomic_numbers.length
        if (next >= batch.total_atoms) break
        await yield_turn()
        batch = await read(start_frame, next, false)
      }
      origin = low.map((value) => value - 1e-6) as Vec3
      cell = [
        [high[0] - low[0] + 2e-6, 0, 0],
        [0, high[1] - low[1] + 2e-6, 0],
        [0, 0, high[2] - low[2] + 2e-6],
      ]
    }
    const lengths = cell.map((row) => Math.hypot(...row))
    const target = options.bins ?? Math.max(1, Math.round(Math.cbrt(first.total_atoms / 100)))
    if (!Number.isInteger(target) || target < 1 || target > 128)
      throw new Error(`Bins per axis must be 1..128, got ${target}`)
    const geometric_mean = Math.cbrt(lengths[0] * lengths[1] * lengths[2])
    grid = {
      cell,
      origin,
      dims: lengths.map((length) =>
        Math.max(1, Math.min(128, Math.round((target * length) / geometric_mean))),
      ) as Vec3,
      pbc: coordinates === `cell` ? [...first.pbc] : [false, false, false],
    }
  }
  const n_bins = validate_hotspot_grid(grid)
  // First batch, next-frame lookahead and current batch can coexist during a frame.
  // Reserve the caller's completed map during replacement, plus one 8 MiB
  // physical decoder chunk and 8 MiB for slice/display pixels. Streaming additionally
  // reserves the published map and an in-flight snapshot. No frame history is retained.
  const buffer_bytes = required_bytes(n_bins * (on_partial ? 160 : 104), preview_bytes)
  if (!Number.isFinite(max_bytes) || buffer_bytes > max_bytes)
    throw new Error(
      `Hotspot buffers require ${buffer_bytes} bytes, above budget ${max_bytes}; reduce grid or batch size`,
    )
  // Per bin: count, mass, relative mean xyz, energy/central moment, velocity anchor xyz.
  const scratch = new Float64Array(n_bins * 9)
  const result: HotspotResult = {
    grid,
    energy: new Float64Array(n_bins),
    population: new Float64Array(n_bins),
    dof: new Float64Array(n_bins),
    occupied_frames: new Uint32Array(n_bins),
    time_weight: 0,
    frames,
    first_step: first.step,
    last_step: first.step,
    weighting: first.time === undefined ? `MD steps` : `recorded time`,
    excluded_atoms: 0,
    reserved_buffer_bytes: buffer_bytes,
    options,
  }
  const element_filter = options.elements ? new Set(options.elements) : undefined
  const timestamp = (batch: AtomBatch): number => {
    if (
      (result.weighting === `recorded time` && batch.time === undefined) ||
      (result.weighting === `MD steps` && batch.time !== undefined)
    )
      throw new Error(`Timestamp availability changes at step ${batch.step}`)
    return batch.time ?? batch.step
  }
  let previous_time = timestamp(first)
  let next_first: AtomBatch | undefined
  let deadline = performance.now() + 8
  let last_partial = performance.now()
  for (let sample_idx = 0; sample_idx < frames; sample_idx++) {
    const frame_idx = start_frame + sample_idx * frame_stride
    if (next_first) first = next_first
    next_first = sample_idx + 1 < frames ? await read(frame_idx + frame_stride) : undefined
    const time = timestamp(first)
    const next_time = next_first ? timestamp(next_first) : undefined
    if (
      !Number.isFinite(first.step) ||
      !Number.isFinite(time) ||
      (next_first &&
        (!(next_first.step > first.step) ||
          !(Number.isFinite(next_time) && Number(next_time) > time)))
    )
      throw new Error(`Hotspot time steps must increase: ${first.step} -> ${next_first?.step}`)
    // Trapezoidal duration weights. A one-frame result has unit exposure.
    const weight =
      frames === 1
        ? 1
        : ((sample_idx > 0 ? time - previous_time : 0) +
            (next_time !== undefined ? next_time - time : 0)) /
          2
    result.time_weight += weight
    previous_time = time
    if (
      coordinates === `device` &&
      grid.pbc.some(Boolean) &&
      first.cell?.some((row, row_idx) =>
        row.some((value, col_idx) => value !== grid.cell[row_idx][col_idx]),
      )
    )
      throw new Error(
        `A periodic device grid requires an unchanged cell; choose a nonperiodic device grid or cell-following coordinates`,
      )
    result.last_step = first.step
    scratch.fill(0)
    const active_grid =
      coordinates === `cell`
        ? { ...grid, cell: first.cell ?? grid.cell, origin: first.origin, pbc: first.pbc }
        : grid
    if (coordinates === `cell` && !first.cell)
      throw new Error(`Cell-following hotspots require a cell at step ${first.step}`)
    const inverse = matrix_inverse_3x3(active_grid.cell)
    let batch = first
    for (;;) {
      for (let atom_idx = 0; atom_idx < batch.atomic_numbers.length; atom_idx++) {
        if (
          (batch.selected && !batch.selected[atom_idx]) ||
          (element_filter && !element_filter.has(batch.atomic_numbers[atom_idx]))
        )
          continue
        const offset = atom_idx * 3
        const bin = hotspot_bin(batch.positions, offset, active_grid, inverse)
        if (bin < 0) {
          result.excluded_atoms++
          continue
        }
        const base = bin * 9
        scratch[base]++
        if (options.energy_key) {
          const energy = batch.energies?.[atom_idx]
          if (energy === undefined || !Number.isFinite(energy) || energy < 0)
            throw new Error(
              `Invalid kinetic energy at frame ${frame_idx}, atom ${batch.start + atom_idx}`,
            )
          scratch[base + 5] += energy * (energy_factor ?? 1)
        } else {
          const mass = batch.masses?.[atom_idx]
          if (mass === undefined || !Number.isFinite(mass) || mass <= 0 || !batch.velocities)
            throw new Error(
              `Missing mass/velocity at frame ${frame_idx}, atom ${batch.start + atom_idx}`,
            )
          const old_mass = scratch[base + 1]
          const total_mass = old_mass + mass
          scratch[base + 1] = total_mass
          for (let axis = 0; axis < dimensions; axis++) {
            const velocity = batch.velocities[offset + axis]
            if (!Number.isFinite(velocity))
              throw new Error(
                `Invalid velocity at frame ${frame_idx}, atom ${batch.start + atom_idx}`,
              )
            if (motion === `device`) {
              scratch[base + 5] += mass * velocity ** 2
              continue
            }
            // Each bin can have a different bulk velocity. Anchor its mean locally so
            // small thermal increments survive even when neighboring bins have huge drift.
            if (!old_mass) scratch[base + 6 + axis] = velocity
            const delta = velocity - scratch[base + 6 + axis] - scratch[base + 2 + axis]
            scratch[base + 2 + axis] += delta * (mass / total_mass)
            scratch[base + 5] += delta * delta * mass * (old_mass / total_mass)
          }
        }
      }
      const next = batch.start + batch.atomic_numbers.length
      if (performance.now() >= deadline) {
        on_progress?.({
          current: sample_idx + next / batch.total_atoms,
          total: frames,
          completed: sample_idx,
          stage: `Binning kinetic energy`,
        })
        await yield_turn()
        signal?.throwIfAborted()
        deadline = performance.now() + 8
      }
      if (next >= batch.total_atoms) break
      batch = await read(frame_idx, next)
    }
    let global_mass = 0
    let reference_bin = -1
    const mean_velocity = [0, 0, 0]
    if (motion === `translation`) {
      for (let bin = 0; bin < n_bins; bin++) {
        const base = bin * 9
        const mass = scratch[base + 1]
        if (!mass) continue
        if (reference_bin < 0) reference_bin = base
        global_mass += mass
        for (let axis = 0; axis < dimensions; axis++)
          mean_velocity[axis] +=
            (scratch[base + 6 + axis] -
              scratch[reference_bin + 6 + axis] -
              mean_velocity[axis] +
              scratch[base + 2 + axis]) *
            (mass / global_mass)
      }
    }
    for (let bin = 0; bin < n_bins; bin++) {
      const base = bin * 9
      const count = scratch[base]
      if (!count) continue
      const mass = scratch[base + 1]
      let centered = scratch[base + 5]
      if (motion === `translation`)
        for (let axis = 0; axis < dimensions; axis++)
          centered +=
            mass *
            (scratch[base + 6 + axis] -
              scratch[reference_bin + 6 + axis] -
              mean_velocity[axis] +
              scratch[base + 2 + axis]) **
              2
      const energy = options.energy_key ? centered : centered * kinetic_factor
      const removed_dof =
        motion === `local`
          ? dimensions
          : motion === `translation`
            ? (dimensions * mass) / global_mass
            : 0
      result.energy[bin] += energy * weight
      result.population[bin] += count * weight
      result.dof[bin] += Math.max(0, count * dof_per_atom - removed_dof) * weight
      if (
        !Number.isFinite(result.energy[bin]) ||
        !Number.isFinite(result.population[bin]) ||
        !Number.isFinite(result.dof[bin])
      )
        throw new Error(
          `Kinetic-energy accumulation overflow at frame ${frame_idx}, bin ${bin}; check input units and values`,
        )
      result.occupied_frames[bin]++
    }
    on_progress?.({
      current: sample_idx + 1,
      total: frames,
      completed: sample_idx + 1,
      stage: `Binning kinetic energy`,
    })
    if (on_partial && sample_idx + 1 < frames && performance.now() - last_partial >= 250) {
      // Own each snapshot: neither a callback nor a worker transfer may mutate the reducer.
      await on_partial({
        ...result,
        frames: sample_idx + 1,
        energy: result.energy.slice(),
        population: result.population.slice(),
        dof: result.dof.slice(),
        occupied_frames: result.occupied_frames.slice(),
      })
      last_partial = performance.now()
    }
    if (performance.now() >= deadline) {
      await yield_turn()
      deadline = performance.now() + 8
    }
    signal?.throwIfAborted()
  }
  return result
}

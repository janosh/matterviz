import { element_by_symbol } from '$lib/element/data'
import { is_elem_symbol } from '$lib/element/helpers'
import type { PeriodogramResult, WindowType } from '$lib/fft'
import {
  fft_in_place,
  next_power_of_two,
  one_sided_periodogram,
  time_series_window,
  WINDOW_TYPES,
} from '$lib/fft'
import type { MdFrequencyUnit } from '$lib/spectral/frequency-units'
import { md_frequency_factor, MD_FREQUENCY_UNITS } from '$lib/spectral/frequency-units'
import type { Complex } from '$lib/spectral/types'
import type { Pbc } from '$lib/structure'
import type { Matrix3x3, Vec3 } from '$lib/math'
import {
  clamp,
  cross_3d,
  dot,
  first_non_increasing_index,
  IDENTITY_3X3,
  mat3x3_vec3_multiply,
  median,
  partition_point,
  transpose_3x3_matrix,
} from '$lib/math'
import type { TrajectoryPositionStream, TrajectorySignal } from '$lib/trajectory'
import {
  unwrap_flat_positions,
  validate_position_stream_layout,
} from '$lib/trajectory/positions'
import type { VelocitySource } from '$lib/vacf'
import { central_difference_velocities } from '$lib/vacf/calc-vacf'

// `1/step` is cycles per MD step (the signals carry their own step axes), the honest axis
// when the run records no timestep. Distinct from the VACF's `1/frame`, which counts
// collected frames.
export type TrajectoryFrequencyUnit = MdFrequencyUnit | `1/step`
export const TRAJECTORY_FREQUENCY_UNITS = [...MD_FREQUENCY_UNITS, `1/step`] as const
type SpectralActivity = `active` | `inactive` | `unknown`
export type SpectroscopyPreprocessing = `body_fixed` | `remove_com` | `raw`
export const RAMAN_CHANNELS = [`isotropic`, `anisotropic`, `vv`, `vh`, `unpolarized`] as const
// Powder-averaged Raman channels. A polarized single-crystal geometry has no producer in
// the trajectory viewer, so only the orientation-averaged combinations are offered.
export type RamanChannel = (typeof RAMAN_CHANNELS)[number]

export type InfraredSignal =
  | { kind: `dipole`; series: TrajectorySignal }
  | { kind: `polarization`; series: TrajectorySignal; branch_continuous: true }
  | { kind: `current`; series: TrajectorySignal }

export type RamanSignal = { kind: `polarizability`; series: TrajectorySignal }

export interface TrajectorySpectroscopyInput {
  positions: TrajectoryPositionStream
  masses: Float64Array
  velocities?: TrajectorySignal | null
  infrared_signal?: InfraredSignal | null
  raman_signal?: RamanSignal | null
  time_step?: number
  time_unit?: string
  metadata?: Record<string, unknown>
}

export interface TrajectorySpectroscopyOptions {
  frequency_unit?: TrajectoryFrequencyUnit
  preprocessing?: SpectroscopyPreprocessing
  // `auto` (default) uses stored velocities when the input carries them and differentiates
  // the prepared positions otherwise; `stored` throws without a velocity signal;
  // `central_difference` ignores stored velocities (same vocabulary as the VACF)
  velocity_source?: VelocitySource | `auto`
  window?: WindowType
  zero_pad_factor?: number
  // Powder channel reported as `raman.selected_channel` and used for peak assignment
  raman_channel?: RamanChannel
}

// The resolved options every FFT path reads, as calc_trajectory_spectroscopy defaults them
type SpectrumOptions = Required<
  Pick<TrajectorySpectroscopyOptions, `frequency_unit` | `window` | `zero_pad_factor`>
>

// Peak detection: a local maximum of the normalized spectrum counts once it stands this far
// above the surrounding minimum (within two Rayleigh widths)
const PEAK_PROMINENCE = 0.02
// IR / Raman activity: a peak is active once its normalized power clears
// max(ACTIVITY_RELATIVE_THRESHOLD, median + ACTIVITY_SNR * MAD) of that spectrum
const ACTIVITY_RELATIVE_THRESHOLD = 0.01
const ACTIVITY_SNR = 6

export interface TrajectorySpectrumCurve {
  frequencies: number[]
  power: number[]
  normalized_power: number[]
  frequency_unit: TrajectoryFrequencyUnit
  sample_interval: number
  frequency_spacing: number
  rayleigh_resolution: number
  nyquist: number
}

type RamanSpectrumResult = Record<RamanChannel, TrajectorySpectrumCurve> & {
  selected_channel: RamanChannel
}

interface TrajectorySpectralPeak {
  frequency: number
  mode_label?: string
  ir_activity: SpectralActivity
  raman_activity: SpectralActivity
  ir_score: number | null
  raman_score: number | null
  vdos_prominence: number
  ir_prominence: number
  raman_prominence: number
  potentially_mixed: boolean
  displacement?: Complex[][]
  displacement_unavailable_reason?: string
}

export interface TrajectorySpectroscopyResult {
  vdos: TrajectorySpectrumCurve
  ir: TrajectorySpectrumCurve | null
  raman: RamanSpectrumResult | null
  peaks: TrajectorySpectralPeak[]
  frequency_unit: TrajectoryFrequencyUnit
  preprocessing: SpectroscopyPreprocessing
  velocity_source: VelocitySource
  reference_positions: number[][]
  elements: string[]
  masses: number[]
  pbc: Pbc
  reference_lattice: Matrix3x3 | null
  metadata: Record<string, unknown>
}

const fail = (message: string): never => {
  throw new Error(`calc_trajectory_spectroscopy: ${message}`)
}

const require_one_of = <Allowed extends string>(
  value: string,
  allowed: readonly Allowed[],
  label: string,
): Allowed => {
  if (!(allowed as readonly string[]).includes(value)) {
    fail(`${label} '${value}' is not supported`)
  }
  return value as Allowed
}

const shape_text = (shape: number[]): string => `[${shape.join(`, `)}]`
export const arrays_equal = <Value>(
  left: ArrayLike<Value> | undefined,
  right: ArrayLike<Value>,
): boolean => {
  if (!left || left.length !== right.length) return false
  for (let idx = 0; idx < left.length; idx++) if (left[idx] !== right[idx]) return false
  return true
}

const require_finite = (values: ArrayLike<number>, label: string, noun: string): void => {
  for (let idx = 0; idx < values.length; idx++) {
    const value = values[idx]
    if (!Number.isFinite(value)) fail(`${label} ${noun} ${idx} is ${value}, not finite`)
  }
}

const require_strict_steps = (steps: ArrayLike<number>, label: string): void => {
  require_finite(steps, label, `step`)
  const violation = first_non_increasing_index(steps)
  if (violation !== null) {
    fail(
      `${label} steps must increase strictly; step ${violation - 1} is ` +
        `${steps[violation - 1]} and step ${violation} is ${steps[violation]}`,
    )
  }
}

export function validate_trajectory_signal(
  signal: TrajectorySignal,
  expected_shape?: number[],
  label = `signal`,
): void {
  if (signal.unit !== undefined && !signal.unit.trim()) {
    fail(`${label} unit must be a non-empty string when supplied`)
  }
  if (expected_shape && !arrays_equal(signal.sample_shape, expected_shape)) {
    fail(
      `${label} has sample shape ${shape_text(signal.sample_shape)}, expected ${shape_text(expected_shape)}`,
    )
  }
  if (
    signal.sample_shape.length > 2 ||
    signal.sample_shape.some((size) => !Number.isInteger(size) || size < 1)
  ) {
    fail(
      `${label} has invalid sample shape ${shape_text(signal.sample_shape)}; ` +
        `dimensions must be positive integers and rank must be at most 2`,
    )
  }
  const sample_size = signal.sample_shape.reduce((total, size) => total * size, 1)
  if (signal.values.length !== signal.steps.length * sample_size) {
    fail(
      `${label} has ${signal.values.length} values but ${signal.steps.length} samples × ` +
        `${sample_size} values/sample requires ${signal.steps.length * sample_size}`,
    )
  }
  if (signal.steps.length < 2)
    fail(`${label} needs at least 2 samples, got ${signal.steps.length}`)
  require_finite(signal.values, label, `value`)
  require_strict_steps(signal.steps, label)
}

// The shared layout check covers counts and buffer length (a fractional n_atoms or n_frames
// fails it too, since element and step counts are integers); the step axis, value and
// lattice finiteness and pbc shape are spectroscopy's own
const validate_position_stream = (stream: TrajectoryPositionStream): void => {
  validate_position_stream_layout(stream, `calc_trajectory_spectroscopy`, 1)
  require_finite(stream.positions, `position`, `value`)
  if (stream.steps.length !== stream.n_frames) {
    fail(`positions have ${stream.n_frames} frames but ${stream.steps.length} steps`)
  }
  require_strict_steps(stream.steps, `position`)
  for (const [frame_idx, lattice] of stream.lattice_matrices?.entries() ?? []) {
    if (lattice === null) continue
    if (
      lattice.length !== 3 ||
      lattice.some((row) => row.length !== 3 || row.some((value) => !Number.isFinite(value)))
    ) {
      fail(`lattice matrix ${frame_idx} must be a finite 3 × 3 matrix`)
    }
  }
  if (
    stream.pbc != null &&
    (stream.pbc.length !== 3 || stream.pbc.some((periodic) => typeof periodic !== `boolean`))
  ) {
    fail(`pbc must contain exactly 3 boolean values`)
  }
}

const uniform_step_delta = (steps: number[], label: string): number => {
  if (steps.length < 2) fail(`${label} needs at least 2 steps`)
  const delta = steps[1] - steps[0]
  for (let step_idx = 2; step_idx < steps.length; step_idx++) {
    const next_delta = steps[step_idx] - steps[step_idx - 1]
    // This second finite difference touches three recorded steps. Eight f64 epsilons at
    // their largest magnitude cover its input and subtraction roundoff without admitting
    // a physically meaningful cadence change.
    const tolerance =
      8 *
      Number.EPSILON *
      Math.max(
        1,
        Math.abs(steps[step_idx]),
        Math.abs(steps[step_idx - 1]),
        Math.abs(steps[step_idx - 2]),
      )
    if (Math.abs(next_delta - delta) > tolerance) {
      fail(
        `${label} is not uniformly sampled: first step delta is ${delta}, but steps ` +
          `${step_idx - 1}→${step_idx} have delta ${next_delta}`,
      )
    }
  }
  return delta
}

const normalize_power = (power: ArrayLike<number>): number[] => {
  const values = Array.from(power)
  let maximum = 0
  for (const value of values) maximum = Math.max(maximum, value)
  return maximum > 0 ? values.map((value) => value / maximum) : values.fill(0)
}

// Fraction of the source magnitude below which a signal is cancellation residue, not motion:
// centre-of-mass removal, Horn alignment, finite differences and mean subtraction each hold
// only to ~n·eps. 1e-10 leaves six decades over f64 eps, far under any real vibration.
const ROUNDOFF_RATIO = 1e-10

const max_abs = (values: Float64Array): number => {
  let maximum = 0
  for (const value of values) {
    const magnitude = Math.abs(value)
    if (magnitude > maximum) maximum = magnitude
  }
  return maximum
}

// Largest excursion from a component's own mean, i.e. exactly what the periodogram
// transforms once it has removed those means.
const max_component_variation = (values: ArrayLike<number>, n_components: number): number => {
  const n_samples = values.length / n_components
  const means = new Float64Array(n_components)
  for (let idx = 0; idx < values.length; idx++) {
    means[idx % n_components] += values[idx] / n_samples
  }
  let variation = 0
  for (let idx = 0; idx < values.length; idx++) {
    const deviation = Math.abs(values[idx] - means[idx % n_components])
    if (deviation > variation) variation = deviation
  }
  return variation
}

// Cycles per `time_unit` -> `frequency_unit`; 1 for the per-step axis
const frequency_factor = (
  frequency_unit: TrajectoryFrequencyUnit,
  time_unit: string | undefined,
): number => {
  if (frequency_unit === `1/step`) return 1
  if (!time_unit) {
    return fail(
      `frequency_unit '${frequency_unit}' requires time_unit; use '1/step' otherwise`,
    )
  }
  const factor = md_frequency_factor(time_unit, frequency_unit)
  if (factor === null) {
    return fail(`time_unit '${time_unit}' cannot be converted to ${frequency_unit}`)
  }
  return factor
}

const sample_interval = (
  steps: number[],
  frequency_unit: TrajectoryFrequencyUnit,
  time_step: number | undefined,
  label: string,
): number => {
  const step_delta = uniform_step_delta(steps, label)
  if (frequency_unit === `1/step`) return step_delta
  if (!(time_step && time_step > 0)) {
    return fail(`${label} needs a positive simulation time_step for ${frequency_unit}`)
  }
  return step_delta * time_step
}

const curve_from_periodogram = (
  periodogram: PeriodogramResult,
  interval: number,
  frequency_unit: TrajectoryFrequencyUnit,
  factor: number,
): TrajectorySpectrumCurve => {
  const frequencies = Array.from(periodogram.frequencies, (value) => value * factor)
  // one_sided_periodogram returns a density per source-frequency unit. When the
  // frequency coordinate is scaled by factor, the density must carry the inverse
  // Jacobian so its integral remains invariant.
  const power = Array.from(periodogram.power, (value) => value / factor)
  return {
    frequencies,
    power,
    normalized_power: normalize_power(power),
    frequency_unit,
    sample_interval: interval,
    frequency_spacing: periodogram.frequency_spacing * factor,
    rayleigh_resolution: periodogram.rayleigh_resolution * factor,
    nyquist: periodogram.nyquist * factor,
  }
}

const combine_curves = (
  left: TrajectorySpectrumCurve,
  right: TrajectorySpectrumCurve,
  left_factor: number,
  right_factor: number,
): TrajectorySpectrumCurve => {
  if (!arrays_equal(left.frequencies, right.frequencies)) {
    return fail(`cannot combine Raman channels with different frequency grids`)
  }
  const power = left.power.map(
    (value, frequency_idx) => left_factor * value + right_factor * right.power[frequency_idx],
  )
  return { ...left, power, normalized_power: normalize_power(power) }
}

// Unit vector of a molecular axis; math's normalize_vec returns zeros for a degenerate input,
// which here would silently drop the rotation instead of reporting the degenerate geometry
const unit_axis = (vector: ArrayLike<number>): Vec3 => {
  const norm = Math.hypot(vector[0], vector[1], vector[2])
  if (!(norm > 0)) fail(`molecular axis must be non-zero`)
  return [vector[0] / norm, vector[1] / norm, vector[2] / norm]
}

const RAMAN_ANISOTROPIC_WEIGHTS = Float64Array.from([0.5, 0.5, 0.5, 3, 3, 3])
const identity_rotations = (count: number): Matrix3x3[] =>
  Array.from({ length: count }, () => IDENTITY_3X3)

const rotate_vec = (rotation: Matrix3x3, vector: ArrayLike<number>): Vec3 =>
  mat3x3_vec3_multiply(rotation, [vector[0], vector[1], vector[2]])

const rotation_from_quaternion = (quaternion: number[]): Matrix3x3 => {
  const quaternion_norm = Math.hypot(...quaternion)
  const [scalar, axis_x, axis_y, axis_z] = quaternion.map((value) => value / quaternion_norm)
  return [
    [
      1 - 2 * (axis_y * axis_y + axis_z * axis_z),
      2 * (axis_x * axis_y - scalar * axis_z),
      2 * (axis_x * axis_z + scalar * axis_y),
    ],
    [
      2 * (axis_x * axis_y + scalar * axis_z),
      1 - 2 * (axis_x * axis_x + axis_z * axis_z),
      2 * (axis_y * axis_z - scalar * axis_x),
    ],
    [
      2 * (axis_x * axis_z - scalar * axis_y),
      2 * (axis_y * axis_z + scalar * axis_x),
      1 - 2 * (axis_x * axis_x + axis_y * axis_y),
    ],
  ]
}

// Jacobi eigensolver for the tiny real symmetric matrices used by Horn alignment and
// inertia pseudoinverses. Returns eigenvectors as columns.
const symmetric_eigensystem = (
  input: number[][],
): { values: number[]; vectors: number[][] } => {
  const size = input.length
  const matrix = input.map((row) => [...row])
  const vectors: number[][] = Array.from({ length: size }, (_row, row_idx) =>
    Array.from({ length: size }, (_column, col_idx) => (row_idx === col_idx ? 1 : 0)),
  )
  for (let iteration = 0; iteration < 100 * size * size; iteration++) {
    let row_max = 0
    let col_max = 1
    let off_diagonal = Math.abs(matrix[row_max]?.[col_max] ?? 0)
    for (let row_idx = 0; row_idx < size; row_idx++) {
      for (let col_idx = row_idx + 1; col_idx < size; col_idx++) {
        const candidate = Math.abs(matrix[row_idx][col_idx])
        if (candidate > off_diagonal) {
          off_diagonal = candidate
          row_max = row_idx
          col_max = col_idx
        }
      }
    }
    if (off_diagonal <= 1e-14) break
    const angle =
      0.5 *
      Math.atan2(
        2 * matrix[row_max][col_max],
        matrix[col_max][col_max] - matrix[row_max][row_max],
      )
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    for (let matrix_idx = 0; matrix_idx < size; matrix_idx++) {
      if (matrix_idx === row_max || matrix_idx === col_max) continue
      const left = matrix[matrix_idx][row_max]
      const right = matrix[matrix_idx][col_max]
      matrix[matrix_idx][row_max] = cosine * left - sine * right
      matrix[row_max][matrix_idx] = matrix[matrix_idx][row_max]
      matrix[matrix_idx][col_max] = sine * left + cosine * right
      matrix[col_max][matrix_idx] = matrix[matrix_idx][col_max]
    }
    const diagonal_left = matrix[row_max][row_max]
    const diagonal_right = matrix[col_max][col_max]
    const cross = matrix[row_max][col_max]
    matrix[row_max][row_max] =
      cosine * cosine * diagonal_left -
      2 * sine * cosine * cross +
      sine * sine * diagonal_right
    matrix[col_max][col_max] =
      sine * sine * diagonal_left +
      2 * sine * cosine * cross +
      cosine * cosine * diagonal_right
    matrix[row_max][col_max] = 0
    matrix[col_max][row_max] = 0
    for (let vector_idx = 0; vector_idx < size; vector_idx++) {
      const left = vectors[vector_idx][row_max]
      const right = vectors[vector_idx][col_max]
      vectors[vector_idx][row_max] = cosine * left - sine * right
      vectors[vector_idx][col_max] = sine * left + cosine * right
    }
  }
  return { values: matrix.map((row, idx) => row[idx]), vectors }
}

const center_frame = (
  positions: Float64Array,
  frame_idx: number,
  n_atoms: number,
  masses: Float64Array,
): { centered: Float64Array; center: [number, number, number] } => {
  const total_mass = masses.reduce((total, mass) => total + mass, 0)
  const center: [number, number, number] = [0, 0, 0]
  const frame_base = frame_idx * n_atoms * 3
  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    const component_base = frame_base + atom_idx * 3
    for (let axis = 0; axis < 3; axis++) {
      center[axis] += masses[atom_idx] * positions[component_base + axis]
    }
  }
  for (let axis = 0; axis < 3; axis++) center[axis] /= total_mass
  const centered = new Float64Array(n_atoms * 3)
  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    const input_base = frame_base + atom_idx * 3
    const output_base = atom_idx * 3
    for (let axis = 0; axis < 3; axis++) {
      centered[output_base + axis] = positions[input_base + axis] - center[axis]
    }
  }
  return { centered, center }
}

const horn_rotation = (
  current: Float64Array,
  reference: Float64Array,
  masses: Float64Array,
): Matrix3x3 => {
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0])
  for (let atom_idx = 0; atom_idx < masses.length; atom_idx++) {
    const base = atom_idx * 3
    for (let current_axis = 0; current_axis < 3; current_axis++) {
      for (let reference_axis = 0; reference_axis < 3; reference_axis++) {
        covariance[current_axis][reference_axis] +=
          masses[atom_idx] * current[base + current_axis] * reference[base + reference_axis]
      }
    }
  }
  const [[sxx, sxy, sxz], [syx, syy, syz], [szx, szy, szz]] = covariance
  const trace = sxx + syy + szz
  const horn = [
    [trace, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ]
  const eigensystem = symmetric_eigensystem(horn)
  let largest_idx = 0
  for (let idx = 1; idx < eigensystem.values.length; idx++) {
    if (eigensystem.values[idx] > eigensystem.values[largest_idx]) largest_idx = idx
  }
  const quaternion = eigensystem.vectors.map((row) => row[largest_idx])
  return rotation_from_quaternion(quaternion)
}

const solve_inertia = (inertia: number[][], angular_momentum: number[]): number[] => {
  const { values, vectors } = symmetric_eigensystem(inertia)
  const maximum = Math.max(...values.map(Math.abs), 1)
  const angular_velocity = [0, 0, 0]
  for (let eigen_idx = 0; eigen_idx < 3; eigen_idx++) {
    if (Math.abs(values[eigen_idx]) <= 1e-10 * maximum) continue
    let projection = 0
    for (let axis = 0; axis < 3; axis++) {
      projection += vectors[axis][eigen_idx] * angular_momentum[axis]
    }
    for (let axis = 0; axis < 3; axis++) {
      angular_velocity[axis] += (projection / values[eigen_idx]) * vectors[axis][eigen_idx]
    }
  }
  return angular_velocity
}

interface PreparedMotion {
  positions: Float64Array
  lab_positions: Float64Array
  rotations: Matrix3x3[]
  reference_positions: number[][]
}

const linear_anchor = (
  centered: Float64Array,
  n_atoms: number,
): { atom_idx: number; axis: [number, number, number] } | null => {
  let atom_idx = 0
  let radius = 0
  for (let candidate_idx = 0; candidate_idx < n_atoms; candidate_idx++) {
    const base = candidate_idx * 3
    const candidate_radius = Math.hypot(centered[base], centered[base + 1], centered[base + 2])
    if (candidate_radius > radius) {
      atom_idx = candidate_idx
      radius = candidate_radius
    }
  }
  if (!(radius > 0)) return null
  const base = atom_idx * 3
  const axis = unit_axis(centered.subarray(base, base + 3))
  let maximum_perpendicular = 0
  for (let candidate_idx = 0; candidate_idx < n_atoms; candidate_idx++) {
    const candidate_base = candidate_idx * 3
    const perpendicular = cross_3d(centered.subarray(candidate_base, candidate_base + 3), axis)
    maximum_perpendicular = Math.max(maximum_perpendicular, Math.hypot(...perpendicular))
  }
  return maximum_perpendicular <= 1e-8 * radius ? { atom_idx, axis } : null
}

const axis_rotation = (
  source: [number, number, number],
  target: [number, number, number],
): Matrix3x3 => {
  const cosine = clamp(dot(source, target), -1, 1)
  let rotation_axis: number[] = cross_3d(source, target)
  let sine = Math.hypot(...rotation_axis)
  if (sine <= 1e-14) {
    if (cosine > 0) return IDENTITY_3X3
    const helper: [number, number, number] = Math.abs(source[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    rotation_axis = unit_axis(cross_3d(source, helper))
    sine = 0
  } else rotation_axis = rotation_axis.map((value) => value / sine)
  const [axis_x, axis_y, axis_z] = rotation_axis
  const one_minus_cosine = 1 - cosine
  return [
    [
      cosine + axis_x * axis_x * one_minus_cosine,
      axis_x * axis_y * one_minus_cosine - axis_z * sine,
      axis_x * axis_z * one_minus_cosine + axis_y * sine,
    ],
    [
      axis_y * axis_x * one_minus_cosine + axis_z * sine,
      cosine + axis_y * axis_y * one_minus_cosine,
      axis_y * axis_z * one_minus_cosine - axis_x * sine,
    ],
    [
      axis_z * axis_x * one_minus_cosine - axis_y * sine,
      axis_z * axis_y * one_minus_cosine + axis_x * sine,
      cosine + axis_z * axis_z * one_minus_cosine,
    ],
  ]
}

const mean_geometry = (
  positions: Float64Array,
  n_frames: number,
  n_atoms: number,
): number[][] =>
  Array.from({ length: n_atoms }, (_atom, atom_idx) =>
    Array.from({ length: 3 }, (_component, axis) => {
      let total = 0
      for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
        total += positions[(frame_idx * n_atoms + atom_idx) * 3 + axis]
      }
      return total / n_frames
    }),
  )

const prepare_positions = (
  stream: TrajectoryPositionStream,
  masses: Float64Array,
  preprocessing: SpectroscopyPreprocessing,
): PreparedMotion => {
  const pbc = stream.pbc ?? ([false, false, false] satisfies Pbc)
  const periodic = pbc.some(Boolean)
  if (periodic && !stream.coords_unwrapped && !stream.lattice_matrices?.[0]) {
    fail(`wrapped periodic positions require a lattice matrix for the first frame`)
  }
  const unwrapped =
    periodic && !stream.coords_unwrapped
      ? unwrap_flat_positions(
          stream.positions,
          stream.n_frames,
          stream.n_atoms,
          stream.lattice_matrices,
          pbc,
        )
      : stream.positions
  // Nothing downstream writes to the prepared buffers, so the raw frame shares one
  // unwrapped copy instead of holding three
  if (preprocessing === `raw`) {
    return {
      positions: unwrapped,
      lab_positions: unwrapped,
      rotations: identity_rotations(stream.n_frames),
      reference_positions: mean_geometry(unwrapped, stream.n_frames, stream.n_atoms),
    }
  }
  const prepared = new Float64Array(unwrapped.length)
  const rotations: Matrix3x3[] = []
  const first_frame = center_frame(unwrapped, 0, stream.n_atoms, masses)
  const first_centered = first_frame.centered
  const reference_center: Vec3 = periodic ? first_frame.center : [0, 0, 0]
  const linear =
    preprocessing === `body_fixed` && !periodic
      ? linear_anchor(first_centered, stream.n_atoms)
      : null
  let previous_axis = linear?.axis
  let previous_rotation: Matrix3x3 = IDENTITY_3X3
  for (let frame_idx = 0; frame_idx < stream.n_frames; frame_idx++) {
    const centered = center_frame(unwrapped, frame_idx, stream.n_atoms, masses).centered
    let rotation: Matrix3x3 = IDENTITY_3X3
    if (preprocessing === `body_fixed` && !periodic) {
      if (linear && previous_axis) {
        const base = linear.atom_idx * 3
        const current_axis = unit_axis(centered.subarray(base, base + 3))
        const transport = axis_rotation(current_axis, previous_axis)
        rotation = dot(previous_rotation, transport)
        previous_axis = current_axis
        previous_rotation = rotation
      } else rotation = horn_rotation(centered, first_centered, masses)
    }
    rotations.push(rotation)
    // Hot loop (n_frames × n_atoms): rotate in place instead of allocating two vectors per atom
    const [[rot_xx, rot_xy, rot_xz], [rot_yx, rot_yy, rot_yz], [rot_zx, rot_zy, rot_zz]] =
      rotation
    const [center_x, center_y, center_z] = reference_center
    const frame_base = frame_idx * stream.n_atoms * 3
    for (let atom_idx = 0; atom_idx < stream.n_atoms; atom_idx++) {
      const atom_base = atom_idx * 3
      const pos_x = centered[atom_base]
      const pos_y = centered[atom_base + 1]
      const pos_z = centered[atom_base + 2]
      const out = frame_base + atom_base
      prepared[out] = rot_xx * pos_x + rot_xy * pos_y + rot_xz * pos_z + center_x
      prepared[out + 1] = rot_yx * pos_x + rot_yy * pos_y + rot_yz * pos_z + center_y
      prepared[out + 2] = rot_zx * pos_x + rot_zy * pos_y + rot_zz * pos_z + center_z
    }
  }
  return {
    positions: prepared,
    lab_positions: unwrapped,
    rotations,
    reference_positions: mean_geometry(prepared, stream.n_frames, stream.n_atoms),
  }
}

const step_index_map = (steps: number[]) =>
  new Map(steps.map((step, step_idx) => [step, step_idx]))

// Body-frame rotation for every sample of a signal (looked up by MD step in the position
// frames); identity when the preprocessing keeps the laboratory frame
const signal_rotations = (
  preprocessing: SpectroscopyPreprocessing,
  position_steps: number[],
  rotations: Matrix3x3[],
  signal_steps: number[],
  label: string,
): Matrix3x3[] => {
  if (preprocessing !== `body_fixed`) return identity_rotations(signal_steps.length)
  const positions_by_step = step_index_map(position_steps)
  return signal_steps.map((step) => {
    const frame_idx = positions_by_step.get(step)
    if (frame_idx === undefined) {
      return fail(
        `${label} has a sample at MD step ${step}, but body-frame processing has no ` +
          `position at that step`,
      )
    }
    return rotations[frame_idx]
  })
}

const rotate_vector_signal = (
  signal: TrajectorySignal,
  rotations: Matrix3x3[],
): Float64Array => {
  const rotated = new Float64Array(signal.values.length)
  for (let sample_idx = 0; sample_idx < signal.steps.length; sample_idx++) {
    rotated.set(
      rotate_vec(
        rotations[sample_idx],
        signal.values.subarray(sample_idx * 3, sample_idx * 3 + 3),
      ),
      sample_idx * 3,
    )
  }
  return rotated
}

const rotate_tensor_signal = (values: Float64Array, rotations: Matrix3x3[]): Float64Array => {
  const rotated = new Float64Array(values.length)
  for (let sample_idx = 0; sample_idx < rotations.length; sample_idx++) {
    const base = sample_idx * 9
    const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = values.subarray(base, base + 9)
    const symmetric: Matrix3x3 = [
      [xx, (xy + yx) / 2, (xz + zx) / 2],
      [(yx + xy) / 2, yy, (yz + zy) / 2],
      [(zx + xz) / 2, (zy + yz) / 2, zz],
    ]
    const transformed = dot(
      dot(rotations[sample_idx], symmetric),
      transpose_3x3_matrix(rotations[sample_idx]),
    )
    rotated.set(transformed.flat(), base)
  }
  return rotated
}

const remove_rigid_velocity = (
  velocities: Float64Array,
  velocity_steps: number[],
  stream: TrajectoryPositionStream,
  masses: Float64Array,
  prepared: PreparedMotion,
  preprocessing: SpectroscopyPreprocessing,
): Float64Array => {
  if (preprocessing === `raw`) return new Float64Array(velocities)
  const position_by_step = step_index_map(stream.steps)
  const output = new Float64Array(velocities.length)
  const total_mass = masses.reduce((total, mass) => total + mass, 0)
  for (let sample_idx = 0; sample_idx < velocity_steps.length; sample_idx++) {
    const position_frame_idx = position_by_step.get(velocity_steps[sample_idx])
    if (position_frame_idx === undefined) {
      return fail(
        `stored velocities have a sample at MD step ${velocity_steps[sample_idx]}, but ` +
          `rigid-motion removal has no position at that step`,
      )
    }
    const center_velocity = [0, 0, 0]
    for (let atom_idx = 0; atom_idx < stream.n_atoms; atom_idx++) {
      const base = (sample_idx * stream.n_atoms + atom_idx) * 3
      for (let axis = 0; axis < 3; axis++) {
        center_velocity[axis] += masses[atom_idx] * velocities[base + axis]
      }
    }
    for (let axis = 0; axis < 3; axis++) center_velocity[axis] /= total_mass
    const centered_positions = center_frame(
      prepared.lab_positions,
      position_frame_idx,
      stream.n_atoms,
      masses,
    ).centered
    // remove_com only subtracts the centre-of-mass velocity; the inertia tensor and angular
    // momentum are only ever consumed by the body-fixed solve
    let angular_velocity: number[] = [0, 0, 0]
    if (preprocessing === `body_fixed`) {
      const inertia = Array.from({ length: 3 }, () => [0, 0, 0])
      const angular_momentum = [0, 0, 0]
      for (let atom_idx = 0; atom_idx < stream.n_atoms; atom_idx++) {
        const position_base = atom_idx * 3
        const velocity_base = (sample_idx * stream.n_atoms + atom_idx) * 3
        const position = Array.from(
          centered_positions.subarray(position_base, position_base + 3),
        )
        const velocity = [
          velocities[velocity_base] - center_velocity[0],
          velocities[velocity_base + 1] - center_velocity[1],
          velocities[velocity_base + 2] - center_velocity[2],
        ]
        const radius_squared = position.reduce((total, value) => total + value * value, 0)
        for (let row_idx = 0; row_idx < 3; row_idx++) {
          for (let col_idx = 0; col_idx < 3; col_idx++) {
            inertia[row_idx][col_idx] +=
              masses[atom_idx] *
              ((row_idx === col_idx ? radius_squared : 0) -
                position[row_idx] * position[col_idx])
          }
        }
        const contribution = cross_3d(position, velocity)
        for (let axis = 0; axis < 3; axis++) {
          angular_momentum[axis] += masses[atom_idx] * contribution[axis]
        }
      }
      angular_velocity = solve_inertia(inertia, angular_momentum)
    }
    const rotation = prepared.rotations[position_frame_idx]
    for (let atom_idx = 0; atom_idx < stream.n_atoms; atom_idx++) {
      const position_base = atom_idx * 3
      const velocity_base = (sample_idx * stream.n_atoms + atom_idx) * 3
      const rotation_velocity = cross_3d(
        angular_velocity,
        centered_positions.subarray(position_base, position_base + 3),
      )
      const residual = [
        velocities[velocity_base] - center_velocity[0] - rotation_velocity[0],
        velocities[velocity_base + 1] - center_velocity[1] - rotation_velocity[1],
        velocities[velocity_base + 2] - center_velocity[2] - rotation_velocity[2],
      ]
      output.set(rotate_vec(rotation, residual), velocity_base)
    }
  }
  return output
}

// One-sided power spectrum of a (windowed, zero-padded) MD signal on the requested
// frequency axis. `frequency_squared` multiplies by (2πν)² and is IR-dipole only: the
// classical IR absorption α(ω)n(ω) ∝ ω·tanh(βħω/2)·FT⟨μ(0)μ(t)⟩ → (βħ/2)·ω²·FT⟨μμ⟩, i.e.
// the power spectrum of μ̇. A `current` IR signal is already μ̇ so it skips the factor, and
// Raman never applies it (see calculate_raman). The VDOS is a velocity power spectrum.
const build_curve = (
  values: Float64Array,
  n_components: number,
  steps: number[],
  input: TrajectorySpectroscopyInput,
  options: SpectrumOptions,
  label: string,
  // Scale the raw data behind `values`, in their units. Only differs from max |values| once an
  // upstream subtraction destroyed it: measured 2.0e1 vs 4.0e-15 for Horn-aligned velocities.
  source_scale: number,
  component_weights?: Float64Array,
  frequency_squared = false,
): TrajectorySpectrumCurve => {
  const interval = sample_interval(steps, options.frequency_unit, input.time_step, label)
  const factor = frequency_factor(options.frequency_unit, input.time_unit)
  const periodogram = one_sided_periodogram(values, n_components, interval, {
    window: options.window,
    zero_pad_factor: options.zero_pad_factor,
    component_weights,
  })
  const curve = curve_from_periodogram(periodogram, interval, options.frequency_unit, factor)
  // Absolute floor, since everything downstream is relative: normalize_power puts the maximum
  // at 1 and peak prominence and the activity threshold are fractions of that, so a spectrum of
  // pure cancellation residue reads as full-scale modes. Rigid tumbling water under body_fixed
  // gave a VDOS maximum of 2.4e-29 with 25 peaks, six "IR active" off a constant dipole.
  const variation = max_component_variation(values, n_components)
  if (variation <= ROUNDOFF_RATIO * Math.max(max_abs(values), source_scale)) {
    const zeros = () => curve.power.map(() => 0)
    return { ...curve, power: zeros(), normalized_power: zeros() }
  }
  if (!frequency_squared) return curve
  const physical_factor =
    options.frequency_unit === `1/step` ? 1 : frequency_factor(`THz`, input.time_unit)
  const power = curve.power.map((value, frequency_idx) => {
    const physical_frequency = periodogram.frequencies[frequency_idx] * physical_factor
    return value * (2 * Math.PI * physical_frequency) ** 2
  })
  return { ...curve, power, normalized_power: normalize_power(power) }
}

// Classical Placzek Raman spectrum: the power spectrum FT⟨α(0)α(t)⟩ of the (body-frame)
// polarizability tensor, split into the isotropic mean ᾱ = tr(α)/3 and the anisotropic
// invariant γ² = ½[(xx−yy)² + (yy−zz)² + (zz−xx)²] + 3(xy² + yz² + xz²), then combined into
// the powder channels VV = 45ᾱ² + 4γ², VH = 3γ², unpolarized = VV + VH = 45ᾱ² + 7γ².
// Intensities are relative only. The full classical expression (Thomas, Brehm, Kirchner,
// PCCP 2013) is I(ω) ∝ (ω_L−ω)⁴ · (1/ω) · [1−e^{−βħω}]⁻¹ · FT⟨α̇α̇⟩; with FT⟨α̇α̇⟩ = ω²·FT⟨αα⟩
// the classical-limit Bose×1/ω factor k_BT/(ħω²) cancels the ω² exactly, so no ω² weighting
// is applied (unlike IR from a dipole). The (ω_L−ω)⁴ excitation factor (≲10% over
// 0–3000 cm⁻¹ at visible ω_L) and the Bose factor are omitted.
const calculate_raman = (
  input: TrajectorySpectroscopyInput,
  polarizability: TrajectorySignal,
  prepared: PreparedMotion,
  options: SpectrumOptions &
    Required<Pick<TrajectorySpectroscopyOptions, `preprocessing` | `raman_channel`>>,
): RamanSpectrumResult => {
  validate_trajectory_signal(polarizability, [3, 3], `Raman polarizability`)
  const rotations = signal_rotations(
    options.preprocessing,
    input.positions.steps,
    prepared.rotations,
    polarizability.steps,
    `Raman polarizability`,
  )
  const rotated = rotate_tensor_signal(polarizability.values, rotations)
  const n_samples = polarizability.steps.length
  const isotropic_values = new Float64Array(n_samples)
  const anisotropic_values = new Float64Array(n_samples * 6)
  for (let sample_idx = 0; sample_idx < n_samples; sample_idx++) {
    const base = sample_idx * 9
    const [xx, xy, xz, , yy, yz, , , zz] = rotated.subarray(base, base + 9)
    isotropic_values[sample_idx] = (xx + yy + zz) / 3
    anisotropic_values.set([xx - yy, yy - zz, zz - xx, xy, yz, xz], sample_idx * 6)
  }
  const raman_curve = (
    values: Float64Array,
    n_components: number,
    component_weights?: Float64Array,
  ) =>
    build_curve(
      values,
      n_components,
      polarizability.steps,
      input,
      options,
      `Raman polarizability`,
      max_abs(polarizability.values),
      component_weights,
    )
  const isotropic = raman_curve(isotropic_values, 1)
  const anisotropic = raman_curve(anisotropic_values, 6, RAMAN_ANISOTROPIC_WEIGHTS)
  return {
    isotropic,
    anisotropic,
    vv: combine_curves(isotropic, anisotropic, 45, 4),
    vh: combine_curves(isotropic, anisotropic, 0, 3),
    unpolarized: combine_curves(isotropic, anisotropic, 45, 7),
    selected_channel: options.raman_channel,
  }
}

interface PeakCandidate {
  frequency: number
  prominence: number
  source: `vdos` | `ir` | `raman`
  resolution: number
}

const curve_candidates = (
  curve: TrajectorySpectrumCurve | null,
  source: PeakCandidate[`source`],
): PeakCandidate[] => {
  if (!curve) return []
  const { normalized_power, frequencies, rayleigh_resolution, frequency_spacing } = curve
  const search_bins = Math.max(1, Math.ceil((2 * rayleigh_resolution) / frequency_spacing))
  const candidates: PeakCandidate[] = []
  for (let frequency_idx = 1; frequency_idx < normalized_power.length - 1; frequency_idx++) {
    const value = normalized_power[frequency_idx]
    const is_local_max =
      value > normalized_power[frequency_idx - 1] &&
      value >= normalized_power[frequency_idx + 1]
    if (!is_local_max) continue
    let left_minimum = value
    let right_minimum = value
    for (let offset = 1; offset <= search_bins; offset++) {
      left_minimum = Math.min(
        left_minimum,
        normalized_power[Math.max(0, frequency_idx - offset)],
      )
      right_minimum = Math.min(
        right_minimum,
        normalized_power[Math.min(normalized_power.length - 1, frequency_idx + offset)],
      )
    }
    const prominence = value - Math.max(left_minimum, right_minimum)
    if (prominence >= PEAK_PROMINENCE) {
      candidates.push({
        frequency: frequencies[frequency_idx],
        prominence,
        source,
        resolution: rayleigh_resolution,
      })
    }
  }
  return candidates
}

interface CurveActivityStats {
  background_median: number
  threshold: number
}

const curve_activity_stats = (
  curve: TrajectorySpectrumCurve | null,
): CurveActivityStats | null => {
  if (!curve) return null
  const background_median = median(curve.normalized_power)
  const mad = median(
    curve.normalized_power.map((value) => Math.abs(value - background_median)),
  )
  return {
    background_median,
    threshold: Math.max(ACTIVITY_RELATIVE_THRESHOLD, background_median + ACTIVITY_SNR * mad),
  }
}

const curve_score = (
  curve: TrajectorySpectrumCurve | null,
  frequency: number,
  stats: CurveActivityStats | null,
): { score: number | null; activity: SpectralActivity; prominence: number } => {
  if (
    !(curve && stats) ||
    frequency < (curve.frequencies[0] ?? 0) ||
    frequency > curve.nyquist
  ) {
    return { score: null, activity: `unknown`, prominence: 0 }
  }
  const radius = 2 * curve.rayleigh_resolution
  let score = 0
  const start_idx = partition_point(curve.frequencies, (value) => value < frequency - radius)
  for (
    let frequency_idx = start_idx;
    frequency_idx < curve.frequencies.length;
    frequency_idx++
  ) {
    if (curve.frequencies[frequency_idx] > frequency + radius) break
    score = Math.max(score, curve.normalized_power[frequency_idx])
  }
  return {
    score,
    activity: score > stats.threshold ? `active` : `inactive`,
    prominence: Math.max(0, score - stats.background_median),
  }
}

const extract_displacements = (
  positions: Float64Array,
  frequencies: number[],
  input: TrajectorySpectroscopyInput,
  options: SpectrumOptions,
): Complex[][][] => {
  const { frequency_unit } = options
  const stream = input.positions
  const interval = sample_interval(stream.steps, frequency_unit, input.time_step, `positions`)
  const factor = frequency_factor(frequency_unit, input.time_unit)
  const weights = time_series_window(stream.n_frames, options.window)
  const weight_sum = weights.reduce((total, value) => total + value, 0)
  const n_components = stream.n_atoms * 3
  const component_means = new Float64Array(n_components)
  for (let frame_idx = 0; frame_idx < stream.n_frames; frame_idx++) {
    const base = frame_idx * n_components
    for (let component_idx = 0; component_idx < n_components; component_idx++) {
      component_means[component_idx] += positions[base + component_idx] / stream.n_frames
    }
  }
  const windowed = (frame_idx: number, component_idx: number) =>
    ((positions[frame_idx * n_components + component_idx] - component_means[component_idx]) *
      weights[frame_idx]) /
    weight_sum

  const spectra: Complex[][] = frequencies.map(() =>
    Array.from({ length: n_components }, () => [0, 0] satisfies Complex),
  )

  // One FFT per component serves every on-bin peak, vs a full-length DFT per (peak, component):
  // 1014 ms -> 113 ms for 494 peaks over 4096 frames and 128 atoms. VDOS peaks always land on a
  // bin; IR/Raman peaks come from separately sampled streams and fall back to the direct sum.
  const n_fft = next_power_of_two(Math.ceil(options.zero_pad_factor * stream.n_frames))
  const binned: [number, number][] = []
  const unbinned: number[] = []
  for (const [freq_idx, frequency] of frequencies.entries()) {
    const exact = (frequency / factor) * interval * n_fft
    const bin = Math.round(exact)
    if (Math.abs(exact - bin) < 1e-9 && bin >= 0 && bin < n_fft) binned.push([freq_idx, bin])
    else unbinned.push(freq_idx)
  }
  if (binned.length > 0) {
    const real = new Float64Array(n_fft)
    const imaginary = new Float64Array(n_fft)
    for (let component_idx = 0; component_idx < n_components; component_idx++) {
      real.fill(0)
      imaginary.fill(0)
      for (let frame_idx = 0; frame_idx < stream.n_frames; frame_idx++) {
        real[frame_idx] = windowed(frame_idx, component_idx)
      }
      fft_in_place(real, imaginary)
      for (const [freq_idx, bin] of binned) {
        spectra[freq_idx][component_idx] = [real[bin], imaginary[bin]]
      }
    }
  }
  for (const freq_idx of unbinned) {
    const raw_frequency = frequencies[freq_idx] / factor
    const flat = spectra[freq_idx]
    for (let frame_idx = 0; frame_idx < stream.n_frames; frame_idx++) {
      const angle = -2 * Math.PI * raw_frequency * frame_idx * interval
      const cosine = Math.cos(angle)
      const sine = Math.sin(angle)
      for (let component_idx = 0; component_idx < n_components; component_idx++) {
        const amplitude = windowed(frame_idx, component_idx)
        flat[component_idx][0] += amplitude * cosine
        flat[component_idx][1] += amplitude * sine
      }
    }
  }

  // Rotate by the phase of the largest component so patterns are real-valued and comparable
  return spectra.map((flat) => {
    let anchor_idx = 0
    for (let component_idx = 1; component_idx < flat.length; component_idx++) {
      if (Math.hypot(...flat[component_idx]) > Math.hypot(...flat[anchor_idx]))
        anchor_idx = component_idx
    }
    const phase = Math.atan2(flat[anchor_idx][1], flat[anchor_idx][0])
    const phase_cosine = Math.cos(-phase)
    const phase_sine = Math.sin(-phase)
    const anchored = flat.map(
      ([real, imaginary]) =>
        [
          real * phase_cosine - imaginary * phase_sine,
          real * phase_sine + imaginary * phase_cosine,
        ] satisfies Complex,
    )
    return Array.from({ length: stream.n_atoms }, (_, atom_idx) =>
      anchored.slice(atom_idx * 3, atom_idx * 3 + 3),
    )
  })
}

const detect_peaks = (
  vdos: TrajectorySpectrumCurve,
  ir: TrajectorySpectrumCurve | null,
  raman: TrajectorySpectrumCurve | null,
  prepared_positions: Float64Array,
  input: TrajectorySpectroscopyInput,
  options: SpectrumOptions,
): TrajectorySpectralPeak[] => {
  const candidates = [
    ...curve_candidates(vdos, `vdos`),
    ...curve_candidates(ir, `ir`),
    ...curve_candidates(raman, `raman`),
  ].toSorted((left, right) => left.frequency - right.frequency)
  const groups: PeakCandidate[][] = []
  for (const candidate of candidates) {
    const group = groups.at(-1)
    const previous = group?.at(-1)
    if (
      group &&
      previous &&
      candidate.frequency - previous.frequency <=
        2 * Math.max(candidate.resolution, ...group.map(({ resolution }) => resolution))
    ) {
      group.push(candidate)
    } else groups.push([candidate])
  }
  const frequencies = groups.map(
    (group) =>
      group.toSorted((left, right) => right.prominence - left.prominence)[0].frequency,
  )
  const position_interval = sample_interval(
    input.positions.steps,
    options.frequency_unit,
    input.time_step,
    `positions`,
  )
  const position_frequency_factor = frequency_factor(options.frequency_unit, input.time_unit)
  const position_nyquist = (0.5 * position_frequency_factor) / position_interval
  const frequencies_with_displacements = frequencies.filter(
    (frequency) => frequency <= position_nyquist,
  )
  const displacements = extract_displacements(
    prepared_positions,
    frequencies_with_displacements,
    input,
    options,
  )
  const displacement_by_frequency = new Map(
    frequencies_with_displacements.map((frequency, frequency_idx) => [
      frequency,
      displacements[frequency_idx],
    ]),
  )
  const ir_stats = curve_activity_stats(ir)
  const raman_stats = curve_activity_stats(raman)
  return groups.map((group, group_idx) => {
    const frequency = frequencies[group_idx]
    const displacement = displacement_by_frequency.get(frequency)
    const ir_score = curve_score(ir, frequency, ir_stats)
    const raman_score = curve_score(raman, frequency, raman_stats)
    const vdos_prominence = Math.max(
      0,
      ...group.flatMap((candidate) =>
        candidate.source === `vdos` ? [candidate.prominence] : [],
      ),
    )
    return {
      frequency,
      ir_activity: ir_score.activity,
      raman_activity: raman_score.activity,
      ir_score: ir_score.score,
      raman_score: raman_score.score,
      vdos_prominence,
      ir_prominence: ir_score.prominence,
      raman_prominence: raman_score.prominence,
      potentially_mixed: new Set(group.map(({ source }) => source)).size < group.length,
      ...(displacement
        ? { displacement }
        : {
            displacement_unavailable_reason:
              `Mode frequency ${frequency} ${options.frequency_unit} exceeds the ` +
              `position Nyquist frequency ${position_nyquist} ${options.frequency_unit}`,
          }),
    }
  })
}

export function standard_masses_for_elements(elements: string[]): Float64Array {
  return Float64Array.from(elements, (element, atom_idx) => {
    const mass = is_elem_symbol(element)
      ? element_by_symbol.get(element)?.atomic_mass
      : undefined
    if (mass && mass > 0) return mass
    return fail(`no standard atomic mass for atom ${atom_idx} (${element})`)
  })
}

export const calc_trajectory_spectroscopy = (
  input: TrajectorySpectroscopyInput,
  options: TrajectorySpectroscopyOptions = {},
): TrajectorySpectroscopyResult => {
  const { positions: stream, masses } = input
  if (stream.n_atoms < 1 || stream.n_frames < 3) {
    fail(
      `need at least 1 atom and 3 position frames, got ${stream.n_atoms} atoms and ${stream.n_frames} frames`,
    )
  }
  validate_position_stream(stream)
  if (
    masses.length !== stream.n_atoms ||
    masses.some((mass) => !Number.isFinite(mass) || !(mass > 0))
  ) {
    fail(
      `masses must contain one positive value per atom; got ${masses.length} for ${stream.n_atoms} atoms`,
    )
  }
  const pbc = stream.pbc ?? ([false, false, false] satisfies Pbc)
  const periodic = pbc.some(Boolean)
  const { time_step, time_unit } = input
  if ((time_step === undefined) !== (time_unit === undefined)) {
    fail(`time_step and time_unit must be supplied together`)
  }
  if (time_step !== undefined && (!Number.isFinite(time_step) || !(time_step > 0))) {
    fail(`time_step must be finite and > 0, got ${time_step}`)
  }
  if (time_unit !== undefined && !time_unit.trim()) {
    fail(`time_unit must be a non-empty string`)
  }
  const frequency_unit = require_one_of(
    options.frequency_unit ?? (time_step && time_unit ? `cm^-1` : `1/step`),
    TRAJECTORY_FREQUENCY_UNITS,
    `frequency_unit`,
  )
  const preprocessing = require_one_of(
    options.preprocessing ?? (periodic ? `remove_com` : `body_fixed`),
    [`body_fixed`, `remove_com`, `raw`],
    `preprocessing`,
  )
  const requested_velocity_source = require_one_of(
    options.velocity_source ?? `auto`,
    [`stored`, `central_difference`, `auto`],
    `velocity_source`,
  )
  if (input.infrared_signal) {
    require_one_of(
      input.infrared_signal.kind,
      [`dipole`, `polarization`, `current`],
      `IR signal kind`,
    )
  }
  if (input.raman_signal) {
    require_one_of(input.raman_signal.kind, [`polarizability`], `Raman signal kind`)
  }
  if (periodic && preprocessing === `body_fixed`) {
    fail(`body_fixed preprocessing is only valid for non-periodic systems`)
  }
  if (input.infrared_signal?.kind === `current` && preprocessing === `body_fixed`) {
    fail(
      `body_fixed current IR requires the time derivative of the rotating frame; ` +
        `use dipole/polarization, raw, or remove_com analysis`,
    )
  }
  if (input.infrared_signal?.kind === `dipole` && periodic) {
    fail(
      `total dipole is not a valid periodic IR signal; provide continuous polarization or current`,
    )
  }
  if (
    input.infrared_signal?.kind === `polarization` &&
    !input.infrared_signal.branch_continuous
  ) {
    fail(`polarization must be explicitly marked branch_continuous`)
  }
  const calculation_options = {
    frequency_unit,
    preprocessing,
    window: require_one_of(options.window ?? `hann`, WINDOW_TYPES, `window`),
    zero_pad_factor: options.zero_pad_factor ?? 4,
    raman_channel: require_one_of(
      options.raman_channel ?? `unpolarized`,
      RAMAN_CHANNELS,
      `Raman channel`,
    ),
  }
  const prepared = prepare_positions(stream, masses, preprocessing)

  // `auto`: stored velocities win whenever the input carries them; otherwise the prepared
  // positions are differentiated
  let velocity_source: VelocitySource
  let velocity_values: Float64Array
  let velocity_steps: number[]
  // What the velocities were subtracted out of, in velocity units (see build_curve source_scale)
  let velocity_source_scale: number
  if (requested_velocity_source === `stored` && !input.velocities) {
    fail(`velocity_source 'stored' was requested but no velocity signal was supplied`)
  }
  if (requested_velocity_source !== `central_difference` && input.velocities) {
    validate_trajectory_signal(input.velocities, [stream.n_atoms, 3], `velocities`)
    velocity_source = `stored`
    velocity_steps = input.velocities.steps
    velocity_values = remove_rigid_velocity(
      input.velocities.values,
      velocity_steps,
      stream,
      masses,
      prepared,
      preprocessing,
    )
    velocity_source_scale = max_abs(input.velocities.values)
  } else {
    velocity_source = `central_difference`
    if (stream.n_frames < 4) {
      fail(
        `central_difference velocities need at least 4 position frames, got ${stream.n_frames}`,
      )
    }
    const derivative_interval = sample_interval(
      stream.steps,
      frequency_unit,
      input.time_step,
      `positions`,
    )
    velocity_values = central_difference_velocities(
      prepared.positions,
      stream.n_frames,
      stream.n_atoms,
      derivative_interval,
    )
    velocity_steps = stream.steps.slice(1, -1)
    velocity_source_scale = max_abs(stream.positions) / derivative_interval
  }
  const total_mass = masses.reduce((total, mass) => total + mass, 0)
  const component_weights = Float64Array.from(
    { length: stream.n_atoms * 3 },
    (_, component_idx) => masses[Math.floor(component_idx / 3)] / total_mass,
  )
  const vdos = build_curve(
    velocity_values,
    stream.n_atoms * 3,
    velocity_steps,
    input,
    calculation_options,
    `velocities`,
    velocity_source_scale,
    component_weights,
  )

  let ir: TrajectorySpectrumCurve | null = null
  if (input.infrared_signal) {
    const { series } = input.infrared_signal
    validate_trajectory_signal(series, [3], `IR ${input.infrared_signal.kind}`)
    const rotations = signal_rotations(
      preprocessing,
      stream.steps,
      prepared.rotations,
      series.steps,
      `IR ${input.infrared_signal.kind}`,
    )
    const ir_values = rotate_vector_signal(series, rotations)
    // dipole/polarization spectra get the ω² of the classical absorption coefficient; a
    // current signal is already the time derivative and must not be weighted again
    ir = build_curve(
      ir_values,
      3,
      series.steps,
      input,
      calculation_options,
      `IR ${input.infrared_signal.kind}`,
      max_abs(series.values),
      undefined,
      input.infrared_signal.kind !== `current`,
    )
  }

  const raman = input.raman_signal
    ? calculate_raman(input, input.raman_signal.series, prepared, calculation_options)
    : null
  const peaks = detect_peaks(
    vdos,
    ir,
    raman ? raman[raman.selected_channel] : null,
    prepared.positions,
    input,
    calculation_options,
  )
  return {
    vdos,
    ir,
    raman,
    peaks,
    frequency_unit,
    preprocessing,
    velocity_source,
    reference_positions: prepared.reference_positions,
    elements: [...stream.elements],
    masses: Array.from(masses),
    pbc,
    reference_lattice: stream.lattice_matrices?.[0] ?? null,
    metadata: { ...input.metadata },
  }
}

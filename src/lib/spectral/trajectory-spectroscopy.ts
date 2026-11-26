import { display_idx } from '#lib/labels'
import { element_by_symbol } from '#lib/element/data'
import { is_elem_symbol } from '#lib/element/helpers'
import type { WindowType } from '#lib/fft'
import {
  fft_in_place,
  next_power_of_two,
  one_sided_periodogram,
  time_series_window,
  WINDOW_TYPES,
} from '#lib/fft'
import type { MdFrequencyUnit } from '#lib/spectral/frequency-units'
import { md_frequency_factor, MD_FREQUENCY_UNITS } from '#lib/spectral/frequency-units'
import type { Complex } from '#lib/spectral/types'
import type { Pbc } from '#lib/structure/index'
import type { Matrix3x3, Vec3 } from '#lib/math'
import {
  cross_3d,
  dot,
  first_non_increasing_index,
  IDENTITY_3X3,
  is_finite_vec3_like,
  is_pbc,
  mul_3x3_vec3,
  median,
  partition_point,
  same_values,
  transpose_3x3,
} from '#lib/math'
import type { TrajectoryPositionStream, TrajectorySignal } from '#lib/trajectory/index'
import {
  unwrap_flat_positions,
  validate_position_stream_layout,
} from '#lib/trajectory/positions'
import type { VelocitySource } from '#lib/vacf/index'
import { central_difference_velocities } from '#lib/vacf/compute-vacf'

// `1/step`: cycles per MD step, the honest axis without a recorded timestep (unlike the
// VACF's `1/frame`, which counts collected frames)
export type TrajectoryFrequencyUnit = MdFrequencyUnit | `1/step`
const TRAJECTORY_FREQUENCY_UNITS = [...MD_FREQUENCY_UNITS, `1/step`] as const
type SpectralActivity = `active` | `inactive` | `unknown`
export type SpectroscopyPreprocessing = `body_fixed` | `remove_com` | `raw`
const RAMAN_CHANNELS = [`isotropic`, `anisotropic`, `vv`, `vh`, `unpolarized`] as const
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
  metadata?: Record<string, unknown>
}

export interface TrajectorySpectroscopyOptions {
  // Simulation time per step, given together; physical frequency units need both. Options
  // rather than input, so a retained input (see the async client) is re-timed without a re-send
  time_step?: number
  time_unit?: string
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

// The resolved options every FFT path reads, as compute_trajectory_spectroscopy defaults them
type SpectrumOptions = Required<
  Pick<TrajectorySpectroscopyOptions, `frequency_unit` | `window` | `zero_pad_factor`>
> &
  Pick<TrajectorySpectroscopyOptions, `time_step` | `time_unit`>

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
  throw new Error(`compute_trajectory_spectroscopy: ${message}`)
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
  if (expected_shape && !same_values(signal.sample_shape, expected_shape)) {
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

// The shared layout check covers (integer) counts and buffer length; the step axis, value
// and lattice finiteness and pbc shape are spectroscopy's own
const validate_position_stream = (stream: TrajectoryPositionStream): void => {
  validate_position_stream_layout(stream, `compute_trajectory_spectroscopy`, 1)
  require_finite(stream.positions, `position`, `value`)
  if (stream.steps.length !== stream.n_frames) {
    fail(`positions have ${stream.n_frames} frames but ${stream.steps.length} steps`)
  }
  require_strict_steps(stream.steps, `position`)
  for (const [frame_idx, lattice] of stream.lattice_matrices?.entries() ?? []) {
    if (lattice && (lattice.length !== 3 || !lattice.every(is_finite_vec3_like))) {
      fail(`lattice matrix ${frame_idx} must be a finite 3 × 3 matrix`)
    }
  }
  if (stream.pbc != null && !is_pbc(stream.pbc))
    fail(`pbc must contain exactly 3 boolean values`)
}

const uniform_step_delta = (steps: number[], label: string): number => {
  const delta = steps[1] - steps[0]
  for (let step_idx = 2; step_idx < steps.length; step_idx++) {
    const next_delta = steps[step_idx] - steps[step_idx - 1]
    // Eight f64 epsilons at the largest of the three (strictly increasing, so an outer one)
    // steps cover this second difference's roundoff without admitting a real cadence change
    const magnitude = Math.max(1, Math.abs(steps[step_idx]), Math.abs(steps[step_idx - 2]))
    const tolerance = 8 * Number.EPSILON * magnitude
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
// centre-of-mass removal, Horn alignment and finite differences each hold only to ~n·eps.
// 1e-10 leaves six decades over f64 eps, far under any real vibration.
const ROUNDOFF_RATIO = 1e-10

const max_abs = (values: Float64Array): number => {
  let maximum = 0
  for (const value of values) maximum = Math.max(maximum, Math.abs(value))
  return maximum
}

// Largest excursion from a component's own mean, i.e. what the periodogram transforms
const max_component_variation = (values: ArrayLike<number>, n_components: number): number => {
  const n_samples = values.length / n_components
  const means = new Float64Array(n_components)
  for (let idx = 0; idx < values.length; idx++) {
    means[idx % n_components] += values[idx] / n_samples
  }
  let variation = 0
  for (let idx = 0; idx < values.length; idx++) {
    variation = Math.max(variation, Math.abs(values[idx] - means[idx % n_components]))
  }
  return variation
}

// Cycles per `time_unit` -> `frequency_unit`; 1 for the per-step axis
const frequency_factor = (
  frequency_unit: TrajectoryFrequencyUnit,
  time_unit: string | undefined,
): number => {
  if (frequency_unit === `1/step`) return 1
  // a physical unit has passed sample_interval's time_step check, and time_unit comes with it
  return (
    md_frequency_factor(time_unit ?? ``, frequency_unit) ??
    fail(`time_unit '${time_unit}' cannot be converted to ${frequency_unit}`)
  )
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

const combine_curves = (
  left: TrajectorySpectrumCurve,
  right: TrajectorySpectrumCurve,
  left_factor: number,
  right_factor: number,
): TrajectorySpectrumCurve => {
  const power = left.power.map(
    (value, frequency_idx) => left_factor * value + right_factor * right.power[frequency_idx],
  )
  return { ...left, power, normalized_power: normalize_power(power) }
}

// Unlike math's normalize_vec (zeros), a degenerate molecular axis throws instead of
// silently dropping the rotation
const unit_axis = (vector: ArrayLike<number>): Vec3 => {
  const norm = Math.hypot(vector[0], vector[1], vector[2])
  if (!(norm > 0)) fail(`molecular axis must be non-zero`)
  return [vector[0] / norm, vector[1] / norm, vector[2] / norm]
}

const RAMAN_ANISOTROPIC_WEIGHTS = Float64Array.from([0.5, 0.5, 0.5, 3, 3, 3])
const identity_rotations = (count: number): Matrix3x3[] =>
  Array.from({ length: count }, () => IDENTITY_3X3)

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
    let [row_max, col_max, off_diagonal] = [0, 1, 0]
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
    const [top, bottom] = [matrix[row_max], matrix[col_max]]
    const angle = 0.5 * Math.atan2(2 * top[col_max], bottom[col_max] - top[row_max])
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    // Givens rotation J in the (row_max, col_max) plane: A <- JᵀAJ, V <- VJ
    const rotate_columns = (target: number[][]) => {
      for (const row of target) {
        const [left, right] = [row[row_max], row[col_max]]
        row[row_max] = cosine * left - sine * right
        row[col_max] = sine * left + cosine * right
      }
    }
    rotate_columns(matrix)
    for (let col_idx = 0; col_idx < size; col_idx++) {
      const [left, right] = [top[col_idx], bottom[col_idx]]
      top[col_idx] = cosine * left - sine * right
      bottom[col_idx] = sine * left + cosine * right
    }
    top[col_max] = 0
    bottom[row_max] = 0
    rotate_columns(vectors)
  }
  return { values: matrix.map((row, idx) => row[idx]), vectors }
}

const center_frame = (
  positions: Float64Array,
  frame_idx: number,
  n_atoms: number,
  masses: Float64Array,
): { centered: Float64Array; center: Vec3 } => {
  const total_mass = masses.reduce((total, mass) => total + mass, 0)
  const frame = positions.subarray(frame_idx * n_atoms * 3, (frame_idx + 1) * n_atoms * 3)
  const center: Vec3 = [0, 0, 0]
  for (let idx = 0; idx < frame.length; idx++) {
    center[idx % 3] += masses[Math.floor(idx / 3)] * frame[idx]
  }
  for (let axis = 0; axis < 3; axis++) center[axis] /= total_mass
  const centered = new Float64Array(frame.length)
  for (let idx = 0; idx < frame.length; idx++) centered[idx] = frame[idx] - center[idx % 3]
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
  const { values, vectors } = symmetric_eigensystem(horn)
  const largest_idx = values.indexOf(Math.max(...values))
  return rotation_from_quaternion(vectors.map((row) => row[largest_idx]))
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
  preprocessing: SpectroscopyPreprocessing
  frame_by_step: Map<number, number>
}

// The outermost atom's axis when every atom sits on it (a linear molecule), else null
const linear_anchor = (
  centered: Float64Array,
  n_atoms: number,
): { atom_idx: number; axis: Vec3 } | null => {
  const atoms = Array.from({ length: n_atoms }, (_, idx) =>
    centered.subarray(idx * 3, idx * 3 + 3),
  )
  const radii = atoms.map((atom) => Math.hypot(...atom))
  const radius = Math.max(...radii)
  if (!(radius > 0)) return null
  const atom_idx = radii.indexOf(radius)
  const axis = unit_axis(atoms[atom_idx])
  const perpendicular = Math.max(...atoms.map((atom) => Math.hypot(...cross_3d(atom, axis))))
  return perpendicular <= 1e-8 * radius ? { atom_idx, axis } : null
}

// Shortest rotation taking unit `source` onto unit `target`: the quaternion (1 + s·t, s × t),
// or half a turn about any perpendicular when the axes are antiparallel
const axis_rotation = (source: Vec3, target: Vec3): Matrix3x3 => {
  const cosine = dot(source, target)
  const rotation_axis = cross_3d(source, target)
  if (cosine < 0 && Math.hypot(...rotation_axis) <= 1e-14) {
    const helper: Vec3 = Math.abs(source[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    return rotation_from_quaternion([0, ...unit_axis(cross_3d(source, helper))])
  }
  return rotation_from_quaternion([1 + cosine, ...rotation_axis])
}

const mean_geometry = (positions: Float64Array, n_atoms: number): number[][] => {
  const n_frames = positions.length / (n_atoms * 3)
  const totals = new Float64Array(n_atoms * 3)
  for (let idx = 0; idx < positions.length; idx++)
    totals[idx % totals.length] += positions[idx]
  return Array.from({ length: n_atoms }, (_, atom_idx) =>
    Array.from(totals.subarray(atom_idx * 3, atom_idx * 3 + 3), (total) => total / n_frames),
  )
}

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
  const motion = (positions: Float64Array, rotations: Matrix3x3[]): PreparedMotion => ({
    positions,
    lab_positions: unwrapped,
    rotations,
    reference_positions: mean_geometry(positions, stream.n_atoms),
    preprocessing,
    frame_by_step: new Map(stream.steps.map((step, frame_idx) => [step, frame_idx])),
  })
  // Nothing downstream writes the prepared buffers, so raw shares one unwrapped copy
  if (preprocessing === `raw`) return motion(unwrapped, identity_rotations(stream.n_frames))
  const prepared = new Float64Array(unwrapped.length)
  const rotations: Matrix3x3[] = []
  const first_frame = center_frame(unwrapped, 0, stream.n_atoms, masses)
  const first_centered = first_frame.centered
  const reference_center: Vec3 = periodic ? first_frame.center : [0, 0, 0]
  // periodic body_fixed input was rejected upfront
  const body_fixed = preprocessing === `body_fixed`
  const linear = body_fixed ? linear_anchor(first_centered, stream.n_atoms) : null
  let previous_axis = linear?.axis
  let previous_rotation: Matrix3x3 = IDENTITY_3X3
  for (let frame_idx = 0; frame_idx < stream.n_frames; frame_idx++) {
    const centered = center_frame(unwrapped, frame_idx, stream.n_atoms, masses).centered
    let rotation: Matrix3x3 = IDENTITY_3X3
    if (body_fixed) {
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
  return motion(prepared, rotations)
}

// Index of the position frame recorded at a signal sample's MD step
const position_frame = (
  prepared: PreparedMotion,
  step: number,
  label: string,
  purpose: string,
): number =>
  prepared.frame_by_step.get(step) ??
  fail(`${label} has a sample at MD step ${step}, but ${purpose} has no position at that step`)

// Body-frame rotation for every sample of a signal; identity when the preprocessing keeps
// the laboratory frame
const signal_rotations = (
  prepared: PreparedMotion,
  signal: TrajectorySignal,
  label: string,
): Matrix3x3[] =>
  prepared.preprocessing === `body_fixed`
    ? signal.steps.map(
        (step) =>
          prepared.rotations[position_frame(prepared, step, label, `body-frame processing`)],
      )
    : identity_rotations(signal.steps.length)

// One rotation per sample (signal_rotations), so it applies to its 3-vector
const rotate_vector_signal = (values: Float64Array, rotations: Matrix3x3[]): Float64Array => {
  const rotated = new Float64Array(values.length)
  for (const [sample_idx, rotation] of rotations.entries()) {
    const base = sample_idx * 3
    const [vec_x, vec_y, vec_z] = values.subarray(base, base + 3)
    rotated.set(mul_3x3_vec3(rotation, [vec_x, vec_y, vec_z]), base)
  }
  return rotated
}

// Each sample's symmetric part (the only one that scatters) as R·α·Rᵀ
const rotate_tensor_signal = (values: Float64Array, rotations: Matrix3x3[]): Float64Array => {
  const rotated = new Float64Array(values.length)
  for (const [sample_idx, rotation] of rotations.entries()) {
    const base = sample_idx * 9
    const entry = (row: number, col: number) =>
      (values[base + 3 * row + col] + values[base + 3 * col + row]) / 2
    const symmetric = [0, 1, 2].map((row) => [0, 1, 2].map((col) => entry(row, col)))
    rotated.set(dot(dot(rotation, symmetric), transpose_3x3(rotation)).flat(), base)
  }
  return rotated
}

const remove_rigid_velocity = (
  { values: velocities, steps }: TrajectorySignal,
  masses: Float64Array,
  prepared: PreparedMotion,
): Float64Array => {
  const { preprocessing, lab_positions } = prepared
  if (preprocessing === `raw`) return new Float64Array(velocities)
  const output = new Float64Array(velocities.length)
  const total_mass = masses.reduce((total, mass) => total + mass, 0)
  const n_atoms = masses.length
  const body_fixed = preprocessing === `body_fixed`
  // Scalar arithmetic and two per-sample scratch buffers only: this runs once per atom of every
  // velocity sample, where per-atom vectors and iterators cost more than the physics
  // (1024 samples x 300 atoms: 96 -> 2.7 ms for remove_com, 378 -> 7 ms for body_fixed)
  const relative = new Float64Array(n_atoms * 3) // velocities relative to the centre of mass
  const centered = new Float64Array(n_atoms * 3) // positions relative to the centre of mass
  for (const [sample_idx, step] of steps.entries()) {
    const position_frame_idx = position_frame(
      prepared,
      step,
      `stored velocity signal`,
      `rigid-motion removal`,
    )
    const sample_base = sample_idx * n_atoms * 3
    const frame_base = position_frame_idx * n_atoms * 3
    let [velocity_x, velocity_y, velocity_z] = [0, 0, 0]
    let [center_x, center_y, center_z] = [0, 0, 0]
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const base = atom_idx * 3
      const mass = masses[atom_idx]
      velocity_x += mass * velocities[sample_base + base]
      velocity_y += mass * velocities[sample_base + base + 1]
      velocity_z += mass * velocities[sample_base + base + 2]
      center_x += mass * lab_positions[frame_base + base]
      center_y += mass * lab_positions[frame_base + base + 1]
      center_z += mass * lab_positions[frame_base + base + 2]
    }
    ;[velocity_x, velocity_y, velocity_z] = [velocity_x, velocity_y, velocity_z].map(
      (sum) => sum / total_mass,
    )
    ;[center_x, center_y, center_z] = [center_x, center_y, center_z].map(
      (sum) => sum / total_mass,
    )
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const base = atom_idx * 3
      relative[base] = velocities[sample_base + base] - velocity_x
      relative[base + 1] = velocities[sample_base + base + 1] - velocity_y
      relative[base + 2] = velocities[sample_base + base + 2] - velocity_z
      centered[base] = lab_positions[frame_base + base] - center_x
      centered[base + 1] = lab_positions[frame_base + base + 1] - center_y
      centered[base + 2] = lab_positions[frame_base + base + 2] - center_z
    }
    // remove_com stops at the centre-of-mass velocity; only body_fixed removes rotation
    let [omega_x, omega_y, omega_z] = [0, 0, 0]
    if (body_fixed) {
      let [inertia_xx, inertia_yy, inertia_zz, inertia_xy, inertia_xz, inertia_yz] = [
        0, 0, 0, 0, 0, 0,
      ]
      let [momentum_x, momentum_y, momentum_z] = [0, 0, 0]
      for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
        const base = atom_idx * 3
        const mass = masses[atom_idx]
        const [pos_x, pos_y, pos_z] = [centered[base], centered[base + 1], centered[base + 2]]
        const [rel_x, rel_y, rel_z] = [relative[base], relative[base + 1], relative[base + 2]]
        const radius_squared = pos_x * pos_x + pos_y * pos_y + pos_z * pos_z
        inertia_xx += mass * (radius_squared - pos_x * pos_x)
        inertia_yy += mass * (radius_squared - pos_y * pos_y)
        inertia_zz += mass * (radius_squared - pos_z * pos_z)
        inertia_xy -= mass * (pos_x * pos_y)
        inertia_xz -= mass * (pos_x * pos_z)
        inertia_yz -= mass * (pos_y * pos_z)
        // angular momentum m r x v
        momentum_x += mass * (pos_y * rel_z - pos_z * rel_y)
        momentum_y += mass * (pos_z * rel_x - pos_x * rel_z)
        momentum_z += mass * (pos_x * rel_y - pos_y * rel_x)
      }
      const inertia = [
        [inertia_xx, inertia_xy, inertia_xz],
        [inertia_xy, inertia_yy, inertia_yz],
        [inertia_xz, inertia_yz, inertia_zz],
      ]
      ;[omega_x, omega_y, omega_z] = solve_inertia(inertia, [
        momentum_x,
        momentum_y,
        momentum_z,
      ])
    }
    const [[rot_xx, rot_xy, rot_xz], [rot_yx, rot_yy, rot_yz], [rot_zx, rot_zy, rot_zz]] =
      prepared.rotations[position_frame_idx]
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const base = atom_idx * 3
      const [pos_x, pos_y, pos_z] = [centered[base], centered[base + 1], centered[base + 2]]
      // residual after the rigid rotation omega x r, turned into the body frame
      const res_x = relative[base] - (omega_y * pos_z - omega_z * pos_y)
      const res_y = relative[base + 1] - (omega_z * pos_x - omega_x * pos_z)
      const res_z = relative[base + 2] - (omega_x * pos_y - omega_y * pos_x)
      const out = sample_base + base
      output[out] = rot_xx * res_x + rot_xy * res_y + rot_xz * res_z
      output[out + 1] = rot_yx * res_x + rot_yy * res_y + rot_yz * res_z
      output[out + 2] = rot_zx * res_x + rot_zy * res_y + rot_zz * res_z
    }
  }
  return output
}

// One-sided power spectrum of a (windowed, zero-padded) MD signal on the requested
// frequency axis. `frequency_squared` multiplies by (2πν)² and is IR-dipole only: the
// classical IR absorption α(ω)n(ω) ∝ ω·tanh(βħω/2)·FT⟨μ(0)μ(t)⟩ → (βħ/2)·ω²·FT⟨μμ⟩, i.e.
// the power spectrum of μ̇. A `current` IR signal is already μ̇ so it skips the factor, and
// Raman never applies it (see compute_raman). The VDOS is a velocity power spectrum.
const build_curve = (
  values: Float64Array,
  n_components: number,
  steps: number[],
  options: SpectrumOptions,
  label: string,
  // Scale of the raw data behind `values`, in their units. Only differs from max |values|
  // once an upstream subtraction destroyed it: 2.0e1 vs 4.0e-15 for Horn-aligned velocities.
  source_scale: number,
  component_weights?: Float64Array,
  frequency_squared = false,
): TrajectorySpectrumCurve => {
  const interval = sample_interval(steps, options.frequency_unit, options.time_step, label)
  const factor = frequency_factor(options.frequency_unit, options.time_unit)
  const periodogram = one_sided_periodogram(values, n_components, interval, {
    window: options.window,
    zero_pad_factor: options.zero_pad_factor,
    component_weights,
  })
  // Absolute floor, since everything downstream is relative: normalize_power puts the maximum
  // at 1 and prominence and activity are fractions of it, so pure cancellation residue reads
  // as full-scale modes (rigid tumbling water gave a 2.4e-29 VDOS maximum with 25 peaks)
  const below_roundoff =
    max_component_variation(values, n_components) <=
    ROUNDOFF_RATIO * Math.max(max_abs(values), source_scale)
  const physical_factor =
    frequency_squared && options.frequency_unit !== `1/step`
      ? frequency_factor(`THz`, options.time_unit)
      : 1
  // A density per source-frequency unit: rescaling the axis by `factor` divides it by the
  // same Jacobian so its integral stays invariant
  const power = Array.from(periodogram.power, (value, frequency_idx) => {
    if (below_roundoff) return 0
    if (!frequency_squared) return value / factor
    const physical_frequency = periodogram.frequencies[frequency_idx] * physical_factor
    return (value / factor) * (2 * Math.PI * physical_frequency) ** 2
  })
  return {
    frequencies: Array.from(periodogram.frequencies, (value) => value * factor),
    power,
    normalized_power: normalize_power(power),
    frequency_unit: options.frequency_unit,
    sample_interval: interval,
    frequency_spacing: periodogram.frequency_spacing * factor,
    rayleigh_resolution: periodogram.rayleigh_resolution * factor,
    nyquist: periodogram.nyquist * factor,
  }
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
const compute_raman = (
  polarizability: TrajectorySignal,
  prepared: PreparedMotion,
  options: SpectrumOptions & Required<Pick<TrajectorySpectroscopyOptions, `raman_channel`>>,
): RamanSpectrumResult => {
  const label = `Raman polarizability`
  validate_trajectory_signal(polarizability, [3, 3], label)
  const rotations = signal_rotations(prepared, polarizability, label)
  const rotated = rotate_tensor_signal(polarizability.values, rotations)
  const n_samples = polarizability.steps.length
  const isotropic_values = new Float64Array(n_samples)
  const anisotropic_values = new Float64Array(n_samples * 6)
  for (let sample_idx = 0; sample_idx < n_samples; sample_idx++) {
    const base = sample_idx * 9
    const [tensor_xx, tensor_xy, tensor_xz, , tensor_yy, tensor_yz, , , tensor_zz] =
      rotated.subarray(base, base + 9)
    isotropic_values[sample_idx] = (tensor_xx + tensor_yy + tensor_zz) / 3
    anisotropic_values.set(
      [
        tensor_xx - tensor_yy,
        tensor_yy - tensor_zz,
        tensor_zz - tensor_xx,
        tensor_xy,
        tensor_yz,
        tensor_xz,
      ],
      sample_idx * 6,
    )
  }
  const { steps } = polarizability
  const source_scale = max_abs(polarizability.values)
  const raman_curve = (values: Float64Array, n_components: number, weights?: Float64Array) =>
    build_curve(values, n_components, steps, options, label, source_scale, weights)
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
  for (let bin_idx = 1; bin_idx < normalized_power.length - 1; bin_idx++) {
    const value = normalized_power[bin_idx]
    // local maxima only
    if (value <= normalized_power[bin_idx - 1] || value < normalized_power[bin_idx + 1])
      continue
    const left_minimum = Math.min(
      ...normalized_power.slice(Math.max(0, bin_idx - search_bins), bin_idx + 1),
    )
    const right_minimum = Math.min(
      ...normalized_power.slice(bin_idx, bin_idx + search_bins + 1),
    )
    const prominence = value - Math.max(left_minimum, right_minimum)
    if (prominence >= PEAK_PROMINENCE) {
      candidates.push({
        frequency: frequencies[bin_idx],
        prominence,
        source,
        resolution: rayleigh_resolution,
      })
    }
  }
  return candidates
}

interface PeakScore {
  score: number | null
  activity: SpectralActivity
  prominence: number
}

// Scores a peak frequency on a response curve: its strongest normalized power within two
// Rayleigh widths, against the curve's robust background (median + MAD)
const curve_scorer = (curve: TrajectorySpectrumCurve | null) => {
  const unknown: PeakScore = { score: null, activity: `unknown`, prominence: 0 }
  if (!curve) return () => unknown
  const { frequencies, normalized_power, rayleigh_resolution, nyquist } = curve
  const background_median = median(normalized_power)
  const mad = median(normalized_power.map((value) => Math.abs(value - background_median)))
  const threshold = Math.max(
    ACTIVITY_RELATIVE_THRESHOLD,
    background_median + ACTIVITY_SNR * mad,
  )
  const radius = 2 * rayleigh_resolution
  return (frequency: number): PeakScore => {
    if (frequency < (frequencies[0] ?? 0) || frequency > nyquist) return unknown
    const start_idx = partition_point(frequencies, (value) => value < frequency - radius)
    const end_idx = partition_point(frequencies, (value) => value <= frequency + radius)
    const score = Math.max(0, ...normalized_power.slice(start_idx, end_idx))
    return {
      score,
      activity: score > threshold ? `active` : `inactive`,
      prominence: Math.max(0, score - background_median),
    }
  }
}

const extract_displacements = (
  prepared: PreparedMotion,
  frequencies: number[],
  stream: TrajectoryPositionStream,
  options: SpectrumOptions,
  interval: number,
  factor: number,
): Complex[][][] => {
  const { positions } = prepared
  const weights = time_series_window(stream.n_frames, options.window)
  const weight_sum = weights.reduce((total, value) => total + value, 0)
  const n_components = stream.n_atoms * 3
  // the reference geometry is the mean of the prepared positions
  const component_means = prepared.reference_positions.flat()
  const windowed = (frame_idx: number, component_idx: number) =>
    ((positions[frame_idx * n_components + component_idx] - component_means[component_idx]) *
      weights[frame_idx]) /
    weight_sum

  const spectra = frequencies.map(() =>
    Array.from({ length: n_components }, (): Complex => [0, 0]),
  )

  // One FFT per component serves every on-bin peak, vs a full-length DFT per (peak, component):
  // 1014 ms -> 113 ms for 494 peaks over 4096 frames and 128 atoms. IR/Raman peaks come from
  // separately sampled streams, land off-bin and fall back to the direct sum.
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
    // Two components a, b share one transform as z = a + i b (see one_sided_periodogram):
    // A(k) = (Z(k) + conj(Z(-k))) / 2 and B(k) = (Z(k) - conj(Z(-k))) / 2i
    for (let component_idx = 0; component_idx < n_components; component_idx += 2) {
      const paired = component_idx + 1 < n_components
      real.fill(0)
      imaginary.fill(0)
      for (let frame_idx = 0; frame_idx < stream.n_frames; frame_idx++) {
        real[frame_idx] = windowed(frame_idx, component_idx)
        if (paired) imaginary[frame_idx] = windowed(frame_idx, component_idx + 1)
      }
      fft_in_place(real, imaginary)
      for (const [freq_idx, bin] of binned) {
        const mirror = bin === 0 ? 0 : n_fft - bin
        const [re, im] = [real[bin], imaginary[bin]]
        const [mirror_re, mirror_im] = [real[mirror], imaginary[mirror]]
        spectra[freq_idx][component_idx] = [(re + mirror_re) / 2, (im - mirror_im) / 2]
        if (paired) {
          spectra[freq_idx][component_idx + 1] = [(im + mirror_im) / 2, (mirror_re - re) / 2]
        }
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
    const [anchor_re, anchor_im] = flat.reduce((best, value) =>
      Math.hypot(value[0], value[1]) > Math.hypot(best[0], best[1]) ? value : best,
    )
    const phase = Math.atan2(anchor_im, anchor_re)
    const phase_cosine = Math.cos(-phase)
    const phase_sine = Math.sin(-phase)
    const anchored = flat.map(([real, imaginary]): Complex => [
      real * phase_cosine - imaginary * phase_sine,
      real * phase_sine + imaginary * phase_cosine,
    ])
    return Array.from({ length: stream.n_atoms }, (_, atom_idx) =>
      anchored.slice(atom_idx * 3, atom_idx * 3 + 3),
    )
  })
}

const detect_peaks = (
  vdos: TrajectorySpectrumCurve,
  infrared: TrajectorySpectrumCurve | null,
  raman: TrajectorySpectrumCurve | null,
  prepared: PreparedMotion,
  input: TrajectorySpectroscopyInput,
  options: SpectrumOptions,
): TrajectorySpectralPeak[] => {
  const candidates = [
    ...curve_candidates(vdos, `vdos`),
    ...curve_candidates(infrared, `ir`),
    ...curve_candidates(raman, `raman`),
  ].toSorted((left, right) => left.frequency - right.frequency)
  const groups: PeakCandidate[][] = []
  for (const candidate of candidates) {
    const group = groups.at(-1)
    const previous = group?.[group.length - 1].frequency ?? -Infinity
    const max_resolution = Math.max(
      candidate.resolution,
      ...(group ?? []).map(({ resolution }) => resolution),
    )
    if (group && candidate.frequency - previous <= 2 * max_resolution) group.push(candidate)
    else groups.push([candidate])
  }
  const frequencies = groups.map(
    (group) =>
      group.toSorted((left, right) => right.prominence - left.prominence)[0].frequency,
  )
  const position_interval = sample_interval(
    input.positions.steps,
    options.frequency_unit,
    options.time_step,
    `positions`,
  )
  const position_frequency_factor = frequency_factor(options.frequency_unit, options.time_unit)
  const position_nyquist = (0.5 * position_frequency_factor) / position_interval
  const frequencies_with_displacements = frequencies.filter(
    (frequency) => frequency <= position_nyquist,
  )
  const displacements = extract_displacements(
    prepared,
    frequencies_with_displacements,
    input.positions,
    options,
    position_interval,
    position_frequency_factor,
  )
  const displacement_by_frequency = new Map(
    frequencies_with_displacements.map((freq, freq_idx) => [freq, displacements[freq_idx]]),
  )
  const [score_ir, score_raman] = [curve_scorer(infrared), curve_scorer(raman)]
  return groups.map((group, group_idx) => {
    const frequency = frequencies[group_idx]
    const displacement = displacement_by_frequency.get(frequency)
    const ir_score = score_ir(frequency)
    const raman_score = score_raman(frequency)
    return {
      frequency,
      ir_activity: ir_score.activity,
      raman_activity: raman_score.activity,
      ir_score: ir_score.score,
      raman_score: raman_score.score,
      vdos_prominence: Math.max(
        0,
        ...group.flatMap(({ source, prominence }) => (source === `vdos` ? [prominence] : [])),
      ),
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
    return fail(`no standard atomic mass for atom ${display_idx(atom_idx)} (${element})`)
  })
}

export const compute_trajectory_spectroscopy = (
  input: TrajectorySpectroscopyInput,
  options: TrajectorySpectroscopyOptions = {},
): TrajectorySpectroscopyResult => {
  const { positions: stream, masses, infrared_signal } = input
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
  const { time_step, time_unit } = options
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
  const ir_kind = infrared_signal?.kind
  if (ir_kind) require_one_of(ir_kind, [`dipole`, `polarization`, `current`], `IR signal kind`)
  const raman_kind = input.raman_signal?.kind
  if (raman_kind) require_one_of(raman_kind, [`polarizability`], `Raman signal kind`)
  if (periodic && preprocessing === `body_fixed`) {
    fail(`body_fixed preprocessing is only valid for non-periodic systems`)
  }
  if (ir_kind === `current` && preprocessing === `body_fixed`) {
    fail(
      `body_fixed current IR requires the time derivative of the rotating frame; ` +
        `use dipole/polarization, raw, or remove_com analysis`,
    )
  }
  if (ir_kind === `dipole` && periodic) {
    fail(
      `total dipole is not a valid periodic IR signal; provide continuous polarization or current`,
    )
  }
  if (infrared_signal?.kind === `polarization` && !infrared_signal.branch_continuous) {
    fail(`polarization must be explicitly marked branch_continuous`)
  }
  const calculation_options = {
    time_step,
    time_unit,
    frequency_unit,
    window: require_one_of(options.window ?? `hann`, WINDOW_TYPES, `window`),
    zero_pad_factor: options.zero_pad_factor ?? 4,
    raman_channel: require_one_of(
      options.raman_channel ?? `unpolarized`,
      RAMAN_CHANNELS,
      `Raman channel`,
    ),
  }
  const prepared = prepare_positions(stream, masses, preprocessing)

  const stored = requested_velocity_source === `central_difference` ? null : input.velocities
  if (requested_velocity_source === `stored` && !stored) {
    fail(`velocity_source 'stored' was requested but no velocity signal was supplied`)
  }
  if (!stored && stream.n_frames < 4) {
    fail(
      `central_difference velocities need at least 4 position frames, got ${stream.n_frames}`,
    )
  }
  if (stored) validate_trajectory_signal(stored, [stream.n_atoms, 3], `velocities`)
  const derivative_interval = stored
    ? 1
    : sample_interval(stream.steps, frequency_unit, time_step, `positions`)
  // source_scale: what the velocities were subtracted out of, in velocity units (see build_curve)
  const velocity = stored
    ? {
        source: `stored` as const,
        values: remove_rigid_velocity(stored, masses, prepared),
        steps: stored.steps,
        source_scale: max_abs(stored.values),
      }
    : {
        source: `central_difference` as const,
        values: central_difference_velocities(
          prepared.positions,
          stream.n_frames,
          stream.n_atoms,
          derivative_interval,
        ),
        steps: stream.steps.slice(1, -1),
        source_scale: max_abs(stream.positions) / derivative_interval,
      }
  const total_mass = masses.reduce((total, mass) => total + mass, 0)
  const component_weights = Float64Array.from(
    { length: stream.n_atoms * 3 },
    (_, component_idx) => masses[Math.floor(component_idx / 3)] / total_mass,
  )
  const vdos = build_curve(
    velocity.values,
    stream.n_atoms * 3,
    velocity.steps,
    calculation_options,
    `velocities`,
    velocity.source_scale,
    component_weights,
  )

  let infrared: TrajectorySpectrumCurve | null = null
  if (infrared_signal) {
    const { series, kind } = infrared_signal
    const label = `IR ${kind}`
    validate_trajectory_signal(series, [3], label)
    const rotations = signal_rotations(prepared, series, label)
    // ω² for dipole/polarization only: a current is already the time derivative
    infrared = build_curve(
      rotate_vector_signal(series.values, rotations),
      3,
      series.steps,
      calculation_options,
      label,
      max_abs(series.values),
      undefined,
      kind !== `current`,
    )
  }

  const raman = input.raman_signal
    ? compute_raman(input.raman_signal.series, prepared, calculation_options)
    : null
  const peaks = detect_peaks(
    vdos,
    infrared,
    raman ? raman[raman.selected_channel] : null,
    prepared,
    input,
    calculation_options,
  )
  return {
    vdos,
    ir: infrared,
    raman,
    peaks,
    frequency_unit,
    preprocessing,
    velocity_source: velocity.source,
    reference_positions: prepared.reference_positions,
    elements: [...stream.elements],
    masses: Array.from(masses),
    pbc,
    reference_lattice: stream.lattice_matrices?.[0] ?? null,
    metadata: { ...input.metadata },
  }
}

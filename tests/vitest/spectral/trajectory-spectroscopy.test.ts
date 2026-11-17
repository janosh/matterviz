import type {
  RamanChannel,
  TrajectorySpectroscopyInput,
  TrajectorySpectroscopyOptions,
  TrajectorySpectroscopyResult,
} from '#lib/spectral/trajectory-spectroscopy.js'
import {
  compute_trajectory_spectroscopy,
  validate_trajectory_signal,
} from '#lib/spectral/trajectory-spectroscopy.js'
import { THZ_TO_INVERSE_CM } from '#lib/constants.js'
import type { ElementSymbol } from '#lib/element/index.js'
import { one_sided_periodogram } from '#lib/fft.js'
import * as math from '#lib/math.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import type { Pbc } from '#lib/structure/pbc.js'
import type { TrajectoryPositionStream, TrajectorySignal } from '#lib/trajectory/index.js'
import { describe, expect, it } from 'vite-plus/test'
import { IDENTITY_MATRIX3, cubic_matrix, make_signal } from '../test-fixtures'

const position_stream = (
  positions: Float64Array,
  elements: ElementSymbol[],
  steps: number[],
): TrajectoryPositionStream => ({
  positions,
  n_frames: steps.length,
  n_atoms: elements.length,
  elements,
  lattice_matrices: null,
  pbc: [false, false, false],
  coords_unwrapped: true,
  frame_stride: 1,
  steps,
})

const make_input = (
  velocity_frequency = 0.125,
  velocity_amplitude = 1,
  n_frames = 128,
): TrajectorySpectroscopyInput => {
  const steps = Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx)
  const positions = new Float64Array(n_frames * 2 * 3)
  const velocities = new Float64Array(n_frames * 2 * 3)
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    const displacement = 0.05 * Math.sin(2 * Math.PI * velocity_frequency * frame_idx)
    positions.set([-0.5 - displacement, 0, 0, 0.5 + displacement, 0, 0], frame_idx * 6)
    const velocity =
      velocity_amplitude * Math.cos(2 * Math.PI * velocity_frequency * frame_idx)
    velocities.set([-velocity, 0, 0, velocity, 0, 0], frame_idx * 6)
  }
  return {
    positions: position_stream(positions, [`H`, `H`], steps),
    masses: Float64Array.from([1, 1]),
    velocities: { values: velocities, sample_shape: [2, 3], steps },
  }
}

// A vec3 series oscillating along x at `cycles` per sample, the standard IR/Raman probe here
const x_sinusoid = (cycles: number, n_samples = 128): TrajectorySignal =>
  make_signal(n_samples, [3], (idx) => [Math.sin(2 * Math.PI * cycles * idx), 0, 0])

// 10 A cubic cell on every frame, so periodic paths have a lattice to unwrap against
const make_periodic = (input: TrajectorySpectroscopyInput, pbc: Pbc): void => {
  input.positions.pbc = pbc
  input.positions.lattice_matrices = Array.from({ length: 128 }, () => cubic_matrix(10))
}
// row-major diagonal 3x3 tensor
const diag3 = (xx: number, yy: number, zz: number) => [xx, 0, 0, 0, yy, 0, 0, 0, zz]

const peak_near = (result: TrajectorySpectroscopyResult, frequency: number) =>
  result.peaks.reduce((best, peak) =>
    Math.abs(peak.frequency - frequency) < Math.abs(best.frequency - frequency) ? peak : best,
  )

const RAW = { preprocessing: `raw` as const, frequency_unit: `1/step` as const }
const RAW_SPECTRUM = { ...RAW, window: `none` as const, zero_pad_factor: 1 as const }

type TumblingCase = {
  elements: ElementSymbol[]
  masses: number[]
  base_positions: number[][]
  body_tensor: (oscillation: number) => number[]
  amplitude: number
  axis?: Vec3 // unit rotation axis through the origin (default z)
  breathing?: number // relative amplitude of a body-frame breathing mode about the centre of mass
}
const tumbling_spectra = (spec: TumblingCase) => {
  const { elements, masses, base_positions, body_tensor, amplitude } = spec
  const { axis = [0, 0, 1], breathing = 0 } = spec
  const n_frames = 128
  const n_atoms = base_positions.length
  const make_buffers = () => ({
    positions: new Float64Array(n_frames * n_atoms * 3),
    velocities: new Float64Array(n_frames * n_atoms * 3),
    tensors: new Float64Array(n_frames * 9),
  })
  const [rotating, stationary] = [make_buffers(), make_buffers()]
  const steps = Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx)
  const angular_speed = 2 * Math.PI * 0.03
  const phase_speed = 2 * Math.PI * 0.125 // the body-frame Raman and breathing modes
  const angular_velocity = math.scale(axis, angular_speed)
  const total_mass = masses.reduce((sum, mass) => sum + mass, 0)
  const weighted = base_positions.map((pos, atom_idx) =>
    math.scale(pos as Vec3, masses[atom_idx]),
  )
  const center = math.scale(math.add(...weighted), 1 / total_mass)
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    const angle = angular_speed * frame_idx
    const [cosine, sine] = [Math.cos(angle), Math.sin(angle)]
    // Rodrigues: R v = cos v + sin (n x v) + (1 - cos) (n . v) n, applied to the basis rows
    const rotate = (vec: Vec3): Vec3 =>
      math.add(
        math.scale(vec, cosine),
        math.scale(math.cross_3d(axis, vec), sine),
        math.scale(axis, (1 - cosine) * math.dot(axis, vec)),
      )
    const rotation = math.transpose_3x3(IDENTITY_MATRIX3.map(rotate) as Matrix3x3)
    const phase = phase_speed * frame_idx
    const tensor = body_tensor(amplitude * Math.sin(phase))
    stationary.tensors.set(tensor, frame_idx * 9)
    const body_matrix = [tensor.slice(0, 3), tensor.slice(3, 6), tensor.slice(6)] as Matrix3x3
    rotating.tensors.set(
      math.dot(math.dot(rotation, body_matrix), math.transpose_3x3(rotation)).flat(),
      frame_idx * 9,
    )
    for (const [atom_idx, base] of base_positions.entries()) {
      const offset = math.subtract(base as Vec3, center)
      const body_position = math.add(
        center,
        math.scale(offset, 1 + breathing * Math.sin(phase)),
      )
      const body_velocity = math.scale(offset, breathing * phase_speed * Math.cos(phase))
      const lab_position = math.mul_3x3_vec3(rotation, body_position)
      const atom_base = frame_idx * n_atoms * 3 + atom_idx * 3
      stationary.positions.set(body_position, atom_base)
      stationary.velocities.set(body_velocity, atom_base)
      rotating.positions.set(lab_position, atom_base)
      rotating.velocities.set(
        math.add(
          math.mul_3x3_vec3(rotation, body_velocity),
          math.cross_3d(angular_velocity, lab_position),
        ),
        atom_base,
      )
    }
  }
  type Buffers = ReturnType<typeof make_buffers>
  const as_input = ({
    positions,
    velocities,
    tensors,
  }: Buffers): TrajectorySpectroscopyInput => ({
    positions: position_stream(positions, elements, steps),
    masses: Float64Array.from(masses),
    velocities: { values: velocities, sample_shape: [n_atoms, 3], steps },
    raman_signal: {
      kind: `polarizability`,
      series: { values: tensors, sample_shape: [3, 3], steps },
    },
  })
  const options = { ...RAW_SPECTRUM, preprocessing: `body_fixed` } as const
  return {
    rotating: compute_trajectory_spectroscopy(as_input(rotating), options),
    stationary: compute_trajectory_spectroscopy(as_input(stationary), options),
  }
}

describe(`compute_trajectory_spectroscopy`, () => {
  // Same vocabulary as the VACF: `auto` prefers stored velocities, `stored` insists on them,
  // `central_difference` differentiates the positions even when velocities are supplied
  it.each([
    [undefined, true, `stored`],
    [undefined, false, `central_difference`],
    [`auto`, true, `stored`],
    [`auto`, false, `central_difference`],
    [`stored`, true, `stored`],
    [`central_difference`, true, `central_difference`],
    [`central_difference`, false, `central_difference`],
  ] as const)(
    `velocity_source=%s with stored velocities=%s reports %s`,
    (velocity_source, has_velocities, expected) => {
      const spectrum = (
        with_velocities: boolean,
        options: TrajectorySpectroscopyOptions = {},
      ) => {
        const input = make_input()
        if (!with_velocities) input.velocities = null
        return compute_trajectory_spectroscopy(input, { ...RAW_SPECTRUM, ...options })
      }
      const result = spectrum(has_velocities, { velocity_source })
      expect(result.velocity_source).toBe(expected)
      // the reported source must be the one actually used: the spectrum has to match the
      // reference computed from that source alone
      const reference = spectrum(expected === `stored`)
      expect(reference.velocity_source).toBe(expected)
      expect(result.vdos.power).toEqual(reference.vdos.power)
      // and differ from the other source's spectrum (the fixture's stored velocities are
      // not the derivative of its positions)
      const other = spectrum(expected !== `stored`)
      expect(other.velocity_source).not.toBe(expected)
      expect(result.vdos.power).not.toEqual(other.vdos.power)
    },
  )

  // Ground truth for the VDOS pipeline: a pure velocity sinusoid at a known physical
  // frequency must peak there, and the curve must be exactly the mass-weighted
  // one_sided_periodogram of those velocities with the fs → THz Jacobian applied.
  it(`VDOS of a 10 THz velocity sinusoid peaks at 10 THz and equals the fft periodogram`, () => {
    const [n_frames, time_step_fs, frequency_thz] = [256, 2, 10]
    const cycles_per_frame = frequency_thz * time_step_fs * 1e-3 // THz · fs
    const input = make_input(cycles_per_frame, 1, n_frames)
    const options = { window: `hann`, zero_pad_factor: 4 } as const
    const { vdos } = compute_trajectory_spectroscopy(input, {
      ...options,
      time_step: time_step_fs,
      time_unit: `fs`,
      preprocessing: `raw`,
      frequency_unit: `THz`,
    })
    const peak_idx = vdos.power.indexOf(Math.max(...vdos.power))
    // Within one frequency bin (zero-padded grid spacing), not just the Rayleigh width
    expect(Math.abs(vdos.frequencies[peak_idx] - frequency_thz)).toBeLessThanOrEqual(
      vdos.frequency_spacing,
    )
    expect(vdos.nyquist).toBeCloseTo(250, 12) // 1 / (2 · 2 fs)

    if (!input.velocities) throw new Error(`fixture has no velocities`)
    const reference = one_sided_periodogram(input.velocities.values, 6, time_step_fs, {
      ...options,
      component_weights: Float64Array.from({ length: 6 }, () => 0.5), // two equal masses
    })
    const thz_per_inverse_fs = 1000
    let max_abs_error = 0
    for (const [idx, power] of vdos.power.entries()) {
      expect(vdos.frequencies[idx]).toBeCloseTo(
        reference.frequencies[idx] * thz_per_inverse_fs,
        12,
      )
      max_abs_error = Math.max(
        max_abs_error,
        Math.abs(power - reference.power[idx] / thz_per_inverse_fs),
      )
    }
    // Same arithmetic in the same order: only the division by 1000 differs
    expect(max_abs_error).toBeLessThan(4 * Number.EPSILON * Math.max(...vdos.power))
  })

  // oxfmt-ignore
  it.each([
    [`zero dimension`, [0], [0, 1], new Float64Array(), /invalid sample shape \[0\]/],
    [`fractional dimension`, [1.5], [0, 1], new Float64Array(3), /invalid sample shape/],
    [`rank three`, [1, 1, 1], [0, 1], new Float64Array(2), /rank must be at most 2/],
    [`non-finite first step`, [3], [Number.NEGATIVE_INFINITY, 0], new Float64Array(6), /step 0 is -Infinity, not finite/],
  ])(`rejects malformed public signals: %s`, (_label, sample_shape, steps, values, expected) => {
    expect(() => validate_trajectory_signal({ sample_shape, steps, values })).toThrow(expected)
  })

  type Mutate = (input: TrajectorySpectroscopyInput) => unknown
  // oxfmt-ignore
  it.each([
    [`short position buffer`, (input) => (input.positions.positions = input.positions.positions.slice(1)), /positions has .* entries but 128 frames/],
    [`non-finite position`, (input) => (input.positions.positions[1] = Number.NaN), /position value 1 is NaN/],
    [`element count`, (input) => input.positions.elements.pop(), /got 1 element labels for 2 atoms/],
    [`descending steps`, (input) => (input.positions.steps[5] = 3), /position steps must increase strictly/],
    [`infinite mass`, (input) => (input.masses[0] = Number.POSITIVE_INFINITY), /masses must contain one positive value per atom/],
    [`lattice count`, (input) => (input.positions.lattice_matrices = [IDENTITY_MATRIX3]), /lattice matrices/],
    [`fractional atom count`, (input) => (input.positions.n_atoms = 1.5), /element labels for 1\.5 atoms/],
    [`fractional frame count`, (input) => (input.positions.n_frames = 127.5), /entries but 127\.5 frames/],
    [`malformed PBC`, (input) => Reflect.set(input.positions, `pbc`, [true, false]), /pbc must contain exactly 3 boolean values/],
    [`wrapped periodic positions without a lattice`, (input) => {
      input.positions.pbc = [true, false, false]
      input.positions.coords_unwrapped = false
    }, /wrapped periodic positions require a lattice matrix for the first frame/],
    [`one-percent cadence mismatch at a large step origin`, (input) => {
      input.positions.steps = input.positions.steps.map((step) => 1e12 + step)
      input.positions.steps[64] += 0.01
    }, /positions is not uniformly sampled/],
  ] as [string, Mutate, RegExp][])(`rejects malformed position input: %s`, (_label, mutate, expected) => {
    const input = make_input()
    mutate(input)
    expect(() => compute_trajectory_spectroscopy(input, RAW)).toThrow(expected)
  })

  const zero_vec3 = () => make_signal(128, [3], () => [0, 0, 0])
  // oxfmt-ignore
  it.each([
    [`IR signal kind`, (input) => {
      input.infrared_signal = { kind: `dipole`, series: zero_vec3() }
      Reflect.set(input.infrared_signal, `kind`, `charges`)
    }, {}, /IR signal kind 'charges' is not supported/],
    [`Raman signal kind`, (input) => {
      input.raman_signal = { kind: `polarizability`, series: make_signal(128, [3, 3], () => diag3(0, 0, 0)) }
      Reflect.set(input.raman_signal, `kind`, `susceptibility`)
    }, {}, /Raman signal kind 'susceptibility' is not supported/],
    [`Raman channel`, () => {}, { raman_channel: `polarized` }, /Raman channel 'polarized' is not supported/],
    [`body-fixed current IR`, (input) => {
      input.infrared_signal = { kind: `current`, series: x_sinusoid(0.125) }
    }, { preprocessing: `body_fixed` }, /body_fixed current IR requires the time derivative of the rotating frame/],
    [`unmarked polarization IR`, (input) => {
      input.infrared_signal = { kind: `polarization`, branch_continuous: true, series: zero_vec3() }
      Reflect.deleteProperty(input.infrared_signal, `branch_continuous`)
    }, {}, /polarization must be explicitly marked branch_continuous/],
    [`unknown window`, () => {}, { window: `blackman` }, /window 'blackman' is not supported/],
    [`unknown velocity_source`, () => {}, { velocity_source: `finite_difference` }, /velocity_source/],
    [`stored velocity_source without a velocity signal`, (input) => (input.velocities = null), { velocity_source: `stored` }, /velocity_source 'stored' was requested but no velocity signal was supplied/],
    [`blank signal unit`, (input) => {
      input.infrared_signal = { kind: `dipole`, series: { ...zero_vec3(), unit: ` ` } }
    }, {}, /unit must be a non-empty string/],
    [`nonuniform velocity sampling`, (input) => input.velocities?.steps.splice(5, 1, 7), {}, /steps must increase strictly|not uniformly sampled/],
    [`periodic total dipole`, (input) => {
      make_periodic(input, [true, false, false])
      input.infrared_signal = { kind: `dipole`, series: make_signal(128, [3], () => [1, 0, 0]) }
    }, { preprocessing: `remove_com` }, /total dipole is not a valid periodic IR signal/],
    [`three frames for central-difference velocities`, (input) => {
      Object.assign(input, make_input(0.125, 1, 3), { velocities: null })
    }, {}, /central_difference velocities need at least 4 position frames, got 3/],
    // physical time options are validated even in 1/step mode
    [`zero time_step`, () => {}, { time_step: 0, time_unit: `fs` }, /time_step must be finite and > 0/],
    [`time_step without time_unit`, () => {}, { time_step: 1 }, /time_step and time_unit must be supplied together/],
    [`time_unit without time_step`, () => {}, { time_unit: `fs` }, /time_step and time_unit must be supplied together/],
    [`blank time_unit`, () => {}, { time_step: 1, time_unit: ` ` }, /time_unit must be a non-empty string/],
  ] as [string, Mutate, Record<string, unknown>, RegExp][])(
    `rejects unsupported options and signals: %s`,
    (_label, mutate, raw_options, expected) => {
      const input = make_input()
      mutate(input)
      const options: TrajectorySpectroscopyOptions = { ...RAW }
      for (const [key, value] of Object.entries(raw_options)) Reflect.set(options, key, value)
      expect(() => compute_trajectory_spectroscopy(input, options)).toThrow(expected)
    },
  )

  it(`returns the same physical raw IR spectrum for equivalent time units`, () => {
    const input = make_input()
    input.infrared_signal = { kind: `dipole`, series: x_sinusoid(0.125) }
    // one input re-timed through the options alone
    const timed = (time_step: number, time_unit: string, frequency_unit: `THz` | `cm^-1`) =>
      compute_trajectory_spectroscopy(input, {
        ...RAW_SPECTRUM,
        time_step,
        time_unit,
        frequency_unit,
      })
    const femtoseconds = timed(1, `fs`, `THz`)
    const picoseconds = timed(0.001, `ps`, `THz`)
    expect(femtoseconds.ir?.frequencies).toEqual(picoseconds.ir?.frequencies)
    const reference = femtoseconds.ir?.power ?? []
    const tolerance = 10 * Number.EPSILON * Math.max(...reference)
    const wavenumbers = timed(1, `fs`, `cm^-1`)
    // same physical spectrum in ps, and in cm^-1 once the per-unit density is converted back
    for (const power of [
      picoseconds.ir?.power ?? [],
      (wavenumbers.ir?.power ?? []).map((value) => value * THZ_TO_INVERSE_CM),
    ]) {
      expect(power).toHaveLength(reference.length)
      const errors = power.map((value, idx) => Math.abs(value - reference[idx]))
      expect(Math.max(...errors)).toBeLessThan(tolerance)
    }
  })

  it(`uses independent signal step spacing for 1/step frequencies`, () => {
    const input = make_input()
    // 0.25 cycles per sample on every other step is 0.125 cycles per step
    const series = x_sinusoid(0.25, 64)
    series.steps = series.steps.map((step) => step * 2)
    input.infrared_signal = { kind: `dipole`, series }
    const infrared = compute_trajectory_spectroscopy(input, RAW_SPECTRUM).ir
    if (!infrared) throw new Error(`no IR spectrum`)
    const maximum_idx = infrared.power.indexOf(Math.max(...infrared.power))
    expect(infrared.frequencies[maximum_idx]).toBeCloseTo(0.125, 14)
    expect(infrared.sample_interval).toBe(2)
    expect(infrared.nyquist).toBe(0.25)
  })

  // Uniform within computed f64 roundoff: a decimal grid, and the same grid translated to a
  // large step origin where the absolute roundoff of each step is far larger
  it.each([
    [`decimal step grid`, (step: number) => step * 0.1],
    [`large step origin`, (step: number) => 1e12 + step * 0.1],
  ])(`accepts a %s that is uniform within f64 roundoff`, (_label, transform) => {
    const input = make_input()
    input.positions.steps = input.positions.steps.map(transform)
    if (input.velocities) input.velocities.steps = [...input.positions.steps]
    const { vdos } = compute_trajectory_spectroscopy(input, RAW_SPECTRUM)
    // the spacing is read off the first two steps: 0.1 up to the ulp of 1e12 (1.2e-4)
    expect(vdos.sample_interval).toBeCloseTo(0.1, 3)
    // 0.125 cycles per frame on a 0.1-step grid is 1.25 cycles per step unit, bin 16 of 128
    const maximum_idx = vdos.power.indexOf(Math.max(...vdos.power))
    expect(maximum_idx).toBe(16)
    expect(vdos.frequencies[maximum_idx]).toBeCloseTo(1.25, 2)
  })

  // Prominence and the activity threshold are both fractions of the spectrum maximum, so
  // without an absolute floor a run with nothing to report has its cancellation residue scaled
  // to 1 and read as modes: this rigid water, tumbling and drifting under body_fixed, gave a
  // VDOS maximum of 2.4e-29 with 25 peaks, six "IR active" off a constant-magnitude dipole.
  // `stretch_amp` scales the O-H bonds, so 0 is the rigid molecule.
  const rigid_water = (stretch_amp: number): TrajectorySpectroscopyInput => {
    const n_frames = 256
    const half_angle = (104.52 / 2) * (Math.PI / 180)
    const [bond_x, bond_y] = [0.9572 * Math.sin(half_angle), 0.9572 * Math.cos(half_angle)]
    // oxfmt-ignore
    const body = [[0, 0, 0], [bond_x, bond_y, 0], [-bond_x, bond_y, 0]]
    const angle = (frame_idx: number) => 0.037 * frame_idx
    const steps = Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx)
    const positions = Float64Array.from(
      steps.flatMap((frame_idx) => {
        const [cosine, sine] = [Math.cos(angle(frame_idx)), Math.sin(angle(frame_idx))]
        const drift = [12 + 0.03 * frame_idx, -7 + 0.011 * frame_idx, 4]
        const stretch = 1 + stretch_amp * Math.sin(2 * Math.PI * 0.11 * frame_idx)
        return body.flatMap(([x_coord, y_coord, z_coord]) => {
          const [x_body, y_body] = [x_coord * stretch, y_coord * stretch]
          return [
            x_body * cosine - y_body * sine + drift[0],
            x_body * sine + y_body * cosine + drift[1],
            z_coord + drift[2],
          ]
        })
      }),
    )
    return {
      positions: position_stream(positions, [`O`, `H`, `H`], steps),
      masses: Float64Array.from([15.999, 1.008, 1.008]),
      // constant 1.85 D magnitude, rotating with the molecule: no IR activity at all
      infrared_signal: {
        kind: `dipole`,
        series: make_signal(n_frames, [3], (frame_idx) => [
          -1.85 * Math.sin(angle(frame_idx)),
          1.85 * Math.cos(angle(frame_idx)),
          0,
        ]),
      },
    }
  }

  it.each([
    { stretch_amp: 0, peak_freqs: [], vdos_max: 0 },
    { stretch_amp: 1e-3, peak_freqs: [0.11], vdos_max: 3.3e-6 },
  ])(
    `reports no spectrum for motion below round-off (stretch $stretch_amp)`,
    ({ stretch_amp, peak_freqs, vdos_max }) => {
      const options = { ...RAW, preprocessing: `body_fixed` } as const
      const result = compute_trajectory_spectroscopy(rigid_water(stretch_amp), options)
      // any surviving peak is the injected 0.11 1/step stretch, not round-off
      expect(result.peaks.map((peak) => peak.frequency)).toEqual(
        peak_freqs.map((frequency) => expect.closeTo(frequency, 2)),
      )
      expect(Math.max(...result.vdos.power)).toBeCloseTo(vdos_max, 7)
      // the lab dipole is rigid whatever the bonds do, so IR stays exactly zero
      expect(Math.max(...(result.ir?.power ?? []))).toBe(0)
      expect(result.peaks.every((peak) => peak.ir_activity === `inactive`)).toBe(true)
    },
  )

  it(`leaves activity unknown outside a response curve's Nyquist range`, () => {
    const input = make_input(0.25)
    const series = make_signal(32, [3], () => [0, 0, 0])
    series.steps = series.steps.map((step) => step * 4)
    input.infrared_signal = { kind: `dipole`, series }
    const result = compute_trajectory_spectroscopy(input, RAW_SPECTRUM)
    expect(result.ir?.nyquist).toBe(0.125)
    expect(peak_near(result, 0.25)).toMatchObject({ ir_activity: `unknown`, ir_score: null })
  })

  // the two H atoms of make_input move antiphase along x and not at all along y or z
  it(`extracts the antiphase x mode at the detected peak, never labelled IR or Raman`, () => {
    const result = compute_trajectory_spectroscopy(make_input(0.125, 1, 128), RAW_SPECTRUM)
    // velocity-only input: no response curve to judge activity on
    for (const { ir_activity, raman_activity } of result.peaks) {
      expect([ir_activity, raman_activity]).toEqual([`unknown`, `unknown`])
    }
    const displacement = peak_near(result, 0.125).displacement
    if (!displacement) throw new Error(`no displacement at the 0.125 1/step peak`)
    const [atom_a, atom_b] = displacement
    expect(atom_a[0][0]).toBeCloseTo(-atom_b[0][0], 12)
    expect(Math.abs(atom_a[0][0])).toBeGreaterThan(1e-3)
    for (const atom of [atom_a, atom_b]) {
      for (const axis of [1, 2]) expect(Math.hypot(...atom[axis])).toBeLessThan(1e-12)
    }
  })

  it(`keeps response peaks above the position Nyquist without inventing MD motion`, () => {
    const input = make_input(0.1, 1, 80)
    input.positions.steps = input.positions.steps.map((step) => step * 2)
    if (input.velocities) input.velocities.steps = [...input.positions.steps]
    input.infrared_signal = { kind: `dipole`, series: x_sinusoid(0.4, 160) }
    const result = compute_trajectory_spectroscopy(input, RAW_SPECTRUM)
    const peak = peak_near(result, 0.4)
    expect(Math.abs(peak.frequency - 0.4)).toBeLessThan(result.ir?.rayleigh_resolution ?? 0)
    expect(result.vdos.nyquist).toBe(0.25)
    expect(result.ir?.nyquist).toBe(0.5)
    expect(peak.ir_activity).toBe(`active`)
    expect(peak.displacement).toBeUndefined()
    expect(peak.displacement_unavailable_reason).toMatch(
      /exceeds the position Nyquist frequency 0.25 1\/step/,
    )
  })

  // channel weights: isotropic 45 (vv, unpolarized); anisotropic 4 (vv), 3 (vh), 7 (unpolarized)
  it.each([
    [`isotropic`, (value: number) => diag3(value, value, value), `anisotropic`, 45, [0, 0, 0]],
    [`traceless`, (value: number) => diag3(value, -value, 0), `isotropic`, 0, [4, 3, 7]],
  ] as const)(
    `gives a %s tensor the Placzek Raman channel coefficients`,
    (_label, tensor, expect_zero, iso_factor, [aniso_vv, aniso_vh, aniso_unpolarized]) => {
      const input = make_input()
      input.raman_signal = {
        kind: `polarizability`,
        series: make_signal(128, [3, 3], (idx) => tensor(Math.sin(2 * Math.PI * 0.125 * idx))),
      }
      const raman = compute_trajectory_spectroscopy(input, RAW_SPECTRUM).raman
      if (!raman) throw new Error(`no Raman spectrum`)
      expect(Math.max(...raman[expect_zero].power)).toBe(0)
      for (const [idx, isotropic] of raman.isotropic.power.entries()) {
        const anisotropic = raman.anisotropic.power[idx]
        expect(raman.vv.power[idx]).toBe(iso_factor * isotropic + aniso_vv * anisotropic)
        expect(raman.vh.power[idx]).toBe(aniso_vh * anisotropic)
        expect(raman.unpolarized.power[idx]).toBe(
          iso_factor * isotropic + aniso_unpolarized * anisotropic,
        )
      }
    },
  )

  // Pins the ω² asymmetry between the response spectra: IR from a dipole is the power
  // spectrum of μ̇ and carries (2πν)², while the classical Placzek Raman spectrum is the
  // plain polarizability power spectrum FT⟨α(0)α(t)⟩ (the ω² from α̇ cancels against the
  // 1/ω·Bose prefactor) and IR from a current is already a derivative. Two tones at
  // ν₁ = 10 THz and ν₂ = 40 THz with amplitudes 1 and 2: a flat spectrum gives a peak ratio
  // of (A₁/A₂)² = 1/4, the ω² weighting tilts it by (ν₁/ν₂)² = 1/16 to 1/64.
  const two_tone_vector = (tone_1: number, tone_2: number) => [tone_1 + tone_2, 0, 0]
  type TwoToneCase = [
    string,
    `polarizability` | `dipole` | `current`,
    number,
    (tone_1: number, tone_2: number) => number[],
    RamanChannel[],
    [number, number],
  ]
  // oxfmt-ignore
  it.each<TwoToneCase>([
    // both tones share an isotropic tensor, so the anisotropic channel is silent
    [`Raman isotropic tensor`, `polarizability`, 1 / 4, (tone_1, tone_2) => diag3(tone_1 + tone_2, tone_1 + tone_2, tone_1 + tone_2), [`isotropic`, `unpolarized`], [1, 1]],
    // ν₁ on the isotropic mean (ᾱ = A₁, weight 45) and ν₂ on a traceless tensor with
    // γ² = ½[(2A₂)² + A₂² + A₂²] = 3A₂² (unpolarized weight 7): the same 1/4 amplitude
    // ratio appears in `unpolarized` as 45A₁² / (21A₂²) = 45/84
    [`Raman mixed isotropic/traceless tensors`, `polarizability`, 1 / 4, (tone_1, tone_2) => diag3(tone_1 + tone_2, tone_1 - tone_2, tone_1), [`unpolarized`], [45, 21]],
    [`IR dipole`, `dipole`, 1 / 64, two_tone_vector, [], [1, 1]],
    [`IR current`, `current`, 1 / 4, two_tone_vector, [], [1, 1]],
  ])(
    `%s two-tone peak ratio is %s`,
    (label, kind, expected_ratio, components, channels, [weight_1, weight_2]) => {
      // 512 frames at 400/1024 fs (exact in binary): Rayleigh width 5 THz, 4x zero padding
      // gives a 1.25 THz grid, so 10 THz (bin 8) and 40 THz (bin 32) sit exactly on it,
      // 6 Rayleigh widths apart. The symmetric Hann main lobes (±2 Rayleigh) do not overlap;
      // the residual sidelobe leakage shifts the measured ratios by 4.7e-4 relative.
      const [n_frames, time_step_fs] = [512, 400 / 1024]
      const [frequency_1_thz, frequency_2_thz, amplitude_1, amplitude_2] = [10, 40, 1, 2]
      const input = make_input(0.125, 1, n_frames)
      const is_raman = kind === `polarizability`
      const series = make_signal(n_frames, is_raman ? [3, 3] : [3], (sample_idx) => {
        const time_fs = sample_idx * time_step_fs
        return components(
          amplitude_1 * Math.cos(2 * Math.PI * frequency_1_thz * 1e-3 * time_fs),
          amplitude_2 * Math.cos(2 * Math.PI * frequency_2_thz * 1e-3 * time_fs),
        )
      })
      if (kind === `polarizability`) input.raman_signal = { kind, series }
      else input.infrared_signal = { kind, series }
      const result = compute_trajectory_spectroscopy(input, {
        time_step: time_step_fs,
        time_unit: `fs`,
        preprocessing: `raw`,
        frequency_unit: `THz`,
        window: `hann`,
        zero_pad_factor: 4,
      })
      const curves = is_raman
        ? channels.map((channel) => result.raman?.[channel])
        : [result.ir]
      for (const curve of curves) {
        // `result.ir` is null (not undefined) when absent, so a missing curve must fail loudly
        // rather than slip past toBeDefined and skip every assertion below
        if (!curve) throw new Error(`${label} produced no spectrum curve`)
        const [bin_1, bin_2] = [frequency_1_thz, frequency_2_thz].map((frequency) =>
          curve.frequencies.findIndex((value) => Math.abs(value - frequency) < 1e-9),
        )
        expect([bin_1, bin_2]).toEqual([8, 32])
        // both tones are resolved: each stands far above the valley between them (the
        // ω²-tilted IR lobe at 10 THz crests one bin above the tone, so the heights are
        // read at the tone bins, where the weights are exactly (2πν₁)² and (2πν₂)²)
        const valley = curve.power[(bin_1 + bin_2) / 2]
        expect(Math.min(curve.power[bin_1], curve.power[bin_2])).toBeGreaterThan(1e3 * valley)
        const ratio = curve.power[bin_1] / weight_1 / (curve.power[bin_2] / weight_2)
        // 1% relative tolerance: 20x the measured 4.7e-4 leakage error, while a wrongly
        // applied or missing ω² changes the ratio 16-fold
        expect(Math.abs(ratio / expected_ratio - 1)).toBeLessThan(0.01)
      }
    },
  )

  it(`requires geometry-step correspondence only for body-fixed Raman`, () => {
    const input = make_input()
    const response = make_signal(64, [3, 3], (idx) =>
      diag3(1, 1, 1).map((entry) => entry * Math.sin(2 * Math.PI * 0.125 * idx)),
    )
    response.steps = response.steps.map((step) => step * 2 + 0.5)
    input.raman_signal = { kind: `polarizability`, series: response }
    for (const preprocessing of [`raw`, `remove_com`] as const) {
      expect(
        compute_trajectory_spectroscopy(input, { ...RAW, preprocessing }).raman,
      ).not.toBeNull()
    }
    expect(() =>
      compute_trajectory_spectroscopy(input, { ...RAW, preprocessing: `body_fixed` }),
    ).toThrow(/body-frame processing has no position at that step/)
  })

  it(`preserves the initial periodic center while removing center-of-mass drift`, () => {
    const input = make_input()
    input.positions.positions = input.positions.positions.map((value) => value + 5)
    make_periodic(input, [true, true, true])
    const result = compute_trajectory_spectroscopy(input, {
      ...RAW_SPECTRUM,
      preprocessing: `remove_com`,
    })
    expect(result.reference_positions).toEqual([
      [4.5, 5, 5],
      [5.5, 5, 5],
    ])
  })

  // each IR signal on its scientifically valid path: dipole and current non-periodic,
  // branch-continuous polarization periodic
  it.each([`dipole`, `current`, `polarization`] as const)(
    `separates an IR-active %s response peak from an IR-inactive VDOS mode`,
    (kind) => {
      const input = make_input()
      const series = x_sinusoid(0.25)
      const periodic = kind === `polarization`
      if (periodic) {
        make_periodic(input, [true, false, false])
        input.infrared_signal = { kind, branch_continuous: true, series }
      } else input.infrared_signal = { kind, series }
      const result = compute_trajectory_spectroscopy(input, {
        ...RAW_SPECTRUM,
        preprocessing: periodic ? `remove_com` : `raw`,
      })
      expect(peak_near(result, 0.125).ir_activity).toBe(`inactive`)
      expect(peak_near(result, 0.25).ir_activity).toBe(`active`)
    },
  )

  it(`uses exact mass fractions in the raw mass-weighted VDOS`, () => {
    const equal_mass = make_input()
    const unequal_mass = make_input()
    unequal_mass.masses = Float64Array.from([2, 1])
    for (let frame_idx = 0; frame_idx < 128; frame_idx++) {
      equal_mass.velocities?.values.fill(0, frame_idx * 6 + 3, frame_idx * 6 + 6)
      unequal_mass.velocities?.values.fill(0, frame_idx * 6 + 3, frame_idx * 6 + 6)
    }
    const equal = compute_trajectory_spectroscopy(equal_mass, RAW_SPECTRUM)
    const unequal = compute_trajectory_spectroscopy(unequal_mass, RAW_SPECTRUM)
    const peak_idx = equal.vdos.power.indexOf(Math.max(...equal.vdos.power))
    expect(unequal.vdos.power[peak_idx]).toBeCloseTo((equal.vdos.power[peak_idx] * 4) / 3, 13)
  })

  // oxfmt-ignore
  const bent: TumblingCase = {
    elements: [`H`, `O`, `H`],
    masses: [1, 16, 1],
    base_positions: [[-1, 0, 0], [0.3, 0.8, 0], [0.4, -0.5, 0.2]],
    body_tensor: (oscillation) => diag3(1 + oscillation, 2, 3),
    amplitude: 0.2,
  }
  // oxfmt-ignore
  it.each<TumblingCase & { label: string }>([
    { label: `a non-linear molecule`, ...bent },
    {
      label: `a linear molecule`,
      elements: [`O`, `C`, `O`],
      masses: [16, 12, 16],
      base_positions: [[-1, 0, 0], [0, 0, 0], [1, 0, 0]],
      body_tensor: (oscillation) => diag3(2 + oscillation, 1, 1),
      amplitude: 0.1,
    },
    // Tumbling about a tilted axis while breathing: every inertia component and every entry
    // of the body-frame rotation enters the stored velocities' rigid-motion removal, which
    // must leave exactly the breathing mode the stationary molecule has
    { label: `a breathing molecule tumbling about a tilted axis`, ...bent, axis: [2 / 7, 3 / 7, 6 / 7], breathing: 0.05 },
  ])(`removes tumbling from $label in the body-fixed frame`, (spec) => {
    const { rotating, stationary } = tumbling_spectra(spec)
    const max_error = (actual: number[], expected: number[]) =>
      Math.max(...expected.map((value, idx) => Math.abs(actual[idx] - value)))
    const expected = stationary.raman?.unpolarized.power ?? []
    expect(max_error(rotating.raman?.unpolarized.power ?? [], expected)).toBeLessThan(
      1e-10 * Math.max(...expected),
    )
    const vdos_max = Math.max(...stationary.vdos.power)
    if (spec.breathing) {
      expect(vdos_max).toBeGreaterThan(1e-4)
      expect(max_error(rotating.vdos.power, stationary.vdos.power)).toBeLessThan(
        1e-10 * vdos_max,
      )
    } else expect(Math.max(...rotating.vdos.power)).toBeLessThan(1e-20)
  })
})

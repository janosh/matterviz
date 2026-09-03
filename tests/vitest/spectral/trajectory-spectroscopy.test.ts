import type {
  TrajectorySpectroscopyInput,
  TrajectorySpectroscopyOptions,
} from '$lib/spectral/trajectory-spectroscopy'
import {
  calc_trajectory_spectroscopy,
  validate_trajectory_signal,
} from '$lib/spectral/trajectory-spectroscopy'
import { THZ_TO_INVERSE_CM } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import { one_sided_periodogram } from '$lib/fft'
import type { Pbc } from '$lib/structure/pbc'
import type { TrajectoryPositionStream, TrajectorySignal } from '$lib/trajectory'
import { describe, expect, it } from 'vitest'

const signal = (
  n_samples: number,
  sample_shape: number[],
  sample: (sample_idx: number) => number[],
): TrajectorySignal => ({
  values: Float64Array.from(
    Array.from({ length: n_samples }, (_unused, sample_idx) => sample(sample_idx)).flat(),
  ),
  sample_shape,
  steps: Array.from({ length: n_samples }, (_unused, sample_idx) => sample_idx),
})

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

// A vec3 series oscillating along x at `cycles_per_sample`, the standard IR/Raman probe here
const x_sinusoid = (cycles_per_sample: number): TrajectorySignal =>
  signal(128, [3], (sample_idx) => [
    Math.sin(2 * Math.PI * cycles_per_sample * sample_idx),
    0,
    0,
  ])

// 10 A cubic cell on every frame, so periodic paths have a lattice to unwrap against
const make_periodic = (input: TrajectorySpectroscopyInput, pbc: Pbc): void => {
  input.positions.pbc = pbc
  input.positions.lattice_matrices = Array.from({ length: 128 }, () => [
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 10],
  ])
}

const peak_near = (
  result: ReturnType<typeof calc_trajectory_spectroscopy>,
  frequency: number,
) =>
  result.peaks.reduce((best, peak) =>
    Math.abs(peak.frequency - frequency) < Math.abs(best.frequency - frequency) ? peak : best,
  )

const RAW = { preprocessing: `raw` as const, frequency_unit: `1/step` as const }
const RAW_SPECTRUM = { ...RAW, window: `none` as const, zero_pad_factor: 1 as const }

const tumbling_spectra = (
  elements: ElementSymbol[],
  masses: number[],
  base_positions: number[][],
  body_tensor: (oscillation: number) => number[],
  oscillation_amp: number,
) => {
  const n_frames = 128
  const n_atoms = base_positions.length
  const rotating_positions = new Float64Array(n_frames * n_atoms * 3)
  const stationary_positions = new Float64Array(n_frames * n_atoms * 3)
  const rotating_velocities = new Float64Array(n_frames * n_atoms * 3)
  const stationary_velocities = new Float64Array(n_frames * n_atoms * 3)
  const rotating_tensors = new Float64Array(n_frames * 9)
  const stationary_tensors = new Float64Array(n_frames * 9)
  const steps = Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx)
  const angular_speed = 2 * Math.PI * 0.03
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    const angle = angular_speed * frame_idx
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const oscillation = oscillation_amp * Math.sin(2 * Math.PI * 0.125 * frame_idx)
    const tensor = body_tensor(oscillation)
    stationary_tensors.set(tensor, frame_idx * 9)
    for (const [atom_idx, [x_coord, y_coord, z_coord]] of base_positions.entries()) {
      const x_rotated = cosine * x_coord - sine * y_coord
      const y_rotated = sine * x_coord + cosine * y_coord
      const atom_base = frame_idx * n_atoms * 3 + atom_idx * 3
      stationary_positions.set([x_coord, y_coord, z_coord], atom_base)
      rotating_positions.set([x_rotated, y_rotated, z_coord], atom_base)
      rotating_velocities.set(
        [-angular_speed * y_rotated, angular_speed * x_rotated, 0],
        atom_base,
      )
    }
    const xx = cosine * cosine * tensor[0] + sine * sine * tensor[4]
    const yy = sine * sine * tensor[0] + cosine * cosine * tensor[4]
    const xy = cosine * sine * (tensor[0] - tensor[4])
    rotating_tensors.set([xx, xy, 0, xy, yy, 0, 0, 0, tensor[8]], frame_idx * 9)
  }
  const as_input = (
    positions: Float64Array,
    velocities: Float64Array,
    tensors: Float64Array,
  ): TrajectorySpectroscopyInput => ({
    positions: position_stream(positions, elements, steps),
    masses: Float64Array.from(masses),
    velocities: {
      values: velocities,
      sample_shape: [n_atoms, 3],
      steps,
    },
    raman_signal: {
      kind: `polarizability`,
      series: {
        values: tensors,
        sample_shape: [3, 3],
        steps,
      },
    },
  })
  const options = {
    preprocessing: `body_fixed`,
    frequency_unit: `1/step`,
    window: `none`,
    zero_pad_factor: 1,
  } as const
  return {
    rotating: calc_trajectory_spectroscopy(
      as_input(rotating_positions, rotating_velocities, rotating_tensors),
      options,
    ),
    stationary: calc_trajectory_spectroscopy(
      as_input(stationary_positions, stationary_velocities, stationary_tensors),
      options,
    ),
  }
}

describe(`calc_trajectory_spectroscopy`, () => {
  it(`requires four position frames for central-difference spectra`, () => {
    const input = make_input(0.125, 1, 3)
    input.velocities = null
    expect(() => calc_trajectory_spectroscopy(input, RAW_SPECTRUM)).toThrow(
      /central_difference velocities need at least 4 position frames, got 3/,
    )
  })

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
      const input = make_input()
      if (!has_velocities) input.velocities = null
      const result = calc_trajectory_spectroscopy(input, { ...RAW_SPECTRUM, velocity_source })
      expect(result.velocity_source).toBe(expected)
      // the reported source must be the one actually used: the spectrum has to match the
      // reference computed from that source alone
      const reference_input = make_input()
      if (expected === `central_difference`) reference_input.velocities = null
      const reference = calc_trajectory_spectroscopy(reference_input, RAW_SPECTRUM)
      expect(reference.velocity_source).toBe(expected)
      expect(result.vdos.power).toEqual(reference.vdos.power)
      // and differ from the other source's spectrum (the fixture's stored velocities are
      // not the derivative of its positions)
      const other_input = make_input()
      if (expected === `stored`) other_input.velocities = null
      const other = calc_trajectory_spectroscopy(other_input, RAW_SPECTRUM)
      expect(other.velocity_source).not.toBe(expected)
      expect(result.vdos.power).not.toEqual(other.vdos.power)
    },
  )

  it(`velocity_source 'stored' throws without a velocity signal`, () => {
    const input = make_input()
    input.velocities = null
    expect(() =>
      calc_trajectory_spectroscopy(input, { ...RAW_SPECTRUM, velocity_source: `stored` }),
    ).toThrow(/velocity_source 'stored' was requested but no velocity signal was supplied/)
  })

  it(`rejects an unknown velocity_source`, () => {
    expect(() =>
      calc_trajectory_spectroscopy(make_input(), {
        ...RAW_SPECTRUM,
        velocity_source: `finite_difference` as unknown as `auto`,
      }),
    ).toThrow(/velocity_source/)
  })

  // Ground truth for the VDOS pipeline: a pure velocity sinusoid at a known physical
  // frequency must peak there, and the curve must be exactly the mass-weighted
  // one_sided_periodogram of those velocities with the fs → THz Jacobian applied.
  it(`VDOS of a 10 THz velocity sinusoid peaks at 10 THz and equals the fft periodogram`, () => {
    const [n_frames, time_step_fs, frequency_thz] = [256, 2, 10]
    const cycles_per_frame = frequency_thz * time_step_fs * 1e-3 // THz · fs
    const input = make_input(cycles_per_frame, 1, n_frames)
    input.time_step = time_step_fs
    input.time_unit = `fs`
    const options = { window: `hann`, zero_pad_factor: 4 } as const
    const { vdos } = calc_trajectory_spectroscopy(input, {
      ...options,
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

  it(`never labels a velocity-only vibrational mode as IR or Raman`, () => {
    const result = calc_trajectory_spectroscopy(make_input(), RAW_SPECTRUM)
    expect(result.peaks).not.toHaveLength(0)
    expect(result.peaks.every(({ ir_activity }) => ir_activity === `unknown`)).toBe(true)
    expect(result.peaks.every(({ raman_activity }) => raman_activity === `unknown`)).toBe(true)
  })

  it(`rejects malformed signal units and nonuniform sampling`, () => {
    const bad_unit = make_input()
    bad_unit.infrared_signal = {
      kind: `dipole`,
      series: { ...signal(128, [3], () => [0, 0, 0]), unit: ` ` },
    }
    expect(() => calc_trajectory_spectroscopy(bad_unit, RAW)).toThrow(
      /unit must be a non-empty string/,
    )

    const nonuniform = make_input()
    nonuniform.velocities?.steps.splice(5, 1, 7)
    expect(() => calc_trajectory_spectroscopy(nonuniform, RAW)).toThrow(
      /steps must increase strictly|not uniformly sampled/,
    )
  })

  it.each([
    [`zero dimension`, [0], [0, 1], new Float64Array(), /invalid sample shape \[0\]/],
    [`fractional dimension`, [1.5], [0, 1], new Float64Array(3), /invalid sample shape/],
    [`rank three`, [1, 1, 1], [0, 1], new Float64Array(2), /rank must be at most 2/],
    [
      `non-finite first step`,
      [3],
      [Number.NEGATIVE_INFINITY, 0],
      new Float64Array(6),
      /step 0 is -Infinity, not finite/,
    ],
  ])(
    `rejects malformed public signals: %s`,
    (_label, sample_shape, steps, values, expected) => {
      expect(() => validate_trajectory_signal({ sample_shape, steps, values })).toThrow(
        expected,
      )
    },
  )

  it.each([
    [
      `short position buffer`,
      (input: TrajectorySpectroscopyInput) =>
        (input.positions.positions = input.positions.positions.slice(1)),
      /positions has .* entries but 128 frames/,
    ],
    [
      `non-finite position`,
      (input: TrajectorySpectroscopyInput) => (input.positions.positions[1] = Number.NaN),
      /position value 1 is NaN/,
    ],
    [
      `element count`,
      (input: TrajectorySpectroscopyInput) => input.positions.elements.pop(),
      /got 1 element labels for 2 atoms/,
    ],
    [
      `descending steps`,
      (input: TrajectorySpectroscopyInput) => (input.positions.steps[5] = 3),
      /position steps must increase strictly/,
    ],
    [
      `infinite mass`,
      (input: TrajectorySpectroscopyInput) => (input.masses[0] = Number.POSITIVE_INFINITY),
      /masses must contain one positive value per atom/,
    ],
    [
      `lattice count`,
      (input: TrajectorySpectroscopyInput) =>
        (input.positions.lattice_matrices = [
          [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
        ]),
      /lattice matrices/,
    ],
    [
      `fractional atom count`,
      (input: TrajectorySpectroscopyInput) => (input.positions.n_atoms = 1.5),
      /element labels for 1\.5 atoms/,
    ],
    [
      `fractional frame count`,
      (input: TrajectorySpectroscopyInput) => (input.positions.n_frames = 127.5),
      /entries but 127\.5 frames/,
    ],
    [
      `malformed PBC`,
      (input: TrajectorySpectroscopyInput) =>
        Reflect.set(input.positions, `pbc`, [true, false]),
      /pbc must contain exactly 3 boolean values/,
    ],
    [
      `wrapped periodic positions without a lattice`,
      (input: TrajectorySpectroscopyInput) => {
        input.positions.pbc = [true, false, false]
        input.positions.coords_unwrapped = false
      },
      /wrapped periodic positions require a lattice matrix for the first frame/,
    ],
  ])(`rejects malformed position input: %s`, (_label, mutate, expected) => {
    const input = make_input()
    mutate(input)
    expect(() => calc_trajectory_spectroscopy(input, RAW)).toThrow(expected)
  })

  it.each([
    [
      `IR signal kind`,
      (input: TrajectorySpectroscopyInput) => {
        input.infrared_signal = { kind: `dipole`, series: signal(128, [3], () => [0, 0, 0]) }
        Reflect.set(input.infrared_signal, `kind`, `charges`)
      },
      {},
      /IR signal kind 'charges' is not supported/,
    ],
    [
      `Raman signal kind`,
      (input: TrajectorySpectroscopyInput) => {
        input.raman_signal = {
          kind: `polarizability`,
          series: signal(128, [3, 3], () => Array.from({ length: 9 }, () => 0)),
        }
        Reflect.set(input.raman_signal, `kind`, `susceptibility`)
      },
      {},
      /Raman signal kind 'susceptibility' is not supported/,
    ],
    [
      `Raman channel`,
      () => {},
      { raman_channel: `polarized` },
      /Raman channel 'polarized' is not supported/,
    ],
    [
      `body-fixed current IR`,
      (input: TrajectorySpectroscopyInput) => {
        input.infrared_signal = {
          kind: `current`,
          series: x_sinusoid(0.125),
        }
      },
      { preprocessing: `body_fixed` },
      /body_fixed current IR requires the time derivative of the rotating frame/,
    ],
    [
      `unmarked polarization IR`,
      (input: TrajectorySpectroscopyInput) => {
        input.infrared_signal = {
          kind: `polarization`,
          branch_continuous: true,
          series: signal(128, [3], () => [0, 0, 0]),
        }
        Reflect.deleteProperty(input.infrared_signal, `branch_continuous`)
      },
      {},
      /polarization must be explicitly marked branch_continuous/,
    ],
    [`unknown window`, () => {}, { window: `blackman` }, /window 'blackman' is not supported/],
  ])(
    `rejects unsupported public discriminants: %s`,
    (_label, mutate, raw_options, expected) => {
      const input = make_input()
      mutate(input)
      const options: TrajectorySpectroscopyOptions = { ...RAW }
      for (const [key, value] of Object.entries(raw_options)) Reflect.set(options, key, value)
      expect(() => calc_trajectory_spectroscopy(input, options)).toThrow(expected)
    },
  )

  it(`returns the same physical raw IR spectrum for equivalent time units`, () => {
    const make_timed_input = (time_step: number, time_unit: string) => {
      const input = make_input()
      input.time_step = time_step
      input.time_unit = time_unit
      input.infrared_signal = {
        kind: `dipole`,
        series: x_sinusoid(0.125),
      }
      return input
    }
    const options = {
      preprocessing: `raw`,
      frequency_unit: `THz`,
      window: `none`,
      zero_pad_factor: 1,
    } as const
    const femtoseconds = calc_trajectory_spectroscopy(make_timed_input(1, `fs`), options)
    const picoseconds = calc_trajectory_spectroscopy(make_timed_input(0.001, `ps`), options)
    expect(femtoseconds.ir?.frequencies).toEqual(picoseconds.ir?.frequencies)
    const femtosecond_power = femtoseconds.ir?.power ?? []
    const picosecond_power = picoseconds.ir?.power ?? []
    const maximum_power = Math.max(...femtosecond_power)
    const max_time_unit_error = Math.max(
      ...femtosecond_power.map((value, frequency_idx) =>
        Math.abs(value - picosecond_power[frequency_idx]),
      ),
    )
    expect(max_time_unit_error).toBeLessThan(10 * Number.EPSILON * maximum_power)

    const wavenumbers = calc_trajectory_spectroscopy(make_timed_input(1, `fs`), {
      ...options,
      frequency_unit: `cm^-1`,
    })
    const converted_power = wavenumbers.ir?.power.map((value) => value * THZ_TO_INVERSE_CM)
    const max_frequency_unit_error = Math.max(
      ...(converted_power ?? []).map((value, frequency_idx) =>
        Math.abs(value - femtosecond_power[frequency_idx]),
      ),
    )
    expect(max_frequency_unit_error).toBeLessThan(10 * Number.EPSILON * maximum_power)
  })

  it.each([
    [{ time_step: 0, time_unit: `fs` }, /time_step must be finite and > 0/],
    [{ time_step: 1 }, /time_step and time_unit must be supplied together/],
    [{ time_unit: `fs` }, /time_step and time_unit must be supplied together/],
    [{ time_step: 1, time_unit: ` ` }, /time_unit must be a non-empty string/],
  ])(`validates supplied physical time metadata in 1/step mode`, (metadata, error) => {
    const input = Object.assign(make_input(), metadata)
    expect(() => calc_trajectory_spectroscopy(input, RAW)).toThrow(error)
  })

  it(`uses independent signal step spacing for 1/step frequencies`, () => {
    const input = make_input()
    const response_steps = Array.from({ length: 64 }, (_unused, sample_idx) => sample_idx * 2)
    input.infrared_signal = {
      kind: `dipole`,
      series: {
        values: Float64Array.from(
          response_steps.flatMap((step) => [Math.sin(2 * Math.PI * 0.125 * step), 0, 0]),
        ),
        sample_shape: [3],
        steps: response_steps,
      },
    }
    const result = calc_trajectory_spectroscopy(input, RAW_SPECTRUM)
    const ir = result.ir
    expect(ir).not.toBeNull()
    if (!ir) return
    const maximum_idx = ir.power.indexOf(Math.max(...ir.power))
    expect(ir.frequencies[maximum_idx]).toBeCloseTo(0.125, 14)
    expect(ir.sample_interval).toBe(2)
    expect(ir.nyquist).toBe(0.25)
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
    const { vdos } = calc_trajectory_spectroscopy(input, RAW_SPECTRUM)
    // the spacing is read off the first two steps: 0.1 up to the ulp of 1e12 (1.2e-4)
    expect(vdos.sample_interval).toBeCloseTo(0.1, 3)
    // 0.125 cycles per frame on a 0.1-step grid is 1.25 cycles per step unit, bin 16 of 128
    const maximum_idx = vdos.power.indexOf(Math.max(...vdos.power))
    expect(maximum_idx).toBe(16)
    expect(vdos.frequencies[maximum_idx]).toBeCloseTo(1.25, 2)
  })

  it(`rejects a one-percent cadence mismatch at a large step origin`, () => {
    const input = make_input()
    input.positions.steps = input.positions.steps.map((step) => 1e12 + step)
    input.positions.steps[64] += 0.01
    expect(() => calc_trajectory_spectroscopy(input, RAW_SPECTRUM)).toThrow(
      /positions is not uniformly sampled/,
    )
  })

  it(`separates an IR-active response peak from an IR-inactive VDOS mode`, () => {
    const input = make_input(0.125)
    input.infrared_signal = {
      kind: `dipole`,
      series: x_sinusoid(0.25),
    }
    const result = calc_trajectory_spectroscopy(input, RAW_SPECTRUM)
    expect(peak_near(result, 0.125).ir_activity).toBe(`inactive`)
    expect(peak_near(result, 0.25).ir_activity).toBe(`active`)
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
    const body = [
      [0, 0, 0],
      [bond_x, bond_y, 0],
      [-bond_x, bond_y, 0],
    ]
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
        series: signal(n_frames, [3], (frame_idx) => [
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
      const result = calc_trajectory_spectroscopy(rigid_water(stretch_amp), {
        preprocessing: `body_fixed`,
        frequency_unit: `1/step`,
      })
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
    input.infrared_signal = {
      kind: `dipole`,
      series: {
        values: new Float64Array(32 * 3),
        sample_shape: [3],
        steps: Array.from({ length: 32 }, (_unused, sample_idx) => sample_idx * 4),
      },
    }
    const result = calc_trajectory_spectroscopy(input, RAW_SPECTRUM)
    expect(result.ir?.nyquist).toBe(0.125)
    expect(peak_near(result, 0.25).ir_activity).toBe(`unknown`)
    expect(peak_near(result, 0.25).ir_score).toBeNull()
  })

  // the two H atoms of make_input move antiphase along x and not at all along y or z
  it(`extracts the antiphase x mode at the detected peak`, () => {
    const result = calc_trajectory_spectroscopy(make_input(0.125, 1, 128), RAW_SPECTRUM)
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
    input.infrared_signal = {
      kind: `dipole`,
      series: signal(160, [3], (sample_idx) => [
        Math.sin(2 * Math.PI * 0.4 * sample_idx),
        0,
        0,
      ]),
    }
    const result = calc_trajectory_spectroscopy(input, RAW_SPECTRUM)
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

  it.each([
    {
      label: `isotropic`,
      tensor: (value: number) => [value, 0, 0, 0, value, 0, 0, 0, value],
      expect_zero: `anisotropic` as const,
      isotropic_factor: 45,
      anisotropic_vv: 0,
      anisotropic_vh: 0,
      anisotropic_unpolarized: 0,
    },
    {
      label: `traceless`,
      tensor: (value: number) => [value, 0, 0, 0, -value, 0, 0, 0, 0],
      expect_zero: `isotropic` as const,
      isotropic_factor: 0,
      anisotropic_vv: 4,
      anisotropic_vh: 3,
      anisotropic_unpolarized: 7,
    },
  ])(
    `gives a $label tensor the Placzek Raman channel coefficients`,
    ({
      tensor,
      expect_zero,
      isotropic_factor,
      anisotropic_vv,
      anisotropic_vh,
      anisotropic_unpolarized,
    }) => {
      const input = make_input()
      input.raman_signal = {
        kind: `polarizability`,
        series: signal(128, [3, 3], (sample_idx) =>
          tensor(Math.sin(2 * Math.PI * 0.125 * sample_idx)),
        ),
      }
      const raman = calc_trajectory_spectroscopy(input, RAW_SPECTRUM).raman
      expect(raman).not.toBeNull()
      if (!raman) return
      expect(Math.max(...raman[expect_zero].power)).toBe(0)
      for (const frequency_idx of raman.isotropic.power.keys()) {
        const isotropic = raman.isotropic.power[frequency_idx]
        const anisotropic = raman.anisotropic.power[frequency_idx]
        expect(raman.vv.power[frequency_idx]).toBe(
          isotropic_factor * isotropic + anisotropic_vv * anisotropic,
        )
        expect(raman.vh.power[frequency_idx]).toBe(anisotropic_vh * anisotropic)
        expect(raman.unpolarized.power[frequency_idx]).toBe(
          isotropic_factor * isotropic + anisotropic_unpolarized * anisotropic,
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
  it.each([
    {
      label: `Raman isotropic tensor`,
      kind: `polarizability` as const,
      expected_ratio: 1 / 4,
      // both tones share an isotropic tensor, so the anisotropic channel is silent
      components: (tone_1: number, tone_2: number) => {
        const value = tone_1 + tone_2
        return [value, 0, 0, 0, value, 0, 0, 0, value]
      },
      channels: [`isotropic`, `unpolarized`] as const,
    },
    {
      label: `Raman mixed isotropic/traceless tensors`,
      kind: `polarizability` as const,
      expected_ratio: 1 / 4,
      // ν₁ on the isotropic mean (ᾱ = A₁, weight 45) and ν₂ on a traceless tensor with
      // γ² = ½[(2A₂)² + A₂² + A₂²] = 3A₂² (unpolarized weight 7): the same 1/4 amplitude
      // ratio appears in `unpolarized` as 45A₁² / (21A₂²) = 45/84
      components: (tone_1: number, tone_2: number) => [
        tone_1 + tone_2,
        0,
        0,
        0,
        tone_1 - tone_2,
        0,
        0,
        0,
        tone_1,
      ],
      channels: [`unpolarized`] as const,
      unpolarized_weights: [45, 21],
    },
    {
      label: `IR dipole`,
      kind: `dipole` as const,
      expected_ratio: 1 / 64,
      components: two_tone_vector,
    },
    {
      label: `IR current`,
      kind: `current` as const,
      expected_ratio: 1 / 4,
      components: two_tone_vector,
    },
  ])(
    `$label two-tone peak ratio is $expected_ratio`,
    ({ label, expected_ratio, kind, components, channels = [], unpolarized_weights }) => {
      // 512 frames at 400/1024 fs (exact in binary): Rayleigh width 5 THz, 4x zero padding
      // gives a 1.25 THz grid, so 10 THz (bin 8) and 40 THz (bin 32) sit exactly on it,
      // 6 Rayleigh widths apart. The symmetric Hann main lobes (±2 Rayleigh) do not overlap;
      // the residual sidelobe leakage shifts the measured ratios by 4.7e-4 relative.
      const [n_frames, time_step_fs] = [512, 400 / 1024]
      const [frequency_1_thz, frequency_2_thz, amplitude_1, amplitude_2] = [10, 40, 1, 2]
      const input = make_input(0.125, 1, n_frames)
      input.time_step = time_step_fs
      input.time_unit = `fs`
      const is_raman = kind === `polarizability`
      const series = signal(n_frames, is_raman ? [3, 3] : [3], (sample_idx) => {
        const time_fs = sample_idx * time_step_fs
        return components(
          amplitude_1 * Math.cos(2 * Math.PI * frequency_1_thz * 1e-3 * time_fs),
          amplitude_2 * Math.cos(2 * Math.PI * frequency_2_thz * 1e-3 * time_fs),
        )
      })
      if (kind === `polarizability`) input.raman_signal = { kind, series }
      else input.infrared_signal = { kind, series }
      const result = calc_trajectory_spectroscopy(input, {
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
        const bin_1 = curve.frequencies.findIndex((value) => Math.abs(value - 10) < 1e-9)
        const bin_2 = curve.frequencies.findIndex((value) => Math.abs(value - 40) < 1e-9)
        expect(bin_1).toBe(8)
        expect(bin_2).toBe(32)
        // both tones are resolved: each stands far above the valley between them (the
        // ω²-tilted IR lobe at 10 THz crests one bin above the tone, so the heights are
        // read at the tone bins, where the weights are exactly (2πν₁)² and (2πν₂)²)
        const valley = curve.power[(bin_1 + bin_2) / 2]
        expect(curve.power[bin_1]).toBeGreaterThan(1e3 * valley)
        expect(curve.power[bin_2]).toBeGreaterThan(1e3 * valley)
        const [weight_1, weight_2] = unpolarized_weights ?? [1, 1]
        const ratio = curve.power[bin_1] / weight_1 / (curve.power[bin_2] / weight_2)
        // 1% relative tolerance: 20x the measured 4.7e-4 leakage error, while a wrongly
        // applied or missing ω² changes the ratio 16-fold
        expect(Math.abs(ratio / expected_ratio - 1)).toBeLessThan(0.01)
      }
    },
  )

  it(`requires geometry-step correspondence only for body-fixed Raman`, () => {
    const input = make_input()
    const response = signal(64, [3, 3], (sample_idx) => {
      const value = Math.sin(2 * Math.PI * 0.125 * sample_idx)
      return [value, 0, 0, 0, value, 0, 0, 0, value]
    })
    response.steps = response.steps.map((step) => step * 2 + 0.5)
    input.raman_signal = { kind: `polarizability`, series: response }
    expect(calc_trajectory_spectroscopy(input, RAW).raman).not.toBeNull()
    expect(
      calc_trajectory_spectroscopy(input, { ...RAW, preprocessing: `remove_com` }).raman,
    ).not.toBeNull()
    expect(() =>
      calc_trajectory_spectroscopy(input, { ...RAW, preprocessing: `body_fixed` }),
    ).toThrow(/body-frame processing has no position at that step/)
  })

  it(`rejects periodic total dipoles`, () => {
    const input = make_input()
    make_periodic(input, [true, false, false])
    input.infrared_signal = { kind: `dipole`, series: signal(128, [3], () => [1, 0, 0]) }
    expect(() => calc_trajectory_spectroscopy(input, { preprocessing: `remove_com` })).toThrow(
      /total dipole is not a valid periodic IR signal/,
    )
  })

  it(`preserves the initial periodic center while removing center-of-mass drift`, () => {
    const input = make_input()
    for (let value_idx = 0; value_idx < input.positions.positions.length; value_idx++) {
      input.positions.positions[value_idx] += 5
    }
    make_periodic(input, [true, true, true])
    const result = calc_trajectory_spectroscopy(input, {
      ...RAW_SPECTRUM,
      preprocessing: `remove_com`,
    })
    expect(result.reference_positions).toEqual([
      [4.5, 5, 5],
      [5.5, 5, 5],
    ])
  })

  it.each([
    [`current`, false],
    [`continuous periodic polarization`, true],
  ] as const)(`computes IR from %s on its scientifically valid path`, (_label, periodic) => {
    const input = make_input()
    const series = x_sinusoid(0.25)
    if (periodic) {
      make_periodic(input, [true, false, false])
      input.infrared_signal = { kind: `polarization`, branch_continuous: true, series }
    } else input.infrared_signal = { kind: `current`, series }
    const result = calc_trajectory_spectroscopy(input, {
      ...RAW_SPECTRUM,
      preprocessing: periodic ? `remove_com` : `raw`,
    })
    expect(result.ir).not.toBeNull()
    expect(peak_near(result, 0.25).ir_activity).toBe(`active`)
  })

  it(`uses exact mass fractions in the raw mass-weighted VDOS`, () => {
    const equal_mass = make_input()
    const unequal_mass = make_input()
    unequal_mass.masses = Float64Array.from([2, 1])
    for (let frame_idx = 0; frame_idx < 128; frame_idx++) {
      equal_mass.velocities?.values.fill(0, frame_idx * 6 + 3, frame_idx * 6 + 6)
      unequal_mass.velocities?.values.fill(0, frame_idx * 6 + 3, frame_idx * 6 + 6)
    }
    const equal = calc_trajectory_spectroscopy(equal_mass, RAW_SPECTRUM)
    const unequal = calc_trajectory_spectroscopy(unequal_mass, RAW_SPECTRUM)
    const peak_idx = equal.vdos.power.indexOf(Math.max(...equal.vdos.power))
    expect(unequal.vdos.power[peak_idx]).toBeCloseTo((equal.vdos.power[peak_idx] * 4) / 3, 13)
  })

  it.each([
    {
      label: `a non-linear molecule`,
      elements: [`H`, `O`, `H`] satisfies ElementSymbol[],
      masses: [1, 16, 1],
      base_positions: [
        [-1, 0, 0],
        [0.3, 0.8, 0],
        [0.4, -0.5, 0.2],
      ],
      tensor: (oscillation: number) => [1 + oscillation, 0, 0, 0, 2, 0, 0, 0, 3],
      amplitude: 0.2,
    },
    {
      label: `a linear molecule`,
      elements: [`O`, `C`, `O`] satisfies ElementSymbol[],
      masses: [16, 12, 16],
      base_positions: [
        [-1, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
      ],
      tensor: (oscillation: number) => [2 + oscillation, 0, 0, 0, 1, 0, 0, 0, 1],
      amplitude: 0.1,
    },
  ])(
    `removes tumbling from $label in the body-fixed frame`,
    ({ elements, masses, base_positions, tensor, amplitude }) => {
      const { rotating, stationary } = tumbling_spectra(
        elements,
        masses,
        base_positions,
        tensor,
        amplitude,
      )
      const expected = stationary.raman?.unpolarized.power ?? []
      const actual = rotating.raman?.unpolarized.power ?? []
      const scale = Math.max(...expected)
      const max_absolute_error = Math.max(
        ...expected.map((value, frequency_idx) => Math.abs(actual[frequency_idx] - value)),
      )
      expect(max_absolute_error).toBeLessThan(1e-10 * scale)
      expect(Math.max(...rotating.vdos.power)).toBeLessThan(1e-20)
    },
  )
})

import {
  calc_trajectory_spectroscopy,
  type RamanGeometry,
  type RamanSignal,
  type TrajectorySpectroscopyInput,
  type TrajectorySpectroscopyOptions,
  validate_trajectory_signal,
} from '$lib/spectral/trajectory-spectroscopy'
import { THZ_TO_INVERSE_CM } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import type { TrajectorySignal } from '$lib/trajectory'
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
    positions: {
      positions,
      n_frames,
      n_atoms: 2,
      elements: [`H`, `H`],
      lattice_matrices: null,
      pbc: [false, false, false],
      coords_unwrapped: true,
      frame_stride: 1,
      steps,
    },
    masses: Float64Array.from([1, 1]),
    velocities: { values: velocities, sample_shape: [2, 3], steps },
  }
}

const peak_near = (
  result: ReturnType<typeof calc_trajectory_spectroscopy>,
  frequency: number,
) =>
  result.peaks.reduce((best, peak) =>
    Math.abs(peak.frequency - frequency) < Math.abs(best.frequency - frequency) ? peak : best,
  )

const RAW = { preprocessing: `raw` as const, frequency_unit: `1/frame` as const }
const RAW_SPECTRUM = { ...RAW, window: `none` as const, zero_pad_factor: 1 as const }

const clone_geometry = (
  input: TrajectorySpectroscopyInput,
  extras: Partial<TrajectorySignal> = {},
): TrajectorySignal => ({
  values: new Float64Array(input.positions.positions),
  sample_shape: [input.positions.n_atoms, 3],
  steps: [...input.positions.steps],
  ...extras,
})

const axis_signals = (series: TrajectorySignal) => ({ x: series, y: series, z: series })

const dipole_field_raman = (
  input: TrajectorySpectroscopyInput,
  extras: {
    response?: TrajectorySignal
    field_strength?: number
    plus?: ReturnType<typeof axis_signals>
    minus?: ReturnType<typeof axis_signals>
  } = {},
): RamanSignal => {
  const response = extras.response ?? signal(128, [3], () => [0, 0, 0])
  const fresh_geometry = () => axis_signals(clone_geometry(input))
  return {
    kind: `field_response`,
    response: `dipole`,
    field_strength: extras.field_strength ?? 0.01,
    field_unit: `V/A`,
    plus: axis_signals(response),
    minus: axis_signals(response),
    geometry: {
      plus: extras.plus ?? fresh_geometry(),
      minus: extras.minus ?? fresh_geometry(),
    },
  }
}

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
    positions: {
      positions,
      n_frames,
      n_atoms,
      elements,
      lattice_matrices: null,
      pbc: [false, false, false],
      coords_unwrapped: true,
      frame_stride: 1,
      steps,
    },
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
    frequency_unit: `1/frame`,
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
      /positions have .* values/,
    ],
    [
      `non-finite position`,
      (input: TrajectorySpectroscopyInput) => (input.positions.positions[1] = Number.NaN),
      /position value 1 is NaN/,
    ],
    [
      `element count`,
      (input: TrajectorySpectroscopyInput) => input.positions.elements.pop(),
      /have 1 elements/,
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
      /n_atoms must be a positive integer/,
    ],
    [
      `fractional frame count`,
      (input: TrajectorySpectroscopyInput) => (input.positions.n_frames = 127.5),
      /n_frames must be a positive integer/,
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
      `Raman field-response kind`,
      (input: TrajectorySpectroscopyInput) => {
        input.raman_signal = dipole_field_raman(input)
        Reflect.set(input.raman_signal, `response`, `current`)
      },
      {},
      /Raman field-response kind 'current' is not supported/,
    ],
    [
      `Raman geometry kind`,
      () => {},
      { raman_geometry: { kind: `crystal` } },
      /Raman geometry kind 'crystal' is not supported/,
    ],
    [
      `Raman powder channel`,
      () => {},
      { raman_geometry: { kind: `powder`, channel: `polarized` } },
      /Raman powder channel 'polarized' is not supported/,
    ],
    [
      `infinite activity SNR`,
      () => {},
      { activity_snr: Number.POSITIVE_INFINITY },
      /activity_snr must be finite and >= 0/,
    ],
    [
      `body-fixed current IR`,
      (input: TrajectorySpectroscopyInput) => {
        input.infrared_signal = {
          kind: `current`,
          series: signal(128, [3], (sample_idx) => [
            Math.sin(2 * Math.PI * 0.125 * sample_idx),
            0,
            0,
          ]),
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

  it(`rejects malformed polarized Raman vectors`, () => {
    const input = make_input()
    input.raman_signal = {
      kind: `polarizability`,
      series: signal(128, [3, 3], () => [1, 0, 0, 0, 1, 0, 0, 0, 1]),
    }
    const raman_geometry = {
      kind: `polarized`,
      incident: [1, 0, 0],
      scattered: [0, 1, 0],
    } satisfies RamanGeometry
    Reflect.set(raman_geometry, `incident`, [1, 0, 0, 1])
    expect(() => calc_trajectory_spectroscopy(input, { ...RAW, raman_geometry })).toThrow(
      /polarization vectors must contain exactly three finite components/,
    )
  })

  it(`returns the same physical raw IR spectrum for equivalent time units`, () => {
    const make_timed_input = (time_step: number, time_unit: string) => {
      const input = make_input()
      input.time_step = time_step
      input.time_unit = time_unit
      input.infrared_signal = {
        kind: `dipole`,
        series: signal(128, [3], (sample_idx) => [
          Math.sin(2 * Math.PI * 0.125 * sample_idx),
          0,
          0,
        ]),
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
    [{ time_step: Number.NaN, time_unit: `fs` }, /time_step must be finite and > 0/],
    [{ time_step: 0, time_unit: `fs` }, /time_step must be finite and > 0/],
    [{ time_step: 1 }, /time_step and time_unit must be supplied together/],
    [{ time_unit: `fs` }, /time_step and time_unit must be supplied together/],
    [{ time_step: 1, time_unit: ` ` }, /time_unit must be a non-empty string/],
  ])(`validates supplied physical time metadata in 1/frame mode`, (metadata, error) => {
    const input = Object.assign(make_input(), metadata)
    expect(() => calc_trajectory_spectroscopy(input, RAW)).toThrow(error)
  })

  it(`uses independent signal step spacing for 1/frame frequencies`, () => {
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

  it(`accepts decimal step grids that are uniform within computed f64 roundoff`, () => {
    const input = make_input()
    input.positions.steps = input.positions.steps.map((step) => step * 0.1)
    if (input.velocities) input.velocities.steps = [...input.positions.steps]
    expect(() => calc_trajectory_spectroscopy(input, { ...RAW, window: `none` })).not.toThrow()
  })

  it(`accepts an exactly uniform cadence translated to a large step origin`, () => {
    const input = make_input()
    input.positions.steps = input.positions.steps.map((step) => 1e12 + step * 0.1)
    if (input.velocities) input.velocities.steps = [...input.positions.steps]
    expect(() => calc_trajectory_spectroscopy(input, RAW_SPECTRUM)).not.toThrow()
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
      series: signal(128, [3], (sample_idx) => [
        Math.sin(2 * Math.PI * 0.25 * sample_idx),
        0,
        0,
      ]),
    }
    const result = calc_trajectory_spectroscopy(input, RAW_SPECTRUM)
    expect(peak_near(result, 0.125).ir_activity).toBe(`inactive`)
    expect(peak_near(result, 0.25).ir_activity).toBe(`active`)
  })

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
      /exceeds the position Nyquist frequency 0.25 1\/frame/,
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

  it(`recovers the direct polarizability spectrum from central field differences`, () => {
    const direct = signal(128, [3, 3], (sample_idx) => {
      const value = Math.sin(2 * Math.PI * 0.125 * sample_idx)
      return [value, 0.2 * value, 0, 0.2 * value, -value, 0, 0, 0, 0]
    })
    const field_strength = 0.02
    const response = (axis: number, sign: number): TrajectorySignal =>
      signal(128, [3], (sample_idx) =>
        [0, 1, 2].map(
          (row) => sign * field_strength * direct.values[sample_idx * 9 + row * 3 + axis],
        ),
      )
    const field_input = make_input()
    const geometry_signal = (): TrajectorySignal => clone_geometry(field_input)
    const field_signal: RamanSignal = {
      kind: `field_response`,
      response: `dipole`,
      field_strength,
      field_unit: `V/A`,
      plus: { x: response(0, 1), y: response(1, 1), z: response(2, 1) },
      minus: { x: response(0, -1), y: response(1, -1), z: response(2, -1) },
      geometry: {
        plus: { x: geometry_signal(), y: geometry_signal(), z: geometry_signal() },
        minus: { x: geometry_signal(), y: geometry_signal(), z: geometry_signal() },
      },
    }
    const direct_input = make_input()
    direct_input.raman_signal = { kind: `polarizability`, series: direct }
    field_input.raman_signal = field_signal
    const options = RAW_SPECTRUM
    const direct_result = calc_trajectory_spectroscopy(direct_input, options)
    const field_result = calc_trajectory_spectroscopy(field_input, options)
    const direct_power = direct_result.raman?.unpolarized.power ?? []
    const field_power = field_result.raman?.unpolarized.power ?? []
    const maximum = Math.max(...direct_power)
    const max_absolute_error = Math.max(
      ...direct_power.map((value, frequency_idx) =>
        Math.abs(field_power[frequency_idx] - value),
      ),
    )
    const max_relative_error = Math.max(
      ...direct_power.map((value, frequency_idx) =>
        Math.abs(value) > 1e-12 * maximum
          ? Math.abs(field_power[frequency_idx] - value) / Math.abs(value)
          : 0,
      ),
    )
    expect(max_absolute_error).toBeLessThan(1e-14 * maximum)
    expect(max_relative_error).toBeLessThan(1e-14)
    expect(field_result.raman?.field_response?.max_geometry_deviation).toBe(0)
  })

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

  it(`rejects mismatched finite-field geometries with the measured deviation`, () => {
    const input = make_input()
    const mismatched = clone_geometry(input)
    mismatched.values[5] += 2e-10
    input.raman_signal = dipole_field_raman(input, {
      minus: { x: mismatched, y: clone_geometry(input), z: clone_geometry(input) },
    })
    expect(() => calc_trajectory_spectroscopy(input, RAW)).toThrow(
      /differ by 2.*e-10 A, exceeding the 1e-10 A limit/,
    )
  })

  it(`compares finite-field geometries after converting nanometers to angstrom`, () => {
    const input = make_input()
    const geometry_nm = clone_geometry(input, {
      values: Float64Array.from(input.positions.positions, (value) => value / 10),
      unit: `nm`,
    })
    input.raman_signal = dipole_field_raman(input, {
      plus: axis_signals(geometry_nm),
      minus: axis_signals(geometry_nm),
    })
    const result = calc_trajectory_spectroscopy(input, RAW)
    expect(result.raman?.field_response?.max_geometry_deviation).toBeLessThan(Number.EPSILON)
  })

  it(`rejects periodic total dipoles and periodic finite-field dipole response`, () => {
    const input = make_input()
    input.positions.pbc = [true, false, false]
    input.positions.lattice_matrices = Array.from({ length: 128 }, () => [
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ])
    input.infrared_signal = { kind: `dipole`, series: signal(128, [3], () => [1, 0, 0]) }
    expect(() => calc_trajectory_spectroscopy(input, { preprocessing: `remove_com` })).toThrow(
      /total dipole is not a valid periodic IR signal/,
    )
    input.infrared_signal = null
    input.raman_signal = dipole_field_raman(input)
    expect(() => calc_trajectory_spectroscopy(input, { preprocessing: `remove_com` })).toThrow(
      /periodic Raman field response must use polarization/,
    )
  })

  it(`preserves the initial periodic center while removing center-of-mass drift`, () => {
    const input = make_input()
    for (let value_idx = 0; value_idx < input.positions.positions.length; value_idx++) {
      input.positions.positions[value_idx] += 5
    }
    input.positions.pbc = [true, true, true]
    input.positions.lattice_matrices = Array.from({ length: 128 }, () => [
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ])
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
    const series = signal(128, [3], (sample_idx) => [
      Math.sin(2 * Math.PI * 0.25 * sample_idx),
      0,
      0,
    ])
    if (periodic) {
      input.positions.pbc = [true, false, false]
      input.positions.lattice_matrices = Array.from({ length: 128 }, () => [
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ])
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

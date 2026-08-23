import type { ElementSymbol } from '$lib/element'
import { group_atoms_by_element } from '$lib/trajectory/positions'
import { autocorrelation_sums, calc_vacf, central_difference_velocities } from '$lib/vacf'
import { describe, expect, it } from 'vitest'
import { cubic_matrix } from '../setup'
import {
  build_vacf_input,
  circular_motion,
  ideal_gas,
  max_abs_error,
  max_rel_error,
} from './helpers'

// The definition, spelled out: sum over atoms and every time origin of v(t) . v(t + lag)
const direct_autocorrelation_sum = (
  velocities: Float64Array,
  n_frames: number,
  n_atoms: number,
  lag: number,
  atoms: number[],
): number => {
  let total = 0
  for (let origin = 0; origin + lag < n_frames; origin++) {
    for (const atom_idx of atoms) {
      const from = (origin * n_atoms + atom_idx) * 3
      const to = ((origin + lag) * n_atoms + atom_idx) * 3
      total +=
        velocities[to] * velocities[from] +
        velocities[to + 1] * velocities[from + 1] +
        velocities[to + 2] * velocities[from + 2]
    }
  }
  return total
}

describe(`autocorrelation_sums (Wiener-Khinchin) against the direct origin loop`, () => {
  it.each([
    [`ideal gas, mixed elements`, 60, 8, 12345],
    [`ideal gas, odd frame count`, 37, 5, 777],
    [`ideal gas, 2 frames`, 2, 3, 9],
  ])(`matches the direct sum for %s to 1e-12`, (_label, n_frames, n_atoms, seed) => {
    const { velocities } = ideal_gas(n_frames, n_atoms, seed)
    const flat = Float64Array.from(velocities.flat(2))
    const elements = Array.from({ length: n_atoms }, (_unused, idx) => (idx % 2 ? `He` : `H`))
    const { labels, atom_group } = group_atoms_by_element(elements)
    const max_lag = n_frames - 1
    const sums = autocorrelation_sums(
      flat,
      n_frames,
      n_atoms,
      atom_group,
      labels.length,
      max_lag,
    )
    const groups = [...labels.keys(), labels.length]
    let worst = 0
    let largest = 0
    for (const slot of groups) {
      const atoms = [...atom_group.keys()].filter(
        (atom_idx) => slot === labels.length || atom_group[atom_idx] === slot,
      )
      for (let lag = 0; lag <= max_lag; lag++) {
        const expected = direct_autocorrelation_sum(flat, n_frames, n_atoms, lag, atoms)
        worst = Math.max(worst, Math.abs(sums[slot][lag] - expected))
        largest = Math.max(largest, Math.abs(expected))
      }
    }
    // Sums of O(1) products over <= 60 origins x 8 atoms: an FFT round trip of length 128
    // carries a few tens of eps of round-off, far under this bound and far above zero
    expect(worst).toBeLessThan(1e-12)
    expect(largest).toBeGreaterThan(1)
  })

  it(`reproduces the direct VACF of an orbiting atom through calc_vacf`, () => {
    const [n_frames, frequency] = [50, 0.07]
    const { positions, velocities } = circular_motion(n_frames, frequency, 1.3)
    const flat = Float64Array.from(velocities.flat(2))
    const result = calc_vacf(build_vacf_input(positions, { velocity_frames: velocities }), {
      max_lag_fraction: 1,
    })
    const expected = result.lags.map(
      (lag) => direct_autocorrelation_sum(flat, n_frames, 1, lag, [0]) / (n_frames - lag),
    )
    expect(max_abs_error(result.curves[0].vacf, expected)).toBeLessThan(1e-12)
  })
})

describe(`analytic VACF limits`, () => {
  it.each([
    [`slow orbit`, 0.02, 600],
    [`fast orbit`, 0.17, 400],
    [`mid frequency`, 0.05, 500],
  ])(
    `circular motion (%s) gives VACF = cos(2 pi f lag) exactly`,
    (_label, frequency, n_frames) => {
      const { positions, velocities } = circular_motion(n_frames, frequency)
      const result = calc_vacf(build_vacf_input(positions, { velocity_frames: velocities }))
      const [total] = result.curves
      const omega = 2 * Math.PI * frequency
      const expected = result.lags.map((lag) => Math.cos(omega * lag))

      // Every origin sees the same value, so the only error left is the round-off of the
      // FFT round trip over n_origins identical terms: a few hundred eps at these lengths.
      expect(max_abs_error(total.vacf_normalized, expected)).toBeLessThan(1e-12)
      expect(total.n_origins).toEqual(result.lags.map((lag) => n_frames - lag))
    },
  )

  it(`decays an ideal gas VACF to zero away from lag 0`, () => {
    // Independent velocities every frame: the VACF is a delta at lag 0 and pure sampling
    // noise elsewhere. With 200 atoms and >=150 origins per lag, each lag averages >=3e4
    // independent products, so the per-lag standard error is ~1/sqrt(3e4) = 6e-3.
    const [n_frames, n_atoms] = [400, 200]
    const { positions, velocities } = ideal_gas(n_frames, n_atoms, 314159)
    const result = calc_vacf(build_vacf_input(positions, { velocity_frames: velocities }))
    const [total] = result.curves
    const tail = total.vacf_normalized.slice(1)
    const worst = Math.max(...tail.map(Math.abs))
    // 0.05 is ~8 sampling standard errors: comfortably above noise, far below any real
    // correlation (a liquid VACF sits at 0.3-0.9 for the first few lags)
    expect(worst).toBeLessThan(0.05)
    expect(total.vacf_normalized[0]).toBe(1)
  })

  it(`gives atoms at rest a zero VACF instead of NaN`, () => {
    const frames = Array.from({ length: 20 }, () => [
      [1.5, -2.25, 0.75],
      [4, 4, 4],
    ])
    const result = calc_vacf(build_vacf_input(frames))
    for (const curve of result.curves) {
      expect(curve.vacf.every((value) => value === 0)).toBe(true)
      expect(curve.vacf_normalized.every((value) => value === 0)).toBe(true)
    }
  })

  it(`splits per-element curves and weights the total by atom count`, () => {
    // H moves, He is frozen: the H curve normalizes to 1 at lag 0, the total is half of
    // the raw H value because it averages over both atoms
    const frames = Array.from({ length: 30 }, (_unused, frame_idx) => [
      [0.3 * frame_idx, 0, 0],
      [5, 5, 5],
    ])
    const elements: ElementSymbol[] = [`H`, `He`]
    const result = calc_vacf(build_vacf_input(frames, { elements }))
    expect(result.curves.map((curve) => curve.label)).toEqual([`Total`, `H`, `He`])
    const [total, hydrogen, helium] = result.curves
    expect(hydrogen.vacf[0]).toBeCloseTo(0.09, 12)
    expect(helium.vacf[0]).toBe(0)
    expect(total.vacf[0]).toBeCloseTo(0.045, 12)
  })
})

describe(`velocity sources`, () => {
  it(`matches stored velocities against central differences on the same motion`, () => {
    // Both paths describe the same orbit, so the normalized VACFs are the same cosine.
    // The raw ones differ by exactly (sin(w) / w)^2 — the central difference's finite
    // stencil — which is a real, quantifiable bias, not round-off.
    const [frequency, n_frames] = [0.05, 500]
    const omega = 2 * Math.PI * frequency
    const { positions, velocities } = circular_motion(n_frames, frequency, 1.7)
    const options = { max_lag_fraction: 0.4 } as const

    const stored = calc_vacf(
      build_vacf_input(positions, { velocity_frames: velocities }),
      options,
    )
    const differenced = calc_vacf(build_vacf_input(positions), options)
    expect(stored.velocity_source).toBe(`stored`)
    expect(differenced.velocity_source).toBe(`central_difference`)

    // The differenced series is 2 frames shorter, so its lag grid stops earlier
    const n_common = Math.min(stored.lags.length, differenced.lags.length)
    expect(differenced.lags.slice(0, n_common)).toEqual(stored.lags.slice(0, n_common))
    const stored_curve = stored.curves[0].vacf_normalized.slice(0, n_common)
    const diff_curve = differenced.curves[0].vacf_normalized.slice(0, n_common)

    // A cosine crosses zero, and 6e-15 divided by a reference of 4e-14 is a relative
    // error of 0.16 that says nothing about either curve, so the relative error is only
    // taken away from the crossings.
    const away_from_zero = stored_curve
      .map((_unused, idx) => idx)
      .filter((idx) => Math.abs(stored_curve[idx]) > 0.1)
    const worst_rel_away = max_rel_error(
      away_from_zero.map((idx) => diff_curve[idx]),
      away_from_zero.map((idx) => stored_curve[idx]),
    )
    expect(worst_rel_away).toBeLessThan(1e-13)
    // Both are the same cosine to within the round-off of a few hundred summed origins
    expect(max_abs_error(diff_curve, stored_curve)).toBeLessThan(1e-12)

    // The raw amplitudes differ by the stencil factor, which is 1.6e-2 relative here —
    // five orders of magnitude above f64 eps, i.e. physics rather than arithmetic
    const stencil_ratio = (Math.sin(omega) / omega) ** 2
    const measured_ratio = differenced.curves[0].vacf[0] / stored.curves[0].vacf[0]
    expect(measured_ratio).toBeCloseTo(stencil_ratio, 12)
    expect(Math.abs(1 - stencil_ratio)).toBeGreaterThan(1e-3)
  })

  it(`unwraps periodic images before differentiating`, () => {
    // The same orbit, wrapped into a 2 Å cube. Without an unwrap every image jump becomes
    // a velocity spike and the normalized VACF stops being a cosine.
    const box = 2
    const { positions } = circular_motion(300, 0.03, 5)
    const wrapped = positions.map((frame) =>
      frame.map((xyz) => xyz.map((coord) => coord - box * Math.floor(coord / box))),
    )
    const unwrapped = calc_vacf(
      build_vacf_input(wrapped, { lattice: cubic_matrix(box), pbc: [true, true, true] }),
    )
    // Flagging the coordinates as already unwrapped is the one way to skip the unwrap
    const folded = calc_vacf(
      build_vacf_input(wrapped, {
        lattice: cubic_matrix(box),
        pbc: [true, true, true],
        coords_unwrapped: true,
      }),
    )
    expect(unwrapped.unwrapped).toBe(true)
    expect(folded.unwrapped).toBe(false)

    const expected = unwrapped.lags.map((lag) => Math.cos(2 * Math.PI * 0.03 * lag))
    const unwrapped_error = max_abs_error(unwrapped.curves[0].vacf_normalized, expected)
    const folded_error = max_abs_error(folded.curves[0].vacf_normalized, expected)
    expect(unwrapped_error).toBeLessThan(1e-12)
    expect(folded_error).toBeGreaterThan(0.5)
  })

  it(`honours coords_unwrapped so LAMMPS xu/yu/zu are not re-folded`, () => {
    const { positions } = circular_motion(200, 0.04, 20)
    const result = calc_vacf(
      build_vacf_input(positions, {
        lattice: cubic_matrix(2),
        pbc: [true, true, true],
        coords_unwrapped: true,
      }),
    )
    expect(result.unwrapped).toBe(false)
    const expected = result.lags.map((lag) => Math.cos(2 * Math.PI * 0.04 * lag))
    expect(max_abs_error(result.curves[0].vacf_normalized, expected)).toBeLessThan(1e-12)
  })

  it(`refuses velocity_source 'stored' when the input carries none`, () => {
    const { positions } = circular_motion(20, 0.1)
    expect(() =>
      calc_vacf(build_vacf_input(positions), { velocity_source: `stored` }),
    ).toThrow(/velocity_source 'stored' was requested but the input carries no velocities/)
  })

  it(`ignores stored velocities when central differences are requested`, () => {
    const { positions, velocities } = circular_motion(100, 0.06)
    const result = calc_vacf(build_vacf_input(positions, { velocity_frames: velocities }), {
      velocity_source: `central_difference`,
    })
    expect(result.velocity_source).toBe(`central_difference`)
    expect(result.n_frames).toBe(98)
  })

  it(`rejects a velocity buffer that does not match the position layout`, () => {
    const { positions } = circular_motion(10, 0.1)
    const input = build_vacf_input(positions)
    input.velocities = new Float64Array(17)
    expect(() => calc_vacf(input)).toThrow(
      /velocities has 17 entries but 10 frames x 1 atoms x 3 requires 30/,
    )
  })

  it.each([2, 1])(`refuses to differentiate %i frames`, (n_frames) => {
    const { positions } = circular_motion(n_frames, 0.1)
    expect(() => calc_vacf(build_vacf_input(positions))).toThrow(
      /central differences need at least 3 frames/,
    )
  })
})

describe(`central_difference_velocities`, () => {
  it.each([1, 0.5])(`reproduces a quadratic derivative exactly at dt=%f`, (dt) => {
    // r(n) = (n^2, 2n, 0) has central difference ((n+1)^2 - (n-1)^2) / 2 = 2n, which is
    // the exact derivative at dt=1; dividing by dt also pins the physical-time scaling.
    const n_frames = 8
    const positions = new Float64Array(n_frames * 3)
    for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
      positions[frame_idx * 3] = frame_idx * frame_idx
      positions[frame_idx * 3 + 1] = 2 * frame_idx
    }
    const velocities = central_difference_velocities(positions, n_frames, 1, dt)
    expect(velocities).toHaveLength((n_frames - 2) * 3)
    for (let out_idx = 0; out_idx < n_frames - 2; out_idx++) {
      expect(velocities[out_idx * 3]).toBe((2 * (out_idx + 1)) / dt)
      expect(velocities[out_idx * 3 + 1]).toBe(2 / dt)
      expect(velocities[out_idx * 3 + 2]).toBe(0)
    }
  })
})

import type { ElementSymbol } from '$lib/element'
import { calc_vacf, central_difference_velocities } from '$lib/vacf'
import { describe, expect, it } from 'vitest'
import { cubic_matrix } from '../setup'
import {
  build_vacf_input,
  circular_motion,
  ideal_gas,
  max_abs_error,
  max_rel_error,
} from './helpers'

// f64 machine epsilon, the yardstick every "is this just round-off?" claim below is
// measured against
const F64_EPS = Number.EPSILON // 2.220446049250313e-16
const skip_vdos = { vdos: { skip: true } } as const

describe(`analytic VACF limits`, () => {
  it.each([
    [`slow orbit`, 0.02, 600],
    [`fast orbit`, 0.17, 400],
    [`mid frequency`, 0.05, 500],
  ])(
    `circular motion (%s) gives VACF = cos(2 pi f lag) exactly`,
    (label, frequency, n_frames) => {
      const { positions, velocities } = circular_motion(n_frames, frequency)
      const result = calc_vacf(
        build_vacf_input(positions, { velocity_frames: velocities }),
        skip_vdos,
      )
      const [total] = result.curves
      const omega = 2 * Math.PI * frequency
      const expected = result.lags.map((lag) => Math.cos(omega * lag))

      const worst_abs = max_abs_error(total.vacf_normalized, expected)
      console.info(
        `${label} (f = ${frequency}/frame): max |vacf - cos| = ${worst_abs.toExponential(3)} ` +
          `= ${(worst_abs / F64_EPS).toFixed(1)} f64 eps over ${result.lags.length} lags`,
      )
      // Every origin sees the same value, so the only error left is the round-off of
      // summing n_origins identical terms: a few hundred eps at these lengths.
      expect(worst_abs).toBeLessThan(1e-12)
      // Same reason the spread must vanish: the naive sum-of-squares variance would
      // report ~sqrt(eps) * vacf here instead.
      const vacf_scale = Math.abs(total.vacf[0])
      expect(Math.max(...total.std_error)).toBeLessThan(1e-13 * vacf_scale)
    },
  )

  it(`decays an ideal gas VACF to zero away from lag 0`, () => {
    // Independent velocities every frame: the VACF is a delta at lag 0 and pure sampling
    // noise elsewhere. With 200 atoms and >=150 origins per lag, each lag averages >=3e4
    // independent products, so the per-lag standard error is ~1/sqrt(3e4) = 6e-3.
    const [n_frames, n_atoms] = [400, 200]
    const { positions, velocities } = ideal_gas(n_frames, n_atoms, 314159)
    const result = calc_vacf(
      build_vacf_input(positions, { velocity_frames: velocities }),
      skip_vdos,
    )
    const [total] = result.curves
    const tail = total.vacf_normalized.slice(1)
    const worst = Math.max(...tail.map(Math.abs))
    console.info(
      `ideal gas: max |VACF(lag > 0)| = ${worst.toExponential(3)} over ${tail.length} lags`,
    )
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
    const result = calc_vacf(build_vacf_input(frames), skip_vdos)
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
    const result = calc_vacf(build_vacf_input(frames, { elements }), skip_vdos)
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
    const options = { ...skip_vdos, max_lag_fraction: 0.4 } as const

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

    const worst_abs = max_abs_error(diff_curve, stored_curve)
    const worst_rel = max_rel_error(diff_curve, stored_curve)
    // A cosine crosses zero, and 6e-15 divided by a reference of 4e-14 is a relative
    // error of 0.16 that says nothing about either curve. Away from the crossings the
    // relative error is the honest figure, so report both.
    const away_from_zero = stored_curve
      .map((_unused, idx) => idx)
      .filter((idx) => Math.abs(stored_curve[idx]) > 0.1)
    const worst_rel_away = max_rel_error(
      away_from_zero.map((idx) => diff_curve[idx]),
      away_from_zero.map((idx) => stored_curve[idx]),
    )
    console.info(
      `stored vs central difference over ${n_common} lags: max |a - b| = ` +
        `${worst_abs.toExponential(3)} (${(worst_abs / F64_EPS).toFixed(1)} f64 eps), ` +
        `max rel = ${worst_rel.toExponential(3)} overall but ` +
        `${worst_rel_away.toExponential(3)} where |cos| > 0.1`,
    )
    expect(worst_rel_away).toBeLessThan(1e-13)
    // Both are the same cosine to within the round-off of a few hundred summed origins
    expect(worst_abs).toBeLessThan(1e-12)

    // The raw amplitudes differ by the stencil factor, which is 1.6e-2 relative here —
    // five orders of magnitude above f64 eps, i.e. physics rather than arithmetic
    const stencil_ratio = (Math.sin(omega) / omega) ** 2
    const measured_ratio = differenced.curves[0].vacf[0] / stored.curves[0].vacf[0]
    console.info(
      `raw VACF(0) ratio ${measured_ratio.toPrecision(12)} vs analytic ` +
        `(sin w / w)^2 = ${stencil_ratio.toPrecision(12)}, ` +
        `rel error ${Math.abs(measured_ratio / stencil_ratio - 1).toExponential(3)}`,
    )
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
      skip_vdos,
    )
    const folded = calc_vacf(
      build_vacf_input(wrapped, { lattice: cubic_matrix(box), pbc: [true, true, true] }),
      { ...skip_vdos, skip_unwrap: true },
    )
    expect(unwrapped.unwrapped).toBe(true)
    expect(folded.unwrapped).toBe(false)

    const expected = unwrapped.lags.map((lag) => Math.cos(2 * Math.PI * 0.03 * lag))
    const unwrapped_error = max_abs_error(unwrapped.curves[0].vacf_normalized, expected)
    const folded_error = max_abs_error(folded.curves[0].vacf_normalized, expected)
    console.info(
      `wrapped orbit: unwrapped max |vacf - cos| = ${unwrapped_error.toExponential(3)}, ` +
        `re-folded = ${folded_error.toExponential(3)}`,
    )
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
      skip_vdos,
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
      ...skip_vdos,
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
  it(`reproduces the analytic derivative of a quadratic exactly`, () => {
    // r(n) = (n^2, 2n, 0) has central difference ((n+1)^2 - (n-1)^2) / 2 = 2n, which is
    // the exact derivative: central differences are exact for quadratics.
    const n_frames = 8
    const positions = new Float64Array(n_frames * 3)
    for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
      positions[frame_idx * 3] = frame_idx * frame_idx
      positions[frame_idx * 3 + 1] = 2 * frame_idx
    }
    const velocities = central_difference_velocities(positions, n_frames, 1, 1)
    expect(velocities).toHaveLength((n_frames - 2) * 3)
    for (let out_idx = 0; out_idx < n_frames - 2; out_idx++) {
      expect(velocities[out_idx * 3]).toBe(2 * (out_idx + 1))
      expect(velocities[out_idx * 3 + 1]).toBe(2)
      expect(velocities[out_idx * 3 + 2]).toBe(0)
    }
  })

  it(`scales by 1 / (2 dt)`, () => {
    const positions = Float64Array.from([0, 0, 0, 4, 0, 0, 8, 0, 0])
    expect(central_difference_velocities(positions, 3, 1, 0.5)[0]).toBe(8)
  })
})

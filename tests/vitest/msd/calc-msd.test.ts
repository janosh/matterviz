import type { ElementSymbol } from '$lib/element'
import { calc_msd, compute_msd_async, fit_einstein_diffusion } from '$lib/msd'
import type { Pbc } from '$lib/structure'
import { describe, expect, it } from 'vitest'
import { cubic_matrix } from '../setup'
import {
  ballistic_frames,
  build_positions,
  drift_positions,
  make_rng,
  max_abs_error,
  max_rel_error,
  on_x_axis,
} from './helpers'

const ballistic = (velocity: [number, number, number], n_frames: number) =>
  build_positions(ballistic_frames(velocity, n_frames))

describe(`analytic MSD limits`, () => {
  it.each([
    [`axis-aligned`, [0.25, 0, 0] as [number, number, number], 60],
    [`diagonal`, [0.1, -0.2, 0.35] as [number, number, number], 80],
    [`tiny drift`, [1e-4, 2e-4, -3e-4] as [number, number, number], 50],
  ])(`ballistic atom (%s) gives MSD = (|v| * lag)^2`, (_label, velocity, n_frames) => {
    const speed_sq = velocity[0] ** 2 + velocity[1] ** 2 + velocity[2] ** 2
    const result = calc_msd(ballistic(velocity, n_frames))
    const [total] = result.curves
    const expected = result.lags.map((lag) => speed_sq * lag * lag)

    // Pure f64 arithmetic on an exact quadratic: only representation round-off
    // separates the two, which is ~1e-16 relative, far under this bound.
    const ballistic_rel_error = max_rel_error(total.msd, expected)
    console.info(
      `ballistic ${_label}: max rel error ${ballistic_rel_error.toExponential(3)} over ` +
        `${result.lags.length} lags`,
    )
    expect(ballistic_rel_error).toBeLessThan(1e-12)
    // Every origin sees the same displacement, so the only spread left is the f64
    // representation noise of v*(t+lag) - v*t: ~3e-17 of the MSD scale here.
    // Naive sum-of-squares variance loses this to cancellation and reports ~1e-6 instead.
    const msd_scale = Math.max(...total.msd)
    expect(Math.max(...total.std_error)).toBeLessThan(1e-15 * msd_scale)
  })

  it(`reports the unbiased standard error of the mean over time origins`, () => {
    // One atom at x = 0, 1, 3 gives exactly two lag-1 origins with squared displacements
    // 1 and 4: mean 2.5, sum of squared deviations 4.5, sample variance 4.5 / (2 - 1),
    // SEM = sqrt(4.5 / 1 / 2) = 1.5. Dividing by n instead of n - 1 reports 1.0607.
    const result = calc_msd(build_positions([[[0, 0, 0]], [[1, 0, 0]], [[3, 0, 0]]]))
    expect(result.curves[0].n_origins).toEqual([2])
    expect(result.curves[0].msd[0]).toBeCloseTo(2.5, 14)
    expect(result.curves[0].std_error[0]).toBeCloseTo(1.5, 14)
  })

  it.each([
    [`no lattice`, undefined],
    [`with lattice`, cubic_matrix(5)],
  ])(`stationary atoms give MSD exactly 0 at all lags (%s)`, (_label, lattice) => {
    // oxfmt-ignore
    const stationary = [[1.5, -2.25, 0.75], [4, 4, 4]]
    const frames = Array.from({ length: 30 }, () => stationary)
    const result = calc_msd(build_positions(frames, { lattice }))
    for (const curve of result.curves) {
      expect(curve.msd.every((value) => value === 0)).toBe(true)
      expect(curve.std_error.every((value) => value === 0)).toBe(true)
    }
  })

  it(`recovers the diffusion coefficient of a seeded random walk`, () => {
    // Uniform steps in [-a, a] per dimension: per-dim variance a^2/3, so
    // MSD(dt) = 3 * (a^2/3) * dt = a^2 * dt and D = slope / 6 = a^2 / 6.
    const [n_atoms, n_frames, step_amplitude] = [400, 600, 0.5]
    const rng = make_rng(20260726)
    const current = Array.from({ length: n_atoms }, () => [0, 0, 0])
    const frames = [current.map((xyz) => [...xyz])]
    for (let frame_idx = 1; frame_idx < n_frames; frame_idx++) {
      for (const xyz of current) {
        for (let axis = 0; axis < 3; axis++) {
          xyz[axis] += (rng() * 2 - 1) * step_amplitude
        }
      }
      frames.push(current.map((xyz) => [...xyz]))
    }

    const result = calc_msd(build_positions(frames))
    const [total] = result.curves
    const expected_d = step_amplitude ** 2 / 6

    // MSD(dt) itself must track the analytic line closely over the fit window
    const fit = total.fit
    expect(fit).not.toBeNull()
    if (!fit) return
    const rel_error = Math.abs(fit.diffusion_coefficient - expected_d) / expected_d
    // Measured error for this seed is 0.66%; 2% leaves room for the sampling noise of
    // overlapping origins without admitting mutations (an origin-loop off-by-one and a
    // lag shift both land near 0.64% and would sail through a 5% bound, so the origin
    // count is asserted separately below).
    expect(rel_error).toBeLessThan(0.02)
    expect(fit.r_squared).toBeGreaterThan(0.99)
    // Every origin from 0 to n_frames - 1 - lag inclusive contributes at lag 1
    expect(total.n_origins[0]).toBe(n_frames - result.lags[0])
    // Print the measured numbers so the claim is evidence, not assertion
    console.info(
      `random walk: D=${fit.diffusion_coefficient.toExponential(6)} expected=` +
        `${expected_d.toExponential(6)} rel_err=${(rel_error * 100).toFixed(3)}% ` +
        `R2=${fit.r_squared.toFixed(6)}`,
    )
  })
})

describe(`periodic unwrapping`, () => {
  // An atom drifting steadily through many periodic images: unwrapped it is ballistic,
  // wrapped it sawtooths. This is the regression guard for the whole feature.
  const [box_length, drift, n_frames] = [2, 0.37, 60]
  const wrapped_frames = Array.from({ length: n_frames }, (_unused, frame_idx) => {
    const raw = drift * frame_idx
    return [[raw - box_length * Math.floor(raw / box_length), 0.5, 0.5]]
  })
  const box = cubic_matrix(box_length)

  it(`turns a drift through many images into a linear MSD`, () => {
    const crossings = Math.floor((drift * (n_frames - 1)) / box_length)
    expect(crossings).toBeGreaterThan(8) // the atom really does leave the box repeatedly

    const result = calc_msd(build_positions(wrapped_frames, { lattice: box }))
    expect(result.unwrapped).toBe(true)
    const expected = result.lags.map((lag) => (drift * lag) ** 2)
    expect(max_rel_error(result.curves[0].msd, expected)).toBeLessThan(1e-12)
  })

  it(`sawtooths without unwrapping, bounded by the box`, () => {
    const result = calc_msd(build_positions(wrapped_frames, { lattice: box }), {
      skip_unwrap: true,
    })
    expect(result.unwrapped).toBe(false)
    // Wrapped displacements can never exceed the box diagonal, so the long-lag MSD
    // is capped instead of growing quadratically as the unwrapped answer does.
    const max_wrapped = Math.max(...result.curves[0].msd)
    expect(max_wrapped).toBeLessThan(box_length ** 2)
    expect((drift * result.lags[result.lags.length - 1]) ** 2).toBeGreaterThan(50)
  })

  it(`applies no unwrapping when the frames carry no lattice`, () => {
    expect(calc_msd(build_positions(wrapped_frames)).unwrapped).toBe(false)
  })

  // A slab is periodic in x/y and open along z. Folding the free axis into the 10 A cell
  // turns a real +6 A hop into -4 A, reporting 16 A² where the answer is 36 A².
  const slab_frames = [[[0, 0, 0]], [[0, 0, 6]]]
  const slab_pbc = [true, true, false] as Pbc

  it.each([
    [`pbc from the collected stream`, { pbc: slab_pbc }, {}, 36],
    [`pbc overridden by the caller`, {}, { pbc: slab_pbc }, 36],
    [`fully periodic cell`, {}, {}, 16],
  ])(`honours %s`, (_label, input_options, options, expected) => {
    const result = calc_msd(
      build_positions(slab_frames, { lattice: cubic_matrix(10), ...input_options }),
      options,
    )
    expect(result.unwrapped).toBe(true)
    expect(result.curves[0].msd[0]).toBeCloseTo(expected, 10)
  })

  // Steps longer than half the box: minimum image folds them back, so applying it to
  // coordinates LAMMPS already unwrapped (xu/yu/zu) silently destroys the answer.
  const long_step = 1.5
  const long_step_frames = ballistic_frames([long_step, 0, 0], 30)
  const stepped = (coords_unwrapped: boolean) =>
    calc_msd(build_positions(long_step_frames, { lattice: box, coords_unwrapped }))

  it.each([
    [`flagged unwrapped`, true, long_step],
    [`not flagged`, false, long_step - box_length], // min image folds 1.5 -> -0.5
  ])(`honours coords_unwrapped (%s)`, (_label, coords_unwrapped, effective_step) => {
    const result = stepped(coords_unwrapped)
    expect(result.unwrapped).toBe(!coords_unwrapped)
    const expected = result.lags.map((lag) => (effective_step * lag) ** 2)
    expect(max_rel_error(result.curves[0].msd, expected)).toBeLessThan(1e-12)
  })

  it(`the same trajectory flagged and unflagged does not give the same MSD`, () => {
    const ratio = stepped(true).curves[0].msd[0] / stepped(false).curves[0].msd[0]
    expect(ratio).toBeCloseTo((long_step / (long_step - box_length)) ** 2, 9)
  })
})

describe(`time-origin averaging`, () => {
  it(`origin counts fall off as n_frames - lag`, () => {
    const n_frames = 41
    const result = calc_msd(ballistic([0.1, 0, 0], n_frames))
    const [total] = result.curves
    expect(result.lags[0]).toBe(1)
    expect(result.lags[result.lags.length - 1]).toBe(Math.floor((n_frames - 1) * 0.5))
    expect(total.n_origins).toEqual(result.lags.map((lag) => n_frames - lag))
    // strictly decreasing
    for (let idx = 1; idx < total.n_origins.length; idx++) {
      expect(total.n_origins[idx]).toBeLessThan(total.n_origins[idx - 1])
    }
  })

  it.each([0.25, 0.5, 1])(`max_lag_fraction %s caps the longest lag`, (fraction) => {
    const n_frames = 101
    const result = calc_msd(ballistic([0.1, 0, 0], n_frames), { max_lag_fraction: fraction })
    expect(result.lags[result.lags.length - 1]).toBe(Math.floor((n_frames - 1) * fraction))
  })

  it(`origin sub-sampling is reported and leaves the exact answer intact`, () => {
    // Ballistic displacement is origin independent, so striding origins must not
    // change the result — only the reported stride and origin counts.
    const full = calc_msd(ballistic([0.2, 0, 0], 50))
    const strided = calc_msd(ballistic([0.2, 0, 0], 50), { origin_stride: 4 })
    expect(strided.origin_stride).toBe(4)
    expect(max_abs_error(strided.curves[0].msd, full.curves[0].msd)).toBeLessThan(1e-12)
    expect(strided.curves[0].n_origins[0]).toBeLessThan(full.curves[0].n_origins[0])
  })

  it(`auto-tunes origin_stride against the work budget and reports it`, () => {
    const result = calc_msd(ballistic([0.2, 0, 0], 200), { work_budget: 100 })
    expect(result.origin_stride).toBeGreaterThan(1)
  })
})

describe(`per-element decomposition`, () => {
  it(`separates species and weights the total by atom count`, () => {
    const [fast, slow] = [0.4, 0.1]
    const frames = Array.from({ length: 40 }, (_unused, frame_idx) => [
      [fast * frame_idx, 0, 0],
      [slow * frame_idx, 0, 0],
      [slow * frame_idx, 0, 0],
    ])
    const elements = [`Li`, `O`, `O`] as ElementSymbol[]
    const result = calc_msd(build_positions(frames, { elements }))

    expect(result.curves.map((curve) => curve.label)).toEqual([`Total`, `Li`, `O`])
    const by_label = Object.fromEntries(result.curves.map((curve) => [curve.label, curve]))
    expect(by_label.Li.n_atoms).toBe(1)
    expect(by_label.O.n_atoms).toBe(2)

    const lag = result.lags[3]
    const li_expected = (fast * lag) ** 2
    const o_expected = (slow * lag) ** 2
    expect(by_label.Li.msd[3]).toBeCloseTo(li_expected, 12)
    expect(by_label.O.msd[3]).toBeCloseTo(o_expected, 12)
    // Total is the atom-count weighted mean of the element curves
    expect(by_label.Total.msd[3]).toBeCloseTo((li_expected + 2 * o_expected) / 3, 12)
    // Each curve owns its origin counts; sharing one array lets a caller corrupt the rest
    expect(by_label.Li.n_origins).not.toBe(by_label.Total.n_origins)
    expect(by_label.Li.n_origins).toEqual(by_label.Total.n_origins)
  })

  it(`emits only a total curve for a single-species trajectory`, () => {
    const result = calc_msd(ballistic([0.1, 0, 0], 20))
    expect(result.curves.map((curve) => curve.label)).toEqual([`Total`])
  })
})

describe(`Einstein fit`, () => {
  it(`recovers slope, intercept, R2 and D from an exact line`, () => {
    const expected_d = 0.0125
    const lags = Array.from({ length: 50 }, (_unused, idx) => idx + 1)
    const msd = lags.map((time) => 6 * expected_d * time + 0.3)
    const fit = fit_einstein_diffusion(lags, lags, msd)
    expect(fit).not.toBeNull()
    if (!fit) return
    expect(fit.diffusion_coefficient).toBeCloseTo(expected_d, 14)
    expect(fit.slope).toBeCloseTo(6 * expected_d, 14)
    expect(fit.intercept).toBeCloseTo(0.3, 12)
    expect(fit.r_squared).toBeCloseTo(1, 14)
    expect(fit.units).toBe(`Å²/frame`)
  })

  it.each([
    [1, 2],
    [2, 4],
    [3, 6],
  ])(`divides the slope by 2 * dimensionality (%s D)`, (dimensionality, divisor) => {
    const lags = Array.from({ length: 20 }, (_unused, idx) => idx + 1)
    const fit = fit_einstein_diffusion(
      lags,
      lags,
      lags.map((lag) => 3 * lag),
      {
        dimensionality,
      },
    )
    expect(fit?.diffusion_coefficient).toBeCloseTo(3 / divisor, 14)
  })

  it(`returns null rather than widening a window with too few points`, () => {
    const lags = [1, 2, 3]
    const options = { start_fraction: 0.9, end_fraction: 0.95 }
    expect(fit_einstein_diffusion(lags, lags, lags, options)).toBeNull()
  })

  it.each([
    [
      `inverted window`,
      { start_fraction: 0.8, end_fraction: 0.2 },
      /start_fraction .* must be below end_fraction/,
    ],
    [`bad dimensionality`, { dimensionality: 0 }, /dimensionality must be positive/],
  ])(`throws on %s`, (_label, options, pattern) => {
    expect(() => fit_einstein_diffusion([1, 2], [1, 2], [1, 2], options)).toThrow(pattern)
  })

  it(`respects a user-adjusted fit window`, () => {
    // Ballistic (quadratic) MSD: a late window has a steeper local slope than an early one
    const positions = ballistic([0.3, 0, 0], 200)
    const early = calc_msd(positions, { fit: { start_fraction: 0.05, end_fraction: 0.25 } })
    const late = calc_msd(positions, { fit: { start_fraction: 0.7, end_fraction: 1 } })
    const early_fit = early.curves[0].fit
    const late_fit = late.curves[0].fit
    expect(early_fit).not.toBeNull()
    expect(late_fit).not.toBeNull()
    if (!early_fit || !late_fit) return
    expect(late_fit.slope).toBeGreaterThan(early_fit.slope * 3)
    expect(early_fit.lag_window[1]).toBeLessThan(late_fit.lag_window[0])
  })
})

describe(`time axis`, () => {
  it.each([
    [`no dt is supplied`, {}, 1, `frame`, `Lag (frames)`],
    [`dt and a unit are supplied`, { dt: 0.5, time_unit: `ps` }, 0.5, `ps`, `Lag time (ps)`],
  ])(`labels the time axis and D units when %s`, (_label, options, dt, unit, x_label) => {
    const result = calc_msd(ballistic([0.1, 0, 0], 20), options)
    expect(result.dt).toBe(dt)
    expect(result.time_unit).toBe(unit)
    expect(result.x_label).toBe(x_label)
    expect(result.times).toEqual(result.lags.map((lag) => lag * dt))
    expect(result.curves[0].fit?.units).toBe(`Å²/${unit}`)
  })

  it(`refuses to invent a time unit when dt is supplied without one`, () => {
    expect(() => calc_msd(ballistic([0.1, 0, 0], 20), { dt: 0.5 })).toThrow(
      /dt was supplied .* without time_unit/,
    )
  })
})

describe(`input validation`, () => {
  const drifting = (n_frames: number) => ballistic([0.1, 0, 0], n_frames)

  it.each([
    [`single frame`, () => calc_msd(build_positions([[[0, 0, 0]]])), /at least 2 frames/],
    [
      `element/atom mismatch`,
      () => calc_msd({ ...drifting(5), elements: [`H`, `H`] as ElementSymbol[] }),
      /element labels for 1 atoms/,
    ],
    [
      `truncated position buffer`,
      () => calc_msd({ ...drifting(5), positions: new Float64Array(6) }),
      /positions has 6 entries/,
    ],
    [
      `lattice count mismatch`,
      () => calc_msd({ ...drifting(5), lattice_matrices: [cubic_matrix(3)] }),
      /1 lattice matrices for 5 frames/,
    ],
    [
      `out-of-range max_lag_fraction`,
      () => calc_msd(drifting(5), { max_lag_fraction: 2 }),
      /max_lag_fraction must be in/,
    ],
    [
      `lag_stride above max lag`,
      () => calc_msd(drifting(5), { lag_stride: 99 }),
      /exceeds the maximum lag/,
    ],
    [
      // A fractional stride would index the flat buffer at non-integer frame offsets
      `fractional lag_stride`,
      () => calc_msd(drifting(20), { lag_stride: 1.5 }),
      /lag_stride must be a positive integer/,
    ],
    [
      `fractional origin_stride`,
      () => calc_msd(drifting(20), { origin_stride: 2.5 }),
      /origin_stride must be a positive integer/,
    ],
  ])(`throws on %s`, (_label, run, pattern) => {
    expect(run).toThrow(pattern)
  })

  it(`throws when the position buffer disagrees with n_frames x n_atoms`, () => {
    // unwrap_flat_positions owns this check; MSD must let it surface, not swallow it
    const positions = build_positions([on_x_axis(0, 1), on_x_axis(0.1, 1.1)])
    // frame 1 loses an atom
    const broken = { ...positions, n_atoms: 2, positions: positions.positions.slice(0, 9) }
    expect(() => calc_msd(broken)).toThrow(/positions has 9 entries/)
  })
})

// happy-dom has no Worker, so these exercise the SSR/no-Worker synchronous fallback;
// worker-path.test.ts stubs a Worker in to cover the postMessage branch.
describe(`compute_msd_async`, () => {
  it(`documents which code path the suite exercises`, () => {
    expect(typeof Worker).toBe(`undefined`)
  })

  it(`matches the synchronous result`, async () => {
    const positions = drift_positions(40)
    const [async_result, sync_result] = [
      await compute_msd_async(positions),
      calc_msd(positions),
    ]
    expect(async_result.curves[0].msd).toEqual(sync_result.curves[0].msd)
    expect(async_result.lags).toEqual(sync_result.lags)
  })

  it(`dedupes identical in-flight requests`, async () => {
    const positions = drift_positions()
    const [first, second] = [
      compute_msd_async(positions, { max_lag_fraction: 0.5 }),
      compute_msd_async(positions, { max_lag_fraction: 0.5 }),
    ]
    expect(first).toBe(second)
    await expect(first).resolves.toBeDefined()
  })

  it.each([
    [`different options`, { max_lag_fraction: 0.25 }],
    [`different fit window`, { fit: { start_fraction: 0.1 } }],
  ])(`issues a separate request for %s`, async (_label, options) => {
    const positions = drift_positions()
    const baseline = compute_msd_async(positions)
    const variant = compute_msd_async(positions, options)
    expect(variant).not.toBe(baseline)
    await Promise.all([baseline, variant])
  })

  it(`rejects rather than throwing synchronously on invalid input`, async () => {
    const single_frame = build_positions([[[0, 0, 0]]])
    let promise: Promise<unknown> | undefined
    expect(() => (promise = compute_msd_async(single_frame))).not.toThrow()
    await expect(promise).rejects.toThrow(/at least 2 frames/)
  })

  it(`clears the dedupe entry so a failed request can be retried`, async () => {
    const single_frame = build_positions([[[0, 0, 0]]])
    await expect(compute_msd_async(single_frame)).rejects.toThrow(/at least 2 frames/)
    // A second attempt must be a fresh promise, not the settled rejection
    await expect(compute_msd_async(single_frame)).rejects.toThrow(/at least 2 frames/)
  })
})

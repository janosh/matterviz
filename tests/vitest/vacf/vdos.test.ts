import { calc_vacf } from '$lib/vacf'
import { describe, expect, it } from 'vitest'
import { build_vacf_input, circular_motion, ideal_gas } from './helpers'

// THz -> cm^-1, the same factor calc-vacf derives from the speed of light
const THZ_TO_INVERSE_CM = 1e12 / (299792458 * 100)

// One atom orbiting at `frequency` cycles per frame, with analytic velocities attached
const orbit = (n_frames: number, frequency: number) => {
  const { positions, velocities } = circular_motion(n_frames, frequency, 1)
  return build_vacf_input(positions, { velocity_frames: velocities })
}

describe(`VDOS peak position`, () => {
  it.each([
    [`20 THz`, 0.02, 20],
    [`8.5 THz`, 0.0085, 8.5],
    [`45 THz`, 0.045, 45],
  ])(
    `puts the %s peak of a 1 fs-sampled orbit at the input frequency`,
    (_label, cycles_per_frame, expected_thz) => {
      // dt = 1 fs, so a frequency of f cycles/frame is f * 1000 THz
      const result = calc_vacf(orbit(1000, cycles_per_frame), {
        dt: 1,
        time_unit: `fs`,
      })
      expect(result.frequency_unit).toBe(`THz`)
      const peak = result.curves[0].peak_frequency
      expect(peak).not.toBeNull()

      // Tolerance is tied to the frequency grid, not picked by eye: the VDOS is only
      // evaluated on bins of width 1 / (n_fft * dt), so the reported peak can be off by
      // up to half a bin from discretisation alone. One full bin leaves room for the
      // asymmetry the negative-frequency image of the Hann-windowed line adds.
      const bin_spacing = result.frequencies[1] - result.frequencies[0]
      const offset = Math.abs((peak ?? 0) - expected_thz)
      console.info(
        `VDOS peak ${peak?.toFixed(4)} THz vs ${expected_thz} THz: off by ` +
          `${offset.toExponential(3)} THz = ${(offset / bin_spacing).toFixed(2)} bins ` +
          `(bin = ${bin_spacing.toExponential(3)} THz, n_fft = ${result.n_fft})`,
      )
      expect(offset).toBeLessThan(bin_spacing)
    },
  )

  // Regression: max_lags used to shrink the lag SPACING once a run exceeded ~8194 frames,
  // which undersamples the correlation function before the transform. A 0.3 cycles/frame
  // mode at the resulting stride of 2 folded to 0.2, i.e. 300 THz reported as 200 THz, with
  // the peak moved rather than missing so the plot still looked reasonable.
  it(`keeps a high-frequency peak put on a run long enough to trigger lag capping`, () => {
    const cycles_per_frame = 0.3
    const result = calc_vacf(orbit(9000, cycles_per_frame), { dt: 1, time_unit: `fs` })

    expect(result.lag_stride).toBe(1)
    const bin_spacing = result.frequencies[1] - result.frequencies[0]
    const peak = result.curves[0].peak_frequency ?? 0
    const aliased_thz = (1 / result.lag_stride - cycles_per_frame) * 1000
    expect(Math.abs(peak - cycles_per_frame * 1000)).toBeLessThan(bin_spacing)
    // and specifically not sitting where a stride-2 decimation would have folded it
    expect(Math.abs(peak - aliased_thz)).toBeGreaterThan(bin_spacing)
  })

  it(`refuses to thin time origins on its own`, () => {
    // A velocity repeating every 8 frames read at origin_stride 8 is sampled at one phase
    // forever, so a real oscillation comes back as an all-zero curve.
    const period = 8
    const n_frames = 80
    const velocities = Array.from({ length: n_frames }, (_, frame_idx) => [
      [Math.cos((2 * Math.PI * frame_idx) / period), 0, 0],
    ])
    const positions = Array.from({ length: n_frames }, () => [[0, 0, 0]])
    const input = build_vacf_input(positions, { velocity_frames: velocities })

    const honest = calc_vacf(input, {})
    expect(honest.origin_stride).toBe(1)
    expect(honest.curves[0].vacf[0]).toBeCloseTo(0.5, 10)

    // opting in is still possible, and still wrong for this signal - which is the point
    const phase_locked = calc_vacf(input, { origin_stride: period })
    expect(phase_locked.curves[0].vacf[0]).toBeCloseTo(1, 10)
  })

  it(`names the stride and the risk when the work budget is exceeded`, () => {
    expect(() => calc_vacf(orbit(400, 0.05), { work_budget: 100 })).toThrow(
      /origin_stride >= \d+.*aliases motion whose period divides the stride/s,
    )
  })

  it(`reports the same peak in cm^-1`, () => {
    const options = { dt: 1, time_unit: `fs` } as const
    const in_thz = calc_vacf(orbit(800, 0.02), options)
    const in_wavenumbers = calc_vacf(orbit(800, 0.02), {
      ...options,
      vdos: { frequency_unit: `cm^-1` },
    })
    const [peak_thz, peak_cm] = [
      in_thz.curves[0].peak_frequency,
      in_wavenumbers.curves[0].peak_frequency,
    ]
    expect(in_wavenumbers.frequency_unit).toBe(`cm^-1`)
    expect(peak_cm).toBeCloseTo((peak_thz ?? 0) * THZ_TO_INVERSE_CM, 8)
    // 20 THz is 667.13 cm^-1, a physically ordinary optical mode. Same one-bin tolerance
    // as the THz assertions: the grid here is 8.1 cm^-1 coarse.
    const bin_spacing = in_wavenumbers.frequencies[1] - in_wavenumbers.frequencies[0]
    const exact_cm = 20 * THZ_TO_INVERSE_CM
    console.info(
      `cm^-1 peak ${peak_cm?.toFixed(3)} vs exact ${exact_cm.toFixed(3)}, bin = ` +
        `${bin_spacing.toFixed(3)} cm^-1`,
    )
    expect(Math.abs((peak_cm ?? 0) - exact_cm)).toBeLessThan(bin_spacing)
  })

  it(`labels the axis in inverse frames when no timestep was supplied`, () => {
    const result = calc_vacf(orbit(1000, 0.02))
    expect(result.frequency_unit).toBe(`1/frame`)
    expect(result.frequency_label).toBe(`Frequency (1/frame)`)
    expect(result.time_unit).toBe(`frame`)
    const bin_spacing = result.frequencies[1] - result.frequencies[0]
    expect(Math.abs((result.curves[0].peak_frequency ?? 0) - 0.02)).toBeLessThan(bin_spacing)
  })

  it(`finds the peak from central differences too`, () => {
    // The stencil scales the VACF amplitude but not its period, so the peak must not move
    const { positions } = circular_motion(1000, 0.02, 1)
    const result = calc_vacf(build_vacf_input(positions), { dt: 1, time_unit: `fs` })
    expect(result.velocity_source).toBe(`central_difference`)
    const bin_spacing = result.frequencies[1] - result.frequencies[0]
    expect(Math.abs((result.curves[0].peak_frequency ?? 0) - 20)).toBeLessThan(bin_spacing)
  })

  it(`gives an ideal gas a flat spectrum with no dominant peak`, () => {
    // A delta-correlated VACF transforms to a constant, so the tallest bin is barely
    // above the mean rather than towering over it like a vibrational line
    const { positions, velocities } = ideal_gas(400, 200, 271828)
    const result = calc_vacf(build_vacf_input(positions, { velocity_frames: velocities }), {
      dt: 1,
      time_unit: `fs`,
    })
    const { vdos } = result.curves[0]
    const mean = vdos.reduce((sum, value) => sum + value, 0) / vdos.length
    const peak_ratio = Math.max(...vdos) / mean
    console.info(`ideal gas VDOS peak / mean = ${peak_ratio.toFixed(3)}`)
    expect(peak_ratio).toBeLessThan(3)
    // The orbit fixture, for contrast, concentrates everything in one line
    const line = calc_vacf(orbit(400, 0.02), { dt: 1, time_unit: `fs` }).curves[0].vdos
    const line_mean = line.reduce((sum, value) => sum + value, 0) / line.length
    expect(Math.max(...line) / line_mean).toBeGreaterThan(50)
  })
})

describe(`windowing`, () => {
  it(`suppresses truncation ringing that the rectangular window leaves behind`, () => {
    // An orbit truncated mid-cycle: the rectangular window's sinc sidelobes ring across
    // the whole axis, Hann's fall away far faster. Measured as the spectral weight more
    // than 5 bins from the line, relative to the line itself.
    const input = orbit(301, 0.037)
    const sidelobe_fraction = (window: `none` | `hann` | `gaussian`) => {
      const result = calc_vacf(input, { dt: 1, time_unit: `fs`, vdos: { window } })
      const { vdos } = result.curves[0]
      let peak_bin = 0
      for (let bin = 1; bin < vdos.length; bin++) {
        if (vdos[bin] > vdos[peak_bin]) peak_bin = bin
      }
      // The main lobe is a handful of bins wide at this zero padding; everything beyond
      // 40 bins is leakage the window is supposed to kill
      let [inside, outside] = [0, 0]
      for (const [bin, value] of vdos.entries()) {
        if (Math.abs(bin - peak_bin) <= 40) inside += Math.abs(value)
        else outside += Math.abs(value)
      }
      return outside / inside
    }
    const [rectangular, hann, gaussian] = [
      sidelobe_fraction(`none`),
      sidelobe_fraction(`hann`),
      sidelobe_fraction(`gaussian`),
    ]
    console.info(
      `leakage outside the main lobe: rectangular ${rectangular.toExponential(3)}, ` +
        `hann ${hann.toExponential(3)}, gaussian ${gaussian.toExponential(3)}`,
    )
    expect(hann).toBeLessThan(rectangular / 2)
    expect(gaussian).toBeLessThan(rectangular / 2)
  })

  it(`defaults to hann and reports which window ran`, () => {
    expect(calc_vacf(orbit(200, 0.05)).window).toBe(`hann`)
    expect(calc_vacf(orbit(200, 0.05), { vdos: { window: `gaussian` } }).window).toBe(
      `gaussian`,
    )
  })

  it(`only interpolates the spectrum when zero padding grows`, () => {
    // More padding must move the peak by less than a bin, not to a different frequency
    const coarse = calc_vacf(orbit(600, 0.03), {
      dt: 1,
      time_unit: `fs`,
      vdos: { zero_pad_factor: 1 },
    })
    const fine = calc_vacf(orbit(600, 0.03), {
      dt: 1,
      time_unit: `fs`,
      vdos: { zero_pad_factor: 8 },
    })
    expect(fine.n_fft).toBe(coarse.n_fft * 8)
    const coarse_bin = coarse.frequencies[1] - coarse.frequencies[0]
    const offset = Math.abs(
      (fine.curves[0].peak_frequency ?? 0) - (coarse.curves[0].peak_frequency ?? 0),
    )
    expect(offset).toBeLessThan(coarse_bin)
  })
})

describe(`no-dt policy`, () => {
  it(`refuses a dt without a time_unit`, () => {
    expect(() => calc_vacf(orbit(50, 0.1), { dt: 0.5 })).toThrow(
      /dt was supplied \(0.5\) without time_unit/,
    )
  })

  it.each([`THz`, `cm^-1`] as const)(
    `refuses a %s axis when no timestep was supplied`,
    (frequency_unit) => {
      expect(() => calc_vacf(orbit(50, 0.1), { vdos: { frequency_unit } })).toThrow(
        /no timestep was supplied, so the only honest axis is '1\/frame'/,
      )
    },
  )

  it(`refuses a THz axis for a time unit it cannot convert`, () => {
    expect(() => calc_vacf(orbit(50, 0.1), { dt: 1, time_unit: `arbitrary units` })).toThrow(
      /time_unit must be one of fs, ps, ns to convert to THz or cm\^-1/,
    )
  })

  it(`accepts an unconvertible time unit as long as the axis stays in frames`, () => {
    const result = calc_vacf(orbit(50, 0.1), {
      dt: 2,
      time_unit: `steps`,
      vdos: { skip: true },
    })
    expect(result.time_unit).toBe(`steps`)
    expect(result.x_label).toBe(`Lag time (steps)`)
    expect(result.times[1]).toBe(result.lags[1] * 2)
    expect(result.frequencies).toEqual([])
  })

  it.each([
    [`fs`, 1000],
    [`ps`, 1],
    [`ns`, 0.001],
  ])(`converts a dt in %s to THz`, (time_unit, thz_per_inverse_time) => {
    const result = calc_vacf(orbit(600, 0.02), { dt: 1, time_unit })
    // 0.02 cycles per frame at dt = 1 <unit> is 0.02 / 1 <unit>^-1
    const expected = 0.02 * thz_per_inverse_time
    const bin_spacing = result.frequencies[1] - result.frequencies[0]
    expect(Math.abs((result.curves[0].peak_frequency ?? 0) - expected)).toBeLessThan(
      bin_spacing,
    )
  })
})

describe(`frequency axis bookkeeping`, () => {
  it(`folds lag_stride into the frequency grid so the peak stays put`, () => {
    // Sampling every second lag halves the Nyquist frequency; the axis must be built from
    // dt * lag_stride or the same mode reads at twice its frequency
    const options = { dt: 1, time_unit: `fs` } as const
    const dense = calc_vacf(orbit(1000, 0.01), options)
    const thinned = calc_vacf(orbit(1000, 0.01), { ...options, lag_stride: 2 })
    expect(thinned.lag_stride).toBe(2)
    const bin_spacing = thinned.frequencies[1] - thinned.frequencies[0]
    const offset = Math.abs(
      (thinned.curves[0].peak_frequency ?? 0) - (dense.curves[0].peak_frequency ?? 0),
    )
    console.info(
      `lag_stride 1 vs 2: peaks ${dense.curves[0].peak_frequency?.toFixed(4)} and ` +
        `${thinned.curves[0].peak_frequency?.toFixed(4)} THz, ` +
        `${(offset / bin_spacing).toFixed(2)} bins apart`,
    )
    expect(offset).toBeLessThan(bin_spacing)
  })

  it(`starts the grid at DC and reaches Nyquist`, () => {
    const result = calc_vacf(orbit(200, 0.05), { dt: 2, time_unit: `fs` })
    expect(result.frequencies[0]).toBe(0)
    expect(result.frequencies).toHaveLength(result.n_fft / 2 + 1)
    // Nyquist for a 2 fs sample interval is 1 / (2 * 2 fs) = 250 THz
    expect(result.frequencies.at(-1)).toBeCloseTo(250, 8)
    expect(result.curves[0].vdos).toHaveLength(result.frequencies.length)
  })

  it(`omits the spectrum entirely when the VDOS is skipped`, () => {
    const result = calc_vacf(orbit(50, 0.1), { vdos: { skip: true } })
    expect(result.frequencies).toEqual([])
    expect(result.n_fft).toBe(0)
    for (const curve of result.curves) {
      expect(curve.vdos).toEqual([])
      expect(curve.peak_frequency).toBeNull()
    }
  })
})

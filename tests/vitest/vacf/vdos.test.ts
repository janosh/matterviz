import { calc_vacf, type VacfResult } from '$lib/vacf'
import { describe, expect, it } from 'vitest'
import { build_vacf_input, circular_motion, ideal_gas } from './helpers'

// THz -> cm^-1, the same factor calc-vacf derives from the speed of light
const THZ_TO_INVERSE_CM = 1e12 / (299792458 * 100)
const n_bins = (result: VacfResult) => result.frequencies.length

// One atom orbiting at `frequency` cycles per frame, with analytic velocities attached
const orbit = (n_frames: number, frequency: number) => {
  const { positions, velocities } = circular_motion(n_frames, frequency, 1)
  return build_vacf_input(positions, { velocity_frames: velocities })
}

const expect_peak_within_bin = (result: VacfResult, expected: number) => {
  const bin_spacing = result.frequencies[1] - result.frequencies[0]
  const peak = result.curves[0].peak_frequency ?? 0
  expect(Math.abs(peak - expected)).toBeLessThan(bin_spacing)
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
      expect(result.curves[0].peak_frequency).not.toBeNull()
      // Tolerance is tied to the frequency grid, not picked by eye: the VDOS is only
      // evaluated on bins of width 1 / (n_fft * dt), so the reported peak can be off by
      // up to half a bin from discretisation alone. One full bin leaves room for the
      // asymmetry the negative-frequency image of the Hann-windowed line adds.
      expect_peak_within_bin(result, expected_thz)
    },
  )

  // Regression: max_lags used to shrink the lag SPACING once a run exceeded ~8194 frames,
  // which undersamples the correlation function before the transform. A 0.3 cycles/frame
  // mode at the resulting stride of 2 folded to 0.2, i.e. 300 THz reported as 200 THz, with
  // the peak moved rather than missing so the plot still looked reasonable.
  it(`keeps a high-frequency peak put when max_lags caps the window`, () => {
    // max_lags 64 over 1000 frames is the same arithmetic the default 4096 hits past ~8194
    // frames, at a thousandth of the cost. The old lag_stride would be ceil(499 / 64) = 8,
    // folding 0.3 cycles/frame to 0.05 and reporting 300 THz as 50.
    const cycles_per_frame = 0.3
    const result = calc_vacf(orbit(1000, cycles_per_frame), {
      dt: 1,
      time_unit: `fs`,
      max_lags: 64,
    })

    expect(result.lags).toEqual(Array.from({ length: 64 }, (_unused, lag) => lag))
    const bin_spacing = result.frequencies[1] - result.frequencies[0]
    const peak = result.curves[0].peak_frequency
    expect(Math.abs(peak - cycles_per_frame * 1000)).toBeLessThan(bin_spacing)
    // and specifically not where a stride-8 decimation would have folded it
    expect(Math.abs(peak - 50)).toBeGreaterThan(bin_spacing)
  })

  it(`averages every time origin, so a phase-locking stride cannot zero an oscillation`, () => {
    // A velocity repeating every 8 frames read at every 8th origin would be sampled at one
    // phase forever and come back as a flat curve; the full origin average sees cos^2 = 1/2
    const period = 8
    const n_frames = 80
    const velocities = Array.from({ length: n_frames }, (_, frame_idx) => [
      [Math.cos((2 * Math.PI * frame_idx) / period), 0, 0],
    ])
    const positions = Array.from({ length: n_frames }, () => [[0, 0, 0]])
    const result = calc_vacf(build_vacf_input(positions, { velocity_frames: velocities }))
    expect(result.curves[0].n_origins).toEqual(result.lags.map((lag) => n_frames - lag))
    expect(result.curves[0].vacf[0]).toBeCloseTo(0.5, 10)
  })

  it(`reports the same peak in cm^-1`, () => {
    const options = { dt: 1, time_unit: `fs` } as const
    const in_thz = calc_vacf(orbit(800, 0.02), options)
    const in_wavenumbers = calc_vacf(orbit(800, 0.02), {
      ...options,
      vdos: { frequency_unit: `cm^-1` },
    })
    expect(in_wavenumbers.frequency_unit).toBe(`cm^-1`)
    // Absolute scale is already pinned by the THz peak table; here only the conversion
    // between the two axes needs to hold.
    expect(in_wavenumbers.curves[0].peak_frequency).toBeCloseTo(
      (in_thz.curves[0].peak_frequency ?? 0) * THZ_TO_INVERSE_CM,
      8,
    )
  })

  it(`labels the axis in inverse frames when no timestep was supplied`, () => {
    const result = calc_vacf(orbit(1000, 0.02))
    expect(result.frequency_unit).toBe(`1/frame`)
    expect(result.frequency_label).toBe(`Frequency (1/frame)`)
    expect(result.time_unit).toBe(`frame`)
    expect_peak_within_bin(result, 0.02)
  })

  it(`reports inverse-frame frequencies when dt is supplied but the axis asks for frames`, () => {
    // Inverse frames means cycles per collected frame, so the grid (and Nyquist) are
    // independent of the numerical dt
    const result = calc_vacf(orbit(600, 0.02), {
      dt: 2,
      time_unit: `fs`,
      vdos: { frequency_unit: `1/frame` },
    })
    expect(result.frequency_unit).toBe(`1/frame`)
    expect_peak_within_bin(result, 0.02)
    expect(result.frequencies.at(-1)).toBeCloseTo(0.5, 12)
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
    expect(Math.max(...vdos) / mean).toBeLessThan(3)
    // The orbit fixture, for contrast, concentrates everything in one line
    const line = calc_vacf(orbit(400, 0.02), { dt: 1, time_unit: `fs` }).curves[0].vdos
    const line_mean = line.reduce((sum, value) => sum + value, 0) / line.length
    expect(Math.max(...line) / line_mean).toBeGreaterThan(50)
  })
})

describe(`windowing`, () => {
  it(`zero-pads the mirrored VACF 4x so the grid is 8 x n_lags bins wide`, () => {
    const result = calc_vacf(orbit(600, 0.03), { dt: 1, time_unit: `fs` })
    // 300 lags (floor(599 / 2) + lag 0) mirrored to 600 and padded 4x -> 2400 -> 4096
    expect(result.lags).toHaveLength(300)
    expect(result.n_fft).toBe(4096)
    expect(n_bins(result)).toBe(result.n_fft / 2 + 1)
  })

  it(`suppresses truncation ringing that the rectangular window leaves behind`, () => {
    // An orbit truncated mid-cycle: the rectangular window's sinc sidelobes ring across
    // the whole axis, Hann's fall away far faster. Measured as the spectral weight more
    // than 5 bins from the line, relative to the line itself.
    const input = orbit(301, 0.037)
    const sidelobe_fraction = (window: `none` | `hann` | `gaussian`) => {
      const result = calc_vacf(input, { dt: 1, time_unit: `fs`, vdos: { window } })
      expect(result.window).toBe(window)
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
    const rectangular = sidelobe_fraction(`none`)
    expect(sidelobe_fraction(`hann`)).toBeLessThan(rectangular / 2)
    expect(sidelobe_fraction(`gaussian`)).toBeLessThan(rectangular / 2)
  })
})

describe(`no-dt policy`, () => {
  it(`refuses a dt without a time_unit`, () => {
    expect(() => calc_vacf(orbit(50, 0.1), { dt: 0.5 })).toThrow(
      /dt was supplied \(0.5\) without time_unit/,
    )
  })

  it(`refuses a dt with the frame sentinel time unit`, () => {
    expect(() => calc_vacf(orbit(50, 0.1), { dt: 0.5, time_unit: `frame` })).toThrow(
      /time_unit 'frame' cannot be combined with dt/,
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

  it.each([`arbitrary units`, `toString`] as const)(
    `refuses a THz axis for time_unit %s`,
    (time_unit) => {
      expect(() =>
        calc_vacf(orbit(50, 0.1), {
          dt: 1,
          time_unit,
          vdos: { frequency_unit: `THz` },
        }),
      ).toThrow(
        `time_unit '${time_unit}' with frequency_unit 'THz' is not convertible; ` +
          `use frequency_unit '1/frame'`,
      )
    },
  )

  it(`rejects inherited Object keys as THz-convertible time units`, () => {
    // Without Object.hasOwn, TIME_UNIT_TO_THZ['toString'] is a function and would be
    // treated as a conversion factor (NaN frequencies / a bogus THz default).
    const result = calc_vacf(orbit(80, 0.05), { dt: 1, time_unit: `toString` })
    expect(result.frequency_unit).toBe(`1/frame`)
    expect(result.frequencies[1]).toBeGreaterThan(0)
    expect(Number.isFinite(result.frequencies[1])).toBe(true)
  })

  // fs -> THz is already pinned by the peak-position table; ps/ns cover the rest of
  // TIME_UNIT_TO_THZ.
  it.each([
    [`ps`, 1],
    [`ns`, 0.001],
  ])(`converts a dt in %s to THz`, (time_unit, thz_per_inverse_time) => {
    const result = calc_vacf(orbit(600, 0.02), { dt: 1, time_unit })
    expect(result.frequency_unit).toBe(`THz`)
    // 0.02 cycles per frame at dt = 1 <unit> is 0.02 / 1 <unit>^-1
    expect_peak_within_bin(result, 0.02 * thz_per_inverse_time)
  })
})

describe(`frequency axis bookkeeping`, () => {
  it(`starts the grid at DC and reaches Nyquist`, () => {
    const result = calc_vacf(orbit(200, 0.05), { dt: 2, time_unit: `fs` })
    expect(result.frequencies[0]).toBe(0)
    expect(result.frequencies).toHaveLength(result.n_fft / 2 + 1)
    // Nyquist for a 2 fs sample interval is 1 / (2 * 2 fs) = 250 THz
    expect(result.frequencies.at(-1)).toBeCloseTo(250, 8)
    expect(result.curves[0].vdos).toHaveLength(result.frequencies.length)
  })
})

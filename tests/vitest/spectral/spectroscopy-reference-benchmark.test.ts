import {
  benchmark_spectroscopy,
  BUILTIN_VIBRATIONAL_REFERENCES,
  parse_experimental_spectrum,
  parse_vibrational_reference_catalog,
  type SpectroscopyBenchmarkOptions,
  type TrajectorySpectroscopyResult,
  type VibrationalReferenceEntry,
} from '$lib/spectral'
import { describe, expect, it } from 'vitest'

const curve = {
  frequencies: [0, 1000, 2000, 3000, 4000],
  power: [0, 1, 0, 1, 0],
  normalized_power: [0, 1, 0, 1, 0],
  frequency_unit: `cm^-1` as const,
  n_fft: 8,
  n_samples: 8,
  sample_interval: 1,
  frequency_spacing: 500,
  rayleigh_resolution: 125,
  nyquist: 4000,
  window: `hann` as const,
}

const result_with_peaks = (frequencies: number[]): TrajectorySpectroscopyResult => ({
  vdos: curve,
  ir: null,
  raman: null,
  peaks: frequencies.map((frequency) => ({
    frequency,
    ir_activity: `active`,
    raman_activity: `active`,
    ir_score: 1,
    raman_score: 1,
    vdos_prominence: 1,
    ir_prominence: 1,
    raman_prominence: 1,
    potentially_mixed: false,
    displacement: [
      [
        [1, 0],
        [0, 0],
        [0, 0],
      ],
    ],
  })),
  frequency_unit: `cm^-1`,
  preprocessing: `raw`,
  velocity_source: `stored`,
  reference_positions: [[0, 0, 0]],
  elements: [`H`],
  masses: [1],
  pbc: [false, false, false],
  reference_lattice: null,
  n_trajectories: 1,
  n_segments: 1,
  metadata: {},
})

const reference: VibrationalReferenceEntry = {
  id: `synthetic`,
  name: `Synthetic`,
  formula: `X`,
  isotopologue: `X`,
  phase: `gas`,
  frequency_unit: `cm^-1`,
  cas_number: `0-00-0`,
  inchikey: `SYNTHETIC`,
  citations: [
    {
      id: `source`,
      title: `Synthetic source`,
      authors: `Test`,
      year: 2026,
      url: `https://example.com`,
      locator: `table 1`,
      access_date: `2026-08-17`,
      redistribution_rationale: `Test fixture`,
    },
  ],
  modes: [1000, 2000, 3000].map((wavenumber_cm1, mode_idx) => ({
    mode_id: `mode-${mode_idx + 1}`,
    label: `ν${mode_idx + 1}`,
    degeneracy: 1,
    wavenumber_cm1,
    ir_activity: `active` as const,
    raman_activity: `active` as const,
    citation_id: `source`,
  })),
}
const experimental_spectrum = {
  kind: `ir` as const,
  source: `fixture`,
  data: [
    [100, 4],
    [200, 2],
  ],
}

describe(`spectroscopy reference parsing`, () => {
  it(`ships four validated gas-phase molecule references with provenance`, () => {
    expect(BUILTIN_VIBRATIONAL_REFERENCES.map(({ formula }) => formula)).toEqual([
      `H2O`,
      `NH3`,
      `CH4`,
      `CO2`,
    ])
    expect(
      BUILTIN_VIBRATIONAL_REFERENCES.every(({ citations }) =>
        citations.every(({ url, locator, redistribution_rationale }) =>
          Boolean(url && locator && redistribution_rationale),
        ),
      ),
    ).toBe(true)
  })

  it(`rejects missing provenance and invalid activity values`, () => {
    expect(() =>
      parse_vibrational_reference_catalog([{ ...reference, citations: [] }]),
    ).toThrow(/citations must be a non-empty array/)
    const bad = structuredClone(reference)
    Reflect.set(bad.modes[0], `ir_activity`, `maybe`)
    expect(() => parse_vibrational_reference_catalog([bad])).toThrow(
      /must be active, inactive, or unknown/,
    )
    expect(() =>
      parse_vibrational_reference_catalog([{ ...reference, frequency_unit: `THz` }]),
    ).toThrow(/frequency_unit must be cm\^-1/)
    const invalid_year = structuredClone(reference)
    invalid_year.citations[0].year = 2026.5
    expect(() => parse_vibrational_reference_catalog([invalid_year])).toThrow(
      /year must be a positive integer/,
    )
    const invalid_date = structuredClone(reference)
    invalid_date.citations[0].access_date = `2026-02-30`
    expect(() => parse_vibrational_reference_catalog([invalid_date])).toThrow(
      /access_date must be a valid calendar date/,
    )
    expect(() =>
      parse_vibrational_reference_catalog([{ ...reference, comparison_url: ` ` }]),
    ).toThrow(/comparison_url must be a non-empty string/)
  })

  it(`parses two-column experimental spectra without normalizing intensities`, () => {
    expect(
      parse_experimental_spectrum({
        ...experimental_spectrum,
        temperature: 300,
      }),
    ).toEqual({
      kind: `ir`,
      source: `fixture`,
      frequencies_cm1: [100, 200],
      intensities: [4, 2],
      temperature: 300,
    })
    expect(() =>
      parse_experimental_spectrum({
        ...experimental_spectrum,
        temperature: -1,
      }),
    ).toThrow(/temperature must be >= 0/)
  })
})

describe(`benchmark_spectroscopy`, () => {
  it(`reports absolute, shift-independent, and explicit-scale metrics without overwriting raw peaks`, () => {
    const result = result_with_peaks([990, 1990, 2990])
    const raw_frequencies = result.peaks.map(({ frequency }) => frequency)
    const benchmark = benchmark_spectroscopy(result, reference, {
      comparison: `scaled`,
      scale: { factor: 1.01, source: `synthetic published factor` },
    })
    expect(benchmark.absolute).toMatchObject({
      mean_signed_error_cm1: -10,
      mae_cm1: 10,
      rmse_cm1: 10,
    })
    expect(benchmark.spacing_mae_cm1).toBe(0)
    expect(benchmark.scale).toEqual({ factor: 1.01, source: `synthetic published factor` })
    expect(benchmark.ir_activity).toEqual({
      correct: 3,
      compared: 3,
      true_active: 3,
      false_active: 0,
      true_inactive: 0,
      false_inactive: 0,
    })
    expect(result.peaks.map(({ frequency }) => frequency)).toEqual(raw_frequencies)
  })

  it(`labels fitted calibration modes as in-sample and keeps unmatched modes`, () => {
    const benchmark = benchmark_spectroscopy(
      result_with_peaks([900, 1900, 2900, 3900]),
      reference,
      {
        fit_scale_mode_ids: [`mode-1`, `mode-2`],
        unmatched_penalty_cm1: 200,
      },
    )
    expect(benchmark.scale.source).toContain(`least-squares`)
    expect(benchmark.scale_is_in_sample).toBe(true)
    expect(benchmark.unmatched_predicted_peak_indices).toEqual([3])
    expect(benchmark.matches).toHaveLength(3)
  })

  it(`constrains automatic assignment with activity penalties`, () => {
    const result = result_with_peaks([995, 1995, 2995])
    result.peaks[1].ir_activity = `inactive`
    const benchmark = benchmark_spectroscopy(result, reference, {
      unmatched_penalty_cm1: 100,
    })
    expect(benchmark.unmatched_predicted_peak_indices).toContain(1)
    expect(benchmark.unmatched_reference_mode_ids).toContain(`mode-2`)
  })

  it(`returns null metrics when every mode remains unmatched`, () => {
    const benchmark = benchmark_spectroscopy(result_with_peaks([10_000]), reference, {
      unmatched_penalty_cm1: 1,
    })
    expect(benchmark.matches).toEqual([])
    expect(benchmark.absolute).toBeNull()
    expect(benchmark.spacing_mae_cm1).toBeNull()
    expect(benchmark.scaled).toBeNull()
  })

  it(`prefers unique stable mode labels before frequency assignment`, () => {
    const result = result_with_peaks([2990, 990])
    result.peaks[0].mode_label = `ν1`
    result.peaks[1].mode_label = `ν3`
    const benchmark = benchmark_spectroscopy(result, reference)
    expect(benchmark.matches.slice(0, 2)).toMatchObject([
      { predicted_peak_idx: 0, reference_mode_id: `mode-1` },
      { predicted_peak_idx: 1, reference_mode_id: `mode-3` },
    ])
    expect(benchmark.matches[0].resolution_cm1).toBe(125)
  })

  it(`rejects calibration IDs that are not present in the accepted mapping`, () => {
    expect(() =>
      benchmark_spectroscopy(result_with_peaks([990]), reference, {
        fit_scale_mode_ids: [`mode-2`],
        unmatched_penalty_cm1: 100,
      }),
    ).toThrow(/scale calibration modes are unmatched or unknown: mode-2/)
  })

  it.each([
    [`unmatched_penalty_cm1`, -1, /unmatched_penalty_cm1 must be finite and >= 0/],
    [`unmatched_penalty_cm1`, Number.NaN, /unmatched_penalty_cm1 must be finite and >= 0/],
    [
      `unmatched_penalty_cm1`,
      Number.POSITIVE_INFINITY,
      /unmatched_penalty_cm1 must be finite and >= 0/,
    ],
    [`activity_mismatch_penalty_cm1`, -1, /activity_mismatch_penalty_cm1 must be >= 0/],
    [
      `activity_mismatch_penalty_cm1`,
      Number.NaN,
      /activity_mismatch_penalty_cm1 must be >= 0/,
    ],
    [`comparison`, `invalid`, /comparison 'invalid' is not supported/],
  ])(`rejects invalid benchmark option %s=%s`, (key, value, expected) => {
    const options: SpectroscopyBenchmarkOptions = {}
    Reflect.set(options, key, value)
    expect(() => benchmark_spectroscopy(result_with_peaks([990]), reference, options)).toThrow(
      expected,
    )
  })

  it(`rejects ambiguous or blank scale provenance`, () => {
    expect(() =>
      benchmark_spectroscopy(result_with_peaks([990]), reference, {
        scale: { factor: 1, source: `published` },
        fit_scale_mode_ids: [`mode-1`],
      }),
    ).toThrow(/provide either scale or fit_scale_mode_ids/)
    expect(() =>
      benchmark_spectroscopy(result_with_peaks([990]), reference, {
        scale: { factor: 1, source: ` ` },
      }),
    ).toThrow(/positive finite factor and source/)
  })
})

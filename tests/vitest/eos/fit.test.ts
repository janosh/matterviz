import type { EosKind, EosParams } from '$lib/eos'
import {
  EOS_KINDS,
  eos_energy,
  eos_gradient,
  eos_pressure,
  fit_eos,
  PARAM_KEYS,
} from '$lib/eos'
import { describe, expect, test } from 'vitest'

// Reference fits [E0, V0, B0, B0'] from pymatgen.analysis.eos.EOS(eos_name).fit(volumes,
// energies) (v2025) for two scans: a 9-point Birch–Murnaghan curve with ~1 meV pseudo-noise
// (Cu-like) and the ASE equation-of-state tutorial numbers for fcc Ag
const REFERENCE = {
  cu_like: {
    volumes: [10.384, 10.738, 11.092, 11.446, 11.8, 12.154, 12.508, 12.862, 13.216],
    energies: [
      -3.60480992, -3.65001692, -3.67844077, -3.69497369, -3.70053567, -3.69525616,
      -3.68211321, -3.66370053, -3.64106684,
    ],
    fits: {
      birch_murnaghan: [-3.699556638, 11.79004862, 0.8682479297, 5.264650962],
      murnaghan: [-3.699495456, 11.79173568, 0.8614993429, 5.167778076],
      vinet: [-3.699581539, 11.78981849, 0.8707313063, 5.280180675],
    },
  },
  ase_ag: {
    volumes: [13.72, 14.83, 16.0, 17.23, 18.52],
    energies: [-56.29, -56.41, -56.46, -56.46, -56.42],
    fits: {
      birch_murnaghan: [-56.4656624, 16.56664708, 0.4935225782, 4.959313006],
      murnaghan: [-56.4656037, 16.57279411, 0.4896946525, 4.752932545],
      vinet: [-56.46568473, 16.563773, 0.4951905784, 5.053985404],
    },
  },
} satisfies Record<
  string,
  { volumes: number[]; energies: number[]; fits: Record<EosKind, number[]> }
>
const to_params = ([e0, v0, b0, b0_prime]: number[]): EosParams => ({ e0, v0, b0, b0_prime })
const rel_err = (val: number, ref: number) => Math.abs(val - ref) / Math.abs(ref)
const rmse = (kind: EosKind, params: EosParams, volumes: number[], energies: number[]) =>
  Math.hypot(...volumes.map((vol, idx) => eos_energy(kind, params, vol) - energies[idx])) /
  Math.sqrt(volumes.length)

const cases = Object.entries(REFERENCE).flatMap(([name, data]) =>
  EOS_KINDS.map((kind) => [name, kind, data] as const),
)

describe(`fit_eos`, () => {
  test.each(cases)(`%s / %s matches pymatgen`, (_name, kind, { volumes, energies, fits }) => {
    const fit = fit_eos(volumes, energies, kind)
    const ref = to_params(fits[kind])
    // scipy's leastsq and our LM stop at slightly different points on a flat 4-parameter
    // surface; measured max relative gaps are 3e-8 for E0/V0 and 2.2e-6 for B0 and B0' (the
    // weakly determined pair)
    for (const [idx, key] of PARAM_KEYS.entries()) {
      expect(rel_err(fit[key], ref[key])).toBeLessThan(idx < 2 ? 1e-7 : 1e-5)
    }
    // the fit is a least-squares optimum: the pymatgen parameters cannot do better
    expect(fit.rmse).toBeCloseTo(rmse(kind, fit, volumes, energies), 12)
    expect(fit.rmse).toBeLessThanOrEqual(rmse(kind, ref, volumes, energies) * (1 + 1e-9))
  })

  // Beyond the typical solid (v0 40 A^3, b0 0.6 eV/A^3): a soft material (b0 1e-3), a tiny
  // and a huge cell (v0 0.04 and 4e7 A^3). Without Marquardt scaling of the normal matrix its
  // diagonal spans 1e10 and the solver's pivot test rejects every step, so the fit silently
  // returned the parabola guess (b0_prime = 4 exactly, b0 off by 11%)
  test.each(
    EOS_KINDS.flatMap((kind) =>
      [
        { e0: -10.5, v0: 40, b0: 0.6, b0_prime: 4.5 },
        { e0: -10.5, v0: 40, b0: 1e-3, b0_prime: 4.5 },
        { e0: -10.5, v0: 0.04, b0: 600, b0_prime: 4.5 },
        { e0: -10.5, v0: 4e7, b0: 6e-7, b0_prime: 4.5 },
      ].map((truth) => [kind, truth] as const),
    ),
  )(`%s recovers exact parameters from noise-free data %j`, (kind, truth) => {
    const volumes = Array.from({ length: 11 }, (_, idx) => truth.v0 * (0.85 + 0.03 * idx))
    const energies = volumes.map((vol) => eos_energy(kind, truth, vol))
    const fit = fit_eos(volumes, energies, kind)
    for (const key of PARAM_KEYS) expect(rel_err(fit[key], truth[key])).toBeLessThan(1e-8)
    expect(fit.rmse).toBeLessThan(1e-9)
  })

  // Expansion-heavy scan (0.95–1.6·V0): anharmonicity pulls the parabola vertex below the
  // smallest volume although V0 is bracketed, so a vertex-in-range guard rejected it
  test.each(EOS_KINDS)(`%s fits a bracketed but lopsided scan`, (kind) => {
    const truth: EosParams = { e0: -10.5, v0: 40, b0: 0.6, b0_prime: 4.5 }
    const volumes = Array.from({ length: 14 }, (_, idx) => 40 * (0.95 + 0.05 * idx))
    const energies = volumes.map((vol) => eos_energy(kind, truth, vol))
    const fit = fit_eos(volumes, energies, kind)
    for (const key of PARAM_KEYS) expect(rel_err(fit[key], truth[key])).toBeLessThan(1e-8)
  })

  // 8 exact points from 1.2·V0 (or 1.3·V0) outward: before the bracket check, Vinet returned
  // V0 off by 27× and Murnaghan by 100% with no error, only a 0.3–2.5 eV RMSE
  test.each(EOS_KINDS.flatMap((kind) => [1.2, 1.3].map((start) => [kind, start] as const)))(
    `%s refuses a scan that does not bracket the minimum (start %s·V0)`,
    (kind, start) => {
      const truth: EosParams = { e0: -10.5, v0: 40, b0: 0.6, b0_prime: 4.5 }
      const volumes = Array.from({ length: 8 }, (_, idx) => 40 * (start + 0.04 * idx))
      const energies = volumes.map((vol) => eos_energy(kind, truth, vol))
      expect(() => fit_eos(volumes, energies, kind)).toThrow(/must bracket the energy minimum/)
    },
  )

  // A bracketing scan can still land the fit outside its own volumes once noise enters: this
  // Cu-like 9-point scan at ~20 meV silently returned V0 = 9.82, B0' = 42.7 against a truth of
  // 40 / 4.5. Vinet still lands at V0 = 11.05 and must be rejected, not reported.
  test(`rejects a noisy fit whose V0 escapes the scanned volumes`, () => {
    const volumes = [36, 37, 38, 39, 40, 41, 42, 43, 44]
    const energies = [
      -10.359965146, -10.427177245, -10.466421621, -10.500782148, -10.501370108, -10.501183896,
      -10.463480846, -10.432090326, -10.402130406,
    ]
    expect(() => fit_eos(volumes, energies, `vinet`)).toThrow(
      /must lie inside the scanned range/,
    )
    // the damping-ladder reset recovers Birch-Murnaghan on the same data
    expect(fit_eos(volumes, energies, `birch_murnaghan`).v0).toBeCloseTo(39.84, 1)
  })

  test(`kind defaults to Birch–Murnaghan and unknown kinds throw`, () => {
    const { volumes, energies } = REFERENCE.ase_ag
    expect(fit_eos(volumes, energies).kind).toBe(`birch_murnaghan`)
    expect(() => fit_eos(volumes, energies, `birch` as EosKind)).toThrow(`Unknown EOS kind`)
  })

  test.each([
    [[1, 2, 3], [1, 2], /3 volumes but 2 energies/],
    [[1, 2, 3], [1, 2, 3], /at least 4 volumes, got 3/],
    [[1, 1, 2, 3], [1, 2, 3, 4], /volumes must be distinct/],
    [[1, 2, 3, 4], [1, 2, Number.NaN, 4], /energies finite, got V=3, E=NaN at index 2/],
    [[Number.NaN, Number.NaN, Number.NaN, 1], [1, 2, 3, 4], /volumes must be finite/], // not "distinct"
    [[-1, 2, 3, 4], [1, 2, 3, 4], /volumes must be finite and positive.*V=-1, E=1 at index 0/],
    [[1, 2, 3, Infinity], [3, 1, 2, 4], /volumes must be finite.*V=Infinity, E=4 at index 3/],
    [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5], /must bracket the energy minimum/], // straight line
    [[1, 2, 3, 4, 5], [0, 3, 4, 3, 0], /must bracket the energy minimum/], // concave-down
    [[2, 1, 3, 4], [0, 0, 0, 1], /no minimum in volume/], // flat around the lowest point
  ])(`rejects bad input %j %j`, (volumes, energies, message) => {
    expect(() => fit_eos(volumes, energies)).toThrow(message)
  })
})

describe(`eos_energy / eos_pressure / eos_gradient`, () => {
  const params: EosParams = { e0: -5, v0: 20, b0: 0.9, b0_prime: 4.3 }
  const central_diff = (func: (arg: number) => number, arg: number, step: number) =>
    (func(arg + step) - func(arg - step)) / (2 * step)

  test.each(EOS_KINDS)(`%s: E(V0) = E0, P(V0) = 0, E is convex around V0`, (kind) => {
    expect(eos_energy(kind, params, params.v0)).toBeCloseTo(params.e0, 12)
    expect(eos_pressure(kind, params, params.v0)).toBeCloseTo(0, 12)
    for (const vol of [16, 18, 22, 25]) {
      expect(eos_energy(kind, params, vol)).toBeGreaterThan(params.e0)
    }
  })

  // O(h²) truncation on smooth curves: observed gaps are ~1e-10 eV/A^3 (pressure) and
  // ≤ 1e-9 (parameter gradient)
  test.each(EOS_KINDS)(
    `%s: pressure, bulk modulus and parameter gradient match central differences`,
    (kind) => {
      const energy_at = (vol: number) => eos_energy(kind, params, vol)
      const pressure_at = (vol: number) => eos_pressure(kind, params, vol)
      expect(-params.v0 * central_diff(pressure_at, params.v0, 1e-5)).toBeCloseTo(params.b0, 7)
      for (const vol of [15, 18, 20, 23, 27]) {
        expect(Math.abs(pressure_at(vol) + central_diff(energy_at, vol, 1e-5))).toBeLessThan(
          1e-8,
        )
        const analytic = eos_gradient(kind, params, vol)
        for (const key of PARAM_KEYS) {
          const energy_with = (val: number) => eos_energy(kind, { ...params, [key]: val }, vol)
          const step = 1e-5 * Math.max(Math.abs(params[key]), 1)
          const numeric = central_diff(energy_with, params[key], step)
          expect(Math.abs(analytic[key] - numeric)).toBeLessThan(1e-7)
        }
      }
    },
  )

  test(`the three forms agree to 2nd order near V0 and differ far from it`, () => {
    const near = EOS_KINDS.map((kind) => eos_energy(kind, params, params.v0 * 1.01))
    const far = EOS_KINDS.map((kind) => eos_energy(kind, params, params.v0 * 1.5))
    expect(Math.max(...near) - Math.min(...near)).toBeLessThan(1e-6)
    expect(Math.max(...far) - Math.min(...far)).toBeGreaterThan(1e-2)
  })
})

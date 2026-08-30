import { BOLTZMANN_EV_PER_K, EV_TO_KJ_PER_MOL } from '$lib/constants'
import { frequency_unit_per_thz, thermal_properties } from '$lib/spectral'
import type { PhononDos } from '$lib/spectral'
import { describe, expect, test } from 'vitest'
import { load_json } from '../setup'

// Reference F, U, S, C_v (J/mol and J/(K·mol) per primitive cell) stored alongside the DOS in
// the atomate2 fixture. They come from the same trapezoid integration over this DOS grid (the
// ZPE agrees to 16 digits), so the fixture test is a regression check; the Einstein-solid
// closed forms below are the independent validation.
const fixture = load_json<{
  phonon_dos: PhononDos
  temps: number[]
  free_energies: number[]
  internal_energies: number[]
  entropies: number[]
  heat_capacities: number[]
}>(`src/site/phonons/mp-2758-Sr4Se4-pbe.json.gz`)

// Einstein solid: every one of n_modes modes at the same frequency, as a narrow DOS peak whose
// trapezoid integral is exactly n_modes
const einstein_dos = (freq_thz: number, n_modes: number): PhononDos => ({
  type: `phonon`,
  frequencies: [freq_thz - 1e-4, freq_thz, freq_thz + 1e-4],
  densities: [0, n_modes / 1e-4, 0],
})
const THZ_TO_EV = frequency_unit_per_thz(`eV`)

// relative error, with a floor on the reference so values that vanish (S, C_v at 0 K) compare
// absolutely
const rel = (ours: number, ref: number, floor = 0) =>
  Math.abs(ours - ref) / Math.max(Math.abs(ref), floor)
const QUANTITIES = [`free_energy`, `internal_energy`, `entropy`, `heat_capacity`] as const

describe(`thermal_properties`, () => {
  test(`reproduces the fixture's reference values for a simulated Sr4Se4 phonon DOS`, () => {
    const { phonon_dos, temps } = fixture
    const thermal = thermal_properties(phonon_dos, temps)
    const j_per_mol = EV_TO_KJ_PER_MOL * 1000
    const refs = {
      free_energy: fixture.free_energies,
      internal_energy: fixture.internal_energies,
      entropy: fixture.entropies,
      heat_capacity: fixture.heat_capacities,
    }
    // measured max relative gap is 9e-9 for F (the reference forms it as kT ∫ g ln(2 sinh(x/2))
    // rather than ZPE + kT ∫ g ln(1 − e^{−x})) and < 1e-9 for U, S, C_v
    for (const key of QUANTITIES) {
      for (const [idx, val] of thermal[key].entries()) {
        expect(rel(val * j_per_mol, refs[key][idx], 1)).toBeLessThan(1e-7)
      }
    }
    for (const [idx, temp] of temps.entries()) {
      if (temp === 0) expect(thermal.free_energy[idx]).toBe(thermal.zero_point_energy)
      // F = U − TS holds identically
      expect(thermal.free_energy[idx]).toBeCloseTo(
        thermal.internal_energy[idx] - temp * thermal.entropy[idx],
        12,
      )
    }
  })

  test.each([
    [5, 3, 300],
    [1, 6, 50],
    [12, 24, 1000],
  ])(
    `Einstein solid at %s THz with %s modes at %s K matches the closed form`,
    (freq, n_modes, temp) => {
      const dos = einstein_dos(freq, n_modes)
      const { zero_point_energy, free_energy, internal_energy, entropy, heat_capacity } =
        thermal_properties(dos, [temp])
      const energy = freq * THZ_TO_EV
      const x = energy / (BOLTZMANN_EV_PER_K * temp)
      const occupation = 1 / (Math.exp(x) - 1)
      const log_term = Math.log(1 - Math.exp(-x))
      const k_b = BOLTZMANN_EV_PER_K
      // only the peak has a nonzero trapezoid weight (n_modes / h · 2h / 2 = n_modes), so every
      // integral is exactly n_modes · f(ω0) up to rounding in (ω0 + h) − (ω0 − h): measured 2e-12
      expect(rel(zero_point_energy, (n_modes * energy) / 2)).toBeLessThan(1e-10)
      expect(rel(internal_energy[0], n_modes * energy * (0.5 + occupation))).toBeLessThan(
        1e-10,
      )
      expect(rel(free_energy[0], n_modes * (energy / 2 + k_b * temp * log_term))).toBeLessThan(
        1e-10,
      )
      expect(rel(entropy[0], n_modes * k_b * (x * occupation - log_term))).toBeLessThan(1e-10)
      const cv_ref = (n_modes * k_b * x ** 2 * Math.exp(x)) / (Math.exp(x) - 1) ** 2
      expect(rel(heat_capacity[0], cv_ref)).toBeLessThan(1e-10)
    },
  )

  test(`classical limits: C_v → n_modes k_B and U → n_modes k_B T at high T, S grows as k_B ln T`, () => {
    const dos = einstein_dos(2, 6)
    const { heat_capacity, entropy, internal_energy } = thermal_properties(
      dos,
      [5000, 10000, 1e20, 1e300],
    )
    const n_kb = 6 * BOLTZMANN_EV_PER_K
    expect(heat_capacity[1] / n_kb).toBeCloseTo(1, 4)
    // S(2T) − S(T) → n_modes k_B ln 2 when k_B T ≫ ħω
    expect((entropy[1] - entropy[0]) / n_kb).toBeCloseTo(Math.LN2, 4)
    // x ≈ 1e-18: 1 − e^{−x} rounds to 0 without expm1 and C_v would be NaN
    expect(heat_capacity[2] / n_kb).toBeCloseTo(1, 8)
    // x ≈ 1e-298: x² underflows to 0, so C_v must be built from x / (1 − e^{−x}) → 1
    expect(heat_capacity[3] / n_kb).toBeCloseTo(1, 8)
    expect(internal_energy[3] / (n_kb * 1e300)).toBeCloseTo(1, 8)
  })

  test(`T = 0 (either sign) is the ground state and low T underflows cleanly`, () => {
    const dos = einstein_dos(5, 3)
    const { zero_point_energy, free_energy, internal_energy, entropy, heat_capacity } =
      thermal_properties(dos, [0, -0, 1e-3, 1, 1e-200, 1e-310, 5e-324])
    // -0 passes the ≥ 0 check and would give x = -∞ (NaN everywhere) if not folded into +0
    for (const idx of [0, 1]) {
      expect(free_energy[idx]).toBe(zero_point_energy)
      expect(internal_energy[idx]).toBe(zero_point_energy)
      expect(entropy[idx]).toBe(0)
      expect(heat_capacity[idx]).toBe(0)
    }
    // x ≈ 2.4e5 at 1 mK: e^x overflows a double, the exp(−x) forms must not; at 1e-200 K
    // even x² overflows, so x·e^{−x} has to be formed before the second factor of x; at
    // denormal T, k_B T underflows and x = ∞ must still give frozen modes, not NaN
    for (const idx of [2, 3, 4, 5, 6]) {
      expect(free_energy[idx]).toBeCloseTo(zero_point_energy, 12)
      expect(internal_energy[idx]).toBeCloseTo(zero_point_energy, 12)
      expect(entropy[idx]).toBeLessThan(1e-100)
      expect(heat_capacity[idx]).toBeLessThan(1e-100)
    }
  })

  test.each([`cm^-1`, `meV`, `eV`, `Ha`] as const)(
    `a DOS given per %s integrates like the same DOS per THz`,
    (unit) => {
      const dos_thz = fixture.phonon_dos
      const factor = frequency_unit_per_thz(unit)
      const dos_unit: PhononDos = {
        ...dos_thz,
        frequencies: dos_thz.frequencies.map((freq) => freq * factor),
        densities: dos_thz.densities.map((density) => density / factor),
      }
      const from_thz = thermal_properties(dos_thz, [300, 1000])
      const from_unit = thermal_properties(dos_unit, [300, 1000], unit)
      // measured max relative gap over all quantities and units is 2e-15
      expect(rel(from_unit.zero_point_energy, from_thz.zero_point_energy)).toBeLessThan(1e-14)
      for (const key of QUANTITIES) {
        for (const [idx, val] of from_unit[key].entries()) {
          expect(rel(val, from_thz[key][idx])).toBeLessThan(1e-14)
        }
      }
    },
  )

  test(`an unsorted frequency grid integrates like the sorted one`, () => {
    const sorted = fixture.phonon_dos
    const order = sorted.frequencies.map((_, idx) => idx).toReversed()
    const reversed: PhononDos = {
      type: `phonon`,
      frequencies: order.map((idx) => sorted.frequencies[idx]),
      densities: order.map((idx) => sorted.densities[idx]),
    }
    const from_sorted = thermal_properties(sorted, [300])
    const from_reversed = thermal_properties(reversed, [300])
    expect(from_reversed.free_energy[0]).toBeCloseTo(from_sorted.free_energy[0], 12)
    expect(from_reversed.heat_capacity[0]).toBeCloseTo(from_sorted.heat_capacity[0], 12)
    expect(from_reversed.heat_capacity[0]).toBeGreaterThan(0)
  })

  test(`imaginary modes are dropped, not folded`, () => {
    const dos: PhononDos = {
      type: `phonon`,
      frequencies: [-2, -1, 0, 1, 2, 3],
      densities: [1, 1, 1, 1, 1, 1],
    }
    const positive_only: PhononDos = {
      type: `phonon`,
      frequencies: [1, 2, 3],
      densities: [1, 1, 1],
    }
    expect(thermal_properties(dos, [300])).toEqual(thermal_properties(positive_only, [300]))
  })

  test.each<[PhononDos, number[], RegExp]>([
    [
      { type: `phonon`, frequencies: [1, 2], densities: [1] },
      [300],
      /2 frequencies but 1 densities/,
    ],
    [
      { type: `phonon`, frequencies: [-2, -1], densities: [1, 1] },
      [300],
      /at least 2 positive frequencies.*got 0/,
    ],
    // a lone positive point has no trapezoid segment to integrate over
    [
      { type: `phonon`, frequencies: [-1, 0, 1], densities: [1, 1, 1] },
      [300],
      /at least 2 positive frequencies.*got 1/,
    ],
    [
      { type: `phonon`, frequencies: [1, Number.POSITIVE_INFINITY], densities: [1, 1] },
      [300],
      /frequencies must all be finite/,
    ],
    [
      { type: `phonon`, frequencies: [1, 2, 3], densities: [1, Number.NaN, 1] },
      [300],
      /densities must all be finite/,
    ],
    // a negative density would silently give negative S and C_v
    [{ type: `phonon`, frequencies: [1, 2, 3], densities: [1, -1e-9, 1] }, [300], /≥ 0/],
    [{ type: `phonon`, frequencies: [1, 2], densities: [1, 1] }, [-5], /≥ 0 K/],
    [{ type: `phonon`, frequencies: [1, 2], densities: [1, 1] }, [Number.NaN], /≥ 0 K/],
  ])(`rejects bad input %j %j`, (dos, temps, message) => {
    expect(() => thermal_properties(dos, temps)).toThrow(message)
  })
})

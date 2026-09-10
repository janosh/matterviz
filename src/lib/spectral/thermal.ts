// Harmonic-phonon thermodynamics from a phonon DOS: integrate the Bose–Einstein occupation
// of each mode over g(ω). Same recipe as phonopy / pymatgen's PhononDos: trapezoid over the
// DOS grid, positive frequencies only (imaginary modes are dropped, not folded), and the DOS
// normalization is taken as given (a DOS integrating to 3N gives per-cell quantities).
// Energies come out in eV, entropy and heat capacity in eV/K, per whatever the DOS is
// normalized to. EV_TO_KJ_PER_MOL converts to phonopy's kJ/mol and J/(K·mol).
import { BOLTZMANN_EV_PER_K } from '$lib/constants'
import type { FrequencyUnit } from './frequency-units'
import { convert_frequencies } from './frequency-units'
import type { PhononDos } from './types'

export interface ThermalProperties {
  temperatures: number[] // K
  zero_point_energy: number // eV
  free_energy: number[] // Helmholtz F = U − TS, eV
  internal_energy: number[] // U including the zero-point energy, eV
  entropy: number[] // eV/K
  heat_capacity: number[] // C_v, eV/K
}

// Thermal properties at each temperature (K) from a phonon DOS whose frequencies are in `unit`
// (THz by default, as in phonopy / pymatgen dumps)
export function thermal_properties(
  dos: PhononDos,
  temperatures: readonly number[],
  unit: FrequencyUnit = `THz`,
): ThermalProperties {
  const { frequencies, densities } = dos
  if (frequencies.length !== densities.length) {
    throw new Error(
      `Phonon DOS has ${frequencies.length} frequencies but ${densities.length} densities`,
    )
  }
  if (!frequencies.every(Number.isFinite))
    throw new Error(`Phonon DOS frequencies must all be finite`)
  if (!densities.every((density) => Number.isFinite(density) && density >= 0)) {
    throw new Error(`Phonon DOS densities must all be finite and ≥ 0`)
  }
  if (!temperatures.every((temp) => Number.isFinite(temp) && temp >= 0)) {
    throw new Error(
      `Temperatures must be finite and ≥ 0 K, got ${JSON.stringify(temperatures)}`,
    )
  }
  // The DOS is a density per `unit` of frequency, so integrate over the original grid (sorted,
  // positive frequencies only) and only convert the mode energies ħω to eV. Dropping the
  // non-positive points also drops the grid segment between the last of them and the first
  // positive frequency, as pymatgen's PhononDos does; the integrands vanish at ω → 0 anyway.
  const order = frequencies
    .map((_, idx) => idx)
    .filter((idx) => frequencies[idx] > 0)
    .toSorted((idx_a, idx_b) => frequencies[idx_a] - frequencies[idx_b])
  if (order.length < 2) {
    throw new Error(
      `Phonon DOS needs at least 2 positive frequencies to integrate over, got ${order.length}`,
    )
  }
  const grid = order.map((idx) => frequencies[idx])
  const mode_energies = convert_frequencies(grid, `eV`, unit)
  // trapezoid weights folded with the density, so every integral is one weighted sum
  const last = grid.length - 1
  const weights = order.map((idx, pos) => {
    const segment = grid[Math.min(pos + 1, last)] - grid[Math.max(pos - 1, 0)]
    return (densities[idx] * segment) / 2
  })
  const zero_point_energy = weights.reduce(
    (total, weight, idx) => total + weight * (mode_energies[idx] / 2),
    0,
  )
  const [free_energy, internal_energy, entropy, heat_capacity]: number[][] = [[], [], [], []]
  for (const temp of temperatures) {
    // 0 K gives x = ∞ for every mode: the ground state. `|| 0` turns a -0 (which passes the
    // ≥ 0 check) into +0, since x = -∞ would make every mode function NaN
    const thermal_energy = BOLTZMANN_EV_PER_K * temp || 0
    let entropy_sum = 0
    let log_sum = 0
    let heat_capacity_sum = 0
    // Share exp/expm1/log across all three integrals without storing a per-temperature grid.
    // exp(−x) avoids low-T overflow; expm1 keeps 1 − exp(−x) accurate at high T.
    for (let idx = 0; idx < weights.length; idx++) {
      const mode_x = mode_energies[idx] / thermal_energy
      const exp_neg = Math.exp(-mode_x)
      const one_minus_exp_neg = -Math.expm1(-mode_x)
      const log_occupation = Math.log(one_minus_exp_neg)
      const ratio = mode_x / one_minus_exp_neg
      // At T = 0 (or underflowed k_B T), x = ∞ is a frozen mode. For finite x,
      // multiply by exp(−x) before the second x factor, whose square may overflow.
      const mode_entropy =
        mode_x === Infinity ? 0 : (mode_x * exp_neg) / one_minus_exp_neg - log_occupation
      const mode_heat_capacity = mode_x === Infinity ? 0 : ratio * exp_neg * ratio
      entropy_sum += weights[idx] * mode_entropy
      log_sum += weights[idx] * log_occupation
      heat_capacity_sum += weights[idx] * mode_heat_capacity
    }
    const s_val = BOLTZMANN_EV_PER_K * entropy_sum
    // F = ZPE + k_B T ∫ g ln(1 − e^{−x}); U follows as F + TS
    const f_val = zero_point_energy + thermal_energy * log_sum
    free_energy.push(f_val)
    internal_energy.push(f_val + temp * s_val)
    entropy.push(s_val)
    heat_capacity.push(BOLTZMANN_EV_PER_K * heat_capacity_sum)
  }
  return {
    temperatures: [...temperatures],
    zero_point_energy,
    free_energy,
    internal_energy,
    entropy,
    heat_capacity,
  }
}

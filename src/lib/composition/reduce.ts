// Formula reduction with no element-data dependency, so the chempot worker bundle can share
// it with the composition module.
import type { CompositionType } from '$lib/composition'
import { gcd_all } from '$lib/math'

// Largest denominator resolved when rationalising fractional amounts (pymatgen's
// get_integer_formula_and_factor default): ratios finer than 1/10000 are left fractional
export const MAX_FORMULA_DENOMINATOR = 10_000

// Total number of atoms
export const count_atoms_in_composition = (composition: CompositionType): number =>
  Object.values(composition).reduce((sum, count) => sum + count, 0)

// Smallest whole-number formula with the same ratios: Fe2O4 -> FeO2, Li0.5Na0.5Cl -> LiNaCl2,
// Fe0.01O0.99 -> FeO99. Amounts are divided by their float gcd (resolved to
// 1/MAX_FORMULA_DENOMINATOR), rounded and reduced by their integer gcd. The result must
// reproduce every atomic fraction of the input to within that resolution and give every
// element at least one atom; otherwise the composition is returned unchanged.
export const get_reduced_formula = (composition: CompositionType): CompositionType => {
  const entries = Object.entries(composition).filter(([, amt]) => amt > 0) as [
    keyof CompositionType,
    number,
  ][]
  if (entries.length === 0) return {}
  const amounts = entries.map(([, amt]) => amt)
  const tol = 1 / MAX_FORMULA_DENOMINATOR
  // Euclid's float gcd stops below `tol`: resolves dilute ratios (0.01/0.99 -> 0.01)
  // while tolerating rounded inputs (0.3333/0.6667 -> 0.3333), like pymatgen's gcd_float.
  const unit = amounts.reduce((val_a, val_b) => {
    while (Math.abs(val_b) > tol) [val_a, val_b] = [val_b, val_a % val_b]
    return val_a
  })
  const int_amounts = amounts.map((amt) => Math.round(amt / unit))
  // gcd is unreliable past 2^53, where consecutive integers stop being distinguishable
  if (!int_amounts.every((val) => val >= 1 && Number.isSafeInteger(val))) return composition
  const total = amounts.reduce((sum, amt) => sum + amt, 0)
  const int_total = int_amounts.reduce((sum, amt) => sum + amt, 0)
  if (!amounts.every((amt, idx) => Math.abs(amt / total - int_amounts[idx] / int_total) < tol))
    return composition
  const divisor = gcd_all(int_amounts)
  return Object.fromEntries(entries.map(([elem], idx) => [elem, int_amounts[idx] / divisor]))
}

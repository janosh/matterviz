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
// Fe0.01O0.99 -> FeO99. Normalize to atomic fractions before resolving the float gcd to
// 1/MAX_FORMULA_DENOMINATOR, then round and reduce by the integer gcd. The result must
// reproduce every atomic fraction of the input to within that resolution and give every
// element at least one atom; otherwise the composition is returned unchanged.
export const get_reduced_formula = (composition: CompositionType): CompositionType => {
  const entries = Object.entries(composition).filter(([, amt]) => amt > 0) as [
    keyof CompositionType,
    number,
  ][]
  if (entries.length === 0) return {}
  // Scale before summing so finite amounts cannot overflow the normalization total.
  const max_amount = Math.max(...entries.map(([, amt]) => amt))
  const scaled_amounts = entries.map(([, amt]) => amt / max_amount)
  const scaled_total = scaled_amounts.reduce((sum, amt) => sum + amt, 0)
  const amounts = scaled_amounts.map((amt) => amt / scaled_total)
  const tol = 1 / MAX_FORMULA_DENOMINATOR
  // Each fraction uses two divisions and an n-term sum. Keep that arithmetic error
  // separate from the 1e-4 chemical resolution when a remainder lies on its boundary.
  const arithmetic_tol = 4 * Number.EPSILON * amounts.length
  if (amounts.some((amt) => amt < tol - arithmetic_tol)) return composition
  // Apply the resolution to ratios, not absolute counts, so rescaling the input cannot
  // skip Euclid's divisions or chase insignificant remainders in very large amounts.
  const unit = amounts.reduce((val_a, val_b) => {
    if (val_a < val_b) [val_a, val_b] = [val_b, val_a]
    while (val_b > 0) {
      const remainder = val_a % val_b
      if (remainder <= tol + arithmetic_tol) return val_b
      ;[val_a, val_b] = [val_b, remainder]
    }
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

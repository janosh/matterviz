// Worker-safe entry stability predicates shared by hull thermodynamics and UI helpers.
import type { PhaseData } from './types'

export const HULL_STABILITY_TOL = 1e-6

export function compute_hull_stability(
  raw_distance: number | null | undefined,
  exclude_from_hull?: boolean,
  tol: number = HULL_STABILITY_TOL,
): { e_above_hull: number | undefined; is_stable: boolean | undefined } {
  if (raw_distance == null || !Number.isFinite(raw_distance)) {
    return { e_above_hull: undefined, is_stable: undefined }
  }
  if (exclude_from_hull) return { e_above_hull: raw_distance, is_stable: false }
  const e_above_hull = Math.abs(raw_distance) < tol ? 0 : Math.max(0, raw_distance)
  return { e_above_hull, is_stable: e_above_hull <= tol }
}

type StabilityEntry = { is_stable?: boolean; e_above_hull?: number }

export const entry_is_stable = (
  entry: StabilityEntry,
  tol: number = HULL_STABILITY_TOL,
): boolean =>
  entry.is_stable === true ||
  (entry.is_stable !== false && Math.abs(entry.e_above_hull ?? Infinity) <= tol)

export const is_on_hull = (entry: PhaseData, tol: number = HULL_STABILITY_TOL): boolean =>
  !entry.exclude_from_hull && entry_is_stable(entry, tol)

export const get_arity = (entry: PhaseData): number =>
  Object.values(entry.composition).filter((count) => count > 0).length

export const is_unary_entry = (entry: PhaseData): boolean => get_arity(entry) === 1

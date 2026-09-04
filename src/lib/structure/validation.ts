import { det_3x3, EPS } from '$lib/math'
import { is_plain_object } from '$lib/utils'
import type { Crystal } from './index'

// Raw formats can carry the lattice itself as a 3x3 array.
const has_lattice = (
  obj: unknown,
): obj is Record<string, unknown> & { lattice: Crystal[`lattice`] } =>
  is_plain_object(obj) && obj.lattice !== null && typeof obj.lattice === `object`

export const is_crystal = (obj: unknown): obj is Crystal =>
  has_lattice(obj) && Array.isArray(obj.sites) && obj.sites.length > 0

// At least one periodic axis. An aperiodic box can still be tiled (is_crystal), but has
// no image atoms or primitive/conventional reduction. Missing pbc matches make_lattice.
export function is_periodic(obj: unknown): obj is Crystal {
  if (!is_crystal(obj)) return false
  const { pbc } = obj.lattice
  return !Array.isArray(pbc) || pbc.some(Boolean)
}

// Raw-format lattice presence (is_crystal) is intentionally looser than usable geometry.
export function has_lattice_matrix(obj: unknown): obj is Crystal {
  if (!has_lattice(obj) || !Array.isArray(obj.sites)) return false
  const { matrix } = obj.lattice
  return (
    Array.isArray(matrix) &&
    matrix.length === 3 &&
    [...matrix].every(
      (row) => Array.isArray(row) && row.length === 3 && [...row].every(Number.isFinite),
    )
  )
}

export function has_usable_lattice(obj: unknown): obj is Crystal {
  if (!has_lattice_matrix(obj)) return false
  const { matrix } = obj.lattice
  const volume = Math.abs(det_3x3(matrix))
  // Match the scale-invariant singularity threshold used by cartesian/fractional conversion.
  return (
    Number.isFinite(volume) &&
    volume > EPS * matrix.reduce((product, row) => product * Math.hypot(...row), 1)
  )
}

export function lattice_unavailable_reason(
  obj: unknown,
  require_volume = false,
): string | undefined {
  if (!has_lattice(obj)) return `A unit cell is required; this structure has no lattice`
  if (!has_lattice_matrix(obj)) return `A unit cell requires a finite 3x3 lattice matrix`
  if (require_volume && !has_usable_lattice(obj))
    return `A nonsingular unit cell with finite volume is required`
  return undefined
}

import { is_plain_object } from '$lib/utils'
import type { Crystal } from './index'

export function is_crystal(obj: unknown): obj is Crystal {
  if (!is_plain_object(obj)) return false
  const has_sites = Array.isArray(obj.sites) && obj.sites.length > 0
  // lattice may be an object or (in some raw formats) a 3x3 array, so only reject nullish
  const has_lattice =
    obj.lattice !== undefined && obj.lattice !== null && typeof obj.lattice === `object`
  return has_sites && has_lattice
}

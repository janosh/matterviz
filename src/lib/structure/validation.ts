import type { Crystal } from './index'

export function is_crystal(obj: unknown): obj is Crystal {
  if (obj === null || typeof obj !== `object`) return false
  const structure_obj = obj as { sites?: unknown; lattice?: unknown }
  const sites = structure_obj.sites
  const lattice = structure_obj.lattice
  const has_sites = Array.isArray(sites) && sites.length > 0
  const has_lattice = lattice !== undefined && lattice !== null &&
    typeof lattice === `object`
  return has_sites && has_lattice
}

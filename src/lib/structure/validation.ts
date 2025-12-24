import type { Crystal } from './index'

export function is_crystal(obj: unknown): obj is Crystal {
  if (obj === null || typeof obj !== `object`) return false
  const input = obj as Record<string, unknown>
  const has_sites = Array.isArray(input.sites) && input.sites.length > 0
  const has_lattice = Boolean(input.lattice) && typeof input.lattice === `object`
  return has_sites && has_lattice
}

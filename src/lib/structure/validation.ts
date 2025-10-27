import type { PymatgenStructure } from './index'

export function is_valid_structure(obj: unknown): obj is PymatgenStructure {
  return (
    typeof obj === `object` &&
    obj !== null &&
    `lattice` in obj &&
    `sites` in obj
  )
}

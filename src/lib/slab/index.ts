// Miller-index surface/slab construction: cut a bulk Crystal along (hkl), pick a
// termination, add vacuum. The internals (basis transforms, layer detection, lattice
// translation search) are importable from their own modules but deliberately not
// re-exported, since `$lib` flattens this namespace into the package root.
export { default as SlabBuilder } from './SlabBuilder.svelte'
export { interplanar_spacing, make_oriented_bulk } from './lattice-basis'
export type { OrientedBulkOptions } from './lattice-basis'
export { make_slab } from './make-slab'
export { enumerate_terminations } from './terminations'
export type { SlabTerminationOptions } from './terminations'
export * from './types'

// Heterointerface construction: Zur–McGill coincidence-lattice matching of two surface slabs
// and stacking of the chosen match into one Crystal. The 2×2 matrix helpers stay internal to
// their modules, since `#lib` flattens this namespace into the package root.
export { default as InterfaceBuilder } from './InterfaceBuilder.svelte'
export {
  match_lattices,
  match_of_matrices,
  match_strain,
  surface_frame,
  unit_cell_match,
} from './lattice-match'
export { in_plane_supercell, make_interface } from './stack'
export * from './types'

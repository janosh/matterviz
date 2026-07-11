import type { DefaultSettings } from '$lib/settings'

export const build_structure_props_from_settings = (defaults: DefaultSettings) => {
  const { structure } = defaults
  return {
    scene_props: { ...structure, gizmo: structure.show_gizmo },
    lattice_props: {
      cell_edge_opacity: structure.cell_edge_opacity,
      cell_surface_opacity: structure.cell_surface_opacity,
      cell_edge_color: structure.cell_edge_color,
      cell_surface_color: structure.cell_surface_color,
      cell_edge_width: structure.cell_edge_width,
      show_cell_vectors: structure.show_cell_vectors,
    },
    color_scheme: defaults.color_scheme,
    background_color: defaults.background_color,
    background_opacity: defaults.background_opacity,
    show_image_atoms: structure.show_image_atoms,
  }
}

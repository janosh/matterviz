import type { DefaultSettings } from '$lib/settings'

type StructurePropGetter = (key: string) => unknown

const WIDGET_SCENE_PROP_KEYS = [
  `atom_radius`,
  `show_atoms`,
  `same_size_atoms`,
  `show_bonds`,
  `bond_thickness`,
  `bond_color`,
  `bonding_strategy`,
  `vector_configs`,
  `vector_scale`,
  `vector_color`,
  `vector_normalize`,
  `vector_uniform_thickness`,
  `vector_origin_gap`,
  `show_site_labels`,
  `show_site_indices`,
] as const

export const STRUCTURE_SCENE_PROP_KEYS = [
  ...WIDGET_SCENE_PROP_KEYS,
  `auto_rotate`,
  `show_gizmo`,
] as const

export const STRUCTURE_LATTICE_PROP_KEYS = [
  `cell_edge_opacity`,
  `cell_surface_opacity`,
  `cell_edge_color`,
  `cell_surface_color`,
  `cell_edge_width`,
  `show_cell_vectors`,
] as const

export const STRUCTURE_TOP_LEVEL_PROP_KEYS = [
  `show_image_atoms`,
  `color_scheme`,
  `background_color`,
  `background_opacity`,
] as const

const pick_structure_props = (
  get_prop: StructurePropGetter,
  keys: readonly string[],
): Record<string, unknown> => Object.fromEntries(keys.map((key) => [key, get_prop(key)]))

export const build_widget_scene_props = (
  get_prop: StructurePropGetter,
): Record<string, unknown> => ({
  ...pick_structure_props(get_prop, WIDGET_SCENE_PROP_KEYS),
  auto_rotate: get_prop(`auto_rotate`) ?? 0.2,
  gizmo: get_prop(`show_gizmo`) ?? true,
})

export const build_widget_structure_props = (
  get_prop: StructurePropGetter,
): Record<string, unknown> => ({
  scene_props: build_widget_scene_props(get_prop),
  lattice_props: pick_structure_props(get_prop, STRUCTURE_LATTICE_PROP_KEYS),
  ...pick_structure_props(get_prop, STRUCTURE_TOP_LEVEL_PROP_KEYS),
  fullscreen_toggle: false,
})

export const build_structure_props_from_settings = (defaults: DefaultSettings) => {
  const { structure } = defaults
  return {
    scene_props: { ...structure, gizmo: structure.show_gizmo },
    lattice_props: Object.fromEntries(
      STRUCTURE_LATTICE_PROP_KEYS.map((key) => [key, structure[key]]),
    ) as Pick<DefaultSettings[`structure`], (typeof STRUCTURE_LATTICE_PROP_KEYS)[number]>,
    color_scheme: defaults.color_scheme,
    background_color: defaults.background_color,
    background_opacity: defaults.background_opacity,
    show_image_atoms: structure.show_image_atoms,
  }
}

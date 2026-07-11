import { DEFAULTS } from '$lib/settings'
import {
  build_structure_props_from_settings,
  build_widget_structure_props,
  STRUCTURE_LATTICE_PROP_KEYS,
} from '$lib/structure/prop-groups'
import { expect, test } from 'vitest'

test(`settings builder keeps wide scene settings and all lattice props`, () => {
  const props = build_structure_props_from_settings(DEFAULTS)

  expect(props.scene_props).toMatchObject(DEFAULTS.structure)
  expect(props.scene_props.gizmo).toBe(DEFAULTS.structure.show_gizmo)
  expect(Object.keys(props.lattice_props)).toEqual(STRUCTURE_LATTICE_PROP_KEYS)
  expect(props.lattice_props.cell_edge_width).toBe(DEFAULTS.structure.cell_edge_width)
  expect(props).not.toHaveProperty(`fullscreen_toggle`)
})

test(`widget builder preserves curated defaults, aliases, and missing values`, () => {
  const values = new Map<string, unknown>([
    [`show_gizmo`, false],
    [`show_atoms`, false],
    [`color_scheme`, `Jmol`],
  ])
  const props = build_widget_structure_props((key) => values.get(key))

  expect(props).toMatchObject({
    fullscreen_toggle: false,
    color_scheme: `Jmol`,
    scene_props: { auto_rotate: 0.2, gizmo: false, show_atoms: false },
  })
  expect(props.scene_props).toHaveProperty(`atom_radius`, undefined)
  expect(props.scene_props).not.toHaveProperty(`cell_edge_opacity`)
  expect(props.lattice_props).toHaveProperty(`cell_edge_width`, undefined)
})

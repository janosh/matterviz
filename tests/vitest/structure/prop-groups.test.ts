import { DEFAULTS } from '$lib/settings'
import { build_structure_props_from_settings } from '$lib/structure/prop-groups'
import { expect, test } from 'vitest'

test(`settings builder groups structure props`, () => {
  const props = build_structure_props_from_settings(DEFAULTS)

  expect(props.scene_props).toMatchObject(DEFAULTS.structure)
  expect(props.scene_props.gizmo).toBe(DEFAULTS.structure.show_gizmo)
  expect(props.lattice_props.cell_edge_width).toBe(DEFAULTS.structure.cell_edge_width)
})

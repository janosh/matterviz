import type { Site } from '#lib/structure/index.js'
import { has_site_data, property_column } from '#lib/structure/site-table.js'
import { expect, test } from 'vitest'

const site = (properties: Record<string, unknown>): Site => ({
  species: [{ element: `Fe`, occu: 1, oxidation_state: 0 }],
  abc: [0, 0, 0],
  xyz: [0, 0, 0],
  label: `Fe`,
  properties,
})

// Numbers worth a table beside the 3D view, but not flags or tags alone
test.each([
  [`a predicted force`, { force: [0.1, 0, 0] }, true],
  [`a magnetic moment`, { magmom: 2.1 }, true],
  [`selective dynamics only`, { selective_dynamics: [true, true, false] }, false],
  [`a text tag only`, { cluster_tag: `surface` }, false],
  [`a non-finite number only`, { charge: Number.NaN }, false],
  [`no properties`, {}, false],
])(`%s has site data: %s`, (_label, properties, expected) => {
  expect(has_site_data([site(properties)])).toBe(expected)
})

// Column labels read units from own config entries only: `constructor` once got
// "constructor (function Object() { [native code] })"
test.each([
  [`force`, undefined, `force (eV/Å)`],
  [`force`, `norm`, `|force| (eV/Å)`],
  [`constructor`, undefined, `constructor`],
  [`toString`, `x`, `toString x`],
])(`property_column(%s, %s) is labeled %s`, (prop_name, axis, label) => {
  expect(property_column(prop_name, axis).label).toBe(label)
})

import type { Site } from '#lib/structure/index.js'
import { has_site_data } from '#lib/structure/site-table.js'
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

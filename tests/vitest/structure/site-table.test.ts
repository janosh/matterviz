import {
  has_site_data,
  property_column,
  site_columns,
  site_property_specs,
} from '#lib/structure/site-table.js'
import SiteTable from '#lib/structure/SiteTable.svelte'
import { make_site } from '#lib/structure/site.js'
import { flushSync, mount, unmount } from 'svelte'
import { expect, onTestFinished, test } from 'vite-plus/test'

const site = (properties: Record<string, unknown>) =>
  make_site(`Fe`, [0, 0, 0], [0, 0, 0], `Fe`, properties)

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
// Å columns get fixed decimals (sub-1e-4 Å noise reads 0), others the table default
test.each([
  [`force`, undefined, `force (eV/Å)`, `site property force in eV/Å`, undefined],
  [`force`, `norm`, `|force| (eV/Å)`, `Magnitude of site property force in eV/Å`, undefined],
  // a symbol (Δ) heads displacement columns; the tooltip spells the property out
  [`displacement`, `x`, `Δx (Å)`, `x component of site property displacement in Å`, `.4~f`],
  [`displacement`, `norm`, `|Δr| (Å)`, `Magnitude of site property displacement in Å`, `.4~f`],
  [`constructor`, undefined, `constructor`, `site property constructor`, undefined],
  [`toString`, `x`, `toString x`, `x component of site property toString`, undefined],
])(`property_column(%s, %s) is labeled %s`, (prop_name, axis, label, description, format) => {
  const column = property_column(prop_name, axis)
  expect(column).toMatchObject({ label, description })
  expect(column.format).toBe(format)
})

// every header explains itself in a tooltip (DataTable renders `description` as one)
test(`site_columns describe every column`, () => {
  const specs = site_property_specs([site({ force: [0.1, 0, 0], charge: 0.3 })])
  const columns = site_columns(specs)
  expect(columns).toHaveLength(2 + 3 + 3 + 4 + 1)
  for (const { id, description } of columns) expect(description, id).toMatch(/\w{4}/)
})

// Cells show the sidebar's 4 significant digits; DataTable's delegated tooltip gives the full
// value of a rounded one (SiteTable once rendered its own copy of that logic)
test(`SiteTable cells round to 4 digits and keep the full value on hover`, () => {
  const table = mount(SiteTable, {
    target: document.body,
    props: { sites: [site({ magmom: 2.123456 }), site({ magmom: 0.5 })] },
  })
  onTestFinished(() => unmount(table))
  flushSync()
  const cells = [...document.querySelectorAll(`td`)].filter(({ textContent }) =>
    [`2.123`, `0.5`].includes(textContent?.trim() ?? ``),
  )
  expect(cells.map(({ textContent }) => textContent?.trim())).toEqual([`2.123`, `0.5`])
  expect(
    cells.map((cell) => cell.querySelector(`[data-title]`)?.getAttribute(`data-title`)),
  ).toEqual([`2.123456`, undefined])
})

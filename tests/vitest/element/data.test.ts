// Element data structure plus physicality checks that properties follow periodic trends
import type { ElementSymbol } from '#lib/element/index.js'
import { element_data } from '#lib/element/index.js'
import { element_by_symbol } from '#lib/element/data.js'
import { element_groups } from '#lib/element/groups.js'
import { element_from_lammps_type } from '#lib/element/helpers.js'
import { describe, expect, test } from 'vitest'
import { CATEGORY_COUNTS as expected_counts } from '../test-fixtures'

const get_element = (symbol: ElementSymbol) => {
  const element = element_by_symbol.get(symbol)
  if (!element) throw new Error(`Element ${symbol} not found`)
  return element
}

// Known atomic mass anomalies (element with lower Z has higher mass)
const ATOMIC_MASS_INVERSIONS = [
  [`Ar`, `K`],
  [`Co`, `Ni`],
  [`Te`, `I`],
  [`Th`, `Pa`],
  [`U`, `Np`],
  [`Pu`, `Am`],
  [`Bh`, `Hs`],
] as const
const EQUAL_MASS_PAIRS = [
  [`Cm`, `Bk`],
  [`Fl`, `Mc`],
  [`Ts`, `Og`],
] as const

test(`element data basics`, () => {
  expect(element_data).toHaveLength(118)
  expect(element_data[0].name).toBe(`Hydrogen`)
  expect(element_data[0].category).toBe(`diatomic nonmetal`)
  expect(element_data[0].number).toBe(1)
  expect(element_data[0].atomic_mass).toBe(1.008)
  expect(element_data[0].electronegativity).toBe(2.2)
  expect(element_data[0].electron_configuration).toBe(`1s1`)
  expect(element_data[111].name).toBe(`Copernicium`)
  expect(element_data[111].summary).not.toMatch(/copernicum/i)
  expect(element_data.every((element) => typeof element.density === `number`)).toBe(true)
  expect(element_by_symbol.size).toBe(element_data.length)
  for (const element of element_data)
    expect(element_by_symbol.get(element.symbol)).toBe(element)
})

test(`category counts`, () => {
  const counts: Record<string, number> = {}
  for (const { category } of element_data) {
    counts[category] = (counts[category] ?? 0) + 1
  }
  expect(counts).toEqual(expected_counts)
})

const n_nonmetals =
  expected_counts[`diatomic nonmetal`] + expected_counts[`polyatomic nonmetal`]
test.each([
  [`all`, 118, `Og`],
  [`transition`, expected_counts[`transition metal`], `Fe`],
  [`nonmetal`, n_nonmetals, `C`],
  [`halogen`, 6, `Ts`],
] as const)(`element group %s holds %i elements including %s`, (key, count, member) => {
  const group = element_groups.find(({ value }) => value === key)
  const members = element_data.filter((element) => group?.includes(element))
  expect(members).toHaveLength(count)
  expect(members.map(({ symbol }) => symbol)).toContain(member)
})

type TrendProp = `atomic_radius` | `covalent_radius` | `electronegativity` | `first_ionization`
const chain = (symbols: ElementSymbol[]): [ElementSymbol, ElementSymbol][] =>
  symbols.slice(1).map((next, idx) => [symbols[idx], next])
const above_h = (symbols: ElementSymbol[]): [ElementSymbol, ElementSymbol][] =>
  symbols.map((symbol) => [symbol, `H`])
const pairs = (
  prop: TrendProp,
  list: [ElementSymbol, ElementSymbol][],
  strict = true,
): [TrendProp, ElementSymbol, `>` | `>=`, ElementSymbol][] =>
  list.map(([larger, smaller]) => [prop, larger, strict ? `>` : `>=`, smaller])

// Each pair asserts the first element's value exceeds the second's
const TREND_PAIRS = [
  // Every common element is larger than H (catches H having a larger radius than O)
  ...pairs(
    `atomic_radius`,
    above_h([`O`, `N`, `C`, `B`, `Be`, `Li`, `S`, `P`, `Si`, `Cl`, `F`]),
  ),
  // down-group trends for halogens, chalcogens, alkali, alkaline earth, pnictogens
  ...pairs(`atomic_radius`, chain([`I`, `Br`, `Cl`, `F`])),
  ...pairs(`atomic_radius`, chain([`Te`, `Se`, `S`, `O`])),
  ...pairs(`atomic_radius`, chain([`Cs`, `Rb`, `K`, `Na`, `Li`])),
  ...pairs(`atomic_radius`, chain([`Ba`, `Sr`, `Ca`, `Mg`, `Be`])),
  ...pairs(`atomic_radius`, chain([`Bi`, `Sb`, `As`, `P`, `N`])),
  // across periods 2 and 3 (Si/P/S/Cl tie in this dataset)
  ...pairs(`atomic_radius`, chain([`Li`, `Be`, `B`, `C`, `N`, `O`, `F`])),
  ...pairs(`atomic_radius`, chain([`Na`, `Mg`, `Al`, `Si`])),
  ...pairs(`atomic_radius`, chain([`Si`, `P`, `S`, `Cl`]), false),
  ...pairs(`covalent_radius`, above_h([`O`, `N`, `C`])),
  ...pairs(`covalent_radius`, chain([`I`, `Br`, `Cl`, `F`])),
  ...pairs(`covalent_radius`, chain([`Te`, `Se`, `S`, `O`])),
  ...pairs(`covalent_radius`, chain([`Cs`, `Rb`, `K`, `Na`, `Li`])),
  ...pairs(`electronegativity`, chain([`F`, `O`, `Cl`, `N`, `Br`, `S`, `C`, `H`])),
  // K == Rb in this dataset, so Rb is skipped
  ...pairs(`electronegativity`, chain([`Li`, `Na`, `K`, `Cs`]), false),
  ...pairs(`first_ionization`, chain([`He`, `Ne`, `Ar`, `Kr`, `Xe`])),
  ...pairs(`first_ionization`, chain([`Li`, `Na`, `K`, `Rb`, `Cs`])),
  // noble gases > adjacent alkali metals
  ...pairs(`first_ionization`, [
    [`He`, `Li`],
    [`Ne`, `Na`],
    [`Ar`, `K`],
    [`Kr`, `Rb`],
    [`Xe`, `Cs`],
  ]),
]

test.each(TREND_PAIRS)(`%s: %s %s %s`, (prop, larger, op, smaller) => {
  const [larger_val, smaller_val] = [get_element(larger)[prop], get_element(smaller)[prop]]
  if (larger_val === null || smaller_val === null)
    throw new Error(`${prop} missing for ${larger} or ${smaller}`)
  if (op === `>`) expect(larger_val).toBeGreaterThan(smaller_val)
  else expect(larger_val).toBeGreaterThanOrEqual(smaller_val)
})

test.each([
  [`atomic_radius`, 0.1, 3.0],
  [`covalent_radius`, 0.1, 2.6],
  [`electronegativity`, 0.7, 4.0],
  [`first_ionization`, 3, 25],
] as const)(`all non-null %s values lie in [%s, %s]`, (prop, min, max) => {
  for (const element of element_data) {
    const value = element[prop]
    if (value === null) continue
    expect(value, element.symbol).toBeGreaterThanOrEqual(min)
    expect(value, element.symbol).toBeLessThanOrEqual(max)
  }
})

test(`fluorine has highest electronegativity`, () => {
  const max = Math.max(
    ...element_data.map(({ electronegativity }) => electronegativity ?? -Infinity),
  )
  expect(get_element(`F`).electronegativity).toBe(max)
})

describe(`atomic_mass`, () => {
  const to_key = (elem_a: ElementSymbol, elem_b: ElementSymbol) => `${elem_a}-${elem_b}`
  const known_anomalies = new Set([
    ...ATOMIC_MASS_INVERSIONS.map(([elem_a, elem_b]) => to_key(elem_a, elem_b)),
    ...EQUAL_MASS_PAIRS.map(([elem_a, elem_b]) => to_key(elem_a, elem_b)),
  ])

  test(`anomalies match known set (detects data changes)`, () => {
    const found_anomalies: string[] = []
    for (let idx = 0; idx < element_data.length - 1; idx++) {
      const current = element_data[idx]
      const next = element_data[idx + 1]
      if (next.atomic_mass <= current.atomic_mass) {
        found_anomalies.push(to_key(current.symbol, next.symbol))
      }
    }
    expect(found_anomalies.toSorted()).toEqual([...known_anomalies].toSorted())
  })
})

describe(`data completeness`, () => {
  test(`all elements have valid structure`, () => {
    for (const [idx, element] of element_data.entries()) {
      expect(element.symbol, `element ${idx}`).toMatch(/^[A-Z][a-z]?$/)
      expect(element.name, element.symbol).not.toBe(``)
      expect(element.number, element.symbol).toBe(idx + 1)
      expect(element.period, element.symbol).toBeGreaterThanOrEqual(1)
      expect(element.period, element.symbol).toBeLessThanOrEqual(7)
      expect(element.column, element.symbol).toBeGreaterThanOrEqual(1)
      expect(element.column, element.symbol).toBeLessThanOrEqual(18)
    }
  })

  test(`main elements (Z <= 86) have required properties`, () => {
    for (const element of element_data.filter((entry) => entry.number <= 86)) {
      // All main elements need first_ionization
      expect(element.first_ionization, `${element.symbol} first_ionization`).not.toBeNull()

      // Noble gases lack electronegativity; only Ar has a reported atomic radius.
      if (element.category !== `noble gas`) {
        expect(element.electronegativity, `${element.symbol} electronegativity`).not.toBeNull()
      }
      if (element.category === `noble gas` && element.symbol !== `Ar`) continue
      if (element.symbol === `At` || element.symbol === `Fr`) continue
      expect(element.atomic_radius, `${element.symbol} atomic_radius`).not.toBeNull()
    }
  })
})

describe(`element_from_lammps_type`, () => {
  // LAMMPS types read as atomic numbers, wrapping past Og and clamping below 1 to H
  test.each([
    [1, `H`],
    [14, `Si`],
    [118, `Og`],
    [119, `H`],
    [120, `He`],
    [0, `H`],
    [-3, `H`],
  ])(`type %d -> %s`, (atom_type, expected) => {
    expect(element_from_lammps_type(atom_type)).toBe(expected)
  })
})

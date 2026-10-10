// Element data structure plus physicality checks that properties follow periodic trends
import type { ElementSymbol } from '#lib/element/index.js'
import { element_data } from '#lib/element/index.js'
import { element_by_symbol } from '#lib/element/data.js'
import { element_groups } from '#lib/element/groups.js'
import { element_from_lammps_type } from '#lib/element/helpers.js'
import { expect, test } from 'vitest'
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
  expect(element_data[0].atomic_mass).toBe(1.008)
  expect(element_data[0].electronegativity).toBe(2.2)
  expect(element_data[0].electron_configuration).toBe(`1s1`)
  expect(element_data[111].name).toBe(`Copernicium`)
  expect(element_data[111].summary).not.toMatch(/copernicum/i)
  expect(element_by_symbol.size).toBe(element_data.length)
  for (const [idx, element] of element_data.entries()) {
    const { symbol, period, column } = element
    expect(element_by_symbol.get(symbol)).toBe(element)
    expect(symbol, `element ${idx}`).toMatch(/^[A-Z][a-z]?$/)
    expect(element.name, symbol).not.toBe(``)
    expect(element.number, symbol).toBe(idx + 1)
    expect(typeof element.density, symbol).toBe(`number`)
    expect(period, symbol).toBeGreaterThanOrEqual(1)
    expect(period, symbol).toBeLessThanOrEqual(7)
    expect(column, symbol).toBeGreaterThanOrEqual(1)
    expect(column, symbol).toBeLessThanOrEqual(18)
  }
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

test(`atomic_mass anomalies match known set (detects data changes)`, () => {
  const known_anomalies = [...ATOMIC_MASS_INVERSIONS, ...EQUAL_MASS_PAIRS].map(
    ([elem_a, elem_b]) => `${elem_a}-${elem_b}`,
  )
  const found_anomalies = element_data
    .slice(1)
    .map((next, idx) => [element_data[idx], next] as const)
    .filter(([prev, next]) => next.atomic_mass <= prev.atomic_mass)
    .map(([prev, next]) => `${prev.symbol}-${next.symbol}`)
  expect(found_anomalies.toSorted()).toEqual(known_anomalies.toSorted())
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

// Arsenic sublimes at 887 K at 1 atm; its 1090 K melting point needs 28 atm (triple point)
test(`melting point is below boiling point wherever both are known (except subliming As)`, () => {
  const inverted = element_data
    .filter(({ melting_point: melt, boiling_point: boil }) => melt != null && boil != null)
    .filter(({ melting_point: melt, boiling_point: boil }) => Number(melt) >= Number(boil))
    .map(({ symbol }) => symbol)
  expect(inverted).toEqual([`As`])
})

// neutrons describe the isotope whose mass number is the listed atomic mass (rounded): Mt
// listed 278 u with 159 neutrons (Z + N = 268), Cf melted 750 K above its boiling point
test.each(element_data.map((element) => [element.symbol, element] as const))(
  `%s: protons, electrons and neutrons match Z and atomic mass`,
  (_symbol, { number, protons, electrons, neutrons, atomic_mass }) => {
    expect(protons).toBe(number)
    expect(electrons).toBe(number)
    expect(number + neutrons).toBe(Math.round(atomic_mass))
  },
)

test.each([
  [`La`, `[Xe] 5d1 6s2`, `5d1`, [2, 8, 18, 18, 9, 2]],
  [`Ds`, `*[Rn] 5f14 6d8 7s2`, `6d8`, [2, 8, 18, 32, 32, 16, 2]],
  [`Rg`, `*[Rn] 5f14 6d9 7s2`, `6d9`, [2, 8, 18, 32, 32, 17, 2]],
])(`%s electron configurations agree`, (symbol, semantic, full_end, shells) => {
  const element = get_element(symbol as ElementSymbol)
  expect(element.electron_configuration_semantic).toBe(semantic)
  expect(element.electron_configuration.endsWith(full_end)).toBe(true)
  expect(element.shells).toEqual(shells)
})

test(`semantic electron configurations separate every subshell with a space`, () => {
  const unspaced = element_data
    .filter(({ electron_configuration_semantic: config }) =>
      /\d[spdf]\d+(?=[1-7][spdf])/.test(config),
    )
    .map(({ symbol }) => symbol)
  expect(unspaced).toEqual([])
})

// LAMMPS types read as atomic numbers, wrapping past Og and clamping below 1 to H
test.each([
  [1, `H`],
  [14, `Si`],
  [118, `Og`],
  [119, `H`],
  [120, `He`],
  [0, `H`],
  [-3, `H`],
])(`element_from_lammps_type(%d) -> %s`, (atom_type, expected) => {
  expect(element_from_lammps_type(atom_type)).toBe(expected)
})

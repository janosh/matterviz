// Tests for element data including basic structure and physicality checks.
// Physicality tests validate that physical properties follow expected periodic trends.
// Would have caught the bug where H had larger atomic_radius than O.

import type { ElementSymbol } from '$lib/element'
import { element_data } from '$lib/element'
import { CATEGORY_COUNTS as expected_counts } from '$lib/labels'
import { describe, expect, test } from 'vitest'

// Precomputed lookup map for O(1) element access
const elements_by_symbol = new Map(element_data.map((el) => [el.symbol, el]))
const get_element = (symbol: ElementSymbol) => {
  const element = elements_by_symbol.get(symbol)
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
const EQUAL_MASS_PAIRS = [[`Cm`, `Bk`], [`Fl`, `Mc`], [`Ts`, `Og`]] as const

test(`element data basics`, () => {
  expect(element_data.length).toBe(118)
  expect(element_data[0].name).toBe(`Hydrogen`)
  expect(element_data[0].category).toBe(`diatomic nonmetal`)
  expect(element_data[0].number).toBe(1)
  expect(element_data[0].atomic_mass).toBe(1.008)
  expect(element_data[0].electronegativity).toBe(2.2)
  expect(element_data[0].electron_configuration).toBe(`1s1`)
  expect(element_data.every((el) => typeof el.density === `number`)).toBe(true)
})

test(`category counts`, () => {
  const counts: Record<string, number> = {}
  for (const { category } of element_data) {
    counts[category] = (counts[category] ?? 0) + 1
  }
  expect(counts).toEqual(expected_counts)
})

describe(`atomic_radius`, () => {
  // Pairs where first element should have LARGER atomic_radius than second
  const LARGER_THAN_PAIRS = [
    // All common elements > H (would catch original bug)
    [`O`, `H`],
    [`N`, `H`],
    [`C`, `H`],
    [`B`, `H`],
    [`Be`, `H`],
    [`Li`, `H`],
    [`S`, `H`],
    [`P`, `H`],
    [`Si`, `H`],
    [`Cl`, `H`],
    [`F`, `H`],
    // Halogens: I > Br > Cl > F
    [`I`, `Br`],
    [`Br`, `Cl`],
    [`Cl`, `F`],
    // Chalcogens: Te > Se > S > O
    [`Te`, `Se`],
    [`Se`, `S`],
    [`S`, `O`],
    // Alkali metals: Cs > Rb > K > Na > Li
    [`Cs`, `Rb`],
    [`Rb`, `K`],
    [`K`, `Na`],
    [`Na`, `Li`],
    // Alkaline earth metals: Ba > Sr > Ca > Mg > Be
    [`Ba`, `Sr`],
    [`Sr`, `Ca`],
    [`Ca`, `Mg`],
    [`Mg`, `Be`],
    // Pnictogens: Bi > Sb > As > P > N
    [`Bi`, `Sb`],
    [`Sb`, `As`],
    [`As`, `P`],
    [`P`, `N`],
  ] as const

  test.each(LARGER_THAN_PAIRS)(`%s > %s`, (larger, smaller) => {
    const larger_el = get_element(larger)
    const smaller_el = get_element(smaller)
    expect(larger_el.atomic_radius).not.toBeNull()
    expect(smaller_el.atomic_radius).not.toBeNull()
    expect(larger_el.atomic_radius).toBeGreaterThan(smaller_el.atomic_radius as number)
  })

  test(`period 2: Li > Be > B > C > N > O > F`, () => {
    const order = [`Li`, `Be`, `B`, `C`, `N`, `O`, `F`] as const
    for (let idx = 0; idx < order.length - 1; idx++) {
      const larger = get_element(order[idx])
      const smaller = get_element(order[idx + 1])
      expect(larger.atomic_radius, `${larger.symbol} atomic_radius`).not.toBeNull()
      expect(smaller.atomic_radius, `${smaller.symbol} atomic_radius`).not.toBeNull()
      expect(larger.atomic_radius).toBeGreaterThan(smaller.atomic_radius as number)
    }
  })

  test(`period 3: Na > Mg > Al > Si >= P >= S > Cl`, () => {
    const order = [`Na`, `Mg`, `Al`, `Si`, `P`, `S`, `Cl`] as const
    for (let idx = 0; idx < order.length - 1; idx++) {
      const larger = get_element(order[idx])
      const smaller = get_element(order[idx + 1])
      expect(larger.atomic_radius, `${larger.symbol} atomic_radius`).not.toBeNull()
      expect(smaller.atomic_radius, `${smaller.symbol} atomic_radius`).not.toBeNull()
      expect(larger.atomic_radius).toBeGreaterThanOrEqual(smaller.atomic_radius as number)
    }
  })

  test(`group 1: Li < Na < K < Rb < Cs`, () => {
    const order = [`Li`, `Na`, `K`, `Rb`, `Cs`] as const
    for (let idx = 0; idx < order.length - 1; idx++) {
      const smaller = get_element(order[idx])
      const larger = get_element(order[idx + 1])
      expect(larger.atomic_radius, `${larger.symbol} atomic_radius`).not.toBeNull()
      expect(smaller.atomic_radius, `${smaller.symbol} atomic_radius`).not.toBeNull()
      expect(larger.atomic_radius).toBeGreaterThan(smaller.atomic_radius as number)
    }
  })

  test(`group 17: F < Cl < Br < I`, () => {
    const order = [`F`, `Cl`, `Br`, `I`] as const
    for (let idx = 0; idx < order.length - 1; idx++) {
      const smaller = get_element(order[idx])
      const larger = get_element(order[idx + 1])
      expect(larger.atomic_radius, `${larger.symbol} atomic_radius`).not.toBeNull()
      expect(smaller.atomic_radius, `${smaller.symbol} atomic_radius`).not.toBeNull()
      expect(larger.atomic_radius).toBeGreaterThan(smaller.atomic_radius as number)
    }
  })

  test(`all radii in valid range (0.1, 3.0) Å`, () => {
    for (const el of element_data) {
      if (el.atomic_radius !== null) {
        expect(el.atomic_radius, el.symbol).toBeGreaterThan(0.1)
        expect(el.atomic_radius, el.symbol).toBeLessThan(3.0)
      }
    }
  })
})

describe(`covalent_radius`, () => {
  const LARGER_THAN_PAIRS = [
    [`O`, `H`],
    [`N`, `H`],
    [`C`, `H`],
    [`I`, `Br`],
    [`Br`, `Cl`],
    [`Cl`, `F`],
    [`Te`, `Se`],
    [`Se`, `S`],
    [`S`, `O`],
    [`Cs`, `Rb`],
    [`Rb`, `K`],
    [`K`, `Na`],
    [`Na`, `Li`],
  ] as const

  test.each(LARGER_THAN_PAIRS)(`%s > %s`, (larger, smaller) => {
    const larger_el = get_element(larger)
    const smaller_el = get_element(smaller)
    expect(larger_el.covalent_radius).not.toBeNull()
    expect(smaller_el.covalent_radius).not.toBeNull()
    expect(larger_el.covalent_radius).toBeGreaterThan(
      smaller_el.covalent_radius as number,
    )
  })

  test(`all radii in valid range (0.1, 2.6] Å`, () => {
    for (const el of element_data) {
      if (el.covalent_radius !== null) {
        expect(el.covalent_radius, el.symbol).toBeGreaterThan(0.1)
        expect(el.covalent_radius, el.symbol).toBeLessThanOrEqual(2.6)
      }
    }
  })
})

describe(`electronegativity`, () => {
  // High electronegativity ordering
  const HIGH_PAIRS = [
    [`F`, `O`],
    [`O`, `Cl`],
    [`Cl`, `N`],
    [`N`, `Br`],
    [`Br`, `S`],
    [`S`, `C`],
    [`C`, `H`],
  ] as const

  test.each(HIGH_PAIRS)(`%s > %s`, (higher, lower) => {
    const higher_el = get_element(higher)
    const lower_el = get_element(lower)
    expect(higher_el.electronegativity).not.toBeNull()
    expect(lower_el.electronegativity).not.toBeNull()
    expect(higher_el.electronegativity).toBeGreaterThan(
      lower_el.electronegativity as number,
    )
  })

  // Alkali metals decrease down group (K == Rb in this dataset, so skip Rb)
  const ALKALI_PAIRS = [[`Li`, `Na`], [`Na`, `K`], [`K`, `Cs`]] as const

  test.each(ALKALI_PAIRS)(`%s >= %s`, (higher, lower) => {
    expect(get_element(higher).electronegativity).toBeGreaterThanOrEqual(
      get_element(lower).electronegativity as number,
    )
  })

  test(`fluorine has highest electronegativity`, () => {
    const max = Math.max(
      ...element_data.filter((el) => el.electronegativity !== null)
        .map((el) => el.electronegativity as number),
    )
    expect(get_element(`F`).electronegativity).toBe(max)
  })

  test(`all values in range [0.7, 4.0]`, () => {
    for (const el of element_data) {
      if (el.electronegativity !== null) {
        expect(el.electronegativity, el.symbol).toBeGreaterThanOrEqual(0.7)
        expect(el.electronegativity, el.symbol).toBeLessThanOrEqual(4.0)
      }
    }
  })
})

describe(`first_ionization`, () => {
  // Noble gases decrease down group
  const NOBLE_PAIRS = [[`He`, `Ne`], [`Ne`, `Ar`], [`Ar`, `Kr`], [`Kr`, `Xe`]] as const

  test.each(NOBLE_PAIRS)(`%s > %s`, (higher, lower) => {
    expect(get_element(higher).first_ionization).toBeGreaterThan(
      get_element(lower).first_ionization as number,
    )
  })

  // Alkali metals decrease down group
  const ALKALI_PAIRS = [[`Li`, `Na`], [`Na`, `K`], [`K`, `Rb`], [`Rb`, `Cs`]] as const

  test.each(ALKALI_PAIRS)(`%s > %s`, (higher, lower) => {
    expect(get_element(higher).first_ionization).toBeGreaterThan(
      get_element(lower).first_ionization as number,
    )
  })

  // Noble gases > adjacent alkali metals
  const NOBLE_VS_ALKALI = [[`He`, `Li`], [`Ne`, `Na`], [`Ar`, `K`], [`Kr`, `Rb`], [
    `Xe`,
    `Cs`,
  ]] as const

  test.each(NOBLE_VS_ALKALI)(`%s > %s`, (noble, alkali) => {
    expect(get_element(noble).first_ionization).toBeGreaterThan(
      get_element(alkali).first_ionization as number,
    )
  })

  test(`all values in range (3, 25) eV`, () => {
    for (const el of element_data) {
      if (el.first_ionization !== null) {
        expect(el.first_ionization, el.symbol).toBeGreaterThan(3)
        expect(el.first_ionization, el.symbol).toBeLessThan(25)
      }
    }
  })
})

describe(`atomic_mass`, () => {
  const to_key = (a: string, b: string) => `${a}-${b}`
  const known_anomalies = new Set([
    ...ATOMIC_MASS_INVERSIONS.map(([a, b]) => to_key(a, b)),
    ...EQUAL_MASS_PAIRS.map(([a, b]) => to_key(a, b)),
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
    expect(found_anomalies.sort()).toEqual([...known_anomalies].sort())
  })

  test.each(ATOMIC_MASS_INVERSIONS)(`known inversion: %s > %s`, (heavier, lighter) => {
    const heavier_el = get_element(heavier)
    const lighter_el = get_element(lighter)
    expect(heavier_el.number).toBeLessThan(lighter_el.number)
    expect(heavier_el.atomic_mass).toBeGreaterThan(lighter_el.atomic_mass)
  })
})

describe(`data completeness`, () => {
  test(`all elements have valid structure`, () => {
    for (const [idx, el] of element_data.entries()) {
      expect(el.symbol, `element ${idx}`).toMatch(/^[A-Z][a-z]?$/)
      expect(el.name, el.symbol).toBeTruthy()
      expect(el.number, el.symbol).toBe(idx + 1)
      expect(el.period, el.symbol).toBeGreaterThanOrEqual(1)
      expect(el.period, el.symbol).toBeLessThanOrEqual(7)
      expect(el.column, el.symbol).toBeGreaterThanOrEqual(1)
      expect(el.column, el.symbol).toBeLessThanOrEqual(18)
    }
  })

  test(`main elements (Z <= 86) have required properties`, () => {
    const NOBLE_GASES = new Set([`He`, `Ne`, `Ar`, `Kr`, `Xe`, `Rn`])
    const NULL_RADIUS_OK = new Set([...NOBLE_GASES, `At`, `Fr`])

    for (const el of element_data.filter((e) => e.number <= 86)) {
      // All main elements need first_ionization
      expect(el.first_ionization, `${el.symbol} first_ionization`).not.toBeNull()

      // Non-noble gases need electronegativity and atomic_radius
      if (!NOBLE_GASES.has(el.symbol)) {
        expect(el.electronegativity, `${el.symbol} electronegativity`).not.toBeNull()
        if (!NULL_RADIUS_OK.has(el.symbol)) {
          expect(el.atomic_radius, `${el.symbol} atomic_radius`).not.toBeNull()
        }
      }
    }
  })
})

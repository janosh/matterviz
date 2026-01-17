import { ELEMENT_COLOR_SCHEMES } from '$lib/colors'
import type { OxiComposition } from '$lib/composition'
import {
  Formula,
  oxi_composition_to_elements,
  parse_formula_with_oxidation,
} from '$lib/composition'
import { mount } from 'svelte'
import { expect, test } from 'vitest'

test(`parse_formula_with_oxidation parses simple formulas`, () => {
  const result = parse_formula_with_oxidation(`H2O`)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({ element: `H`, amount: 2, orig_idx: 0 })
  expect(result[1]).toMatchObject({ element: `O`, amount: 1, orig_idx: 1 })
})

test(`parse_formula_with_oxidation handles caret syntax for oxidation states`, () => {
  const result = parse_formula_with_oxidation(`Fe^2+O3`)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({
    element: `Fe`,
    amount: 1,
    oxidation_state: 2,
    orig_idx: 0,
  })
  expect(result[1]).toMatchObject({
    element: `O`,
    amount: 3,
    oxidation_state: undefined,
    orig_idx: 1,
  })
})

test(`parse_formula_with_oxidation handles bracket syntax for oxidation states`, () => {
  const result = parse_formula_with_oxidation(`Fe[2+]O3`)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({
    element: `Fe`,
    amount: 1,
    oxidation_state: 2,
    orig_idx: 0,
  })
  expect(result[1]).toMatchObject({
    element: `O`,
    amount: 3,
    oxidation_state: undefined,
    orig_idx: 1,
  })
})

test(`parse_formula_with_oxidation handles negative oxidation states`, () => {
  const result1 = parse_formula_with_oxidation(`Cl^-`)
  expect(result1[0]).toMatchObject({
    element: `Cl`,
    amount: 1,
    oxidation_state: -1,
  })

  const result2 = parse_formula_with_oxidation(`S[-2]`)
  expect(result2[0]).toMatchObject({
    element: `S`,
    amount: 1,
    oxidation_state: -2,
  })
})

test(`parse_formula_with_oxidation handles bare sign oxidation states`, () => {
  // Test bare signs: "+", "-", "[+]", "[-]" should be treated as ±1
  const test_cases: [string, number][] = [
    [`Na^+`, 1],
    [`Cl^-`, -1],
    [`Na[+]`, 1],
    [`Cl[-]`, -1],
    [`K^+Cl^-`, 1], // K should have +1
  ]
  for (const [formula, expected_oxidation] of test_cases) {
    const result = parse_formula_with_oxidation(formula)
    expect(result[0].oxidation_state).toBe(expected_oxidation)
  }
})

test(`parse_formula_with_oxidation handles various oxidation state formats`, () => {
  // Test different formats: +2, 2+, -2, 2-
  const test_cases: [string, number][] = [
    [`Fe^+2O`, 2],
    [`Fe^2+O`, 2],
    [`Fe^-2O`, -2],
    [`Fe^2-O`, -2],
    [`Fe[+2]O`, 2],
    [`Fe[2+]O`, 2],
    [`Fe[-2]O`, -2],
    [`Fe[2-]O`, -2],
  ]

  for (const [formula, expected_oxidation] of test_cases) {
    const result = parse_formula_with_oxidation(formula)
    expect(result[0].oxidation_state).toBe(expected_oxidation)
  }
})

test(`parse_formula_with_oxidation handles complex formulas`, () => {
  const result = parse_formula_with_oxidation(`Ca^2+Cl2^-`)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({
    element: `Ca`,
    amount: 1,
    oxidation_state: 2,
    orig_idx: 0,
  })
  expect(result[1]).toMatchObject({
    element: `Cl`,
    amount: 2,
    oxidation_state: -1,
    orig_idx: 1,
  })
})

test(`parse_formula_with_oxidation handles parentheses`, () => {
  const result = parse_formula_with_oxidation(`Ca(OH)2`)
  expect(result).toHaveLength(3)
  expect(result.find((el) => el.element === `Ca`)?.amount).toBe(1)
  expect(result.find((el) => el.element === `O`)?.amount).toBe(2)
  expect(result.find((el) => el.element === `H`)?.amount).toBe(2)
})

test(`parse_formula_with_oxidation preserves original order`, () => {
  const result = parse_formula_with_oxidation(`ZnO2Fe`)
  expect(result[0].element).toBe(`Zn`)
  expect(result[0].orig_idx).toBe(0)
  expect(result[1].element).toBe(`O`)
  expect(result[1].orig_idx).toBe(1)
  expect(result[2].element).toBe(`Fe`)
  expect(result[2].orig_idx).toBe(2)
})

test(`parse_formula_with_oxidation throws on invalid element`, () => {
  expect(() => parse_formula_with_oxidation(`Xx2O3`)).toThrow(`Invalid element symbol`)
})

test.each([
  [`Fe^2+Fe^3+`, false, 1, 2], // Non-strict: uses first oxidation state
  [`Fe^2+Fe^2+`, true, 1, 2], // Strict: matching states OK
])(`parse_formula_with_oxidation %s strict=%s`, (formula, strict, length, ox_state) => {
  const result = parse_formula_with_oxidation(formula, strict)
  expect(result).toHaveLength(length)
  expect(result[0]).toMatchObject({ element: `Fe`, amount: 2, oxidation_state: ox_state })
})

test.each([
  [`Fe^2+Fe^3+`, `Conflicting oxidation states for Fe: +2 and +3`],
  [`S^2-S^-`, `Conflicting oxidation states for S: -2 and -1`],
])(`parse_formula_with_oxidation strict throws on %s`, (formula, error_msg) => {
  expect(() => parse_formula_with_oxidation(formula, true)).toThrow(error_msg)
})

test(`oxi_composition_to_elements converts correctly`, () => {
  const composition: Partial<OxiComposition> = {
    Fe: { amount: 2, oxidation_state: 3 },
    O: { amount: 3, oxidation_state: -2 },
  }

  const result = oxi_composition_to_elements(
    composition as OxiComposition,
  )
  expect(result).toHaveLength(2)

  const iron = result.find((elem) => elem.element === `Fe`)
  expect(iron).toMatchObject({
    element: `Fe`,
    amount: 2,
    oxidation_state: 3,
  })

  const oxygen = result.find((elem) => elem.element === `O`)
  expect(oxygen).toMatchObject({
    element: `O`,
    amount: 3,
    oxidation_state: -2,
  })
})

test(`Formula component renders with string formula`, () => {
  mount(Formula, { target: document.body, props: { formula: `H2O` } })
  const element = document.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.textContent).toContain(`H`)
  expect(element?.textContent).toContain(`O`)
})

test(`Formula component renders with oxidation states (caret syntax)`, () => {
  mount(Formula, { target: document.body, props: { formula: `Fe^2+O3` } })
  const element = document.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.textContent).toContain(`Fe`)
  expect(element?.textContent).toContain(`+2`)
  expect(element?.textContent).toContain(`O`)
})

test(`Formula component renders with oxidation states (bracket syntax)`, () => {
  mount(Formula, { target: document.body, props: { formula: `Fe[2+]O3` } })
  const element = document.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.textContent).toContain(`Fe`)
  expect(element?.textContent).toContain(`+2`)
  expect(element?.textContent).toContain(`O`)
})

test.each([
  { scheme: `Vesta` as const, expected_color_present: true },
  { scheme: `Jmol` as const, expected_color_present: true },
  { scheme: `Alloy` as const, expected_color_present: true },
])(
  `Formula applies $scheme color scheme correctly`,
  ({ scheme, expected_color_present }) => {
    mount(Formula, {
      target: document.body,
      props: { formula: `H2O`, color_scheme: scheme },
    })
    const symbols = document.querySelectorAll(`.element-symbol`)
    expect(symbols.length).toBe(2)

    // Check that elements have color styles applied
    const has_color = Array.from(symbols).some((symbol) =>
      (symbol as HTMLElement).style.color
    )
    expect(has_color).toBe(expected_color_present)
  },
)

test(`Formula component ordering: original`, () => {
  // Mounting to document.body
  mount(Formula, {
    target: document.body,
    props: { formula: `OHFe`, ordering: `original` },
  })
  const symbols = Array.from(document.querySelectorAll(`.element-symbol`)) as Element[]
  const text = symbols.map((elem) => elem.textContent).join(``)
  expect(text).toBe(`OHFe`)
})

test(`Formula component ordering: alphabetical`, () => {
  // Mounting to document.body
  mount(Formula, {
    target: document.body,
    props: { formula: `OHFe`, ordering: `alphabetical` },
  })
  const symbols = Array.from(document.querySelectorAll(`.element-symbol`)) as Element[]
  const text = symbols.map((elem) => elem.textContent).join(``)
  expect(text).toBe(`FeHO`)
})

test(`Formula component ordering: electronegativity`, () => {
  // Mounting to document.body
  mount(Formula, {
    target: document.body,
    props: { formula: `ONa`, ordering: `electronegativity` },
  })
  const symbols = Array.from(document.querySelectorAll(`.element-symbol`)) as Element[]
  const text = symbols.map((elem) => elem.textContent).join(``)
  // Na has lower electronegativity than O, so it should come first
  expect(text).toBe(`NaO`)
})

test(`Formula component ordering: hill`, () => {
  // Mounting to document.body
  mount(Formula, { target: document.body, props: { formula: `C2H6O`, ordering: `hill` } })
  const symbols = Array.from(document.querySelectorAll(`.element-symbol`)) as Element[]
  const text = symbols.map((elem) => elem.textContent).join(``)
  // Hill notation: C first, H second (if C present), then alphabetical
  expect(text).toBe(`CHO`)
})

test(`Formula component renders subscripts for amounts > 1`, () => {
  // Mounting to document.body
  mount(Formula, { target: document.body, props: { formula: `H2O` } })
  const subscripts = document.querySelectorAll(`sub`)
  expect(subscripts.length).toBe(1)
  expect(subscripts[0].textContent).toBe(`2`)
})

test(`Formula component does not render subscripts for amount = 1`, () => {
  // Mounting to document.body
  mount(Formula, { target: document.body, props: { formula: `HO` } })
  const subscripts = document.querySelectorAll(`sub`)
  expect(subscripts.length).toBe(0)
})

test(`Formula component renders superscripts for oxidation states`, () => {
  // Mounting to document.body
  mount(Formula, { target: document.body, props: { formula: `Fe^2+O^2-` } })
  const superscripts = document.querySelectorAll(`sup`)
  expect(superscripts.length).toBe(2)

  const oxidation_values = Array.from(superscripts as NodeListOf<Element>).map((sup) =>
    sup.textContent
  )
  expect(oxidation_values).toContain(`+2`)
  expect(oxidation_values).toContain(`-2`)
})

test(`Formula component does not render superscripts for zero oxidation`, () => {
  const composition = {
    Fe: { amount: 1, oxidation_state: 0 },
    O: { amount: 1, oxidation_state: 0 },
  } as OxiComposition
  // Mounting to document.body
  mount(Formula, { target: document.body, props: { formula: composition } })
  const superscripts = document.querySelectorAll(`sup`)
  expect(superscripts.length).toBe(0)
})

test(`Formula component accepts OxiComposition input`, () => {
  const composition = {
    Fe: { amount: 2, oxidation_state: 3 },
    O: { amount: 3, oxidation_state: -2 },
  } as OxiComposition
  // Mounting to document.body
  mount(Formula, { target: document.body, props: { formula: composition } })
  const element = document.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.textContent).toContain(`Fe`)
  expect(element?.textContent).toContain(`O`)
  expect(element?.textContent).toContain(`+3`)
  expect(element?.textContent).toContain(`-2`)
})

test.each([
  { as_value: `span` },
  { as_value: `div` },
  { as_value: `h1` },
  { as_value: `h2` },
  { as_value: `strong` },
  { as_value: `em` },
  { as_value: `p` },
])(`Formula renders with as="$as_value"`, ({ as_value }) => {
  // Mounting to document.body
  mount(Formula, { target: document.body, props: { formula: `H2O`, as: as_value } })
  const element = document.querySelector(as_value)
  expect(element).toBeTruthy()
  expect(element?.classList.contains(`formula`)).toBe(true)
  expect(element?.textContent).toContain(`H`)
  expect(element?.textContent).toContain(`O`)
})

test.each([
  { scheme: `Vesta` as const },
  { scheme: `Jmol` as const },
  { scheme: `Alloy` as const },
  { scheme: `Pastel` as const },
  { scheme: `Muted` as const },
  { scheme: `Dark Mode` as const },
])(`Formula renders with color scheme "$scheme"`, ({ scheme }) => {
  // Mounting to document.body
  mount(Formula, {
    target: document.body,
    props: { formula: `H2O`, color_scheme: scheme },
  })
  const element = document.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.querySelectorAll(`.element-symbol`).length).toBe(2)
})

test(`Formula formats amounts with custom format string`, () => {
  // Mounting to document.body
  mount(Formula, {
    target: document.body,
    props: { formula: `H2O`, amount_format: `.2f` },
  })
  const subscript = document.querySelector(`sub`)
  expect(subscript?.textContent).toBe(`2.00`)
})

test.each([
  { formula: `Ca[2+]Cl[-]2`, expected_elements: [`Ca`, `Cl`], expected_superscripts: 2 },
  { formula: `Fe^3+2O^2-3`, expected_elements: [`Fe`, `O`], expected_superscripts: 2 },
  { formula: `Na^+Cl^-`, expected_elements: [`Na`, `Cl`], expected_superscripts: 2 },
  { formula: `SO^2-4`, expected_elements: [`S`, `O`], expected_superscripts: 1 },
  { formula: `NH^+4`, expected_elements: [`N`, `H`], expected_superscripts: 1 },
])(
  `Formula handles complex formula "$formula"`,
  ({ formula, expected_elements, expected_superscripts }) => {
    // Mounting to document.body
    mount(Formula, { target: document.body, props: { formula } })
    const element = document.querySelector(`.formula`)
    expect(element).toBeTruthy()

    // Check that all expected elements are present
    for (const elem of expected_elements) {
      expect(element?.textContent).toContain(elem)
    }

    // Check correct number of oxidation state superscripts
    const superscripts = element?.querySelectorAll(`sup`) ?? []
    expect(superscripts.length).toBe(expected_superscripts)
  },
)

// Normalize any color format to lowercase hex
function normalize_to_hex(color: string): string {
  if (color.startsWith(`#`)) return color.toLowerCase()
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!match) return color
  const [, r, g, b] = match
  const to_hex = (n: string) => parseInt(n).toString(16).padStart(2, `0`)
  return `#${to_hex(r)}${to_hex(g)}${to_hex(b)}`
}

test.each([`Vesta`, `Jmol`] as const)(
  `Formula tooltip ElementTile uses same color scheme as symbol text (%s)`,
  async (color_scheme) => {
    mount(Formula, {
      target: document.body,
      props: { formula: `Fe2O3`, color_scheme },
    })

    const element_group = document.querySelector(`.element-group`) as HTMLElement
    expect(element_group).toBeTruthy()

    // Trigger mouseenter to show tooltip
    element_group.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))

    // Wait for Svelte to update the DOM
    await new Promise((resolve) => setTimeout(resolve, 0))

    const tooltip = document.querySelector(`.tooltip`)
    expect(tooltip).toBeTruthy()

    // Get the ElementTile inside the tooltip
    const tile = tooltip?.querySelector(`.element-tile`) as HTMLElement
    expect(tile).toBeTruthy()

    // The tile background should match the color scheme for Fe
    const expected_hex = ELEMENT_COLOR_SCHEMES[color_scheme]?.[`Fe`]
    if (!expected_hex) throw new Error(`Missing color for Fe in ${color_scheme}`)
    const actual_hex = normalize_to_hex(tile.style.backgroundColor)
    expect(actual_hex).toBe(expected_hex.toLowerCase())
  },
)

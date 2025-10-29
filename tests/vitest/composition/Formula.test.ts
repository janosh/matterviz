import { Formula } from '$lib/composition'
import type { CompositionWithOxidation } from '$lib/composition/parse'
import {
  composition_with_oxidation_to_elements,
  parse_formula_with_oxidation,
} from '$lib/composition/parse'
import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'

test(`parse_formula_with_oxidation parses simple formulas`, () => {
  const result = parse_formula_with_oxidation(`H2O`)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({ element: `H`, amount: 2, original_index: 0 })
  expect(result[1]).toMatchObject({ element: `O`, amount: 1, original_index: 1 })
})

test(`parse_formula_with_oxidation handles caret syntax for oxidation states`, () => {
  const result = parse_formula_with_oxidation(`Fe^2+O3`)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({
    element: `Fe`,
    amount: 1,
    oxidation_state: 2,
    original_index: 0,
  })
  expect(result[1]).toMatchObject({
    element: `O`,
    amount: 3,
    oxidation_state: undefined,
    original_index: 1,
  })
})

test(`parse_formula_with_oxidation handles bracket syntax for oxidation states`, () => {
  const result = parse_formula_with_oxidation(`Fe[2+]O3`)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({
    element: `Fe`,
    amount: 1,
    oxidation_state: 2,
    original_index: 0,
  })
  expect(result[1]).toMatchObject({
    element: `O`,
    amount: 3,
    oxidation_state: undefined,
    original_index: 1,
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

test(`parse_formula_with_oxidation handles various oxidation state formats`, () => {
  // Test different formats: +2, 2+, -2, 2-
  const test_cases: Array<[string, number]> = [
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
  const result = parse_formula_with_oxidation(`Ca^2+Cl^-2`)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({
    element: `Ca`,
    amount: 1,
    oxidation_state: 2,
    original_index: 0,
  })
  expect(result[1]).toMatchObject({
    element: `Cl`,
    amount: 2,
    oxidation_state: -1,
    original_index: 1,
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
  expect(result[0].original_index).toBe(0)
  expect(result[1].element).toBe(`O`)
  expect(result[1].original_index).toBe(1)
  expect(result[2].element).toBe(`Fe`)
  expect(result[2].original_index).toBe(2)
})

test(`parse_formula_with_oxidation throws on invalid element`, () => {
  expect(() => parse_formula_with_oxidation(`Xx2O3`)).toThrow(`Invalid element symbol`)
})

test(`composition_with_oxidation_to_elements converts correctly`, () => {
  const composition: CompositionWithOxidation = {
    Fe: { amount: 2, oxidation_state: 3 },
    O: { amount: 3, oxidation_state: -2 },
  }

  const result = composition_with_oxidation_to_elements(composition)
  expect(result).toHaveLength(2)

  const iron = result.find((el) => el.element === `Fe`)
  expect(iron).toMatchObject({
    element: `Fe`,
    amount: 2,
    oxidation_state: 3,
  })

  const oxygen = result.find((el) => el.element === `O`)
  expect(oxygen).toMatchObject({
    element: `O`,
    amount: 3,
    oxidation_state: -2,
  })
})

test(`Formula component renders with string formula`, () => {
  const { container } = render(Formula, { props: { formula: `H2O` } })
  const element = container.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.textContent).toContain(`H`)
  expect(element?.textContent).toContain(`O`)
})

test(`Formula component renders with oxidation states (caret syntax)`, () => {
  const { container } = render(Formula, { props: { formula: `Fe^2+O3` } })
  const element = container.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.textContent).toContain(`Fe`)
  expect(element?.textContent).toContain(`+2`)
  expect(element?.textContent).toContain(`O`)
})

test(`Formula component renders with oxidation states (bracket syntax)`, () => {
  const { container } = render(Formula, { props: { formula: `Fe[2+]O3` } })
  const element = container.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.textContent).toContain(`Fe`)
  expect(element?.textContent).toContain(`+2`)
  expect(element?.textContent).toContain(`O`)
})

test(`Formula component applies color scheme`, () => {
  const { container } = render(Formula, {
    props: { formula: `H2O`, color_scheme: `Vesta` },
  })
  const symbols = container.querySelectorAll(`.element-symbol`)
  expect(symbols.length).toBeGreaterThan(0)

  // Check that at least one element has a color style
  const has_color = Array.from(symbols).some((symbol) =>
    (symbol as HTMLElement).style.color
  )
  expect(has_color).toBe(true)
})

test(`Formula component ordering: original`, () => {
  const { container } = render(Formula, {
    props: { formula: `OHFe`, ordering: `original` },
  })
  const symbols = Array.from(container.querySelectorAll(`.element-symbol`))
  const text = symbols.map((el) => el.textContent).join(``)
  expect(text).toBe(`OHFe`)
})

test(`Formula component ordering: alphabetical`, () => {
  const { container } = render(Formula, {
    props: { formula: `OHFe`, ordering: `alphabetical` },
  })
  const symbols = Array.from(container.querySelectorAll(`.element-symbol`))
  const text = symbols.map((el) => el.textContent).join(``)
  expect(text).toBe(`FeHO`)
})

test(`Formula component ordering: electronegativity`, () => {
  const { container } = render(Formula, {
    props: { formula: `ONa`, ordering: `electronegativity` },
  })
  const symbols = Array.from(container.querySelectorAll(`.element-symbol`))
  const text = symbols.map((el) => el.textContent).join(``)
  // Na has lower electronegativity than O, so it should come first
  expect(text).toBe(`NaO`)
})

test(`Formula component renders subscripts for amounts > 1`, () => {
  const { container } = render(Formula, { props: { formula: `H2O` } })
  const subscripts = container.querySelectorAll(`sub`)
  expect(subscripts.length).toBe(1)
  expect(subscripts[0].textContent).toBe(`2`)
})

test(`Formula component does not render subscripts for amount = 1`, () => {
  const { container } = render(Formula, { props: { formula: `HO` } })
  const subscripts = container.querySelectorAll(`sub`)
  expect(subscripts.length).toBe(0)
})

test(`Formula component renders superscripts for oxidation states`, () => {
  const { container } = render(Formula, { props: { formula: `Fe^2+O^2-` } })
  const superscripts = container.querySelectorAll(`sup`)
  expect(superscripts.length).toBe(2)

  const oxidation_values = Array.from(superscripts).map((sup) => sup.textContent)
  expect(oxidation_values).toContain(`+2`)
  expect(oxidation_values).toContain(`-2`)
})

test(`Formula component does not render superscripts for zero oxidation`, () => {
  const composition: CompositionWithOxidation = {
    Fe: { amount: 1, oxidation_state: 0 },
    O: { amount: 1 },
  }
  const { container } = render(Formula, { props: { formula: composition } })
  const superscripts = container.querySelectorAll(`sup`)
  expect(superscripts.length).toBe(0)
})

test(`Formula component accepts CompositionWithOxidation input`, () => {
  const composition: CompositionWithOxidation = {
    Fe: { amount: 2, oxidation_state: 3 },
    O: { amount: 3, oxidation_state: -2 },
  }
  const { container } = render(Formula, { props: { formula: composition } })
  const element = container.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.textContent).toContain(`Fe`)
  expect(element?.textContent).toContain(`O`)
  expect(element?.textContent).toContain(`+3`)
  expect(element?.textContent).toContain(`-2`)
})

test(`Formula component renders with different 'as' prop values`, () => {
  const as_values = [`span`, `div`, `h1`, `h2`, `strong`, `em`, `p`]

  for (const as_value of as_values) {
    const { container } = render(Formula, {
      props: { formula: `H2O`, as: as_value },
    })
    const element = container.querySelector(as_value)
    expect(element).toBeTruthy()
    expect(element?.classList.contains(`formula`)).toBe(true)
  }
})

test(`Formula component with all color schemes`, () => {
  const color_schemes = [
    `Vesta`,
    `Jmol`,
    `Alloy`,
    `Pastel`,
    `Muted`,
    `Dark Mode`,
  ] as const

  for (const scheme of color_schemes) {
    const { container } = render(Formula, {
      props: { formula: `H2O`, color_scheme: scheme },
    })
    const element = container.querySelector(`.formula`)
    expect(element).toBeTruthy()
  }
})

test(`Formula component handles empty formula gracefully`, () => {
  const { container } = render(Formula, { props: { formula: `` } })
  const element = container.querySelector(`.formula`)
  expect(element).toBeTruthy()
  expect(element?.querySelectorAll(`.element-symbol`).length).toBe(0)
})

test(`Formula component handles invalid formula gracefully`, () => {
  // Should not crash, even with invalid input
  const { container } = render(Formula, { props: { formula: `!!!` } })
  const element = container.querySelector(`.formula`)
  expect(element).toBeTruthy()
})

test(`Formula component formats amounts with custom format string`, () => {
  const { container } = render(Formula, {
    props: { formula: `H2.5O`, amount_format: `.2f` },
  })
  const subscript = container.querySelector(`sub`)
  expect(subscript?.textContent).toBe(`2.50`)
})

test(`Formula component handles complex real-world formulas`, () => {
  const formulas = [
    `Ca[2+]Cl[-]2`,
    `Fe^3+2O^2-3`,
    `Na^+Cl^-`,
    `SO4^2-`,
    `NH4^+`,
  ]

  for (const formula of formulas) {
    const { container } = render(Formula, { props: { formula } })
    const element = container.querySelector(`.formula`)
    expect(element).toBeTruthy()
    // Should have at least one element rendered
    expect(element?.querySelectorAll(`.element-symbol`).length).toBeGreaterThan(0)
  }
})

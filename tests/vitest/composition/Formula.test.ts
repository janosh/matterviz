import { ELEMENT_COLOR_SCHEMES } from '$lib/colors'
import type { OxiComposition } from '$lib/composition'
import {
  Formula,
  oxi_composition_to_elements,
  parse_formula_with_oxidation,
} from '$lib/composition'
import { type ComponentProps, mount } from 'svelte'
import { expect, test, vi } from 'vitest'

// Mount Formula into document.body and return its rendered `.formula` root (or null)
const mount_formula = (props: ComponentProps<typeof Formula>): HTMLElement | null => {
  mount(Formula, { target: document.body, props })
  return document.querySelector<HTMLElement>(`.formula`)
}

test(`parse_formula_with_oxidation parses simple formulas`, () => {
  const result = parse_formula_with_oxidation(`H2O`)
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({ element: `H`, amount: 2, orig_idx: 0 })
  expect(result[1]).toMatchObject({ element: `O`, amount: 1, orig_idx: 1 })
})

test.each([`Fe^2+O3`, `Fe[2+]O3`])(
  `parse_formula_with_oxidation handles caret/bracket syntax: %s`,
  (formula) => {
    const result = parse_formula_with_oxidation(formula)
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
  },
)

test.each([
  // bare signs "+", "-", "[+]", "[-]" are treated as ±1
  [`Na^+`, 1],
  [`Cl^-`, -1],
  [`Na[+]`, 1],
  [`Cl[-]`, -1],
  [`K^+Cl^-`, 1], // K should have +1
  [`S[-2]`, -2],
  // sign before or after the digit, caret or bracket syntax
  [`Fe^+2O`, 2],
  [`Fe^2+O`, 2],
  [`Fe^-2O`, -2],
  [`Fe^2-O`, -2],
  [`Fe[+2]O`, 2],
  [`Fe[2+]O`, 2],
  [`Fe[-2]O`, -2],
  [`Fe[2-]O`, -2],
])(`parse_formula_with_oxidation %s -> oxidation %d`, (formula, expected_oxidation) => {
  expect(parse_formula_with_oxidation(formula)[0].oxidation_state).toBe(expected_oxidation)
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

test(`parse_formula_with_oxidation handles decimal counts`, () => {
  const result = parse_formula_with_oxidation(`Fe(OH)0.5`)
  expect(result.find((el) => el.element === `Fe`)?.amount).toBe(1)
  expect(result.find((el) => el.element === `O`)?.amount).toBe(0.5)
  expect(result.find((el) => el.element === `H`)?.amount).toBe(0.5)
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

  const result = oxi_composition_to_elements(composition as OxiComposition)
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
  const element = mount_formula({ formula: `H2O` })
  expect(element).toBeInstanceOf(HTMLElement)
  expect(element?.textContent).toContain(`H`)
  expect(element?.textContent).toContain(`O`)
})

test.each([`Fe^2+O3`, `Fe[2+]O3`])(
  `Formula component renders oxidation states for %s`,
  (formula) => {
    const element = mount_formula({ formula })
    expect(element).toBeInstanceOf(HTMLElement)
    expect(element?.textContent).toContain(`Fe`)
    expect(element?.textContent).toContain(`+2`)
    expect(element?.textContent).toContain(`O`)
  },
)

test.each([
  [`OHFe`, `original`, `OHFe`],
  [`OHFe`, `alphabetical`, `FeHO`],
  // Na has lower electronegativity than O, so it should come first
  [`ONa`, `electronegativity`, `NaO`],
  // Hill notation: C first, H second (if C present), then alphabetical
  [`C2H6O`, `hill`, `CHO`],
] as const)(`Formula component ordering: %s %s -> %s`, (formula, ordering, expected) => {
  mount_formula({ formula, ordering })
  const symbols = Array.from(document.querySelectorAll(`.element-symbol`))
  expect(symbols.map((elem) => elem.textContent).join(``)).toBe(expected)
})

test.each([
  [`H2O`, [`2`]], // subscript for amounts > 1
  [`HO`, []], // no subscript for amount = 1
])(`Formula component subscripts for %s -> %j`, (formula, expected) => {
  mount_formula({ formula })
  const subscripts = Array.from(document.querySelectorAll(`sub`))
  expect(subscripts.map((sub) => sub.textContent)).toEqual(expected)
})

test(`Formula component renders superscripts for oxidation states`, () => {
  mount_formula({ formula: `Fe^2+O^2-` })
  const superscripts = document.querySelectorAll(`sup`)
  expect(superscripts).toHaveLength(2)

  const oxidation_values = Array.from(superscripts as NodeListOf<Element>).map(
    (sup) => sup.textContent,
  )
  expect(oxidation_values).toContain(`+2`)
  expect(oxidation_values).toContain(`-2`)
})

test(`Formula component does not render superscripts for zero oxidation`, () => {
  const composition = {
    Fe: { amount: 1, oxidation_state: 0 },
    O: { amount: 1, oxidation_state: 0 },
  } as OxiComposition
  mount_formula({ formula: composition })
  const superscripts = document.querySelectorAll(`sup`)
  expect(superscripts).toHaveLength(0)
})

test(`Formula component accepts OxiComposition input`, () => {
  const composition = {
    Fe: { amount: 2, oxidation_state: 3 },
    O: { amount: 3, oxidation_state: -2 },
  } as OxiComposition
  const element = mount_formula({ formula: composition })
  expect(element).toBeInstanceOf(HTMLElement)
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
  mount_formula({ formula: `H2O`, as: as_value })
  const element = document.querySelector(as_value)
  expect(element).toBeInstanceOf(HTMLElement)
  expect(element?.classList.contains(`formula`)).toBe(true)
  expect(element?.textContent).toContain(`H`)
  expect(element?.textContent).toContain(`O`)
})

test.each([`Vesta`, `Jmol`, `Alloy`, `Pastel`, `Muted`, `Dark Mode`] as const)(
  `Formula renders with color scheme "%s" applied to element symbols`,
  (scheme) => {
    const element = mount_formula({ formula: `H2O`, color_scheme: scheme })
    expect(element).toBeInstanceOf(HTMLElement)
    const symbols = element?.querySelectorAll<HTMLElement>(`.element-symbol`) ?? []
    expect(symbols).toHaveLength(2)
    expect(Array.from(symbols).some((symbol) => symbol.style.color)).toBe(true)
  },
)

test(`Formula formats amounts with custom format string`, () => {
  mount_formula({ formula: `H2O`, amount_format: `.2f` })
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
    const element = mount_formula({ formula })
    expect(element).toBeInstanceOf(HTMLElement)

    // Check that all expected elements are present
    for (const elem of expected_elements) {
      expect(element?.textContent).toContain(elem)
    }

    // Check correct number of oxidation state superscripts
    const superscripts = element?.querySelectorAll(`sup`) ?? []
    expect(superscripts).toHaveLength(expected_superscripts)
  },
)

// Normalize any color format to lowercase hex
function normalize_to_hex(color: string): string {
  if (color.startsWith(`#`)) return color.toLowerCase()
  const match = /rgb\((?<red>\d+),\s*(?<green>\d+),\s*(?<blue>\d+)\)/.exec(color)
  if (!match) return color
  const [, red, green, blue] = match
  const to_hex = (num_str: string) => Number(num_str).toString(16).padStart(2, `0`)
  return `#${to_hex(red)}${to_hex(green)}${to_hex(blue)}`
}

test.each([`Vesta`, `Jmol`] as const)(
  `Formula tooltip ElementTile uses same color scheme as symbol text (%s)`,
  async (color_scheme) => {
    mount_formula({ formula: `Fe2O3`, color_scheme })

    const element_group = document.querySelector(`.element-group`) as HTMLElement
    expect(element_group).toBeInstanceOf(HTMLElement)

    // Trigger mouseenter to show tooltip
    element_group.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))

    // Wait for Svelte to update the DOM
    await new Promise((resolve) => setTimeout(resolve, 0))

    const tooltip = document.querySelector(`.tooltip`)
    expect(tooltip).toBeInstanceOf(HTMLElement)

    // Get the ElementTile inside the tooltip
    const tile = tooltip?.querySelector(`.element-tile`) as HTMLElement
    expect(tile).toBeInstanceOf(HTMLElement)

    // The tile background should match the color scheme for Fe
    const expected_hex = ELEMENT_COLOR_SCHEMES[color_scheme]?.Fe
    if (!expected_hex) throw new Error(`Missing color for Fe in ${color_scheme}`)
    const actual_hex = normalize_to_hex(tile.style.backgroundColor)
    expect(actual_hex).toBe(expected_hex.toLowerCase())
  },
)

// Helper to simulate copy event and return clipboard data
function simulate_copy(
  is_collapsed = false,
  selection_outside = false,
): { text: string; type: string; prevented: boolean } {
  const formula_el = document.querySelector(`.formula`)
  if (!formula_el) throw new Error(`Formula element not found`)
  // Mock selection with anchorNode/focusNode inside or outside formula
  const node_inside = formula_el.firstChild
  const node_outside = document.body
  vi.spyOn(window, `getSelection`).mockReturnValue({
    isCollapsed: is_collapsed,
    anchorNode: selection_outside ? node_outside : node_inside,
    focusNode: selection_outside ? node_outside : node_inside,
  } as unknown as Selection)

  let text = ``
  let type = ``
  const event = new ClipboardEvent(`copy`, { bubbles: true, cancelable: true })
  Object.defineProperty(event, `clipboardData`, {
    value: {
      setData: (format: string, data: string) => {
        type = format
        text = data
      },
    },
  })

  formula_el.dispatchEvent(event)
  vi.restoreAllMocks()
  return { text, type, prevented: event.defaultPrevented }
}

// Test copy functionality - clipboard should contain plain text with spaces between elements
test.each([
  [`H2O`, `H2 O`],
  [`Fe2O3`, `Fe2 O3`],
  [`NaCl`, `Na Cl`],
  [`Li2SO4`, `Li2 S O4`],
  [`Ca(OH)2`, `Ca O2 H2`],
  [`Fe^3+2O^2-3`, `Fe(+3)2 O(-2)3`], // oxidation in parens to avoid "Fe+32" ambiguity
])(`Formula copy: "%s" -> "%s"`, (formula, expected) => {
  mount_formula({ formula })
  const { text, type, prevented } = simulate_copy()
  expect(prevented).toBe(true)
  expect(type).toBe(`text/plain`)
  expect(text).toBe(expected)
})

test(`Formula copy skipped when selection collapsed`, () => {
  mount_formula({ formula: `H2O` })
  const { text, prevented } = simulate_copy(true)
  expect(prevented).toBe(false)
  expect(text).toBe(``)
})

test(`Formula copy skipped when selection extends outside formula`, () => {
  mount_formula({ formula: `H2O` })
  const { text, prevented } = simulate_copy(false, true) // selection_outside = true
  expect(prevented).toBe(false)
  expect(text).toBe(``)
})

test(`Formula copy respects ordering prop`, () => {
  mount_formula({ formula: `OHFe`, ordering: `alphabetical` })
  expect(simulate_copy().text).toBe(`Fe H O`)
})

test(`Formula copy handles fractional amounts`, () => {
  const composition = { Li: { amount: 0.5 }, O: { amount: 1 } } as OxiComposition
  mount_formula({ formula: composition, amount_format: `.2f` })
  expect(simulate_copy().text).toBe(`Li0.50 O`)
})

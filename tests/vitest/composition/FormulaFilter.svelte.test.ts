import { FormulaFilter } from '$lib/composition'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`FormulaFilter`, () => {
  const get_input = (): HTMLInputElement => doc_query(`input`)
  const get_filter = (): HTMLElement => doc_query(`.formula-filter`)

  test(`renders with default props and initial value`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `` } })
    expect(get_input()).toBeTruthy()
    expect(get_input().getAttribute(`aria-label`)).toBe(`Formula filter`)

    document.body.innerHTML = ``
    mount(FormulaFilter, { target: document.body, props: { value: `Fe,O` } })
    expect(get_input().value).toBe(`Fe,O`)
  })

  test.each([
    [`Li,Fe`, `contains elements`],
    [`Li-Fe-O`, `chemical system`],
    [`LiFePO4`, `exact formula`],
  ])(`mode hint for "%s" shows "%s"`, async (input, expected_hint) => {
    let val = $state(input)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return val
        },
        set value(v: string) {
          val = v
        },
      },
    })
    await tick()
    // Use includes() since clickable mode hints have an icon child
    expect(document.querySelector(`.mode-hint`)?.textContent).toContain(expected_hint)
  })

  test(`clicking mode hint cycles through modes and reformats input`, async () => {
    // Mode hint is always clickable and clicking it reformats the input
    const onchange = vi.fn()
    let val = $state(`LiFePO4`)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return val
        },
        set value(v: string) {
          val = v
        },
        onchange,
      },
    })
    await tick()

    const get_mode_btn = () =>
      document.querySelector<HTMLButtonElement>(`.mode-hint.clickable`)
    expect(get_mode_btn()).toBeTruthy()
    expect(get_mode_btn()?.textContent).toContain(`exact formula`)

    // Click to cycle: exact → elements (reformats to comma-separated)
    get_mode_btn()?.click()
    flushSync()
    expect(onchange).toHaveBeenLastCalledWith(`Fe,Li,O,P`, `elements`)
    expect(get_mode_btn()?.textContent).toContain(`contains elements`)

    // Click again: elements → chemsys (reformats to dash-separated)
    get_mode_btn()?.click()
    flushSync()
    expect(onchange).toHaveBeenLastCalledWith(`Fe-Li-O-P`, `chemsys`)
    expect(get_mode_btn()?.textContent).toContain(`chemical system`)

    // Click again: chemsys → exact (reformats to concatenated)
    get_mode_btn()?.click()
    flushSync()
    expect(onchange).toHaveBeenLastCalledWith(`FeLiOP`, `exact`)
    expect(get_mode_btn()?.textContent).toContain(`exact formula`)
  })

  test.each([
    { from: `Li-Fe-O`, to_mode: `elements`, expected: `Fe,Li,O` },
    { from: `Li,Fe,O`, to_mode: `chemsys`, expected: `Fe-Li-O` },
    { from: `LiFePO4`, to_mode: `elements`, expected: `Fe,Li,O,P` },
    { from: `LiFePO4`, to_mode: `chemsys`, expected: `Fe-Li-O-P` },
    { from: `Fe,Li,O`, to_mode: `exact`, expected: `FeLiO` },
  ])(
    `reformats "$from" to "$expected" when cycling to $to_mode mode`,
    async ({ from, to_mode, expected }) => {
      const onchange = vi.fn()
      let val = $state(from)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          get value() {
            return val
          },
          set value(v: string) {
            val = v
          },
          onchange,
        },
      })
      await tick()

      // Click until we reach the target mode
      const get_mode_btn = () =>
        document.querySelector<HTMLButtonElement>(`.mode-hint.clickable`)
      let attempts = 0
      while (attempts < 3) {
        get_mode_btn()?.click()
        flushSync()
        const last_call = onchange.mock.calls[onchange.mock.calls.length - 1]
        if (last_call[1] === to_mode) break
        attempts++
      }

      expect(onchange).toHaveBeenLastCalledWith(expected, to_mode)
    },
  )

  test.each([
    [`Li,Fe`, `elements`],
    [`Li-Fe-O`, `chemsys`],
    [`LiFePO4`, `exact`],
  ])(`infers mode "%s" from input "%s"`, async (input, expected_mode) => {
    const onchange = vi.fn()
    let val = $state(input)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return val
        },
        set value(v: string) {
          val = v
        },
        onchange,
      },
    })
    await tick()
    get_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
    flushSync()
    expect(onchange).toHaveBeenCalledWith(expect.any(String), expected_mode)
  })

  test(`disabled state applies`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: ``, disabled: true } })
    expect(get_filter().classList.contains(`disabled`)).toBe(true)
    expect(get_input().disabled).toBe(true)
  })

  test.each([
    { value: `Fe`, show_clear_button: true, disabled: false, expected: true },
    { value: ``, show_clear_button: true, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: false, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: true, disabled: true, expected: false },
  ])(`clear button visible=$expected`, (params) => {
    mount(FormulaFilter, { target: document.body, props: params })
    expect(!!document.querySelector(`.clear-btn`)).toBe(params.expected)
  })

  test(`clears value on click or Escape`, () => {
    const onchange = vi.fn()
    const onclear = vi.fn()
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe`, onchange, onclear },
    })

    // Click clear button
    doc_query<HTMLButtonElement>(`.clear-btn`).click()
    flushSync()
    expect(onclear).toHaveBeenCalled()
    expect(onchange).toHaveBeenCalledWith(``, `elements`)

    // Reset for Escape test
    document.body.innerHTML = ``
    const onclear2 = vi.fn()
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe`, onclear: onclear2 },
    })
    get_input().dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
    )
    flushSync()
    expect(get_input().value).toBe(``)
    expect(onclear2).toHaveBeenCalled()
  })

  test(`clear button accessibility and input_element binding`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `Fe` } })
    expect(doc_query(`.clear-btn`).getAttribute(`aria-label`)).toBe(`Clear filter`)
    expect(doc_query(`.clear-btn`).getAttribute(`title`)).toBe(`Clear (Escape)`)

    document.body.innerHTML = ``
    let bound: HTMLInputElement | null = null
    mount(FormulaFilter, {
      target: document.body,
      props: {
        value: ``,
        get input_element() {
          return bound
        },
        set input_element(val) {
          bound = val
        },
      },
    })
    flushSync()
    expect(bound).toBe(get_input())
  })

  test(`syncs external value changes`, async () => {
    let value = $state(``)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return value
        },
        set value(val: string) {
          value = val
        },
      },
    })
    await tick()
    expect(get_input().value).toBe(``)

    value = `Fe,O`
    await tick()
    expect(get_input().value).toBe(`Fe,O`)
  })

  test.each([
    { initial_value: `Li-Fe-O`, expected_mode: `chemsys` },
    { initial_value: `LiFePO4`, expected_mode: `exact` },
    { initial_value: `Li,Fe`, expected_mode: `elements` },
  ])(
    `infers mode=$expected_mode on first render from value="$initial_value" (e.g. URL params)`,
    async ({ initial_value, expected_mode }) => {
      // Regression test: when value is set from URL params without search_mode,
      // the component should infer the correct mode from the value format
      let mode = $state<`elements` | `chemsys` | `exact`>(`elements`)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          value: initial_value,
          get search_mode() {
            return mode
          },
          set search_mode(val) {
            mode = val
          },
        },
      })
      await tick()
      expect(mode).toBe(expected_mode)
    },
  )

  test(`re-infers mode when value prop changes externally`, async () => {
    // When parent updates value prop without search_mode, mode should be re-inferred
    let value = $state(`LiFePO4`)
    let mode = $state<`elements` | `chemsys` | `exact`>(`elements`)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return value
        },
        set value(val: string) {
          value = val
        },
        get search_mode() {
          return mode
        },
        set search_mode(val) {
          mode = val
        },
      },
    })
    await tick()
    expect(mode).toBe(`exact`) // Initial inference

    // Simulate parent updating value prop (e.g., from URL change)
    value = `Fe,Li,O`
    await tick()
    expect(mode).toBe(`elements`) // Should re-infer from new value format
  })

  test.each([
    [`Li-Fe-O`, `chemsys`],
    [`LiFePO4`, `exact`],
    [`Li,Fe`, `elements`],
  ])(`search_mode binding updates to %s for input "%s"`, (input, expected_mode) => {
    // Verifies that the search_mode bindable prop is synchronized when user enters input
    let mode = $state<`elements` | `chemsys` | `exact`>(`elements`)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        value: ``,
        get search_mode() {
          return mode
        },
        set search_mode(val) {
          mode = val
        },
      },
    })
    get_input().value = input
    get_input().dispatchEvent(new Event(`input`, { bubbles: true }))
    get_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
    flushSync()
    expect(mode).toBe(expected_mode)
  })

  test.each([
    { input: `Fe,O`, expected: `O,Fe`, mode: `elements` },
    { input: `Fe-Li`, expected: `Li-Fe`, mode: `chemsys` },
    { input: `NaCl`, expected: `NaCl`, mode: `exact` },
  ])(
    `normalizes "$input" to "$expected" (mode=$mode)`,
    async ({ input, expected, mode }) => {
      const onchange = vi.fn()
      let val = $state(input)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          get value() {
            return val
          },
          set value(v: string) {
            val = v
          },
          onchange,
        },
      })
      await tick()
      get_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
      flushSync()
      expect(onchange).toHaveBeenCalledWith(expected, mode)
    },
  )

  test(`Enter key triggers normalization`, async () => {
    const onchange = vi.fn()
    let val = $state(`Fe-Li`)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return val
        },
        set value(v: string) {
          val = v
        },
        onchange,
      },
    })
    await tick()
    get_input().dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
    )
    flushSync()
    expect(onchange).toHaveBeenCalledWith(`Li-Fe`, `chemsys`)
  })

  test(`spreads additional attributes to wrapper`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, 'data-testid': `test` },
    })
    expect(doc_query(`[data-testid="test"]`).classList.contains(`formula-filter`)).toBe(
      true,
    )
  })

  describe(`examples dropdown`, () => {
    test.each([
      { show_examples: true, disabled: false, expected: true },
      { show_examples: false, disabled: false, expected: false },
      { show_examples: true, disabled: true, expected: false },
    ])(`help button visible=$expected`, (params) => {
      mount(FormulaFilter, { target: document.body, props: { value: ``, ...params } })
      expect(!!document.querySelector(`.help-btn`)).toBe(params.expected)
    })

    test(`toggles, displays content, and applies example on click`, () => {
      const onchange = vi.fn()
      mount(FormulaFilter, { target: document.body, props: { value: ``, onchange } })
      const help_btn = doc_query<HTMLButtonElement>(`.help-btn`)

      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`false`)

      help_btn.click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeTruthy()
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`true`)
      expect(document.querySelectorAll(`.example-category`).length).toBe(3)
      expect(document.querySelectorAll(`.example-tag`).length).toBe(9)

      // Apply example
      Array.from(document.querySelectorAll<HTMLButtonElement>(`.example-tag`))
        .find((tag) => tag.textContent === `Li-Fe-O`)
        ?.click()
      flushSync()
      expect(onchange).toHaveBeenCalledWith(`Li-Fe-O`, `chemsys`)
      expect(get_input().value).toBe(`Li-Fe-O`)
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
    })

    test(`Escape closes dropdown first, then clears value`, () => {
      const onclear = vi.fn()
      mount(FormulaFilter, { target: document.body, props: { value: `Fe`, onclear } })
      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeTruthy()

      // First Escape closes dropdown
      get_input().dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
      )
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
      expect(get_input().value).toBe(`Fe`)
      expect(onclear).not.toHaveBeenCalled()

      // Second Escape clears value
      get_input().dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
      )
      flushSync()
      expect(get_input().value).toBe(``)
      expect(onclear).toHaveBeenCalled()
    })
  })
})

import { FormulaFilter } from '$lib/composition'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`FormulaFilter`, () => {
  const get_input = (): HTMLInputElement => doc_query(`input`)
  const get_select = (): HTMLSelectElement => doc_query(`select`)
  const get_label = (): HTMLElement => doc_query(`label.filter-group`)

  test(`renders with default props`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `` } })
    expect(get_input()).toBeTruthy()
    expect(get_select()).toBeTruthy()
    expect(get_label().textContent).toContain(`Formula/Elements`)
    expect(get_select().getAttribute(`aria-label`)).toBe(`Search mode`)
    expect(Array.from(document.querySelectorAll(`option`)).map((o) => o.value)).toEqual([
      `elements`,
      `chemsys`,
      `exact`,
    ])
  })

  test(`renders with custom props`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe,O`, label: `Custom`, title: `Tooltip` },
    })
    expect(get_input().value).toBe(`Fe,O`)
    expect(get_label().textContent).toContain(`Custom`)
    expect(doc_query(`label span`).getAttribute(`title`)).toBe(`Tooltip`)
    expect(get_input().getAttribute(`aria-label`)).toBe(`Custom`)
  })

  test.each(
    [
      [`elements`, `Nb,Zr`],
      [`chemsys`, `Nb-Zr`],
      [`exact`, `NbZr2`],
    ] as const,
  )(`placeholder for %s mode is %s`, (mode, expected) => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, search_mode: mode },
    })
    expect(get_input().placeholder).toBe(expected)
  })

  test(`hides mode selector when show_mode_selector=false`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, show_mode_selector: false },
    })
    expect(document.querySelector(`select`)).toBeNull()
  })

  test(`active class transitions with value changes`, async () => {
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
    expect(get_label().classList.contains(`active`)).toBe(false)

    value = `Fe`
    await tick()
    expect(get_label().classList.contains(`active`)).toBe(true)

    value = ``
    await tick()
    expect(get_label().classList.contains(`active`)).toBe(false)
  })

  test(`disabled state applies class and attributes`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: ``, disabled: true } })
    expect(doc_query(`.formula-filter-wrapper`).classList.contains(`disabled`)).toBe(true)
    expect(get_input().disabled).toBe(true)
    expect(get_select().disabled).toBe(true)
  })

  test.each([
    { value: `Fe`, show_clear_button: true, disabled: false, expected: true },
    { value: ``, show_clear_button: true, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: false, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: true, disabled: true, expected: false },
  ])(
    `clear button visible=$expected for value=$value, show=$show_clear_button, disabled=$disabled`,
    (params) => {
      mount(FormulaFilter, { target: document.body, props: params })
      expect(!!document.querySelector(`.clear-btn`)).toBe(params.expected)
    },
  )

  test.each([
    { trigger: `click`, selector: `.clear-btn` },
    { trigger: `Escape`, selector: null },
  ])(`clears value on $trigger`, ({ trigger, selector }) => {
    const onchange = vi.fn()
    const onclear = vi.fn()
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe`, onchange, onclear, show_examples: false },
    })

    if (selector) {
      doc_query<HTMLButtonElement>(selector).click()
    } else {
      get_input().dispatchEvent(
        new KeyboardEvent(`keydown`, { key: trigger, bubbles: true }),
      )
    }
    flushSync()

    expect(onclear).toHaveBeenCalled()
    if (selector) expect(onchange).toHaveBeenCalledWith(``, `elements`)
  })

  test(`clear button has accessible attributes`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `Fe` } })
    const btn = doc_query(`.clear-btn`)
    expect(btn.getAttribute(`aria-label`)).toBe(`Clear filter`)
    expect(btn.getAttribute(`title`)).toBe(`Clear filter (Escape)`)
  })

  test(`exposes input_element binding`, () => {
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

  test(`syncs external value changes to input`, async () => {
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

  test(`select reflects initial search_mode`, () => {
    let mode: `elements` | `chemsys` | `exact` = `chemsys`
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
    flushSync()
    expect(get_select().value).toBe(`chemsys`)
  })

  test.each([
    { value: `Fe,O`, mode: `elements` as const, expected: `O,Fe`, trigger: `blur` },
    { value: `Fe-Li`, mode: `chemsys` as const, expected: `Li-Fe`, trigger: `Enter` },
  ])(
    `normalizes value on $trigger (mode=$mode)`,
    ({ value, mode, expected, trigger }) => {
      const onchange = vi.fn()
      let val = value
      mount(FormulaFilter, {
        target: document.body,
        props: {
          get value() {
            return val
          },
          set value(v: string) {
            val = v
          },
          search_mode: mode,
          onchange,
        },
      })

      flushSync()
      const event = trigger === `blur`
        ? new Event(`blur`, { bubbles: true })
        : new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true })
      get_input().dispatchEvent(event)
      flushSync()

      expect(onchange).toHaveBeenCalledWith(expected, mode)
    },
  )

  test(`spreads additional attributes to wrapper`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, 'data-testid': `test` },
    })
    expect(doc_query(`[data-testid="test"]`).classList.contains(`formula-filter-wrapper`))
      .toBe(
        true,
      )
  })

  describe(`examples dropdown`, () => {
    test.each([
      { show_examples: true, disabled: false, expected: true },
      { show_examples: false, disabled: false, expected: false },
      { show_examples: true, disabled: true, expected: false },
    ])(
      `help button visible=$expected when show=$show_examples, disabled=$disabled`,
      (params) => {
        mount(FormulaFilter, { target: document.body, props: { value: ``, ...params } })
        expect(!!document.querySelector(`.help-btn`)).toBe(params.expected)
      },
    )

    test(`toggles, displays content, and closes on button clicks`, () => {
      const onchange = vi.fn()
      mount(FormulaFilter, { target: document.body, props: { value: ``, onchange } })
      const help_btn = doc_query<HTMLButtonElement>(`.help-btn`)

      // Initially closed with correct aria
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`false`)
      expect(help_btn.getAttribute(`aria-label`)).toBe(`Show search examples`)

      // Open and verify content
      help_btn.click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeTruthy()
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`true`)
      // SEARCH_EXAMPLES has 3 categories (elements, chemsys, exact) with 3 examples each
      expect(document.querySelectorAll(`.example-category`).length).toBe(3)
      expect(document.querySelectorAll(`.example-tag`).length).toBe(9)
      expect(
        Array.from(document.querySelectorAll(`.category-label`)).map((el) =>
          el.textContent
        ),
      ).toEqual(
        [`Contains elements:`, `Chemical system:`, `Exact formula:`],
      )

      // Close by clicking help button again (toggles dropdown)
      help_btn.click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()

      // Reopen and verify toggle works
      help_btn.click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeTruthy()
      help_btn.click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
    })

    test(`applies example when tag is clicked`, () => {
      const onchange = vi.fn()
      mount(FormulaFilter, { target: document.body, props: { value: ``, onchange } })

      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()

      Array.from(document.querySelectorAll<HTMLButtonElement>(`.example-tag`))
        .find((tag) => tag.textContent === `Li-Fe-O`)
        ?.click()
      flushSync()

      expect(onchange).toHaveBeenCalledWith(`Li-Fe-O`, `chemsys`)
      expect(get_input().value).toBe(`Li-Fe-O`)
      expect(get_select().value).toBe(`chemsys`)
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
    })
  })
})

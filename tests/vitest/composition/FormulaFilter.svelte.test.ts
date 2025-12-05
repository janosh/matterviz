import { FormulaFilter } from '$lib/composition'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`FormulaFilter`, () => {
  const get_input = (): HTMLInputElement => doc_query(`input`)
  const get_select = (): HTMLSelectElement => doc_query(`select`)
  const get_label = (): HTMLElement => doc_query(`label.filter-group`)

  test(`renders with default props and custom label/title/value`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `` } })
    expect(get_input()).toBeTruthy()
    expect(get_select().getAttribute(`aria-label`)).toBe(`Search mode`)
    expect(Array.from(document.querySelectorAll(`option`)).map((o) => o.value)).toEqual([
      `elements`,
      `chemsys`,
      `exact`,
    ])

    document.body.innerHTML = ``
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

  test(`show_mode_selector=false hides select`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, show_mode_selector: false },
    })
    expect(document.querySelector(`select`)).toBeNull()
  })

  test(`active class tracks value; disabled state applies`, async () => {
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

    document.body.innerHTML = ``
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
  ])(`clear button visible=$expected`, (params) => {
    mount(FormulaFilter, { target: document.body, props: params })
    expect(!!document.querySelector(`.clear-btn`)).toBe(params.expected)
  })

  test(`clears value on click or Escape; Escape closes dropdown first`, () => {
    const onchange = vi.fn()
    const onclear = vi.fn()
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe`, onchange, onclear, show_examples: false },
    })

    // Click clear button
    doc_query<HTMLButtonElement>(`.clear-btn`).click()
    flushSync()
    expect(onclear).toHaveBeenCalled()
    expect(onchange).toHaveBeenCalledWith(``, `elements`)

    // Reset for Escape test with dropdown
    document.body.innerHTML = ``
    const onclear2 = vi.fn()
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe`, onclear: onclear2, show_examples: true },
    })
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
    expect(onclear2).not.toHaveBeenCalled()

    // Second Escape clears value
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
    expect(doc_query(`.clear-btn`).getAttribute(`title`)).toBe(`Clear filter (Escape)`)

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

  test(`syncs external value and search_mode changes`, async () => {
    let value = $state(``)
    let mode: `elements` | `chemsys` | `exact` = `chemsys`
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
    expect(get_input().value).toBe(``)
    expect(get_select().value).toBe(`chemsys`)

    value = `Fe,O`
    await tick()
    expect(get_input().value).toBe(`Fe,O`)
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
      .toBe(true)
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
        .find((tag) => tag.textContent === `Li-Fe-O`)?.click()
      flushSync()
      expect(onchange).toHaveBeenCalledWith(`Li-Fe-O`, `chemsys`)
      expect(get_input().value).toBe(`Li-Fe-O`)
      expect(get_select().value).toBe(`chemsys`)
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
    })
  })
})

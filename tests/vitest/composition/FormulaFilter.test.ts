import { FormulaFilter } from '$lib/composition'
import { flushSync, mount, unmount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`FormulaFilter`, () => {
  const get_input = (): HTMLInputElement => doc_query(`input`)
  const get_select = (): HTMLSelectElement => doc_query(`select`)
  const get_label = (): HTMLElement => doc_query(`label.filter-group`)
  const get_wrapper = (): HTMLElement => doc_query(`.formula-filter-wrapper`)

  test(`renders with default props`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `` } })
    expect(get_input()).toBeTruthy()
    expect(get_select()).toBeTruthy()
    expect(get_label().textContent).toContain(`Formula/Elements`)
  })

  test(`renders custom label`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, label: `Custom Filter` },
    })
    expect(get_label().textContent).toContain(`Custom Filter`)
  })

  test.each(
    [
      [`elements`, `Nb,Zr`],
      [`chemsys`, `Nb-Zr`],
      [`exact`, `NbZr2`],
    ] as const,
  )(`shows correct placeholder for %s mode`, (mode, expected) => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, search_mode: mode },
    })
    expect(get_input().placeholder).toBe(expected)
  })

  test(`hides mode selector when show_mode_selector is false`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, show_mode_selector: false },
    })
    expect(document.querySelector(`select`)).toBeNull()
  })

  test.each([
    [`Fe`, true],
    [``, false],
  ])(`active class when value=%s is %s`, (value, expected) => {
    mount(FormulaFilter, { target: document.body, props: { value } })
    expect(get_label().classList.contains(`active`)).toBe(expected)
  })

  test(`applies disabled class and attribute when disabled`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: ``, disabled: true } })
    expect(get_wrapper().classList.contains(`disabled`)).toBe(true)
    expect(get_input().disabled).toBe(true)
    expect(get_select().disabled).toBe(true)
  })

  test.each([
    { value: `Fe`, show_clear_button: true, disabled: false, expected: true },
    { value: ``, show_clear_button: true, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: false, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: true, disabled: true, expected: false },
  ])(
    `clear button visible=$expected when value=$value, show=$show_clear_button, disabled=$disabled`,
    (params) => {
      mount(FormulaFilter, { target: document.body, props: { ...params } })
      expect(!!document.querySelector(`.clear-btn`)).toBe(params.expected)
    },
  )

  test(`clears value when clear button is clicked`, () => {
    const onchange = vi.fn()
    const onclear = vi.fn()
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe`, onchange, onclear },
    })

    doc_query<HTMLButtonElement>(`.clear-btn`).click()
    flushSync()

    expect(onclear).toHaveBeenCalled()
    expect(onchange).toHaveBeenCalledWith(``, `elements`)
  })

  test(`clears value on Escape key when value is set and dropdown closed`, () => {
    const onclear = vi.fn()
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe`, onclear, show_examples: false },
    })

    get_input().dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
    )
    flushSync()

    expect(onclear).toHaveBeenCalled()
  })

  test(`exposes input_element binding after mount`, () => {
    let bound_input: HTMLInputElement | null = null
    mount(FormulaFilter, {
      target: document.body,
      props: {
        value: ``,
        get input_element() {
          return bound_input
        },
        set input_element(val: HTMLInputElement | null) {
          bound_input = val
        },
      },
    })

    flushSync()
    expect(bound_input).toBe(get_input())
  })

  test(`sets title attribute on label span`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, title: `Filter by elements` },
    })
    expect(doc_query(`label span`).getAttribute(`title`)).toBe(`Filter by elements`)
  })

  test(`syncs external value changes to input`, () => {
    let value = ``
    const component = mount(FormulaFilter, {
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

    unmount(component)
    value = `Fe,O`

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

    flushSync()
    expect(get_input().value).toBe(`Fe,O`)
  })

  test(`has aria-label on input and select`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, label: `Formula` },
    })
    expect(get_input().getAttribute(`aria-label`)).toBe(`Formula`)
    expect(get_select().getAttribute(`aria-label`)).toBe(`Search mode`)
  })

  test(`clear button has accessible attributes`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `Fe` } })
    const clear_btn = doc_query(`.clear-btn`)
    expect(clear_btn.getAttribute(`aria-label`)).toBe(`Clear filter`)
    expect(clear_btn.getAttribute(`title`)).toBe(`Clear filter (Escape)`)
  })

  test(`renders select options correctly`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `` } })
    const options = document.querySelectorAll(`option`)
    expect(options.length).toBe(3)
    expect([...options].map((opt) => opt.value)).toEqual([`elements`, `chemsys`, `exact`])
  })

  test(`input has correct initial value`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `Fe,O,N` } })
    expect(get_input().value).toBe(`Fe,O,N`)
  })

  test(`select has correct initial value based on search_mode`, () => {
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
    `calls onchange with normalized value on $trigger (mode=$mode)`,
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
      if (trigger === `blur`) {
        get_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
      } else {
        get_input().dispatchEvent(
          new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
        )
      }
      flushSync()

      expect(onchange).toHaveBeenCalledWith(expected, mode)
    },
  )

  test(`spreads additional attributes to wrapper`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, 'data-testid': `formula-filter` },
    })
    expect(
      doc_query(`[data-testid="formula-filter"]`).classList.contains(
        `formula-filter-wrapper`,
      ),
    ).toBe(true)
  })

  describe(`examples dropdown`, () => {
    test.each([
      { show_examples: true, disabled: false, expected: true },
      { show_examples: false, disabled: false, expected: false },
      { show_examples: true, disabled: true, expected: false },
    ])(
      `help button visible=$expected when show_examples=$show_examples, disabled=$disabled`,
      (params) => {
        mount(FormulaFilter, { target: document.body, props: { value: ``, ...params } })
        expect(!!document.querySelector(`.help-btn`)).toBe(params.expected)
      },
    )

    test(`toggles dropdown when help button is clicked`, () => {
      mount(FormulaFilter, { target: document.body, props: { value: `` } })
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()

      const help_btn = doc_query<HTMLButtonElement>(`.help-btn`)
      help_btn.click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeTruthy()

      help_btn.click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
    })

    test(`displays example categories and pills`, () => {
      mount(FormulaFilter, { target: document.body, props: { value: `` } })
      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()

      expect(document.querySelectorAll(`.example-category`).length).toBe(3)
      expect(document.querySelectorAll(`.example-pill`).length).toBe(6)

      const labels = [...document.querySelectorAll(`.category-label`)].map((el) =>
        el.textContent
      )
      expect(labels).toEqual([`Contains elements:`, `Chemical system:`, `Exact formula:`])
    })

    test(`applies example when pill is clicked`, () => {
      const onchange = vi.fn()
      mount(FormulaFilter, { target: document.body, props: { value: ``, onchange } })

      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()

      const chemsys_pill = [
        ...document.querySelectorAll<HTMLButtonElement>(`.example-pill`),
      ].find(
        (pill) => pill.textContent === `Li-Fe`,
      )
      chemsys_pill?.click()
      flushSync()

      expect(onchange).toHaveBeenCalledWith(`Li-Fe`, `chemsys`)
      expect(get_input().value).toBe(`Li-Fe`)
      expect(get_select().value).toBe(`chemsys`)
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
    })

    test(`closes dropdown when close button is clicked`, () => {
      mount(FormulaFilter, { target: document.body, props: { value: `` } })
      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()

      doc_query<HTMLButtonElement>(`.close-btn`).click()
      flushSync()

      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
    })

    test(`help button has accessible attributes and updates aria-expanded`, () => {
      mount(FormulaFilter, { target: document.body, props: { value: `` } })
      const help_btn = doc_query<HTMLButtonElement>(`.help-btn`)

      expect(help_btn.getAttribute(`aria-label`)).toBe(`Show search examples`)
      expect(help_btn.getAttribute(`title`)).toBe(`Show search examples`)
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`false`)

      help_btn.click()
      flushSync()
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`true`)
    })
  })
})

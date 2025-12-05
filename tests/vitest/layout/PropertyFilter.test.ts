import { PropertyFilter } from '$lib/layout'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`PropertyFilter`, () => {
  const get_inputs = (): NodeListOf<HTMLInputElement> =>
    document.querySelectorAll(`input[type="number"]`)
  const get_min_input = (): HTMLInputElement => get_inputs()[0]
  const get_max_input = (): HTMLInputElement => get_inputs()[1]
  const get_container = (): HTMLDivElement => doc_query(`.filter-container`)

  test(`renders with label (supports HTML) and two number inputs`, () => {
    mount(PropertyFilter, { target: document.body, props: { label: `E<sub>hull</sub>` } })
    expect(get_container()).toBeTruthy()
    expect(doc_query(`.filter-label sub`).textContent).toBe(`hull`)
    expect(get_inputs().length).toBe(2)
    expect(get_min_input().type).toBe(`number`)
    expect(get_min_input().step).toBe(`any`)
  })

  test.each([
    { placeholders: {}, expected_min: `min`, expected_max: `max` },
    { placeholders: { min: `0`, max: `100` }, expected_min: `0`, expected_max: `100` },
  ])(
    `placeholders: $expected_min/$expected_max`,
    ({ placeholders, expected_min, expected_max }) => {
      mount(PropertyFilter, {
        target: document.body,
        props: { label: `Test`, placeholders },
      })
      expect(get_min_input().placeholder).toBe(expected_min)
      expect(get_max_input().placeholder).toBe(expected_max)
    },
  )

  test.each([
    { min_value: 5, max_value: undefined, expected: true },
    { min_value: undefined, max_value: 100, expected: true },
    { min_value: undefined, max_value: undefined, expected: false },
  ])(
    `active class=$expected when min=$min_value, max=$max_value`,
    ({ min_value, max_value, expected }) => {
      mount(PropertyFilter, {
        target: document.body,
        props: { label: `Test`, min_value, max_value },
      })
      expect(get_container().classList.contains(`active`)).toBe(expected)
    },
  )

  test(`disabled state`, () => {
    mount(PropertyFilter, {
      target: document.body,
      props: { label: `Test`, disabled: true },
    })
    expect(get_container().classList.contains(`disabled`)).toBe(true)
    expect(get_min_input().disabled).toBe(true)
    expect(get_max_input().disabled).toBe(true)
  })

  test.each([
    { unit: `eV/atom`, expected: true },
    { unit: undefined, expected: false },
  ])(`unit label visible=$expected when unit=$unit`, ({ unit, expected }) => {
    mount(PropertyFilter, { target: document.body, props: { label: `Energy`, unit } })
    const unit_label = document.querySelector(`.unit-label`)
    expect(!!unit_label).toBe(expected)
    if (expected) expect(unit_label?.textContent).toBe(unit)
  })

  test.each([
    { min_value: 10, show_clear_button: true, disabled: false, expected: true },
    { min_value: undefined, show_clear_button: true, disabled: false, expected: false },
    { min_value: 10, show_clear_button: false, disabled: false, expected: false },
    { min_value: 10, show_clear_button: true, disabled: true, expected: false },
  ])(`clear button visible=$expected`, (params) => {
    mount(PropertyFilter, { target: document.body, props: { label: `Test`, ...params } })
    expect(!!document.querySelector(`.clear-btn`)).toBe(params.expected)
  })

  test(`clear button and Escape key clear values and fire callbacks`, () => {
    const onchange = vi.fn()
    const onclear = vi.fn()
    let min_val: number | undefined = 10
    let max_val: number | undefined = 100
    mount(PropertyFilter, {
      target: document.body,
      props: {
        label: `Test`,
        get min_value() {
          return min_val
        },
        set min_value(val: number | undefined) {
          min_val = val
        },
        get max_value() {
          return max_val
        },
        set max_value(val: number | undefined) {
          max_val = val
        },
        onchange,
        onclear,
      },
    })
    doc_query<HTMLButtonElement>(`.clear-btn`).click()
    flushSync()
    expect(onclear).toHaveBeenCalled()
    expect(onchange).toHaveBeenCalledWith(undefined, undefined)
    expect(min_val).toBeUndefined()
    expect(max_val).toBeUndefined()

    // Reset and test Escape key
    document.body.innerHTML = ``
    const onclear2 = vi.fn()
    mount(PropertyFilter, {
      target: document.body,
      props: { label: `Test`, min_value: 10, onclear: onclear2 },
    })
    get_min_input().dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
    )
    flushSync()
    expect(onclear2).toHaveBeenCalled()
  })

  test(`title and aria-label attributes (strips HTML)`, () => {
    mount(PropertyFilter, {
      target: document.body,
      props: { label: `E<sub>hull</sub>`, title: `Filter` },
    })
    expect(doc_query(`.filter-label`).getAttribute(`title`)).toBe(`Filter`)
    expect(get_min_input().getAttribute(`aria-label`)).toBe(`Ehull minimum`)
    expect(get_max_input().getAttribute(`aria-label`)).toBe(`Ehull maximum`)
  })

  test.each([
    { histogram_data: [1, 2, 3], expected: true },
    { histogram_data: [], expected: false },
    { histogram_data: undefined, expected: false },
  ])(
    `histogram visible=$expected when data length=${JSON.stringify(`$histogram_data`)}`,
    ({ histogram_data, expected }) => {
      mount(PropertyFilter, {
        target: document.body,
        props: { label: `Test`, histogram_data },
      })
      expect(!!document.querySelector(`svg`)).toBe(expected)
    },
  )

  test.each([
    { position: `top` as const, visible: true, before_row: true },
    { position: `bottom` as const, visible: true, before_row: false },
    { position: `none` as const, visible: false, before_row: false },
  ])(`histogram_position=$position`, ({ position, visible, before_row }) => {
    mount(PropertyFilter, {
      target: document.body,
      props: { label: `Test`, histogram_data: [1, 2, 3], histogram_position: position },
    })
    const svg = document.querySelector(`svg`)
    expect(!!svg).toBe(visible)
    if (visible) {
      const container = get_container()
      const row = doc_query(`.filter-row`)
      expect(
        [...container.children].findIndex((el) => el.contains(svg)) <
          [...container.children].indexOf(row),
      ).toBe(before_row)
    }
  })

  test.each([{ log: true }, { log: false }])(
    `log=$log shows/hides log label`,
    ({ log }) => {
      mount(PropertyFilter, {
        target: document.body,
        props: { label: `Test`, histogram_data: [1, 2, 3], log },
      })
      expect(!!document.querySelector(`.log-label`)).toBe(log)
    },
  )

  test(`clear button accessibility and onchange on blur`, () => {
    const onchange = vi.fn()
    mount(PropertyFilter, {
      target: document.body,
      props: { label: `Test`, min_value: 5, max_value: 10, onchange },
    })
    const clear_btn = doc_query(`.clear-btn`)
    expect(clear_btn.getAttribute(`aria-label`)).toBe(`Clear filter`)
    expect(clear_btn.getAttribute(`title`)).toBe(`Clear filter (Escape)`)
    get_min_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
    flushSync()
    expect(onchange).toHaveBeenCalledWith(5, 10)
  })

  test(`spreads additional attributes to container`, () => {
    mount(PropertyFilter, {
      target: document.body,
      props: { label: `Test`, style: `margin: 10px`, 'data-testid': `property-filter` },
    })
    const container = doc_query<HTMLDivElement>(`[data-testid="property-filter"]`)
    expect(container.style.margin).toBe(`10px`)
    expect(container.classList.contains(`filter-container`)).toBe(true)
  })
})

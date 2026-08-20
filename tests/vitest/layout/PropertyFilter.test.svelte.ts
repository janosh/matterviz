import { PropertyFilter } from '$lib/layout'
import { type ComponentProps, flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`PropertyFilter`, () => {
  const inputs = () => document.querySelectorAll<HTMLInputElement>(`input[type="number"]`)
  const container = () => doc_query<HTMLDivElement>(`.filter-container`)
  const mount_filter = (props: Partial<ComponentProps<typeof PropertyFilter>> = {}) => {
    mount(PropertyFilter, { target: document.body, props: { label: `Test`, ...props } })
    flushSync()
  }

  test(`renders an HTML label, two any-step number inputs with plain aria-labels, spreads attrs`, () => {
    mount_filter({
      label: `E<sub>hull</sub>`,
      title: `Filter`,
      placeholders: { min: `0`, max: `100` },
      style: `margin: 10px`,
      'data-testid': `property-filter`,
    })
    expect(doc_query(`.filter-label sub`).textContent).toBe(`hull`)
    expect(doc_query(`.filter-label`).getAttribute(`title`)).toBe(`Filter`)
    const [min_input, max_input] = inputs()
    expect([min_input.step, max_input.step]).toEqual([`any`, `any`])
    expect([min_input.placeholder, max_input.placeholder]).toEqual([`0`, `100`])
    expect(min_input.getAttribute(`aria-label`)).toBe(`Ehull minimum`)
    expect(max_input.getAttribute(`aria-label`)).toBe(`Ehull maximum`)
    expect(container().dataset.testid).toBe(`property-filter`)
    expect(container().style.margin).toBe(`10px`)
  })

  test.each<[Partial<ComponentProps<typeof PropertyFilter>>, boolean, boolean]>([
    [{ min_value: 5 }, true, true],
    [{ max_value: 100 }, true, true],
    [{}, false, false],
    [{ min_value: 10, disabled: true }, true, false],
  ])(`props %j -> active=%s, clear button=%s`, (props, active, has_clear) => {
    mount_filter(props)
    expect(container().classList.contains(`active`)).toBe(active)
    expect(Boolean(document.querySelector(`.clear-btn`))).toBe(has_clear)
    expect(container().classList.contains(`disabled`)).toBe(Boolean(props.disabled))
    expect(inputs()[0].disabled).toBe(Boolean(props.disabled))
    expect([...inputs()].map((input) => input.placeholder)).toEqual([`min`, `max`])
  })

  test.each([
    [`eV/atom`, true],
    [undefined, false],
  ])(`unit %p renders a unit label = %s`, (unit, expected) => {
    mount_filter({ unit })
    expect(document.querySelector(`.unit-label`)?.textContent ?? null).toBe(unit ?? null)
    expect(Boolean(document.querySelector(`.unit-label`))).toBe(expected)
  })

  test(`clear button and Escape reset both bounds and fire onclear before onchange`, () => {
    const calls: string[] = []
    const state = $state<{ min_value?: number; max_value?: number }>({
      min_value: 10,
      max_value: 100,
    })
    mount(PropertyFilter, {
      target: document.body,
      props: {
        label: `Test`,
        get min_value() {
          return state.min_value
        },
        set min_value(val) {
          state.min_value = val
        },
        get max_value() {
          return state.max_value
        },
        set max_value(val) {
          state.max_value = val
        },
        onclear: () => {
          calls.push(`clear`)
        },
        onchange: (min: number | undefined, max: number | undefined) => {
          calls.push(`change:${min}:${max}`)
        },
      },
    })
    flushSync()
    const clear_btn = doc_query<HTMLButtonElement>(`.clear-btn`)
    expect(clear_btn.getAttribute(`aria-label`)).toBe(`Clear filter`)
    clear_btn.click()
    flushSync()
    expect(calls).toEqual([`clear`, `change:undefined:undefined`])
    expect([state.min_value, state.max_value]).toEqual([undefined, undefined])
    expect(document.querySelector(`.clear-btn`)).toBeNull()

    state.min_value = 10
    flushSync()
    inputs()[0].dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
    flushSync()
    expect(calls).toHaveLength(4)
    expect(state.min_value).toBeUndefined()
    // Escape with nothing set is a no-op
    inputs()[0].dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
    flushSync()
    expect(calls).toHaveLength(4)
  })

  test(`blur reports the current bounds and Enter blurs the input`, () => {
    const onchange = vi.fn()
    mount_filter({ min_value: 5, max_value: 10, onchange })
    const [min_input] = inputs()
    min_input.focus()
    min_input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    expect(document.activeElement).not.toBe(min_input)
    min_input.dispatchEvent(new Event(`blur`, { bubbles: true }))
    flushSync()
    expect(onchange).toHaveBeenCalledWith(5, 10)
  })

  test.each([
    [{ histogram_data: [1, 2, 3] }, `top`],
    [{ histogram_data: [1, 2, 3], histogram_position: `bottom` as const }, `bottom`],
    [{ histogram_data: [1, 2, 3], histogram_position: `none` as const }, null],
    [{ histogram_data: [] }, null],
    [{}, null],
  ])(`histogram for %j renders at %s`, (props, position) => {
    mount_filter({ ...props, log: true })
    const svg = document.querySelector(`svg`)
    expect(Boolean(svg)).toBe(position !== null)
    expect(Boolean(document.querySelector(`.log-label`))).toBe(position !== null)
    if (!svg) return
    const children = [...container().children]
    const svg_idx = children.findIndex((el) => el.contains(svg))
    const row_idx = children.indexOf(doc_query(`.filter-row`))
    expect(svg_idx < row_idx).toBe(position === `top`)
  })
})

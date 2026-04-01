import ThemeControl from '$lib/theme/ThemeControl.svelte'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

vi.mock(`$lib/theme`, () => ({
  apply_theme_to_dom: vi.fn(),
  save_theme_preference: vi.fn(),
  THEME_OPTIONS: [
    { value: `light`, label: `Light`, icon: `☀️` },
    { value: `dark`, label: `Dark`, icon: `🌙` },
    { value: `auto`, label: `Auto`, icon: `🔄` },
  ],
}))

vi.mock(`$lib/state.svelte`, () => ({ theme_state: { mode: `light` } }))

describe(`ThemeControl`, () => {
  test(`renders select element with theme options`, () => {
    mount(ThemeControl, { target: document.body, props: {} })

    const select = doc_query(`select.theme-control`)
    expect(select).toBeInstanceOf(HTMLSelectElement)
    expect(select.tagName).toBe(`SELECT`)

    const options = select.querySelectorAll(`option`)
    expect(options).toHaveLength(3)
    expect(options[0].value).toBe(`light`)
    expect(options[0].textContent).toMatch(/^☀️\s+Light/u)
    expect(options[1].value).toBe(`dark`)
    expect(options[1].textContent).toMatch(/^🌙\s+Dark/u)
    expect(options[2].value).toBe(`auto`)
    expect(options[2].textContent).toMatch(/^🔄\s+Auto/u)
  })

  test(`applies custom class when provided`, () => {
    mount(ThemeControl, {
      target: document.body,
      props: { class: `custom-theme-control` },
    })

    const select = doc_query(`select.theme-control.custom-theme-control`)
    expect(select).toBeInstanceOf(HTMLSelectElement)
  })

  test(`forwards additional props to select element`, () => {
    mount(ThemeControl, {
      target: document.body,
      props: { 'data-testid': `theme-select`, 'aria-label': `Select theme` },
    })

    const select = doc_query(`select.theme-control`)
    expect(select.getAttribute(`data-testid`)).toBe(`theme-select`)
    expect(select.getAttribute(`aria-label`)).toBe(`Select theme`)
  })
})

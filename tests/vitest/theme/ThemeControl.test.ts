import ThemeControl from '$lib/theme/ThemeControl.svelte'
import { mount } from 'svelte'
import ThemeControlTypeFixture from './ThemeControlTypeFixture.svelte'
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
  test(`renders theme options with a default aria-label`, () => {
    mount(ThemeControl, { target: document.body, props: {} })

    const select = doc_query(`select.theme-control`)
    expect(select).toBeInstanceOf(HTMLSelectElement)
    expect(select.getAttribute(`aria-label`)).toBe(`Color theme`)

    const options = [...select.querySelectorAll(`option`)]
    expect(options.map((opt) => [opt.value, opt.textContent?.replace(/\s+/u, ` `)])).toEqual([
      [`light`, `☀️ Light`],
      [`dark`, `🌙 Dark`],
      [`auto`, `🔄 Auto`],
    ])
  })

  test(`forwards class, aria-label and other props to select element`, () => {
    mount(ThemeControl, {
      target: document.body,
      props: {
        class: `custom-theme-control`,
        'data-testid': `theme-select`,
        'aria-label': `Select theme`,
      },
    })

    const select = doc_query(`select.theme-control.custom-theme-control`)
    expect(select.getAttribute(`data-testid`)).toBe(`theme-select`)
    expect(select.getAttribute(`aria-label`)).toBe(`Select theme`)
  })

  // The type-level pin (native `onchange` rejected, `on_change` accepted) lives in
  // ThemeControlTypeFixture.svelte, which svelte-check covers; this only keeps it mounting
  test(`on_change replaces the native onchange (fixture mounts and stays silent)`, () => {
    const on_change = vi.fn()
    mount(ThemeControlTypeFixture, { target: document.body, props: { on_change } })
    expect(document.querySelectorAll(`select.theme-control`)).toHaveLength(2)
    expect(on_change).not.toHaveBeenCalled()
  })
})

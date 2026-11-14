import ThemeControl from '#lib/theme/ThemeControl.svelte'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vite-plus/test'
import { doc_query } from '../setup'

vi.mock(`#lib/theme/index.js`, () => ({
  apply_theme_to_dom: vi.fn(),
  save_theme_preference: vi.fn(),
  THEME_OPTIONS: [
    { value: `light`, label: `Light`, icon: `☀️` },
    { value: `dark`, label: `Dark`, icon: `🌙` },
    { value: `auto`, label: `Auto`, icon: `🔄` },
  ],
}))

vi.mock(`#lib/state.svelte.js`, () => ({ theme_state: { mode: `light` } }))

describe(`ThemeControl`, () => {
  test(`renders theme options with a default aria-label`, () => {
    mount(ThemeControl, { target: document.body, props: {} })

    const select = doc_query(`select.theme-control`)
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
})

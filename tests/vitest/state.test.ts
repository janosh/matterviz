import { DEFAULT_CATEGORY_COLORS, default_element_colors } from '#lib/colors/index.js'
import { colors, resolve_theme_text_color, theme_state } from '#lib/state.svelte.js'
import { AUTO_THEME } from '#lib/theme/index.js'
import { afterEach, expect, test, vi } from 'vitest'

// happy-dom rejects light-dark() on a probe's style, so stand in for the browser: the probe
// keeps any value and computes light-dark() to the branch for the root's color-scheme
const emulate_browser_probe = (): void => {
  const probe = document.createElement(`span`)
  Object.defineProperty(probe, `style`, { value: { color: `` } })
  vi.spyOn(document, `createElement`).mockReturnValue(probe)
  const real = globalThis.getComputedStyle
  vi.spyOn(globalThis, `getComputedStyle`).mockImplementation((element) => {
    if (!(element instanceof HTMLSpanElement)) return real(element)
    const { color } = element.style
    const branches = /^light-dark\((?<light>.+), (?<dark>.+)\)$/.exec(color)?.groups
    const { light = color, dark = color } = branches ?? {}
    const is_dark = document.documentElement.style.colorScheme === `dark`
    return { color: is_dark ? dark : light } as CSSStyleDeclaration
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty(`--text-color`)
  document.documentElement.style.colorScheme = ``
})

test(`theme_state starts in auto mode`, () => {
  expect(theme_state).toEqual({ mode: AUTO_THEME })
})

test(`colors state starts from the default palettes as independent copies`, () => {
  expect(colors).toEqual({
    category: DEFAULT_CATEGORY_COLORS,
    element: default_element_colors,
  })
  expect(colors.element).not.toBe(default_element_colors)
})

test.each([
  [``, `light`, undefined],
  [`transparent`, `light`, undefined], // callers fall back to #808080
  [`not-a-color`, `light`, undefined],
  [`#123456`, `light`, `#123456`],
  [`light-dark(#123456, #eee)`, `light`, `#123456`],
  [`light-dark(#123456, #eee)`, `dark`, `#eee`],
])(
  `resolve_theme_text_color: --text-color %j in %s scheme -> %s`,
  (token, scheme, expected) => {
    emulate_browser_probe()
    const root = document.documentElement
    if (token) root.style.setProperty(`--text-color`, token)
    root.style.colorScheme = scheme
    expect(resolve_theme_text_color()).toBe(expected)
  },
)

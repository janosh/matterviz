import type { Paint } from '#lib/colors/index.js'
import {
  add_alpha,
  composite_colors,
  CONTRAST_MEMO_LIMIT,
  contrast_color_memo,
  contrast_text_color,
  css_color_to_hex,
  DEFAULT_CATEGORY_COLORS,
  ELEMENT_COLOR_SCHEMES,
  get_d3_interpolator,
  is_color,
  is_concrete_color,
  is_dark_mode,
  is_d3_interpolate_name,
  is_opaque_color,
  perceived_brightness,
  pick_contrast_color,
  PLOT_COLORS,
  tooltip_paint,
  watch_dark_mode,
} from '#lib/colors/index.js'
import { ELEM_SYMBOLS } from '#lib/element/types.js'
import { rgb as d3_rgb } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'
import { beforeEach, describe, expect, it, test, vi } from 'vitest'

test(`every d3-scale-chromatic interpolate* export is a registered interpolator`, () => {
  const names = Object.keys(d3_sc).filter((name) => name.startsWith(`interpolate`))
  expect(names.length).toBeGreaterThan(20)
  for (const name of names) {
    expect(is_d3_interpolate_name(name)).toBe(true)
    if (is_d3_interpolate_name(name)) expect(get_d3_interpolator(name)).toBeTypeOf(`function`)
  }
  expect(is_d3_interpolate_name(`schemeViridis`)).toBe(false)
  // @ts-expect-error exercise the runtime guard for JavaScript callers
  expect(() => get_d3_interpolator(`invalid`)).toThrow(
    `Unknown D3 color interpolator: invalid`,
  )
})

describe(`Element Color Schemes`, () => {
  test(`all schemes have identical, complete element coverage`, () => {
    const schemes = [`Alloy`, `Dark Mode`, `Jmol`, `Muted`, `Pastel`, `Vesta`]
    expect(Object.keys(ELEMENT_COLOR_SCHEMES).toSorted()).toEqual(schemes)
    const expected_keys = Object.keys(ELEMENT_COLOR_SCHEMES.Vesta).toSorted()
    expect(expected_keys).toEqual(expect.arrayContaining(ELEM_SYMBOLS.slice(0, 109)))
    for (const [scheme_name, colors] of Object.entries(ELEMENT_COLOR_SCHEMES)) {
      expect(Object.keys(colors).toSorted(), `${scheme_name} coverage`).toEqual(expected_keys)
    }
  })

  test(`pastel scheme has pastel characteristics`, () => {
    for (const element of [`H`, `C`, `O`, `Fe`, `Au`]) {
      const color = ELEMENT_COLOR_SCHEMES.Pastel[element]
      const channels = [1, 3, 5].map((idx) => parseInt(color.slice(idx, idx + 2), 16))
      const lightness = (Math.max(...channels) + Math.min(...channels)) / 2
      expect(lightness, `${element} Pastel lightness`).toBeGreaterThan(120)
    }
  })
})

describe(`color constants`, () => {
  it.each<[string, readonly string[]]>([
    ...Object.entries(ELEMENT_COLOR_SCHEMES).map(([scheme, colors]): [string, string[]] => [
      `${scheme} element`,
      Object.values(colors),
    ]),
    [`category`, Object.values(DEFAULT_CATEGORY_COLORS)],
    [`plot`, PLOT_COLORS],
  ])(`%s colors are all valid 6-digit hex`, (_label, colors) => {
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it(`PLOT_COLORS has 10 unique colors`, () => {
    expect(PLOT_COLORS).toHaveLength(10)
    expect(new Set(PLOT_COLORS).size).toBe(PLOT_COLORS.length)
  })
})

describe(`is_color function`, () => {
  // oxfmt-ignore
  test.each([
    [`#ff0000`, true], [`#FF0000`, true], [`#f00`, true],
    [`#00ff00ab`, true], // 8-digit hex with alpha
    [`rgb(255, 0, 0)`, true], [`rgb(255,0,0)`, true], [`rgba(255, 0, 0, 0.5)`, true],
    // rgb/rgba are aliases, as for the browser's canvas parser used where a DOM exists
    [`rgb(255, 0, 0, 0.5)`, true], [`rgba(255, 0, 0)`, true],
    [`hsl(120, 100%, 50%)`, true], [`hsla(120, 100%, 50%, 0.8)`, true], [`var(--my-color)`, true],
    [`color(srgb 1 0 0)`, true], [`color(display-p3 1 0.5 0)`, true],
    [`red`, true], [`rebeccapurple`, true], [`transparent`, true], [`currentcolor`, true],
    [`RED`, true], // named colors are case-insensitive
    [`RGB(255, 0, 0)`, true], // function names are case-insensitive
    [` #ff0000 `, true], // whitespace is trimmed
    [`pending`, false], // arbitrary words are not colors
    [`hello world`, false], [``, false], [123, false], [null, false],
    // incomplete or malformed functions and hex
    [`rgb`, false], [`var`, false], [`color`, false], [`#gg0000`, false], [`#12`, false],
    [`rgb(255, 0)`, false], // incomplete rgb values are rejected
    [`#12345`, false], // 5-digit hex is invalid (regression vs old COLOR_FN_REGEX)
    [`#1234567`, false], // 7-digit hex is invalid (regression vs old COLOR_FN_REGEX)
  ])(`%s -> %s`, (input, expected) => {
    expect(is_color(input)).toBe(expected)
  })

  test.each([
    [`#4fc3f7`, true],
    [`rgb(79 195 247)`, true],
    [`rgb(79 195 247 / 50%)`, true],
    [`var(--accent)`, false],
    [`currentcolor`, false],
    [`transparent`, false],
  ])(`is_concrete_color(%s) is %s`, (color, expected) => {
    expect(is_concrete_color(color)).toBe(expected)
  })
  test.each([
    [`#4fc3f7`, true],
    [`rgb(79 195 247)`, true],
    [`rgb(79 195 247 / 50%)`, false],
    [`rgba(79, 195, 247, 0.5)`, false],
    [`transparent`, false],
    [`var(--accent)`, false],
  ])(`is_opaque_color(%s) is %s`, (color, expected) => {
    expect(is_opaque_color(color)).toBe(expected)
  })
})

// oxfmt-ignore
test.each([
  // hex passes through lowercased, short hex expanded
  [`#ff0000`, `#ff0000`], [`#FF0000`, `#ff0000`], [`#f00`, `#ff0000`],
  // CSS color functions are parsed, alpha ignored
  [`rgb(255, 0, 0)`, `#ff0000`], [`rgb(0 128 255)`, `#0080ff`], [`rgb(0, 128, 255)`, `#0080ff`],
  [`rgba(255, 0, 0, 0.5)`, `#ff0000`], [`rgba(255, 0, 0, 0)`, `#ff0000`],
  [`hsl(0, 100%, 50%)`, `#ff0000`], [`hsl(120, 100%, 50%)`, `#00ff00`],
  [`hsla(240, 100%, 50%, 0.8)`, `#0000ff`], [`red`, `#ff0000`],
  [`green`, `#008000`], // CSS green is #008000, not #00ff00
  // transparent maps to white, whatever its case or padding
  [`transparent`, `#ffffff`], [` Transparent `, `#ffffff`],
  // unresolvable inputs (CSS vars included) return the fallback
  [undefined, `#abcdef`], [``, `#abcdef`], [`var(--color)`, `#abcdef`],
  [`not-a-color`, `#abcdef`], [`#gggggg`, `#abcdef`], [`rgb(invalid)`, `#abcdef`],
] as const)(`css_color_to_hex(%s) = %s`, (input, expected) => {
  expect(css_color_to_hex(input, `#abcdef`)).toBe(expected)
})

test.each([
  [`#000000`, 0],
  [`#ffffff`, 1],
  [`#ff0000`, 0.299],
  [`#00ff00`, 0.587],
  [`#0000ff`, 0.114],
  [`#808080`, 0.502],
  [`#ff8000`, 0.594],
  [`red`, 0.299],
])(`perceived_brightness(%s) = %s`, (color, expected_brightness) => {
  expect(perceived_brightness(color)).toBeCloseTo(expected_brightness, 3)
})

describe(`pick_contrast_color`, () => {
  it.each<[Paint, string]>([
    [{ background: `#000000` }, `white`],
    [{ background: `#4fc3f7` }, `black`], // light cyan
    [{ background: `#1f77b4` }, `white`], // dark blue: white 4.8:1 vs black 4.4:1
    // near-tie: black edges ahead (4.60 vs 4.57) but white reaches AA, so white wins
    [{ background: `#4e79a7` }, `white`], // PLOT_COLORS[0] steelblue
    // mid-tones where white text falls below 4.5:1 WCAG (white:black ratio in comments)
    [{ background: `#00a1ff` }, `black`], // Vesta Pa 2.8:7.5
    [{ background: `#59a14f` }, `black`], // PLOT_COLORS[4] green 3.2:6.6
    [{ background: `#808080` }, `black`], // mid gray 3.9:5.3
    [{ background: `#ffffff`, choices: [`red`, `blue`] }, `blue`],
    [{ background: `rgba(255, 255, 255, 0.1)`, backdrop: `black` }, `white`],
    [{ background: `rgba(0, 0, 0, 0.1)`, backdrop: `white` }, `black`],
    [{ background: `transparent`, backdrop: `black` }, `white`],
  ])(`pick_contrast_color(%o) = %s`, (paint, expected) => {
    expect(pick_contrast_color(paint)).toBe(expected)
  })

  it(`prefers white at AA, else the higher ratio, on every element-scheme and d3-scale color`, () => {
    // independent oracle: WCAG 2 relative luminance and contrast ratio
    const luminance = (color: string): number => {
      const { r: red, g: green, b: blue } = d3_rgb(color)
      const [lin_r, lin_g, lin_b] = [red, green, blue].map((channel) => {
        const fraction = channel / 255
        return fraction <= 0.04045 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * lin_r + 0.7152 * lin_g + 0.0722 * lin_b
    }
    const ratio = (lum_a: number, lum_b: number) =>
      (Math.max(lum_a, lum_b) + 0.05) / (Math.min(lum_a, lum_b) + 0.05)
    const scale_names = Object.keys(d3_sc).filter(is_d3_interpolate_name)
    const backgrounds = new Set([
      ...Object.values(ELEMENT_COLOR_SCHEMES).flatMap(Object.values),
      ...PLOT_COLORS,
      ...scale_names.flatMap((name) =>
        Array.from({ length: 21 }, (_, idx) => get_d3_interpolator(name)(idx / 20)),
      ),
    ])
    expect(backgrounds.size).toBeGreaterThan(1000)
    const failures = [...backgrounds].flatMap((background) => {
      const bg_lum = luminance(background)
      const picked = pick_contrast_color({ background })
      const [black, white] = [ratio(0, bg_lum), ratio(1, bg_lum)]
      const picked_ratio = picked === `black` ? black : white
      // white whenever it reaches AA, otherwise whichever contrasts more; black or white
      // always reaches ≥ 4.58:1, so the pick meets AA too
      const expected_ratio = white >= 4.5 ? white : Math.max(black, white)
      return picked_ratio !== expected_ratio || picked_ratio < 4.5
        ? [`${background}: ${picked} at ${picked_ratio} (black ${black}, white ${white})`]
        : []
    })
    expect(failures).toEqual([])
  })

  it.each<[Paint, string]>([
    [{ background: `not-a-color` }, `Invalid color: not-a-color`],
    [{ background: `rgba(255, 255, 255, 0.1)` }, `Translucent background requires a backdrop`],
    [
      { background: `rgba(255, 255, 255, 0.1)`, backdrop: `rgba(0, 0, 0, 0.5)` },
      `backdrop must be opaque`,
    ],
  ])(`rejects invalid paint %o`, (paint, error) => {
    expect(() => pick_contrast_color(paint)).toThrow(error)
  })

  it.each<[Paint, string]>([
    // CSS vars cannot be resolved in JS, so inherit rather than guess
    [{ background: `var(--some-bg)` }, `currentColor`],
    [{ background: `#000000` }, `white`],
  ])(`contrast_text_color(%o) = %s`, (paint, expected) => {
    expect(contrast_text_color(paint)).toBe(expected)
  })

  // opaque fills dress the tooltip; anything else keeps the neutral themed chip
  it.each([
    [`#59a14f`, { background: `#59a14f`, color: `black` }],
    [`#1f3a5f`, { background: `#1f3a5f`, color: `white` }],
    [`rgba(255, 255, 255, 0.5)`, null],
    [`var(--fill)`, null],
    [null, null],
  ])(`tooltip_paint(%s) = %o`, (fill, expected) => {
    expect(tooltip_paint(fill)).toEqual(expected)
  })

  it(`tooltip_paint asks a custom picker for opaque fills only`, () => {
    const pick = vi.fn(() => `red`)
    expect(tooltip_paint(`#59a14f`, pick)).toEqual({ background: `#59a14f`, color: `red` })
    expect(tooltip_paint(`var(--fill)`, pick)).toBeNull()
    expect(pick).toHaveBeenCalledExactlyOnceWith(`#59a14f`)
    expect(tooltip_paint(`#59a14f`, () => null)).toBeNull()
  })

  it(`contrast_color_memo matches pick_contrast_color and follows backdrop/alpha changes`, () => {
    let backdrop = `white`
    let alpha = 0.1
    const memo = contrast_color_memo({ backdrop: () => backdrop, alpha: () => alpha })
    expect(memo(`var(--bg)`)).toBeNull()
    // a faint black wash over white reads as a light cell
    expect(memo(`#000000`)).toBe(`black`)
    // the cached answer is dropped when the backdrop changes
    backdrop = `black`
    expect(memo(`#000000`)).toBe(`white`)
    alpha = 1
    expect(memo(`#ffffff`)).toBe(`black`)
  })

  it(`contrast_color_memo evicts FIFO past the cap instead of dropping the whole cache`, () => {
    const pick = vi.fn(pick_contrast_color)
    const plain = contrast_color_memo({ pick })
    const color_at = (idx: number) => `rgb(${idx % 256}, ${Math.floor(idx / 256)}, 128)`
    const n_colors = CONTRAST_MEMO_LIMIT + 5
    const colors = Array.from({ length: n_colors }, (_, idx) => color_at(idx))
    // past the cache limit every answer still agrees with the unmemoized pick
    const mismatches = colors.filter(
      (color) => plain(color) !== pick_contrast_color({ background: color }),
    )
    expect(mismatches).toEqual([])
    expect(pick).toHaveBeenCalledTimes(n_colors)
    // the 5 oldest entries were evicted one by one; the rest are still hits. A clear-all
    // would have dropped everything up to the cap and made these all misses.
    for (const color of colors.slice(5)) plain(color)
    expect(pick).toHaveBeenCalledTimes(n_colors)
    for (const color of colors.slice(0, 5)) plain(color)
    expect(pick).toHaveBeenCalledTimes(n_colors + 5)
  })
})

test.each([
  [`rgba(255, 255, 255, 0.1)`, `black`, `rgb(26, 26, 26)`],
  [`transparent`, `red`, `rgb(255, 0, 0)`],
  [`red`, `transparent`, `rgb(255, 0, 0)`],
])(`composites %s over %s`, (foreground, backdrop, expected) => {
  expect(composite_colors(foreground, backdrop)).toBe(expected)
})

describe(`add_alpha`, () => {
  it.each([
    [`#ff0000`, 0.5, `rgba(255, 0, 0, 0.5)`],
    [`#abc`, 0.3, `rgba(170, 187, 204, 0.3)`],
    [`rgb(100, 150, 200)`, 0.8, `rgba(100, 150, 200, 0.8)`],
    [`rgba(100, 150, 200, 0.2)`, 0.9, `rgba(100, 150, 200, 0.9)`],
    [`rgb(100, 150, 200, 0.2)`, 0.9, `rgba(100, 150, 200, 0.9)`],
    [`rgba(255, 0, 0, 0)`, 0.5, `rgba(255, 0, 0, 0.5)`],
    [`rgba(100, 100, 100, 1e-5)`, 0.6, `rgba(100, 100, 100, 0.6)`], // scientific notation
    [`rgba(50, 50, 50, 1.5E+2)`, 0.1, `rgba(50, 50, 50, 0.1)`], // uppercase E with +
    [`unknown-format`, 0.5, `unknown-format`], // passthrough unknown
  ])(`add_alpha(%s, %s) = %s`, (color, alpha, expected) => {
    expect(add_alpha(color, alpha)).toBe(expected)
  })
})

describe(`is_dark_mode + watch_dark_mode`, () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0)) // observers report async
  beforeEach(() => {
    document.documentElement.removeAttribute(`style`)
    delete document.documentElement.dataset.theme
  })

  // The element's computed color-scheme is the single source: the root's inline scheme on the
  // site, a widget element's own scheme in a notebook; nothing declared → the OS preference
  it.each([
    [`dark`, true],
    [`light`, false],
    [`light dark`, false],
  ])(`reads a declared color-scheme %j -> dark=%s`, (scheme, expected) => {
    document.documentElement.style.colorScheme = scheme
    expect(is_dark_mode()).toBe(expected)
  })

  it(`a widget element's own scheme wins over the page root's`, () => {
    document.documentElement.style.colorScheme = `light`
    const widget = document.createElement(`div`)
    widget.style.colorScheme = `dark`
    document.body.append(widget)
    const canvas = document.createElement(`canvas`)
    widget.append(canvas)
    expect(is_dark_mode(canvas)).toBe(true)
    expect(is_dark_mode()).toBe(false)
    widget.remove()
  })

  it(`watch_dark_mode reports changes for the element's scheme, never on subscribe, and stops after cleanup`, async () => {
    // silent on subscribe: callers subscribe inside effects that write state in the callback
    const widget = document.createElement(`div`)
    document.body.append(widget)
    const widget_calls: boolean[] = []
    const stop_widget = watch_dark_mode((dark) => widget_calls.push(dark), widget)
    expect(widget_calls).toEqual([])
    widget.style.colorScheme = `dark` // the element's own scheme is not watched, its roots are
    document.documentElement.style.colorScheme = `light`
    await settle()
    expect(widget_calls.at(-1)).toBe(true) // re-read from the element, not the (light) root
    stop_widget()
    widget.remove()

    const calls: boolean[] = []
    const cleanup = watch_dark_mode((dark) => calls.push(dark))
    expect(calls).toEqual([])
    document.documentElement.style.colorScheme = `dark`
    await settle()
    expect(calls.at(-1)).toBe(true)
    cleanup()
    const count = calls.length
    document.documentElement.style.colorScheme = `light`
    await settle()
    expect(calls).toHaveLength(count)
  })
})

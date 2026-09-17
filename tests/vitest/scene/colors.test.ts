import { brighten_hex, css_to_linear_rgb, parse_linear_rgb } from '$lib/scene/colors'
import { Color } from 'three/webgpu'
import { expect, test } from 'vitest'

test.each([parse_linear_rgb, css_to_linear_rgb])(
  `%s converts CSS to linear RGB without stale scratch colors`,
  (parse) => {
    // Compare directly with Three's conversion to catch missing or doubled sRGB conversion.
    for (const css of [`#57178f`, `rebeccapurple`, `rgb(0, 128, 255)`])
      expect(parse(css)).toEqual(new Color(css).toArray())
    // D3 accepts uppercase RGBA and preserves out-of-gamut channels; CSS clamps the latter.
    expect(parse(`RGBA(0, 128, 255, 1)`)).toEqual(parse(`rgb(0, 128, 255)`))
    expect(parse(`rgb(300, -20, 0)`)).toEqual(new Color(`rgb(255, 0, 0)`).toArray())
    // Invalid/transparent colors have no usable hue, even after a valid scratch color.
    expect(parse(`not-a-color`)).toEqual([0.5, 0.5, 0.5])
    expect(parse(`rgba(255, 0, 0, 0)`)).toEqual([0.5, 0.5, 0.5])
  },
)

test(`brighten_hex lifts luminance while keeping the source hue family`, () => {
  const source = `#57178f` // deep purple (Cs-like)
  const bright = brighten_hex(source, 0.55)
  expect(bright).toBe(`#cac4d6`)
  const src = new Color(source)
  const out = new Color(bright)
  // Strictly brighter than the atom color (dirty gray hover used to lose the hue entirely).
  expect(out.r + out.g + out.b).toBeGreaterThan(src.r + src.g + src.b)
  // Still purple-ish: blue and red dominate green (not a neutral wash).
  expect(out.b).toBeGreaterThan(out.g)
  expect(out.r).toBeGreaterThan(out.g)
  expect(brighten_hex(source, 0)).toBe(`#57178f`)
  expect(brighten_hex(source, 1)).toBe(`#ffffff`)
  expect(brighten_hex(undefined)).toBe(`#eaeaea`) // #cccccc lifted by the default 0.55
  // an unparsable color glows grey (linear 0.5 mixed 55% toward white), not in the hue the
  // previous call left behind — three's Color.set would have kept the red
  brighten_hex(`#ff0000`)
  expect(brighten_hex(`not-a-color`)).toBe(`#${new Color(0.775, 0.775, 0.775).getHexString()}`)
})

test(`css_to_linear_rgb memoizes without changing results, and stays bounded`, () => {
  // same array identity proves the second call came from the cache rather than a reparse
  const first = css_to_linear_rgb(`#57178f`)
  expect(css_to_linear_rgb(`#57178f`)).toBe(first)
  expect([...first]).toEqual(new Color(`#57178f`).toArray())
  // every caller shares that tuple, so a stray write must not be able to repaint later reads
  expect(Object.isFrozen(first)).toBe(true)

  // A continuous property color scale mints a distinct string per value, so the cache has to
  // evict — 5000 unique keys against a 4096 cap. Correctness of an evicted key must not depend
  // on it still being resident, and eviction must not strand a wrong value behind a live key.
  const many_colors = Array.from(
    { length: 5000 },
    (_, idx) => `rgb(${idx % 256}, ${Math.floor(idx / 256)}, 9)`,
  )
  expect(new Set(many_colors).size).toBe(many_colors.length)
  const fresh = many_colors.map((css) => [...parse_linear_rgb(css)])
  expect(many_colors.map((css) => [...css_to_linear_rgb(css)])).toEqual(fresh)
  expect(many_colors.map((css) => [...css_to_linear_rgb(css)])).toEqual(fresh)
})

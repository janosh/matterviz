import { HIGHLIGHT } from '#lib/colors/index.js'
import {
  brighten_hex,
  css_to_linear_rgb,
  highlight_edge_color,
  parse_linear_rgb,
} from '#lib/scene/colors.js'
import { Color } from 'three/webgpu'
import { expect, test } from 'vite-plus/test'

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

// A quarter of the way to white in sRGB: lighter, in the same hue. 55% in Linear-sRGB turned
// band 2's blue Fermi sheet near white (#c6d2e4) under the hover highlight.
test(`brighten_hex lifts luminance while keeping the source hue family`, () => {
  const source = `#57178f` // deep purple (Cs-like)
  const bright = brighten_hex(source)
  expect(bright).toBe(`#8151ab`)
  const src = new Color(source)
  const out = new Color(bright)
  // Strictly brighter than the atom color (dirty gray hover used to lose the hue entirely).
  expect(out.r + out.g + out.b).toBeGreaterThan(src.r + src.g + src.b)
  // Still purple-ish: blue and red dominate green (not a neutral wash).
  expect(out.b).toBeGreaterThan(out.g)
  expect(out.r).toBeGreaterThan(out.g)
  // each sRGB channel a quarter of the way to 255: 0x37 -> 0x69, 0x7e -> 0x9e, 0xb8 -> 0xca
  expect(brighten_hex(`#377eb8`)).toBe(`#699eca`)
  expect(brighten_hex(undefined)).toBe(`#d9d9d9`) // #cccccc lifted a quarter toward white
  // an unparsable color glows grey (linear 0.5, i.e. sRGB #bcbcbc, lifted a quarter toward
  // white), not in the hue the previous call left behind: three's Color.set would keep the red
  brighten_hex(`#ff0000`)
  expect(brighten_hex(`not-a-color`)).toBe(`#cccccc`)
})

// Bit-identical to the chempot domain outline it replaced: three's Color scaled by 0.6 in
// Linear-sRGB, the darker the fill the darker the edge
test.each([HIGHLIGHT.emphasis, `#f0f`, `rgb(12, 200, 99)`, `teal`])(
  `highlight_edge_color(%s) darkens like three's Color.multiplyScalar(0.6)`,
  (color) => {
    expect(highlight_edge_color(color)).toBe(
      `#${new Color(color).multiplyScalar(0.6).getHexString()}`,
    )
  },
)

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

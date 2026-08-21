import {
  brighten_hex,
  css_to_linear_rgb,
  parse_linear_rgb,
  write_linear_color_to_buffer,
} from '$lib/scene/colors'
import { Color } from 'three/webgpu'
import { expect, test } from 'vitest'

test(`write_linear_color_to_buffer converts CSS once without stale scratch colors`, () => {
  // Vertex and instance buffers are read raw, so these must hold exactly what three's own
  // sRGB→working conversion produces — the space InstancedAtoms and ArrowInstances write.
  // Asserting against `new Color(css)` rather than pinned numbers catches drift in either
  // direction: a dropped conversion (values ~2x too bright) or a doubled one (~4x too dark).
  const buffer = new Float32Array(9 * 3)
  const write_at = (idx: number, css_color: string): number[] => {
    write_linear_color_to_buffer(buffer, idx, css_color)
    return Array.from(buffer.slice(idx * 3, (idx + 1) * 3))
  }
  // f32 storage, so compare at f32 resolution (eps 1.2e-7); both failure modes are ~1e-1
  const expect_rgb = (written: number[], expected: number[], label: string) => {
    for (const [channel_idx, value] of written.entries()) {
      expect(value, `${label} channel ${channel_idx}`).toBeCloseTo(expected[channel_idx], 6)
    }
  }
  for (const [idx, css] of [`#57178f`, `rebeccapurple`, `rgb(0, 128, 255)`].entries()) {
    expect_rgb(write_at(idx + 1, css), new Color(css).toArray(), css)
  }
  // d3 also parses spellings three rejects — three warns and leaves the scratch on its
  // previous value — which is why the helper delegates to it rather than to Color.set()
  expect_rgb(write_at(4, `RGBA(0, 128, 255, 1)`), write_at(5, `rgb(0, 128, 255)`), `RGBA`)
  // and an unparsable color must land on grey, not repaint with whatever came before
  expect(write_at(6, `not-a-color`)).toEqual([0.5, 0.5, 0.5])
  // grey also covers fully transparent input: d3 blanks the channels of any alpha-0 color, so
  // the red of `rgba(255, 0, 0, 0)` is unrecoverable — and unused, since these meshes are opaque
  expect(write_at(7, `rgba(255, 0, 0, 0)`)).toEqual([0.5, 0.5, 0.5])
  // out-of-gamut channels come back from d3 unclamped; CSS clamps them, so we must too
  expect_rgb(write_at(8, `rgb(300, -20, 0)`), new Color(`rgb(255, 0, 0)`).toArray(), `gamut`)
  expect(Array.from(buffer.slice(0, 3))).toEqual([0, 0, 0])
})

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

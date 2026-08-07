import { type CanvasMarker, draw_markers } from '$lib/plot/core/canvas-markers'
import { describe, expect, test } from 'vitest'

class StubPath2D {
  added: { path: StubPath2D; transform: DOMMatrix }[] = []
  d?: string
  constructor(source?: string | StubPath2D) {
    if (typeof source === `string`) this.d = source
    else if (source) {
      this.d = source.d
      this.added = source.added.map(({ path, transform }) => ({
        path,
        transform: new DOMMatrix([
          transform.a,
          transform.b,
          transform.c,
          transform.d,
          transform.e,
          transform.f,
        ]),
      }))
    }
  }
  addPath(path: StubPath2D, transform: DOMMatrix) {
    this.added.push({
      path,
      transform: new DOMMatrix([
        transform.a,
        transform.b,
        transform.c,
        transform.d,
        transform.e,
        transform.f,
      ]),
    })
  }
}
globalThis.Path2D ??= StubPath2D as unknown as typeof Path2D

type Call = { op: string; args: unknown[] }
const fake_ctx = () => {
  const calls: Call[] = []
  const ctx: Record<string, unknown> = { calls }
  for (const op of `setTransform clearRect scale beginPath rect clip moveTo arc fill stroke save restore`.split(
    ` `,
  )) {
    ctx[op] = (...args: unknown[]) => void calls.push({ op, args })
  }
  for (const prop of [`fillStyle`, `strokeStyle`, `lineWidth`, `globalAlpha`]) {
    Object.defineProperty(ctx, prop, {
      set: (value: unknown) => void calls.push({ op: `set:${prop}`, args: [value] }),
    })
  }
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] }
}
const marker = (overrides: Partial<CanvasMarker> = {}): CanvasMarker => ({
  cx: 10,
  cy: 20,
  radius: 3,
  fill: `red`,
  fill_opacity: 1,
  stroke: `#000`,
  stroke_width: 1,
  stroke_opacity: 1,
  opacity: 1,
  ...overrides,
})
const ops = (ctx: { calls: Call[] }, op: string) => ctx.calls.filter((call) => call.op === op)
const filled_path = (ctx: { calls: Call[] }) => ops(ctx, `fill`)[0].args[0] as StubPath2D
const draw = (
  markers: readonly CanvasMarker[],
  options: Parameters<typeof draw_markers>[2] = { width: 100, height: 100 },
) => {
  const ctx = fake_ctx()
  draw_markers(ctx, markers, options)
  return ctx
}
const batch = (n: number, overrides: Partial<CanvasMarker> = {}) =>
  Array.from({ length: n }, (_, idx) => marker({ cx: idx, cy: idx, ...overrides }))
// Symbol markers accumulate into one Path2D; these are the stamped entries.
const stamps = (overrides: Partial<CanvasMarker>) =>
  filled_path(draw([marker(overrides)])).added

describe(`draw_markers`, () => {
  test(`clears and scales the canvas while preserving context state`, () => {
    const hidpi = draw([marker()], { width: 400, height: 300, pixel_ratio: 2 })
    expect(ops(hidpi, `clearRect`)[0].args).toEqual([0, 0, 800, 600])
    expect(ops(hidpi, `scale`)[0].args).toEqual([2, 2])
    const empty_ops = draw([]).calls.map(({ op }) => op)
    expect(empty_ops).toEqual([`save`, `setTransform`, `clearRect`, `restore`])
  })

  test(`batches opaque markers and splits translucent or changed styles`, () => {
    // Opaque identical styles batch; translucent markers isolate for SVG alpha parity.
    const circles = draw(batch(500, { stroke_width: 0 }))
    expect(ops(circles, `arc`)).toHaveLength(500)
    expect(ops(circles, `fill`)).toHaveLength(1)
    const squares = draw(batch(500, { symbol_type: `Square`, stroke_width: 0 }))
    expect(ops(squares, `arc`)).toHaveLength(0)
    expect(filled_path(squares).added).toHaveLength(500)
    const translucent = draw(batch(2, { fill_opacity: 0.5 }))
    expect(ops(translucent, `fill`)).toHaveLength(2)
    const embedded_alpha = draw(batch(2, { fill: `rgba(255, 0, 0, 0.5)`, stroke_width: 0 }))
    expect(ops(embedded_alpha, `fill`)).toHaveLength(2)
    const fill_and_stroke = draw(batch(2))
    expect(ops(fill_and_stroke, `fill`)).toHaveLength(2)
    expect(ops(fill_and_stroke, `stroke`)).toHaveLength(2)
    const color_ctx = draw(
      [`red`, `red`, `blue`, `red`].map((fill) => marker({ fill, stroke_width: 0 })),
    )
    const fill_styles = ops(color_ctx, `set:fillStyle`).map((call) => call.args[0])
    expect(fill_styles).toEqual([`red`, `blue`, `red`])
  })

  // Asserts nothing is painted (not just no `arc`): an invalid symbol_size takes the
  // stamped-symbol branch, which never calls `arc` even when it is valid.
  test.each([
    { cx: NaN },
    { cy: Infinity },
    { radius: NaN },
    { radius: Infinity },
    { radius: 0 },
    { radius: -2 },
    { symbol_size: NaN },
    { symbol_size: 0 },
    { symbol_size: -5 },
  ])(`skips markers with invalid geometry %o`, (overrides) => {
    const invalid_ctx = draw([marker(overrides)])
    for (const op of [`arc`, `fill`, `stroke`]) {
      expect(ops(invalid_ctx, op)).toHaveLength(0)
    }
  })

  test(`clips, moves before arcs, and restores between redraws`, () => {
    const clip_ctx = fake_ctx()
    const markers = [marker({ cx: 5, cy: 6, radius: 2 })]
    for (const clip of [
      { x: 10, y: 20, width: 100, height: 80 },
      { x: 50, y: 60, width: 200, height: 180 },
    ]) {
      draw_markers(clip_ctx, markers, { width: 400, height: 300, clip })
      expect(clip_ctx.calls.at(-1)?.op).toBe(`restore`)
    }
    expect(ops(clip_ctx, `moveTo`)[0].args).toEqual([7, 6])
    expect(ops(clip_ctx, `rect`).map((call) => call.args)).toEqual([
      [10, 20, 100, 80],
      [50, 60, 200, 180],
    ])
  })

  test(`combines marker and fill or stroke opacity`, () => {
    const separate_alpha = draw([marker({ fill_opacity: 0.5, stroke_opacity: 0.25 })])
    const paint_calls = separate_alpha.calls
      .filter((call) => [`set:globalAlpha`, `fill`, `stroke`].includes(call.op))
      .map((call) => (call.op === `set:globalAlpha` ? call.args[0] : call.op))
    expect(paint_calls).toEqual([0.5, `fill`, 0.25, `stroke`])

    const combined_alpha = draw([
      marker({ opacity: 0.25, fill_opacity: 0.8, stroke_opacity: 0.5 }),
    ])
    const alpha_values = ops(combined_alpha, `set:globalAlpha`)
      .map((call) => call.args[0])
      .slice(0, 2)
    expect(alpha_values).toEqual([0.2, 0.125])
  })

  test(`normalizes alpha and stroke width before assigning canvas state`, () => {
    const ctx = draw([
      marker({ fill_opacity: 2, stroke_opacity: 2, stroke_width: 2 }),
      marker({ fill: `blue`, opacity: NaN, stroke_width: Infinity }),
      marker({ fill: `none`, stroke_width: -1 }),
    ])
    expect(ops(ctx, `set:globalAlpha`).map((call) => call.args[0])).toEqual([1, 1])
    expect(ops(ctx, `set:lineWidth`).map((call) => call.args[0])).toEqual([2, 0, 0])
  })

  // `transparent` is skipped just like `none`; canvas would otherwise reject the CSS keyword.
  test.each([
    [{ stroke_width: 0 }, 1, 0],
    [{ fill: `none` }, 0, 1],
    [{ fill: `transparent` }, 0, 1],
    [{ stroke: `none` }, 1, 0],
    [{ stroke: `transparent` }, 1, 0],
    [{ fill: `none`, stroke: `none` }, 0, 0],
  ] as const)(
    `handles absent fill and stroke styles %o`,
    (overrides, expected_fills, expected_strokes) => {
      const ctx = draw(batch(2, overrides))
      expect(ops(ctx, `fill`)).toHaveLength(expected_fills)
      expect(ops(ctx, `stroke`)).toHaveLength(expected_strokes)
    },
  )

  test(`stamps non-circle symbols with matching area and batches mixed shapes`, () => {
    const stamped = draw([marker({ cx: 30, cy: 40, radius: 4, symbol_type: `Square` })])
    const { transform } = filled_path(stamped).added[0]
    expect(ops(stamped, `arc`)).toHaveLength(0)
    expect([transform.e, transform.f]).toEqual([30, 40])
    // an explicit symbol_size stands in for radius, so radius 0 still draws
    expect(stamps({ radius: 0, symbol_size: 100 })).toHaveLength(1)
    for (const radius of [2, 5, 9]) {
      const outline = stamps({ radius, symbol_type: `Square` })[0].path.d ?? ``
      const side = Number(/^M(?<half_side>[-\d.]+)/.exec(outline)?.groups?.half_side)
      expect(Math.abs(side)).toBeCloseTo(Math.sqrt(Math.PI * radius ** 2) / 2, 3)
    }

    const mixed = draw(
      ([`Circle`, `Star`, `Circle`] as const).map((symbol_type) =>
        marker({ symbol_type, stroke_width: 0 }),
      ),
    )
    expect(ops(mixed, `arc`)).toHaveLength(2)
    expect(ops(mixed, `fill`)).toHaveLength(2)
  })

  test(`Path2D stub preserves accumulated geometry when cloned`, () => {
    const source = new StubPath2D()
    const transform = new DOMMatrix()
    transform.e = 3
    transform.f = 4
    source.addPath(new StubPath2D(`M0,0`), transform)
    const clone = new StubPath2D(source)
    source.added.length = 0
    expect(clone.added).toHaveLength(1)
    expect([clone.added[0].transform.e, clone.added[0].transform.f]).toEqual([3, 4])
  })
})

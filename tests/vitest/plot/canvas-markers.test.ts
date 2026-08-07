import { type CanvasMarker, draw_markers } from '$lib/plot/core/canvas-markers'
import { describe, expect, test } from 'vitest'

class StubPath2D {
  added: { path: StubPath2D; transform: DOMMatrix }[] = []
  constructor(public d?: string) {}
  addPath(path: StubPath2D, transform: DOMMatrix) {
    this.added.push({ path, transform })
  }
}
globalThis.Path2D ??= StubPath2D as unknown as typeof Path2D

type Call = { op: string; args: unknown[] }
const fake_ctx = () => {
  const calls: Call[] = []
  const ctx: Record<string, unknown> = { calls }
  for (const op of `setTransform clearRect scale beginPath rect clip moveTo arc fill stroke save restore translate`.split(
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

describe(`draw_markers`, () => {
  test(`clear/scale/empty, batching, style splits, skips, clip, alpha, none, symbols`, () => {
    const hidpi = draw([marker()], { width: 400, height: 300, pixel_ratio: 2 })
    expect(ops(hidpi, `clearRect`)[0].args).toEqual([0, 0, 800, 600])
    expect(ops(hidpi, `scale`)[0].args).toEqual([2, 2])
    expect(draw([]).calls.map(({ op }) => op)).toEqual([
      `save`,
      `setTransform`,
      `clearRect`,
      `restore`,
    ])

    // Opaque identical styles batch; translucent markers isolate for SVG alpha parity.
    const circles = draw(batch(500, { stroke_width: 0 }))
    expect(ops(circles, `arc`)).toHaveLength(500)
    expect(ops(circles, `fill`)).toHaveLength(1)
    const squares = draw(batch(500, { symbol_type: `Square`, stroke_width: 0 }))
    expect(ops(squares, `arc`)).toHaveLength(0)
    expect((ops(squares, `fill`)[0].args[0] as StubPath2D).added).toHaveLength(500)
    const translucent = draw(batch(2, { fill_opacity: 0.5 }))
    expect(ops(translucent, `fill`)).toHaveLength(2)
    const color_markers = [
      marker({ fill: `red`, stroke_width: 0 }),
      marker({ fill: `red`, stroke_width: 0 }),
      marker({ fill: `blue`, stroke_width: 0 }),
      marker({ fill: `red`, stroke_width: 0 }),
    ]
    const color_ctx = draw(color_markers)
    expect(ops(color_ctx, `set:fillStyle`).map((call) => call.args[0])).toEqual([
      `red`,
      `blue`,
      `red`,
    ])

    for (const bad of [
      { cx: NaN },
      { cy: Infinity },
      { radius: NaN },
      { radius: Infinity },
      { radius: 0 },
      { radius: -2 },
    ]) {
      const bad_marker = marker(bad)
      const bad_marker_ctx = draw([bad_marker])
      expect(ops(bad_marker_ctx, `arc`)).toHaveLength(0)
    }

    const clip_ctx = fake_ctx()
    for (const clip of [
      { x: 10, y: 20, width: 100, height: 80 },
      { x: 50, y: 60, width: 200, height: 180 },
    ]) {
      draw_markers(clip_ctx, [marker({ cx: 5, cy: 6, radius: 2 })], {
        width: 400,
        height: 300,
        clip,
      })
    }
    expect(ops(clip_ctx, `moveTo`)[0].args).toEqual([7, 6])
    expect(ops(clip_ctx, `rect`).map((call) => call.args)).toEqual([
      [10, 20, 100, 80],
      [50, 60, 200, 180],
    ])
    expect(clip_ctx.calls.at(-1)?.op).toBe(`restore`)

    expect(
      draw([marker({ fill_opacity: 0.5, stroke_opacity: 0.25 })])
        .calls.filter((call) => [`set:globalAlpha`, `fill`, `stroke`].includes(call.op))
        .map((call) => (call.op === `set:globalAlpha` ? call.args[0] : call.op)),
    ).toEqual([0.5, `fill`, 0.25, `stroke`])
    expect(
      draw([marker({ opacity: 0.25, fill_opacity: 0.8, stroke_opacity: 0.5 })])
        .calls.filter((call) => call.op === `set:globalAlpha`)
        .map((call) => call.args[0])
        .slice(0, 2),
    ).toEqual([0.2, 0.125])

    for (const [overrides, n_fill, n_stroke] of [
      [{ stroke_width: 0 }, 1, 0],
      [{ fill: `none` }, 0, 1],
      [{ stroke: `none` }, 1, 0],
      [{ fill: `none`, stroke: `none` }, 0, 0],
    ] as const) {
      const ctx = draw(batch(2, overrides))
      expect(ops(ctx, `fill`)).toHaveLength(n_fill)
      expect(ops(ctx, `stroke`)).toHaveLength(n_stroke)
    }

    const stamped = draw([marker({ cx: 30, cy: 40, radius: 4, symbol_type: `Square` })])
    expect(ops(stamped, `arc`)).toHaveLength(0)
    expect([
      filled_path(stamped).added[0].transform.e,
      filled_path(stamped).added[0].transform.f,
    ]).toEqual([30, 40])
    const sized_symbol = marker({ radius: 0, symbol_size: 100 })
    const sized_symbol_ctx = draw([sized_symbol])
    expect(filled_path(sized_symbol_ctx).added).toHaveLength(1)
    for (const radius of [2, 5, 9]) {
      const outline =
        filled_path(draw([marker({ radius, symbol_type: `Square` })])).added[0].path.d ?? ``
      const side = Number(/^M(?<half_side>[-\d.]+)/.exec(outline)?.groups?.half_side)
      expect(Math.abs(side)).toBeCloseTo(Math.sqrt(Math.PI * radius ** 2) / 2, 3)
    }

    const mixed = draw([
      marker({ symbol_type: `Circle`, stroke_width: 0 }),
      marker({ symbol_type: `Star`, stroke_width: 0 }),
      marker({ symbol_type: `Circle`, stroke_width: 0 }),
    ])
    expect(ops(mixed, `arc`)).toHaveLength(2)
    expect(ops(mixed, `fill`)).toHaveLength(2)
  })
})

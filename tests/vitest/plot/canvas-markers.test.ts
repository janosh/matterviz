import {
  type CanvasMarker,
  draw_markers,
  MAX_SPRITE_RUNS,
  MAX_SPRITE_SIDE,
  SPRITE_MIN_MARKERS,
} from '#lib/plot/core/canvas-markers.js'
import { prepare_canvas } from '#lib/plot/core/utils.js'
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

class StubPath2D {
  added: { path: StubPath2D; transform: DOMMatrix }[] = []
  d?: string
  constructor(path_data?: string) {
    this.d = path_data
  }
  addPath(path: StubPath2D, transform: DOMMatrix) {
    this.added.push({ path, transform: DOMMatrix.fromMatrix(transform) })
  }
}
globalThis.Path2D ??= StubPath2D as unknown as typeof Path2D

type Call = { op: string; args: unknown[] }
const fake_ctx = () => {
  const calls: Call[] = []
  const ctx: Record<string, unknown> = { calls }
  for (const operation of `setTransform clearRect scale beginPath moveTo arc fill stroke save restore drawImage`.split(
    ` `,
  )) {
    ctx[operation] = (...args: unknown[]) => void calls.push({ op: operation, args })
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
const ops = (ctx: { calls: Call[] }, operation: string) =>
  ctx.calls.filter((call) => call.op === operation)
const filled_path = (ctx: { calls: Call[] }) => ops(ctx, `fill`)[0].args[0] as StubPath2D
const draw = (
  markers: readonly CanvasMarker[],
  options: Parameters<typeof draw_markers>[2] = { width: 100, height: 100 },
) => {
  const ctx = fake_ctx()
  draw_markers(ctx, markers, options)
  return ctx
}
const batch = (n_markers: number, overrides: Partial<CanvasMarker> = {}) =>
  Array.from({ length: n_markers }, (_, idx) => marker({ cx: idx, cy: idx, ...overrides }))
// Symbol markers accumulate into one Path2D; these are the stamped entries.
const stamps = (overrides: Partial<CanvasMarker>) =>
  filled_path(draw([marker(overrides)])).added

describe(`canvas markers`, () => {
  test.each([
    [400, 300, 1, 400, 300],
    [400, 300, 2, 800, 600],
    [100.4, 200.6, 1.25, 126, 251],
    [0.1, 0.2, 1.25, 1, 1],
  ])(
    `prepares %sx%s at DPR %s without resetting unchanged dimensions`,
    (width, height, pixel_ratio, backing_width, backing_height) => {
      vi.stubGlobal(`devicePixelRatio`, pixel_ratio)
      const ctx = draw([marker()], { width, height, pixel_ratio })
      const canvas = document.createElement(`canvas`)
      vi.spyOn(canvas, `getContext`).mockReturnValue(ctx)
      const setters = [
        vi.spyOn(canvas, `width`, `set`),
        vi.spyOn(canvas, `height`, `set`),
        vi.spyOn(canvas.style, `setProperty`),
      ]
      const writes = () => setters.map((setter) => setter.mock.calls.length)
      expect(prepare_canvas(canvas, width, height)).toEqual({
        ctx,
        width,
        height,
        pixel_ratio,
      })
      expect([canvas.width, canvas.height]).toEqual([backing_width, backing_height])
      expect([canvas.style.width, canvas.style.height]).toEqual([`${width}px`, `${height}px`])
      const initial_writes = writes()
      prepare_canvas(canvas, width, height)
      expect(writes()).toEqual(initial_writes)
      expect(ops(ctx, `clearRect`)[0].args).toEqual([
        0,
        0,
        width * pixel_ratio,
        height * pixel_ratio,
      ])
      expect(ops(ctx, `scale`)[0].args).toEqual([pixel_ratio, pixel_ratio])
      const empty_ops = draw([]).calls.map(({ op: operation }) => operation)
      expect(empty_ops).toEqual([`save`, `setTransform`, `clearRect`, `restore`])
    },
  )

  test(`batches opaque markers and splits translucent or changed styles`, () => {
    // Opaque identical styles batch; translucent markers isolate for SVG alpha parity.
    const circles = draw(batch(500, { stroke_width: 0 }))
    expect(ops(circles, `arc`)).toHaveLength(500)
    expect(ops(circles, `fill`)).toHaveLength(1)
    // each arc starts with a moveTo its rightmost point so adjacent arcs don't connect
    expect(ops(circles, `moveTo`)[1].args).toEqual([4, 1])
    expect(circles.calls.at(-1)?.op).toBe(`restore`)
    const squares = draw(batch(500, { symbol_type: `Square`, stroke_width: 0 }))
    expect(ops(squares, `arc`)).toHaveLength(0)
    expect(filled_path(squares).added).toHaveLength(500)
    const translucent = draw(batch(2, { fill_opacity: 0.5 }))
    expect(ops(translucent, `fill`)).toHaveLength(2)
    expect(ops(translucent, `set:fillStyle`)).toHaveLength(1)
    expect(ops(translucent, `set:strokeStyle`)).toHaveLength(1)
    const embedded_alpha = draw(batch(2, { fill: `rgba(255, 0, 0, 0.5)`, stroke_width: 0 }))
    expect(ops(embedded_alpha, `fill`)).toHaveLength(2)
    const fill_and_stroke = draw(batch(2))
    expect(ops(fill_and_stroke, `fill`)).toHaveLength(2)
    expect(ops(fill_and_stroke, `stroke`)).toHaveLength(2)
    expect(ops(fill_and_stroke, `set:lineWidth`)).toHaveLength(1)
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
    for (const operation of [`arc`, `fill`, `stroke`]) {
      expect(ops(invalid_ctx, operation)).toHaveLength(0)
    }
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
})

describe(`canvas marker sprites (dense plots)`, () => {
  // jsdom has no OffscreenCanvas: the stub records each sprite and the calls painting it
  const stub_offscreen = (context = true) => {
    const sprites: { width: number; height: number; ctx: ReturnType<typeof fake_ctx> }[] = []
    class StubOffscreenCanvas {
      ctx = fake_ctx()
      constructor(
        public width: number,
        public height: number,
      ) {
        sprites.push(this)
      }
      getContext = () => (context ? this.ctx : null)
    }
    vi.stubGlobal(`OffscreenCanvas`, StubOffscreenCanvas)
    return sprites
  }

  test(`stamps cached sprites snapped to device pixels, sized for strokes and miters`, () => {
    const sprites = stub_offscreen()
    const markers = [
      ...batch(SPRITE_MIN_MARKERS, { fill: `red` }),
      ...batch(5, { fill: `blue` }),
      marker({ cx: NaN }), // invalid: skipped
    ]
    const ctx = draw(markers, { width: 100, height: 100, pixel_ratio: 2 })
    expect(ops(ctx, `drawImage`)).toHaveLength(SPRITE_MIN_MARKERS + 5)
    expect(ops(ctx, `arc`)).toHaveLength(0)
    draw(markers, { width: 100, height: 100, pixel_ratio: 2 })
    expect(sprites).toHaveLength(2) // red and blue, reused on redraw
    // radius 3 + stroke 1/2 + 1 antialias px = 4.5 CSS px half-extent, 18 device px side at DPR 2
    expect([sprites[0].width, sprites[0].height]).toEqual([18, 18])
    // marker 7 at (7, 7): top-left (7 - 4.5) * 2 = 5 device px
    expect(ops(ctx, `drawImage`)[7].args.slice(1)).toEqual([5, 5])
    // the path renderer paints each sprite, its circle centred
    expect(ops(sprites[0].ctx, `arc`)[0].args.slice(0, 3)).toEqual([4.5, 4.5, 3])
    // symbols add 10 miter half-widths of the 1 px stroke to their sqrt(π·3²) bounding radius
    draw(batch(SPRITE_MIN_MARKERS, { fill: `navy`, symbol_type: `Triangle` }))
    expect(sprites[2].width).toBe(Math.ceil(2 * (Math.sqrt(Math.PI * 9) + 5 + 1)))
    const invisible = draw(batch(SPRITE_MIN_MARKERS, { fill: `none`, stroke: `none` }))
    expect(ops(invisible, `drawImage`)).toHaveLength(0)
  })

  // Sprites are planned before anything is drawn, so each fallback traces every marker as a path exactly once
  test.each<[string, CanvasMarker[], boolean?]>([
    [
      `per-point colours exceed the style-run cap`,
      Array.from({ length: SPRITE_MIN_MARKERS }, (_, idx) =>
        marker({ cx: idx, fill: `rgb(${idx % (MAX_SPRITE_RUNS + 1)}, 1, 2)` }),
      ),
    ],
    [`sprites exceed the size cap`, batch(SPRITE_MIN_MARKERS, { radius: MAX_SPRITE_SIDE })],
    [`there is no offscreen 2D context`, batch(SPRITE_MIN_MARKERS, { fill: `teal` }), false],
    [`below the sprite threshold`, batch(SPRITE_MIN_MARKERS - 1, { fill: `green` })],
  ])(`falls back to paths when %s`, (_label, markers, context = true) => {
    stub_offscreen(context)
    const ctx = draw(markers)
    expect(ops(ctx, `drawImage`)).toHaveLength(0)
    expect(ops(ctx, `arc`)).toHaveLength(markers.length)
    expect(ops(ctx, `save`)).toHaveLength(ops(ctx, `restore`).length)
  })
})

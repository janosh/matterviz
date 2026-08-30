import type { PatternDash, PatternShape, PatternShorthand } from '$lib/plot/core/patterns'
import {
  PATTERN_SHAPES,
  PATTERN_SHORTHANDS,
  plot_pattern,
  resolve_pattern,
  unique_patterns,
} from '$lib/plot/core/patterns'
import { describe, expect, test } from 'vitest'

const BLUE = `#336699` // dark -> auto fg is white
const YELLOW = `#ffe0b3` // light -> auto fg is black

describe(`resolve_pattern`, () => {
  test.each(Object.entries(PATTERN_SHORTHANDS) as [PatternShorthand, PatternShape][])(
    `shorthand %s resolves to the same tile as shape %s`,
    (shorthand, shape) => {
      const from_shorthand = resolve_pattern(shorthand, BLUE, `p`)
      expect(from_shorthand).toEqual(resolve_pattern(shape, BLUE, `p`))
      expect(from_shorthand).toEqual(resolve_pattern({ shape }, BLUE, `p`))
    },
  )

  test.each(PATTERN_SHAPES)(`%s yields a non-empty tile with a stable scoped id`, (shape) => {
    const pat = resolve_pattern(shape, BLUE, `chart-1`)
    expect(pat.d.length).toBeGreaterThan(0)
    expect(pat.width).toBeGreaterThan(0)
    expect(pat.height).toBeGreaterThan(0)
    expect(pat.id).toMatch(/^chart-1-pat-[0-9a-z]+$/)
    expect(pat.url).toBe(`url(#${pat.id})`)
    expect(pat.id).toBe(resolve_pattern(shape, BLUE, `chart-1`).id) // deterministic
    // stroked shapes get a positive line width and no fill; filled shapes the reverse
    if (pat.stroked) expect(pat.line_width).toBeGreaterThan(0)
    else expect(pat.line_width).toBe(0)
  })

  test(`overlay defaults: bg is the mark color, fg auto-contrasts at half opacity`, () => {
    expect(resolve_pattern(`/`, BLUE, `p`)).toMatchObject({
      bg: BLUE,
      fg: `white`,
      fg_opacity: 0.5,
      width: 8,
      height: 8,
      transform: `rotate(-45)`,
    })
    expect(resolve_pattern(`/`, YELLOW, `p`).fg).toBe(`black`)
    // CSS variables can't be parsed for contrast -> currentColor keeps the texture visible
    expect(resolve_pattern(`/`, `var(--accent)`, `p`).fg).toBe(`currentColor`)
  })

  test(`replace mode: transparent bg, texture in the mark color at full opacity`, () => {
    expect(resolve_pattern({ mode: `replace` }, BLUE, `p`)).toMatchObject({
      bg: undefined,
      fg: BLUE,
      fg_opacity: 1,
    })
    // explicit fg/bg/fg_opacity always win
    expect(
      resolve_pattern({ mode: `replace`, fg: `red`, bg: `#eee`, fg_opacity: 0.3 }, BLUE, `p`),
    ).toMatchObject({ bg: `#eee`, fg: `red`, fg_opacity: 0.3 })
  })

  test.each([
    [`horizontal`, undefined],
    [`vertical`, `rotate(90)`],
    [`diagonal`, `rotate(-45)`],
    [`diagonal-reverse`, `rotate(45)`],
    [`cross`, undefined],
    [`cross-diagonal`, `rotate(45)`],
  ] as const)(`%s has intrinsic rotation %s and angle adds to it`, (shape, transform) => {
    expect(resolve_pattern(shape, BLUE, `p`).transform).toBe(transform)
    const intrinsic = transform ? Number(/-?[\d.]+/.exec(transform)?.[0]) : 0
    expect(resolve_pattern({ shape, angle: 30 }, BLUE, `p`).transform).toBe(
      `rotate(${intrinsic + 30})`,
    )
  })

  test(`solidity sets line width so coverage is comparable across stroked shapes`, () => {
    // one line of length `size` per size×size tile: width = solidity * size
    expect(
      resolve_pattern({ shape: `horizontal`, size: 10, solidity: 0.3 }, BLUE, `p`),
    ).toMatchObject({ line_width: 3 })
    // two lines per tile -> half the width for the same coverage
    expect(
      resolve_pattern({ shape: `cross`, size: 10, solidity: 0.3 }, BLUE, `p`).line_width,
    ).toBeCloseTo(1.5)
    // explicit line_width overrides solidity
    expect(
      resolve_pattern({ shape: `cross`, solidity: 0.3, line_width: 2 }, BLUE, `p`),
    ).toMatchObject({ line_width: 2 })
    // filled markers: dots of area solidity*size² -> radius = size*sqrt(solidity/pi)
    const dots = resolve_pattern({ shape: `dots`, size: 10, solidity: 0.25 }, BLUE, `p`)
    expect(dots.d).toContain(`a2.821 2.821`)
  })

  test(`scale shrinks tile and line width but not solidity-derived proportions`, () => {
    const full = resolve_pattern({ shape: `cross`, size: 12, line_width: 2 }, BLUE, `p`)
    const half = resolve_pattern({ shape: `cross`, size: 12, line_width: 2 }, BLUE, `p`, 0.5)
    expect([half.width, half.height, half.line_width]).toEqual([6, 6, 1])
    expect(half.id).not.toBe(full.id)
  })

  test.each<[PatternDash, string | undefined, string | undefined]>([
    [`solid`, undefined, undefined],
    [`dashed`, `4 4`, undefined],
    [`dotted`, `0 4`, `round`], // round caps turn zero-length dashes into dots
    [[2, 1, 1], `2 1 1`, undefined],
  ])(`dash %j -> dasharray %s with %s caps`, (dash, dasharray, linecap) => {
    const pat = resolve_pattern({ shape: `horizontal`, size: 8, dash }, BLUE, `p`)
    expect(pat.dasharray).toBe(dasharray)
    expect(pat.linecap).toBe(linecap)
    // dashing is a stroke property: filled shapes ignore it
    expect(resolve_pattern({ shape: `dots`, dash }, BLUE, `p`).dasharray).toBeUndefined()
  })

  test(`hexagon tile is a honeycomb period of sqrt(3)R × 3R`, () => {
    const pat = resolve_pattern({ shape: `hexagons`, size: 10 }, BLUE, `p`)
    expect(pat.width).toBeCloseTo(5 * Math.sqrt(3))
    expect(pat.height).toBe(15)
  })

  test(`ids differ whenever any resolved field differs`, () => {
    const base = resolve_pattern(`/`, BLUE, `p`)
    const variants = [
      resolve_pattern(`/`, YELLOW, `p`), // different bg + fg
      resolve_pattern({ shape: `/`, fg: `red` }, BLUE, `p`),
      resolve_pattern({ shape: `/`, size: 9 }, BLUE, `p`),
      resolve_pattern({ shape: `/`, angle: 1 }, BLUE, `p`),
      resolve_pattern({ shape: `/`, dash: `dashed` }, BLUE, `p`),
      resolve_pattern(`/`, BLUE, `q`), // different chart prefix
    ]
    expect(new Set([base.id, ...variants.map((pat) => pat.id)]).size).toBe(variants.length + 1)
  })

  test.each([
    [{ size: 0 }, /size must be > 0/],
    [{ size: -3 }, /size must be > 0/],
    [{ size: NaN }, /size must be > 0/],
    [{ solidity: -0.1 }, /solidity must be in \[0, 1\]/],
    [{ solidity: 1.5 }, /solidity must be in \[0, 1\]/],
    [{ solidity: NaN }, /solidity must be in \[0, 1\]/],
    [{ angle: NaN }, /angle must be finite/],
    [{ angle: Infinity }, /angle must be finite/],
    // shorthand lookup must not pick up inherited Object properties
    [`toString` as PatternShape, /Unknown pattern shape: toString/],
  ])(`rejects invalid options %j`, (opts, message) => {
    expect(() => resolve_pattern(opts, BLUE, `p`)).toThrow(message)
  })
})

describe(`plot_pattern`, () => {
  test(`cycles through PATTERN_SHAPES by index`, () => {
    expect(plot_pattern(0)).toBe(PATTERN_SHAPES[0])
    expect(plot_pattern(PATTERN_SHAPES.length)).toBe(PATTERN_SHAPES[0])
    expect(plot_pattern(PATTERN_SHAPES.length + 2)).toBe(PATTERN_SHAPES[2])
    // every shape name is a distinct entry
    expect(new Set(PATTERN_SHAPES).size).toBe(PATTERN_SHAPES.length)
  })
})

describe(`unique_patterns`, () => {
  test(`drops null/undefined and duplicates by id, keeping first-seen order`, () => {
    const diag = resolve_pattern(`/`, BLUE, `p`)
    const dots = resolve_pattern(`.`, BLUE, `p`)
    const result = unique_patterns([
      null,
      diag,
      undefined,
      dots,
      resolve_pattern(`/`, BLUE, `p`),
    ])
    expect(result.map((pat) => pat.id)).toEqual([diag.id, dots.id])
    expect(unique_patterns([])).toEqual([])
  })
})

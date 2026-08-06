import {
  clear_text_metrics_cache,
  DEFAULT_FONT_SPEC,
  font_spec_to_css,
  get_text_metrics_revision,
  invalidate_text_metrics_after_fonts_ready,
  measure_css_text_width,
  measure_text_block,
  measure_text_line,
  resolve_font_size_css,
  resolve_font_spec,
  wrap_text_paragraph,
  type FontSpec,
} from '$lib/plot/core/text-metrics'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TEST_FONT: FontSpec = {
  font_family: `"Inter", sans-serif`,
  font_size: 16,
  font_style: `italic`,
  font_variant: `small-caps`,
  font_weight: `700`,
  font_stretch: `condensed`,
  line_height: 24,
}

const mock_canvas = () => {
  const measure_text = vi.fn((text: string) => ({
    width: text.length * 5,
    actualBoundingBoxAscent: 9,
    actualBoundingBoxDescent: 3,
  }))
  const context = {
    font: ``,
    measureText: measure_text,
  } as unknown as CanvasRenderingContext2D
  const get_context = vi
    .spyOn(HTMLCanvasElement.prototype, `getContext`)
    .mockReturnValue(context)
  return { context, get_context, measure_text }
}

describe(`text metrics`, () => {
  beforeEach(() => clear_text_metrics_cache())
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([`html`, `svg`] as const)(`resolves computed %s fonts`, (element_type) => {
    const element =
      element_type === `html`
        ? document.createElement(`div`)
        : document.createElementNS(`http://www.w3.org/2000/svg`, `text`)
    const style_spy = vi.spyOn(window, `getComputedStyle`).mockReturnValue({
      fontFamily: TEST_FONT.font_family,
      fontSize: `${TEST_FONT.font_size}px`,
      fontStyle: TEST_FONT.font_style,
      fontVariant: TEST_FONT.font_variant,
      fontWeight: TEST_FONT.font_weight,
      fontStretch: TEST_FONT.font_stretch,
      lineHeight: `${TEST_FONT.line_height}px`,
    } as CSSStyleDeclaration)

    expect(resolve_font_spec(element)).toEqual(TEST_FONT)
    expect(style_spy).toHaveBeenCalledWith(element)
    expect(font_spec_to_css(TEST_FONT)).toBe(
      `italic small-caps 700 condensed 16px "Inter", sans-serif`,
    )
  })

  it.each([
    [`12px`, 16, 12],
    [`12`, 16, 12],
    [`1.5em`, 20, 30],
    [`1.5rem`, 20, 30],
    [`150%`, 20, 30],
    [`12pt`, 16, 16],
    [undefined, 18, 18],
  ] as const)(`resolve_font_size_css(%j, %j) = %j`, (value, parent, expected) => {
    expect(resolve_font_size_css(value, parent)).toBe(expected)
  })

  it(`resolves normal and unitless line heights deterministically`, () => {
    const element = document.createElement(`span`)
    const computed_style = {
      fontFamily: ``,
      fontSize: `20px`,
      fontStyle: ``,
      fontVariant: ``,
      fontWeight: ``,
      fontStretch: ``,
      lineHeight: `normal`,
    } as CSSStyleDeclaration
    vi.spyOn(window, `getComputedStyle`).mockReturnValue(computed_style)

    expect(resolve_font_spec(element)).toEqual({
      ...DEFAULT_FONT_SPEC,
      font_size: 20,
      line_height: 20 * (DEFAULT_FONT_SPEC.line_height / DEFAULT_FONT_SPEC.font_size),
    })

    computed_style.lineHeight = `1.5`
    expect(resolve_font_spec(element).line_height).toBe(30)
  })

  it(`caches measurements separately per font`, () => {
    const { context, measure_text } = mock_canvas()
    const other_font = { ...TEST_FONT, font_size: 20, line_height: 30 }

    const first = measure_text_line(`cache me`, TEST_FONT)
    const cached = measure_text_line(`cache me`, TEST_FONT)
    const other = measure_text_line(`cache me`, other_font)

    expect(first).toBe(cached)
    expect(first).toMatchObject({
      width: 40,
      ascent: 9,
      descent: 3,
      height: 12,
      source: `canvas`,
    })
    expect(other.width).toBe(40)
    expect(measure_text).toHaveBeenCalledTimes(2)
    expect(context.font).toBe(`italic small-caps 700 condensed 20px "Inter", sans-serif`)
  })

  it(`parses font size after shorthand qualifiers for deterministic fallback width`, () => {
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(null)

    expect(measure_css_text_width(`abcd`, `bold 18px "Inter", sans-serif`)).toBeCloseTo(43.2)
  })

  it.each([
    {
      name: `word boundaries`,
      paragraph: `alpha beta gamma`,
      width: 50,
      preserve_empty_line: false,
      expected: [`alpha beta`, `gamma`],
    },
    {
      name: `no-break spaces`,
      paragraph: `10\u00A0eV 20\u202FkPa`,
      width: 30,
      preserve_empty_line: false,
      expected: [`10\u00A0eV`, `20\u202FkPa`],
    },
    {
      name: `overlong words`,
      paragraph: `abcdefghij`,
      width: 20,
      preserve_empty_line: false,
      expected: [`abcd`, `efgh`, `ij`],
    },
    {
      name: `non-positive widths`,
      paragraph: `alpha beta`,
      width: 0,
      preserve_empty_line: false,
      expected: [`alpha beta`],
    },
    {
      name: `discarded empty paragraphs`,
      paragraph: `   `,
      width: 50,
      preserve_empty_line: false,
      expected: [],
    },
    {
      name: `preserved empty paragraphs`,
      paragraph: `   `,
      width: 50,
      preserve_empty_line: true,
      expected: [``],
    },
  ])(`wraps $name with shared greedy semantics`, (test_case) => {
    const measure = (text: string) => ({ width: Array.from(text).length * 5 })
    expect(
      wrap_text_paragraph(
        test_case.paragraph,
        test_case.width,
        TEST_FONT,
        measure,
        test_case.preserve_empty_line,
      ),
    ).toEqual(test_case.expected)
  })

  it(`clears cached measurements and increments the revision`, () => {
    const { measure_text } = mock_canvas()
    const revision_before = get_text_metrics_revision()

    measure_text_line(`fresh`, TEST_FONT)
    measure_text_line(`fresh`, TEST_FONT)
    expect(measure_text).toHaveBeenCalledTimes(1)

    expect(clear_text_metrics_cache()).toBe(revision_before + 1)
    expect(get_text_metrics_revision()).toBe(revision_before + 1)
    measure_text_line(`fresh`, TEST_FONT)
    expect(measure_text).toHaveBeenCalledTimes(2)
  })

  it(`invalidates only after font readiness resolves`, async () => {
    const { measure_text } = mock_canvas()
    let resolve_ready: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      resolve_ready = resolve
    })
    const revision_before = get_text_metrics_revision()
    measure_text_line(`web font`, TEST_FONT)

    const invalidation = invalidate_text_metrics_after_fonts_ready({ ready })
    measure_text_line(`web font`, TEST_FONT)
    expect(measure_text).toHaveBeenCalledTimes(1)
    expect(get_text_metrics_revision()).toBe(revision_before)

    resolve_ready?.()
    await expect(invalidation).resolves.toBe(revision_before + 1)
    measure_text_line(`web font`, TEST_FONT)
    expect(measure_text).toHaveBeenCalledTimes(2)
  })

  it(`measures multiline blocks with explicit line-height and shared line caching`, () => {
    const { measure_text } = mock_canvas()
    const first = measure_text_block(`short\nlongest\nshort`, TEST_FONT)
    const tighter = measure_text_block(`short\nlongest`, {
      ...TEST_FONT,
      line_height: 18,
    })

    expect(first).toMatchObject({
      width: 35,
      height: 72,
      line_height: 24,
      line_count: 3,
    })
    expect(first.lines.map(({ text }) => text)).toEqual([`short`, `longest`, `short`])
    expect(tighter).toMatchObject({ width: 35, height: 36, line_height: 18, line_count: 2 })
    expect(measure_text).toHaveBeenCalledTimes(2)
  })

  it(`returns deterministic SSR metrics without touching browser globals`, async () => {
    const font = { ...DEFAULT_FONT_SPEC, font_size: 10, line_height: 15 }
    vi.stubGlobal(`document`, undefined)

    expect(resolve_font_spec(null, font)).toEqual(font)
    expect(measure_text_block(`A🙂\nx`, font)).toMatchObject({
      width: 12,
      height: 30,
      line_height: 15,
      line_count: 2,
      lines: [
        { text: `A🙂`, width: 12, ascent: 8, descent: 2, source: `fallback` },
        { text: `x`, width: 6, ascent: 8, descent: 2, source: `fallback` },
      ],
    })
    const revision_before = get_text_metrics_revision()
    await expect(invalidate_text_metrics_after_fonts_ready()).resolves.toBe(revision_before)
  })
})

import {
  clear_text_metrics_cache,
  DEFAULT_FONT_SPEC,
  font_spec_to_css,
  get_text_metrics_revision,
  invalidate_text_metrics_after_fonts_ready,
  measure_css_text_width,
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
    [`50%`, `ultra-condensed`],
    [`62.5%`, `extra-condensed`],
    [`75%`, `condensed`],
    [`87.5%`, `semi-condensed`],
    [`100%`, `normal`],
    [`112.5%`, `semi-expanded`],
    [`125%`, `expanded`],
    [`150%`, `extra-expanded`],
    [`200%`, `ultra-expanded`],
  ])(`normalizes browser font stretch %s to %s`, (percentage, keyword) => {
    const prefix = keyword === `normal` ? `` : `${keyword} `
    expect(font_spec_to_css({ ...DEFAULT_FONT_SPEC, font_stretch: percentage })).toBe(
      `${prefix}12px sans-serif`,
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

  it(`preserves browser font stretch and resolves unitless line heights`, () => {
    const element = document.createElement(`span`)
    const computed_style = {
      fontFamily: ``,
      fontSize: `20px`,
      fontStyle: ``,
      fontVariant: ``,
      fontWeight: ``,
      fontStretch: `100%`,
      lineHeight: `normal`,
    } as CSSStyleDeclaration
    vi.spyOn(window, `getComputedStyle`).mockReturnValue(computed_style)

    expect(resolve_font_spec(element)).toEqual({
      ...DEFAULT_FONT_SPEC,
      font_size: 20,
      font_stretch: `100%`,
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
    [`word boundaries`, `alpha beta gamma`, 50, false, [`alpha beta`, `gamma`]],
    [`no-break spaces`, `10\u00A0eV 20\u202FkPa`, 30, false, [`10\u00A0eV`, `20\u202FkPa`]],
    [`overlong words`, `abcdefghij`, 20, false, [`abcd`, `efgh`, `ij`]],
    [`non-positive widths`, `alpha beta`, 0, false, [`alpha beta`]],
    [`discarded empty paragraphs`, `   `, 50, false, []],
    [`preserved empty paragraphs`, `   `, 50, true, [``]],
  ] as const)(
    `wraps %s with shared greedy semantics`,
    (_name, paragraph, width, preserve_empty_line, expected) => {
      const measure = (text: string) => ({ width: Array.from(text).length * 5 })
      expect(
        wrap_text_paragraph(paragraph, width, TEST_FONT, measure, preserve_empty_line),
      ).toEqual(expected)
    },
  )

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

  // Every axis and plot title asks for this independently. One clear per readiness cycle
  // keeps a page of many plots from re-running all their layouts once per component.
  it(`clears once per readiness cycle no matter how many callers ask`, async () => {
    mock_canvas()
    const ready = Promise.resolve()
    const revision_before = get_text_metrics_revision()

    const revisions = await Promise.all(
      Array.from({ length: 5 }, () => invalidate_text_metrics_after_fonts_ready({ ready })),
    )
    expect(revisions).toEqual(Array.from({ length: 5 }, () => revision_before + 1))
    expect(get_text_metrics_revision()).toBe(revision_before + 1)

    // a plot mounting after resolution reuses the memo rather than clearing again
    await expect(invalidate_text_metrics_after_fonts_ready({ ready })).resolves.toBe(
      revision_before + 1,
    )
    expect(get_text_metrics_revision()).toBe(revision_before + 1)

    // a later font load hands out a new `ready`, which must invalidate again
    await expect(
      invalidate_text_metrics_after_fonts_ready({ ready: Promise.resolve() }),
    ).resolves.toBe(revision_before + 2)
  })

  // A memoized rejection would be replayed forever, wedging invalidation for that FontFaceSet
  it(`evicts a rejected readiness instead of caching it`, async () => {
    mock_canvas()
    let reject_ready: (() => void) | undefined
    const ready = new Promise<void>((_resolve, reject) => {
      reject_ready = () => reject(new Error(`font load failed`))
    })
    const revision_before = get_text_metrics_revision()

    const failed = invalidate_text_metrics_after_fonts_ready({ ready })
    reject_ready?.()
    await expect(failed).rejects.toThrow(`font load failed`)

    // a fresh promise rather than the memoized one proves the entry was dropped
    const retried = invalidate_text_metrics_after_fonts_ready({ ready })
    expect(retried).not.toBe(failed)
    await expect(retried).rejects.toThrow(`font load failed`)
    await expect(
      invalidate_text_metrics_after_fonts_ready({ ready: Promise.resolve() }),
    ).resolves.toBe(revision_before + 1)
  })

  it(`returns deterministic SSR metrics without touching browser globals`, async () => {
    const font = { ...DEFAULT_FONT_SPEC, font_size: 10, line_height: 15 }
    vi.stubGlobal(`document`, undefined)

    expect(resolve_font_spec(null, font)).toEqual(font)
    expect([measure_text_line(`A🙂`, font), measure_text_line(`x`, font)]).toMatchObject([
      { text: `A🙂`, width: 12, ascent: 8, descent: 2, source: `fallback` },
      { text: `x`, width: 6, ascent: 8, descent: 2, source: `fallback` },
    ])
    const revision_before = get_text_metrics_revision()
    await expect(invalidate_text_metrics_after_fonts_ready()).resolves.toBe(revision_before)
  })
})

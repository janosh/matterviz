import { resolve_plot_title, type PlotTitleMeasure } from '$lib/plot/core/plot-title'
import { clear_text_metrics_cache } from '$lib/plot/core/text-metrics'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fixed_width_measure =
  (pixels_per_character: number): PlotTitleMeasure =>
  (text, font) => ({
    text,
    width: Array.from(text).length * pixels_per_character,
    ascent: font.font_size * 0.8,
    descent: font.font_size * 0.2,
    height: font.font_size,
    source: `fallback`,
  })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clear_text_metrics_cache()
})

describe(`resolve_plot_title`, () => {
  it(`wraps at measured word boundaries and splits overlong words`, () => {
    const measure = fixed_width_measure(5)
    const wrapped = resolve_plot_title(
      {
        text: `alpha beta gamma`,
        font: { font_size: 10, line_height: 12 },
      },
      { width: 50 },
      measure,
    )
    const split_word = resolve_plot_title(
      {
        text: `abcdefghij`,
        font: { font_size: 10, line_height: 12 },
      },
      { width: 20 },
      measure,
    )

    expect(wrapped.title?.lines.map(({ text }) => text)).toEqual([`alpha beta`, `gamma`])
    expect(wrapped.block_height).toBe(24)
    expect(split_word.title?.lines.map(({ text }) => text)).toEqual([`abcd`, `efgh`, `ij`])
  })

  it(`limits wrapped lines with a measured ellipsis while preserving the full label`, () => {
    const measure = fixed_width_measure(5)
    const layout = resolve_plot_title(
      {
        text: `alpha beta gamma delta`,
        max_lines: 1,
        font: { font_size: 10, line_height: 12 },
      },
      { width: 50 },
      measure,
    )

    expect(layout.title?.lines).toHaveLength(1)
    expect(layout.title?.lines[0].text.endsWith(`…`)).toBe(true)
    expect(layout.title?.lines[0].width).toBeLessThanOrEqual(50)
    expect(layout.title?.label).toBe(`alpha beta gamma delta`)
  })

  it.each([
    [`start`, 10],
    [`middle`, 60],
    [`end`, 110],
  ] as const)(`align=%s anchors every line at x=%i`, (align, expected_x) => {
    const layout = resolve_plot_title(
      { text: `Title`, subtitle: `Subtitle`, align },
      { x: 10, y: 8, width: 100 },
      fixed_width_measure(5),
    )

    expect(layout.anchor_x).toBe(expected_x)
    expect(layout.text_anchor).toBe(align)
    expect(layout.lines.every(({ x }) => x === expected_x)).toBe(true)
  })

  it(`positions a separately styled subtitle after the measured title block and gap`, () => {
    const layout = resolve_plot_title(
      {
        text: `Main`,
        subtitle: `Details`,
        gap: 5,
        font: { font_family: `Title Font`, font_size: 16, line_height: 20 },
        subtitle_font: {
          font_family: `Subtitle Font`,
          font_size: 9,
          line_height: 12,
          font_style: `italic`,
        },
      },
      { x: 4, y: 7, width: 200 },
      fixed_width_measure(4),
    )

    expect(layout.title).toMatchObject({
      y: 7,
      height: 20,
      font: { font_family: `Title Font`, font_size: 16, line_height: 20 },
    })
    expect(layout.subtitle).toMatchObject({
      y: 32,
      height: 12,
      font: {
        font_family: `Subtitle Font`,
        font_size: 9,
        line_height: 12,
        font_style: `italic`,
      },
    })
    expect(layout.block_height).toBe(37)
  })

  it.each([
    [`undefined`, undefined],
    [`empty object`, {}],
    [`blank strings`, { text: `  `, subtitle: `\n` }],
  ] as const)(`returns an empty zero-height layout for %s config`, (_name, config) => {
    const layout = resolve_plot_title(config, { width: 100 }, fixed_width_measure(5))
    expect(layout.lines).toEqual([])
    expect(layout.title).toBeNull()
    expect(layout.subtitle).toBeNull()
    expect(layout.block_height).toBe(0)
  })

  it(`reflows when text metrics change`, () => {
    let pixels_per_character = 5
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
      font: ``,
      measureText: (text: string) => ({
        width: Array.from(text).length * pixels_per_character,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
      }),
    } as unknown as CanvasRenderingContext2D)
    const config = {
      text: `alpha beta`,
      font: { font_size: 10, line_height: 12 },
    }
    const compact = resolve_plot_title(config, { width: 50, metrics_revision: 1 })
    pixels_per_character = 6
    // metrics_revision stamps the result; changing mocked glyph widths still needs invalidation.
    clear_text_metrics_cache()
    const expanded = resolve_plot_title(config, { width: 50, metrics_revision: 2 })

    expect(compact.title?.lines.map(({ text }) => text)).toEqual([`alpha beta`])
    expect(expanded.title?.lines.map(({ text }) => text)).toEqual([`alpha`, `beta`])
    expect(compact.block_height).toBe(12)
    expect(expanded.block_height).toBe(24)
    expect(expanded.metrics_revision).toBe(2)
  })

  it(`uses deterministic text-metrics fallbacks during SSR`, () => {
    vi.stubGlobal(`document`, undefined)
    const layout = resolve_plot_title(
      {
        text: `A🙂`,
        font: { font_size: 10, line_height: 12 },
      },
      { width: 100 },
    )

    expect(layout.title?.lines).toMatchObject([
      { text: `A🙂`, width: 12, ascent: 8, descent: 2, source: `fallback` },
    ])
    expect(layout.title?.lines[0].y).toBe(9)
  })

  it.each([
    [`max_lines`, { max_lines: 0 }],
    [`gap`, { gap: -1 }],
  ] as const)(`rejects invalid %s`, (message, config) => {
    expect(() => resolve_plot_title(config, { width: 100 }, fixed_width_measure(5))).toThrow(
      message,
    )
  })
})

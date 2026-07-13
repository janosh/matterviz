import { get_chart_font_scale } from '$lib/composition'
import { describe, expect, it } from 'vitest'

describe(`get_chart_font_scale`, () => {
  it.each([
    [`text fits`, `Short`, 100],
    [`zero space`, `Text`, 0],
    [`negative space`, `Text`, -10],
    [`empty text`, ``, 100],
  ])(`returns base scale when %s`, (_desc, text, space) => {
    expect(get_chart_font_scale(1.0, text, space)).toBe(1.0)
  })

  it(`scales down when text is too wide`, () => {
    const result = get_chart_font_scale(1.0, `Very Long Text`, 50)
    expect(result).toBeLessThan(1.0)
    expect(result).toBeGreaterThan(0)
  })

  it(`respects minimum scale factor`, () => {
    expect(get_chart_font_scale(1.0, `Extremely Long Text`, 10, 0.5)).toBe(0.5)
  })

  it(`scales down with custom base font size`, () => {
    expect(get_chart_font_scale(1.0, `Test`, 20, 0.7, 20)).toBeLessThan(1.0)
  })
})

import { get_chart_font_scale } from '$lib/composition'
import { describe, expect, it } from 'vitest'

describe(`get_chart_font_scale`, () => {
  it(`returns base scale when text fits`, () => {
    expect(get_chart_font_scale(1.0, `Short`, 100)).toBe(1.0)
  })

  it(`scales down when text is too wide`, () => {
    const result = get_chart_font_scale(1.0, `Very Long Text`, 50)
    expect(result).toBeLessThan(1.0)
    expect(result).toBeGreaterThan(0)
  })

  it(`respects minimum scale factor`, () => {
    const result = get_chart_font_scale(1.0, `Extremely Long Text`, 10, 0.5)
    expect(result).toBe(0.5)
  })

  it(`handles edge cases`, () => {
    expect(get_chart_font_scale(1.0, `Text`, 0)).toBe(1.0) // zero space
    expect(get_chart_font_scale(1.0, `Text`, -10)).toBe(1.0) // negative space
    expect(get_chart_font_scale(1.0, ``, 100)).toBe(1.0) // empty text
  })

  it(`uses custom parameters`, () => {
    const result = get_chart_font_scale(1.0, `Test`, 20, 0.7, 20)
    expect(result).toBeLessThan(1.0)
  })
})

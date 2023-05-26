import { element_color_schemes } from '$lib/colors'
import { expect, test } from 'vitest'

test(`element_color_schemes`, () => {
  for (const [scheme, colors] of Object.entries(element_color_schemes)) {
    expect(Object.keys(colors).length, scheme).toBeGreaterThan(108)
  }
})

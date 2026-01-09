import type { Matrix3x3, Vec2 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import { compute_xrd_pattern, type XrdPattern } from '$lib/xrd'
import { describe, expect, test } from 'vitest'
import { create_test_structure } from '../setup'

function make_simple_cubic(
  a_len: number,
  element_symbol: string = `H`,
): Crystal {
  const a = a_len
  const lattice: Matrix3x3 = [[a, 0, 0], [0, a, 0], [0, 0, a]]
  return create_test_structure(lattice, [element_symbol as never], [[0, 0, 0]])
}

describe(`@xrd/ api and compute_xrd_pattern options`, () => {
  test(`unknown radiation key throws`, () => {
    const structure = make_simple_cubic(2)
    expect(() => compute_xrd_pattern(structure, { wavelength: `FooBar` as never }))
      .toThrow(/Unknown radiation key/i)
  })

  test.each([
    { wl: 0, desc: `zero` },
    { wl: -1.5, desc: `negative` },
    { wl: NaN, desc: `NaN` },
    { wl: Infinity, desc: `Infinity` },
    { wl: -Infinity, desc: `-Infinity` },
  ])(`invalid numeric wavelength ($desc) throws`, ({ wl }) => {
    const structure = make_simple_cubic(2)
    try {
      compute_xrd_pattern(structure, { wavelength: wl })
      expect.fail(`Expected error for wavelength=${wl}`)
    } catch (error) {
      const message = (error as Error).message
      // relaxed key fragments only, not full wording
      expect(message).toMatch(/invalid wavelength/i)
      expect(message).toMatch(/finite positive/i)
      // ensure the invalid value is echoed for debugging
      expect(message).toContain(String(wl))
    }
  })

  test(`valid numeric wavelength works`, () => {
    const structure = make_simple_cubic(2)
    const pattern = compute_xrd_pattern(structure, { wavelength: 1.54184 })
    expect(pattern.x.length).toBeGreaterThan(0)
    expect(pattern.y.length).toBe(pattern.x.length)
  })

  test(`unknown element symbol throws`, () => {
    const structure = make_simple_cubic(2, `Xx`)
    expect(() => compute_xrd_pattern(structure, { wavelength: `CuKa` }))
      .toThrow(/Unknown atomic number/i)
  })

  test.each([
    { t_range: [0, 30] as Vec2 },
    { t_range: [10, 60] as Vec2 },
  ])(`two_theta_range bounds respected and x sorted`, ({ t_range }) => {
    const structure = make_simple_cubic(2)
    const pattern = compute_xrd_pattern(structure, {
      wavelength: `CuKa`,
      two_theta_range: t_range,
      scaled: false,
    })
    expect(pattern.x.every((angle) => angle >= t_range[0] && angle <= t_range[1])).toBe(
      true,
    )
    const xs = pattern.x.slice()
    const sorted = [...xs].sort((a, b) => a - b)
    expect(xs).toEqual(sorted)
  })

  test(`scaled false returns raw intensities; scaled true caps max to 100`, () => {
    const structure = make_simple_cubic(2)
    const raw = compute_xrd_pattern(structure, { wavelength: `CuKa`, scaled: false })
    const scaled = compute_xrd_pattern(structure, { wavelength: `CuKa`, scaled: true })
    expect(raw.x.length).toBeGreaterThan(0)
    expect(Math.max(...raw.y)).not.toBeCloseTo(100, 6)
    expect(Math.max(...scaled.y)).toBeCloseTo(100, 12)
  })

  test(`Debye-Waller factors damp intensities when not scaled`, () => {
    const structure = make_simple_cubic(2)
    const base = compute_xrd_pattern(structure, { wavelength: `CuKa`, scaled: false })
    const damp = compute_xrd_pattern(structure, {
      wavelength: `CuKa`,
      scaled: false,
      debye_waller_factors: { H: 10 },
    })
    const max_base = Math.max(0, ...base.y)
    const max_damp = Math.max(0, ...damp.y)
    expect(max_damp).toBeLessThan(max_base)
  })

  test(`returns consistent vector lengths and optional hkls/d_hkls`, () => {
    const structure = make_simple_cubic(2)
    const pattern: XrdPattern = compute_xrd_pattern(structure, {
      wavelength: `CuKa`,
      scaled: true,
    })
    expect(pattern.x.length).toBe(pattern.y.length)
    if (pattern.hkls) expect(pattern.hkls.length).toBe(pattern.x.length)
    if (pattern.d_hkls) expect(pattern.d_hkls.length).toBe(pattern.x.length)
  })
})

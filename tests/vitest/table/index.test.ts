import type { D3InterpolateName } from '#lib/colors/index.js'
import type { CellVal } from '#lib/table/index.js'
import { make_cell_color_scale } from '#lib/table/index.js'
import { describe, expect, it } from 'vitest'

// Row, sort, filter and stats helpers are tested with DataTable in svelte-widgets; these cover
// HeatmapTable's color scales.
// one-shot wrapper around the memoized factory, for the single-cell assertions below
const calc_cell_color = (
  val: number | null | undefined,
  all_values: CellVal[],
  better: `higher` | `lower` | undefined,
  scheme: D3InterpolateName | null = `interpolateViridis`,
  type: `linear` | `log` = `linear`,
) => make_cell_color_scale(all_values, better, scheme && { scheme, type })(val)

describe(`column color scales`, () => {
  it(`treats non-finite values as uncolorable`, () => {
    const scale = make_cell_color_scale([1, 2, Infinity], `higher`)
    expect(scale(Infinity).bg).toBeNull()
    expect(scale(2).bg).not.toBeNull()
  })

  it(`keeps log scaling when a supplied domain reaches zero`, () => {
    const bg_of_10 = (scale_type: `linear` | `log`, domain?: [number, number]) =>
      make_cell_color_scale([1, 10, 100], `higher`, { type: scale_type }, domain)(10).bg
    expect(bg_of_10(`log`, [0, 100])).not.toBe(bg_of_10(`linear`, [0, 100]))
    expect(bg_of_10(`log`, [0, 100])).toBe(bg_of_10(`log`))
  })

  it.each([`linear`, `log`] as const)(
    `clamps %s colors without rescanning a supplied domain`,
    (scale_type) => {
      const column_values = [0, 10, 10_000]
      Object.defineProperty(column_values, 0, {
        get: () => {
          throw new Error(`explicit domain must not read column values`)
        },
      })
      const scale = make_cell_color_scale(
        column_values,
        `higher`,
        { type: scale_type },
        [1, 10],
      )
      expect(scale(10_000).bg).toBe(scale(10).bg)
      expect(scale(5).bg).not.toBe(scale(10).bg)
    },
  )

  // color_scale.value_range ends override the data domain and clamp; palette_range clips
  it(`honors value_range and palette_range like the other color-mapped components`, () => {
    const cell_values = [0, 50, 100]
    const fixed = make_cell_color_scale(cell_values, `higher`, { value_range: [null, 50] })
    const full = make_cell_color_scale([0, 50], `higher`)
    for (const val of [0, 25, 50]) expect(fixed(val).bg).toBe(full(val).bg)
    expect(fixed(100).bg).toBe(full(50).bg) // clamped at the fixed max
    const clipped = make_cell_color_scale(cell_values, `higher`, { palette_range: [0.5, 1] })
    expect(clipped(0).bg).toBe(make_cell_color_scale(cell_values, `higher`)(50).bg)
  })
})

describe(`make_cell_color_scale`, () => {
  it.each<
    [
      name: string,
      val: number | null | undefined,
      all_values: CellVal[],
      color_scale?: D3InterpolateName | null,
      scale_type?: `linear` | `log`,
    ]
  >([
    [`null value`, null, [1, 2, 3]],
    [`undefined value`, undefined, [1, 2, 3]],
    [`NaN value`, NaN, [1, 50, 100]],
    [`null color_scale`, 5, [1, 5, 10], null],
    [`empty column`, 5, []],
    [`only non-numeric values`, 50, [null, `a`, undefined]],
    [`all NaN values`, 50, [NaN, NaN]],
    [`negative with log scale`, -5, [-5, 50, 100], undefined, `log`],
    [`log column without nonnegative values`, 1, [-5, -1, Infinity], undefined, `log`],
  ])(`returns null colors for %s`, (_name, val, all_values, color_scale, scale_type) => {
    expect(calc_cell_color(val, all_values, `higher`, color_scale, scale_type)).toEqual({
      bg: null,
      text: null,
    })
  })

  it.each<
    [
      name: string,
      val: number,
      all_values: CellVal[],
      better: `higher` | undefined,
      scale_type?: `linear` | `log`,
    ]
  >([
    [`undefined better`, 50, [1, 50, 100], undefined],
    [`zero with linear scale`, 0, [0, 50, 100], `higher`],
    [`all-zero log scale`, 0, [0, 0], `higher`, `log`],
    [`log zero mixed with invalid values`, 0, [null, -1, -0, NaN], `higher`, `log`],
    [`negative with linear scale`, -50, [-100, 0, 100], `higher`],
    [`log scale positive values`, 100, [10, 100, 1000], `higher`, `log`],
    [`mixed types`, 50, [null, `text`, 10, 50, 100, undefined, true, { obj: 1 }], `higher`],
    [`single numeric value`, 42, [42], `higher`],
    [`NaN filtered from column`, 50, [1, NaN, 100], `higher`],
  ])(`returns valid colors for %s`, (_name, val, all_values, better, scale_type) => {
    const result = calc_cell_color(val, all_values, better, `interpolateViridis`, scale_type)
    expect(result.bg).not.toBeNull()
    expect(result.text).not.toBeNull()
  })

  it(`uses contrasting endpoints and reverses the gradient for lower values`, () => {
    const values = [1, 50, 100]
    const low = calc_cell_color(1, values, `higher`)
    const high = calc_cell_color(100, values, `higher`)
    expect(low.text).toBe(`white`)
    expect(high.text).toBe(`black`)
    expect(low.bg).not.toBe(high.bg)
    expect(low.bg).toBe(calc_cell_color(100, values, `lower`).bg)
    expect(high.bg).toBe(calc_cell_color(1, values, `lower`).bg)
  })

  it(`maps log-scale zero to the lowest positive endpoint color`, () => {
    const values = [0, 10, 100]
    for (const better of [`higher`, `lower`] as const) {
      expect(calc_cell_color(0, values, better, undefined, `log`).bg).toBe(
        calc_cell_color(10, values, better, undefined, `log`).bg,
      )
    }
  })

  it(`rejects invalid color scale names`, () => {
    const invalid_scale = `interpolateNonExistent` as D3InterpolateName
    expect(() => calc_cell_color(50, [1, 50, 100], `higher`, invalid_scale)).toThrow(
      `Unknown D3 color interpolator: interpolateNonExistent`,
    )
  })
})

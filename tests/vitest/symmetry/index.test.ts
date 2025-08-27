import { simplicity_score, wyckoff_positions_from_moyo } from '$lib/symmetry'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'

describe(`wyckoff_positions_from_moyo`, () => {
  test(`returns empty array when sym_data is null`, () => {
    const result = wyckoff_positions_from_moyo(null)
    expect(result).toEqual([])
  })

  test(`processes symmetric sites with Wyckoff letters correctly`, () => {
    const mock_sym_data = {
      std_cell: {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0, 0], [0, 0.5, 0]],
        numbers: [1, 1, 1, 1], // All H atoms
      },
      wyckoffs: [`1a`, `1a`, `1a`, `1a`],
    } as unknown as MoyoDataset

    const result = wyckoff_positions_from_moyo(mock_sym_data)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      wyckoff: `4a`,
      elem: `H`,
      abc: [0, 0, 0], // Should pick the simplest coordinates
    })
  })

  test(`handles mixed element types correctly`, () => {
    const mock_sym_data = {
      std_cell: {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5]],
        numbers: [1, 8], // H, O
      },
      wyckoffs: [`1a`, `1b`],
    } as unknown as MoyoDataset

    const result = wyckoff_positions_from_moyo(mock_sym_data)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ wyckoff: `1a`, elem: `H`, abc: [0, 0, 0] })
    expect(result[1]).toEqual({ wyckoff: `1b`, elem: `O`, abc: [0.5, 0.5, 0.5] })
  })

  test(`sorts results by multiplicity then alphabetically`, () => {
    const mock_sym_data = {
      std_cell: {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.75]],
        numbers: [1, 8, 1, 1], // H, O, H, H
      },
      wyckoffs: [`b`, `a`, `b`, `b`], // 3 atoms at 'b', 1 atom at 'a'
    } as unknown as MoyoDataset

    const result = wyckoff_positions_from_moyo(mock_sym_data)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ wyckoff: `1a`, elem: `O`, abc: [0.5, 0.5, 0.5] })
    expect(result[1]).toEqual({ wyckoff: `3b`, elem: `H`, abc: [0, 0, 0] })
  })

  test(`handles sites without Wyckoff letters`, () => {
    const mock_sym_data = {
      std_cell: {
        positions: [[0, 0, 0], [0.5, 0.5, 0.5]],
        numbers: [1, 8], // H, O
      },
      wyckoffs: [``, `1a`], // Empty string for first site
    } as unknown as MoyoDataset

    const result = wyckoff_positions_from_moyo(mock_sym_data)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ wyckoff: `1`, elem: `H`, abc: [0, 0, 0] })
    expect(result[1]).toEqual({ wyckoff: `1a`, elem: `O`, abc: [0.5, 0.5, 0.5] })
  })

  test(`handles null/undefined Wyckoff values`, () => {
    const mock_sym_data = {
      std_cell: {
        positions: [[0, 0, 0]],
        numbers: [1], // H
      },
      wyckoffs: [null],
    } as unknown as MoyoDataset

    const result = wyckoff_positions_from_moyo(mock_sym_data)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ wyckoff: `1`, elem: `H`, abc: [0, 0, 0] })
  })
})

describe(`simplicity_score`, () => {
  test(`returns 0.75 for integer coordinates`, () => {
    expect(simplicity_score([0, 0, 0])).toBe(0.75)
    expect(simplicity_score([1, 0, 0])).toBe(0.75)
  })

  test(`returns higher scores for fractional coordinates`, () => {
    expect(simplicity_score([0.5, 0.5, 0.5])).toBeGreaterThan(0)
    expect(simplicity_score([0.25, 0.75, 0.125])).toBeGreaterThan(0)
  })

  test(`prefers coordinates closer to 0 or 1`, () => {
    const score_0 = simplicity_score([0.1, 0.1, 0.1])
    const score_05 = simplicity_score([0.5, 0.5, 0.5])
    const score_09 = simplicity_score([0.9, 0.9, 0.9])

    expect(score_0).toBeLessThan(score_05)
    expect(score_09).toBeLessThan(score_05)
  })
})

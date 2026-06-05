import { arity_name, chem_sys_sunburst_data } from '$lib/composition'
import { describe, expect, test, vi } from 'vitest'

describe(`chem_sys_sunburst_data`, () => {
  test(`groups by arity and normalizes formulas + chemsys strings to one system`, () => {
    const data = chem_sys_sunburst_data([
      `Li-Fe-O`, // chemsys string
      `O-Li-Fe`, // out-of-order chemsys -> same system
      `LiFePO4`, // formula -> quaternary Fe-Li-O-P
      `Fe2O3`,
      `Fe-O`,
      `LiCoO2`,
    ])
    expect(data.map((node) => node.id)).toEqual([`binary`, `ternary`, `quaternary`])
    const ternary = data[1]
    // sorted by count descending within an arity
    expect(ternary.children?.map((node) => [node.label, node.value])).toEqual([
      [`Fe-Li-O`, 2],
      [`Co-Li-O`, 1],
    ])
    expect(ternary.children?.[0].id).toBe(`ternary/Fe-Li-O`)
    expect(ternary.children?.[0].metadata).toEqual({ chem_sys: `Fe-Li-O`, arity: 3 })
    expect(data[0].children?.map((node) => [node.label, node.value])).toEqual([[`Fe-O`, 2]])
  })

  test(`duplicate elements in a formula count once toward arity`, () => {
    const data = chem_sys_sunburst_data([`Li2Fe2O4`])
    expect(data[0].children?.[0].label).toBe(`Fe-Li-O`)
    expect(data[0].id).toBe(`ternary`)
  })

  test(`skips invalid entries with a single warning`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const data = chem_sys_sunburst_data([`Fe-O`, `Xx-Yy`, `not a formula!`, ``])
    expect(data).toHaveLength(1)
    expect(data[0].children?.[0].value).toBe(1)
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/skipped 3 invalid entries/),
    )
    warn.mockRestore()
  })

  test(`returns empty array for empty input`, () => {
    expect(chem_sys_sunburst_data([])).toEqual([])
  })
})

describe(`arity_name`, () => {
  test.each([
    [1, `unary`],
    [2, `binary`],
    [3, `ternary`],
    [4, `quaternary`],
    [5, `quinary`],
    [9, `9-ary`],
  ])(`maps %i to %s`, (arity, expected) => {
    expect(arity_name(arity)).toBe(expected)
  })
})

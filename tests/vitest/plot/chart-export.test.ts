import { export_filename, series_to_csv_rows, to_csv } from '$lib/plot/core/utils/chart-export'
import { describe, expect, test } from 'vitest'

describe(`to_csv`, () => {
  test.each([
    [`plain values stay unquoted`, [[1, 2]], `a,b\n1,2`],
    [`commas force quotes`, [[`x,y`, 1]], `a,b\n"x,y",1`],
    [`embedded quotes double`, [[`say "hi"`, 1]], `a,b\n"say ""hi""",1`],
    [`newlines force quotes`, [[`two\nlines`, 1]], `a,b\n"two\nlines",1`],
    // A cell that silently became `NaN`/`Infinity` would read as data downstream
    [`non-finite numbers blank out`, [[NaN, Infinity]], `a,b\n,`],
    [`null and undefined blank out`, [[null, undefined]], `a,b\n,`],
  ])(`%s`, (_name, rows, expected) => {
    expect(to_csv([`a`, `b`], rows)).toBe(expected)
  })
})

describe(`series_to_csv_rows`, () => {
  test(`emits one row per point, series named in a column`, () => {
    const { header, rows } = series_to_csv_rows([
      { label: `A`, x: [1, 2], y: [10, 20] },
      { x: [3], y: [30] },
    ])
    expect(header).toEqual([`series`, `x`, `y`])
    expect(rows).toEqual([
      [`A`, 1, 10],
      [`A`, 2, 20],
      [`series 2`, 3, 30],
    ])
  })

  test(`extra channels become columns, absent ones null`, () => {
    const { header, rows } = series_to_csv_rows([
      { label: `A`, x: [1], y: [2], extras: { color_value: [7] } },
      { label: `B`, x: [3], y: [4] },
    ])
    expect(header).toEqual([`series`, `x`, `y`, `color_value`])
    expect(rows).toEqual([
      [`A`, 1, 2, 7],
      [`B`, 3, 4, null],
    ])
  })

  // Ragged x/y would otherwise emit undefined cells for the overhang
  test(`ragged series stop at the shorter of x and y`, () => {
    const { rows } = series_to_csv_rows([{ label: `A`, x: [1, 2, 3], y: [10] }])
    expect(rows).toEqual([[`A`, 1, 10]])
  })
})

describe(`export_filename`, () => {
  test.each([
    [[`Energy vs Volume`], `Energy-vs-Volume`],
    [[`E (eV)`, `V`], `E-eV-V`],
    [[undefined, `  `, `x`], `x`],
    [[], `chart`], // never yields an empty filename
    [[`///`], `chart`],
  ])(`%j -> %s`, (parts, expected) => {
    expect(export_filename(...parts)).toBe(expected)
  })
})

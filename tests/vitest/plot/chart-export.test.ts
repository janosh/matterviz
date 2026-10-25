import { parse_linear_gradient } from '#lib/io/export.js'
import {
  chart_export_filename,
  csv_source,
  export_filename,
  series_to_csv_rows,
  to_csv,
} from '#lib/plot/core/utils/chart-export.js'
import { describe, expect, test } from 'vitest'

describe(`to_csv`, () => {
  test.each([
    [`plain values stay unquoted`, [[1, 2]], `a,b\n1,2`],
    [`commas force quotes`, [[`x,y`, 1]], `a,b\n"x,y",1`],
    [`embedded quotes double`, [[`say "hi"`, 1]], `a,b\n"say ""hi""",1`],
    [`newlines force quotes`, [[`two\nlines`, 1]], `a,b\n"two\nlines",1`],
    [`carriage returns force quotes`, [[`two\rlines`, 1]], `a,b\n"two\rlines",1`],
    // A cell that silently became `NaN`/`Infinity` would read as data downstream
    [`non-finite numbers blank out`, [[NaN, Infinity]], `a,b\n,`],
    [`null and undefined blank out`, [[null, undefined]], `a,b\n,`],
  ])(`%s`, (_name, rows, expected) => {
    expect(to_csv([`a`, `b`], rows)).toBe(expected)
  })
})

describe(`series_to_csv_rows`, () => {
  // an HTML label (as legends render it) is named by its text
  test(`emits one row per point, series named in a column`, () => {
    const { header, rows } = series_to_csv_rows([
      { label: `A`, x: [1, 2], y: [10, 20] },
      { x: [3], y: [30] },
      { label: `E<sub>F</sub> &amp; co`, x: [4], y: [40] },
    ])
    expect(header).toEqual([`series`, `x`, `y`])
    expect(rows).toEqual([
      [`A`, 1, 10],
      [`A`, 2, 20],
      [`series 2`, 3, 30],
      [`EF & co`, 4, 40],
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
    [[`Énergie`, `ΔE<sub>F</sub> (eV)`, `Fe₂O₃`], `Énergie-ΔEF-eV-Fe₂O₃`],
    [[`${`a`.repeat(99)} b`], `a`.repeat(99)], // the cut must not strand a dash
    [[`-${`a`.repeat(98)}--b`], `${`a`.repeat(98)}-b`], // leading dashes cost no length
    [[`形`.repeat(150)], `形`.repeat(33)], // 100 bytes: 3 per CJK, 4 per astral code point
    [[`𝐸`.repeat(150)], `𝐸`.repeat(25)],
  ])(`%j -> %s`, (parts, expected) => {
    expect(export_filename(...parts)).toBe(expected)
  })
})

test(`chart_export_filename slugs the title and axis labels; csv_source builds lazily`, () => {
  const frame = { title_config: { text: `My Chart` }, axes: { x: { label: `E (eV)` }, y: {} } }
  expect(chart_export_filename(frame)).toBe(`My-Chart-E-eV`)
  let built = 0
  const source = csv_source(() => {
    built++
    return { header: [`a`], rows: [[1], [Number.NaN]] }
  })
  expect(built).toBe(0)
  expect(source(144)).toBe(`a\n1\n`)
  expect(built).toBe(1)
})

// Computed ColorBar backgrounds, whose colors carry their own commas. Only ColorBar's
// `to <side>` form is recognized.
// oxfmt-ignore
test.each([
  [`linear-gradient(to right, rgb(0, 0, 255) 0%, rgb(255, 0, 0) 100%)`, { vector: [0, 0, 1, 0], stops: [[`rgb(0, 0, 255)`, `0%`], [`rgb(255, 0, 0)`, `100%`]] }],
  [`linear-gradient(to top, red 0%, rgba(0, 128, 0, 0.5) 50%, blue 100%)`, { vector: [0, 1, 0, 0], stops: [[`red`, `0%`], [`rgba(0, 128, 0, 0.5)`, `50%`], [`blue`, `100%`]] }],
  [`linear-gradient(red, blue)`, null],
  [`none`, null],
])(`parse_linear_gradient(%s)`, (css, expected) => {
  expect(parse_linear_gradient(css)).toEqual(expected)
})

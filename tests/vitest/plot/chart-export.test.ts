import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
import { download } from '$lib/io/fetch'
import {
  create_chart_exporter,
  export_filename,
  series_to_csv_rows,
  to_csv,
} from '$lib/plot/core/utils/chart-export'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('$lib/io/fetch', () => ({ download: vi.fn() }))
vi.mock('$lib/io/export', () => ({
  export_svg_as_png: vi.fn(),
  export_svg_as_svg: vi.fn(),
}))

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

// Every chart shares this branch, so it is tested once here rather than per chart
describe(`create_chart_exporter`, () => {
  const svg = {} as SVGElement
  const frame = {
    svg_element: svg,
    title_config: { text: `My Chart` },
    axes: { x: { label: `E (eV)` }, y: { label: `n` } },
  }
  const make = () => create_chart_exporter(frame, () => ({ header: [`a`], rows: [[1]] }))

  beforeEach(() => vi.clearAllMocks())

  test(`csv writes the table under the .csv name and draws no image`, () => {
    make()(`csv`)
    expect(download).toHaveBeenCalledWith(
      `a\n1`,
      `My-Chart-E-eV-n.csv`,
      expect.stringContaining(`csv`),
    )
    expect(export_svg_as_png).not.toHaveBeenCalled()
    expect(export_svg_as_svg).not.toHaveBeenCalled()
  })

  test.each([
    [`png`, export_svg_as_png],
    [`svg`, export_svg_as_svg],
  ] as const)(`%s renders the image and writes no csv`, (format, exporter) => {
    make()(format)
    // Only the leading args are the contract here; styles/dpi belong to the io helpers
    expect(vi.mocked(exporter).mock.calls[0].slice(0, 2)).toEqual([
      svg,
      `My-Chart-E-eV-n.${format}`,
    ])
    expect(download).not.toHaveBeenCalled()
  })
})

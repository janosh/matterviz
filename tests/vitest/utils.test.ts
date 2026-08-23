import {
  decode_url_safe_base64,
  escape_csv_field,
  format_bytes,
  parse_leading_num,
  parse_num_token,
  rows_to_csv,
} from '$lib'
import { describe, expect, test } from 'vitest'

describe(`parse_num_token / parse_leading_num`, () => {
  test.each([
    // [input, whole-token result, first-token result]
    [` 1.5 `, 1.5, 1.5],
    [``, NaN, NaN], // blank must be NaN, not 0 (unlike Number(``))
    [`2.0 ! scale`, NaN, 2], // leading_num keeps first token like parseFloat
    [`6 methane`, NaN, 6], // Tinker-style XYZ count line
    [`abc`, NaN, NaN],
  ])(`%j -> %s / %s`, (input, whole, leading) => {
    expect(parse_num_token(input)).toBe(whole)
    expect(parse_leading_num(input)).toBe(leading)
  })
})

describe(`decode_url_safe_base64`, () => {
  test.each([
    [`dGVzdA`, `test`],
    [``, ``],
    // URL-safe: _ → /, - → +
    [`c3ViamVjdHM_`, `subjects?`],
    [`PDw_Pz4-`, `<<??>>`],
    // invalid → undefined
    [`!!!not-base64!!!`, undefined],
  ])(`decodes %s → %s`, (encoded, expected) => {
    expect(decode_url_safe_base64(encoded)).toBe(expected)
  })

  test(`decodes a realistic JSON structure payload`, () => {
    const json = JSON.stringify({ lattice: [[1, 0, 0]], sites: [{ element: `Na` }] })
    const url_safe = btoa(json).replaceAll('+', `-`).replaceAll('/', `_`).replace(/=+$/, ``)
    expect(decode_url_safe_base64(url_safe)).toBe(json)
  })
})

describe(`rows_to_csv`, () => {
  test.each([
    [[], ``],
    [
      [
        { y_key: `X`, A: 1, B: 2 },
        { y_key: `Y`, A: 3, B: null },
      ],
      `y_key,A,B\nX,1,2\nY,3,`,
    ],
    [
      [{ y_key: `Fe,O`, A: `He"Ne`, B: `line1\nline2` }],
      `y_key,A,B\n"Fe,O","He""Ne","line1\nline2"`,
    ],
  ])(`serializes %j`, (rows, expected) => {
    expect(rows_to_csv(rows)).toBe(expected)
  })

  test.each([
    [`plain`, `plain`],
    [42, `42`],
    [null, ``],
    [undefined, ``],
    [`a,b`, `"a,b"`],
    [`say "hi"`, `"say ""hi"""`],
    [`line1\rline2`, `"line1\rline2"`],
  ])(`escape_csv_field(%j) = %j`, (value, expected) => {
    expect(escape_csv_field(value)).toBe(expected)
  })
})

describe(`format_bytes`, () => {
  test.each([
    // Undefined and edge cases
    [undefined, `Unknown`],
    [NaN, `Unknown`],
    [Infinity, `Unknown`],
    [-Infinity, `Unknown`],

    // Bytes range (< 1024)
    [0, `0 B`],
    [1, `1 B`],
    [500, `500 B`],
    [1023, `1023 B`],
    [1023.5, `1024 B`],
    [0.4, `0 B`],

    // Kibibytes range (1024 - 1024*1024)
    [1024, `1.00 KiB`],
    [1536, `1.50 KiB`],
    [10240, `10.00 KiB`],
    [102400, `100.00 KiB`],
    [1024 * 1024 - 1, `1024.00 KiB`],

    // Mebibytes range (1024*1024 - 1024*1024*1024)
    [1024 * 1024, `1.00 MiB`],
    [1024 * 1024 * 1.5, `1.50 MiB`],
    [1024 * 1024 * 10, `10.00 MiB`],
    [1024 * 1024 * 100, `100.00 MiB`],
    [1024 * 1024 * 500, `500.00 MiB`],
    [1024 * 1024 * 1024 - 1, `1024.00 MiB`],

    // Gibibytes range (>= 1024*1024*1024)
    [1024 * 1024 * 1024, `1.00 GiB`],
    [1024 * 1024 * 1024 * 1.5, `1.50 GiB`],
    [1024 * 1024 * 1024 * 10, `10.00 GiB`],
    [1024 * 1024 * 1024 * 100, `100.00 GiB`],
    [1024 * 1024 * 1024 * 1000, `1000.00 GiB`],
  ])(`format_bytes(%s) should return %s`, (bytes, expected) => {
    expect(format_bytes(bytes)).toBe(expected)
  })
})

import { decode_url_safe_base64, escape_html, parse_leading_num, parse_num_token } from '$lib'
import { describe, expect, test } from 'vitest'

test.each([
  [`<script>alert('xss')</script>`, `&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;`],
  [`&<>"'`, `&amp;&lt;&gt;&quot;&#39;`],
  [`Hello World`, `Hello World`],
  [``, ``],
])(`escape_html(%s) = %s`, (input, expected) => {
  expect(escape_html(input)).toBe(expected)
})

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

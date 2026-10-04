import {
  decode_url_safe_base64,
  escape_html,
  is_plain_object,
  parse_leading_num,
  parse_num_token,
  to_error,
} from '#lib/utils.js'
import { describe, expect, test } from 'vitest'

test.each([
  `failure`,
  42,
  null,
  undefined,
  Symbol(`failure`),
  Object.create(null),
  { toString: null },
])(`normalizes arbitrary thrown values without throwing: %j`, (value) => {
  const error = to_error(value)
  expect(error).toBeInstanceOf(Error)
  expect(error.cause).toBe(value)
  expect(error.message).not.toBe(``)
  expect(to_error(error)).toBe(error)
})

test.each([
  [{}, true],
  [Object.create(null), true],
  [JSON.parse(`{"value": 1}`), true],
  [new Proxy({ value: 1 }, {}), true],
  [null, false],
  [undefined, false],
  [0, false],
  [`value`, false],
  [[], false],
  [new Date(0), false],
  [new Map(), false],
  [new Set(), false],
  [/pattern/, false],
  [new Float64Array(2), false],
  [
    new (class RecordLike {
      value = 1
    })(),
    false,
  ],
])(`is_plain_object(%j) = %s`, (value, expected) => {
  expect(is_plain_object(value)).toBe(expected)
})

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
  const json = JSON.stringify({ lattice: [[1, 0, 0]], sites: [{ element: `Na` }] })
  test.each([
    [`dGVzdA`, `test`],
    [``, ``],
    // URL-safe: _ → /, - → +
    [`c3ViamVjdHM_`, `subjects?`],
    [`PDw_Pz4-`, `<<??>>`],
    // UTF-8 text, not one Latin-1 char per byte (atob alone gave `Ã\x85 Î±`)
    [`w4UgzrE`, `Å α`],
    // invalid → undefined, including bytes that are not UTF-8
    [`!!!not-base64!!!`, undefined],
    [`__4`, undefined],
    // realistic JSON structure payload
    [btoa(json).replaceAll(`+`, `-`).replaceAll(`/`, `_`).replace(/=+$/, ``), json],
  ])(`decodes %s → %s`, (encoded, expected) => {
    expect(decode_url_safe_base64(encoded)).toBe(expected)
  })
})

import {
  decode_url_safe_base64,
  escape_html,
  html_to_text,
  is_plain_object,
  parse_leading_num,
  parse_num_token,
  strip_html,
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
  [0, false],
  [`value`, false],
  [[], false],
  [new Date(0), false],
  [new Map(), false],
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

// Quoted attribute values may hold `>` or `<`; an unterminated `<` is text, not a tag that
// swallows everything up to the next `>`
test.each([
  [`<span title="x>0" data-y='a>b'>Si</span>`, `Si`],
  [`<a title="<b>">link</a> &amp; more`, `link & more`],
  [`<b>bold</b`, `bold</b`],
  [`a <b c <i>d</i>`, `a <b c d`], // a browser reads `<i` as an attribute, here it is text
  [`<a "unclosed`, `<a "unclosed`],
])(`strip_html / html_to_text(%j) = %j`, (input, expected) => {
  expect(html_to_text(input)).toBe(expected)
  expect(strip_html(input).replaceAll(`&amp;`, `&`)).toBe(expected)
})

// `[^>"']` in the attribute run let every unclosed `<` rescan to the end of input, so
// 48 KB of `<a ` took 631 ms and grew quadratically. Linear, these finish in well under 1 ms.
test.each([`<a `, `<a "`, `<a '`, `<a "'`, `</b`, `<!`, `<a "<a" `])(
  `strip_html and html_to_text stay linear on 200 KB of %j`,
  (unit) => {
    const input = unit.repeat(Math.ceil(200_000 / unit.length))
    const start = performance.now()
    strip_html(input)
    html_to_text(input)
    expect(performance.now() - start).toBeLessThan(200)
  },
)

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

import {
  decode_url_safe_base64,
  html_to_text,
  is_plain_object,
  parse_leading_num,
  parse_num_token,
  toggle_item,
} from '#lib/utils.js'
import { describe, expect, test } from 'vitest'

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

// Quoted attribute values may hold `>` or `<`; an unterminated `<` is text, not a tag that
// swallows everything up to the next `>`
test.each([
  [`<span title="x>0" data-y='a>b'>Si</span>`, `Si`],
  [`<a title="<b>">link</a> &amp; more`, `link & more`],
  [`<b>bold</b`, `bold</b`],
  [`a <b c <i>d</i>`, `a <b c d`], // a browser reads `<i` as an attribute, here it is text
  [`<a "unclosed`, `<a "unclosed`],
])(`html_to_text(%j) = %j`, (input, expected) => {
  expect(html_to_text(input)).toBe(expected)
})

// `[^>"']` in the attribute run let every unclosed `<` rescan to the end of input, so
// 48 KB of `<a ` took 631 ms and grew quadratically. Linear, these finish in well under 1 ms.
test.each([`<a `, `<a "`, `<a '`, `<a "'`, `</b`, `<!`, `<a "<a" `])(
  `html_to_text stays linear on 200 KB of %j`,
  (unit) => {
    const input = unit.repeat(Math.ceil(200_000 / unit.length))
    const start = performance.now()
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

// Adds missing items at the end, drops present ones (every copy) and never mutates the input
test.each([
  [[], 2, [2]],
  [[3, 1], 2, [3, 1, 2]],
  [[3, 2, 1], 2, [3, 1]],
  [[2, 1, 2], 2, [1]],
  [[`a`, `b`], `a`, [`b`]],
  [[`b`], `a`, [`b`, `a`]],
])(`toggle_item(%j, %j) → %j`, (items: (number | string)[], item, expected) => {
  const before = [...items]
  expect(toggle_item(items, item)).toEqual(expected)
  expect(items).toEqual(before)
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

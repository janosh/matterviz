import {
  decode_url_safe_base64,
  html_to_text,
  is_plain_object,
  memo_by_identity,
  parse_leading_num,
  parse_num_token,
  same_while_equal,
  toggle_item,
  value_key,
  plain_copy,
} from '#lib/utils.js'
import { describe, expect, test, vi } from 'vitest'

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

// JSON.stringify writes Infinity, -Infinity, NaN and null alike, so a cache keyed on it
// reused an unlimited option's entry for an unset one
test(`value_key tells values apart by type and content, and Maps by identity`, () => {
  const map = new Map([[`a`, 1]])
  const distinct = [Infinity, -Infinity, Number.NaN, null, `Infinity`, 0, -0, 1, `1`, map]
  const keys = distinct.map((value) => value_key({ value }))
  expect(new Set(keys).size).toBe(keys.length)
  expect(value_key(new Map(map))).not.toBe(value_key(map)) // a Map isn't spelled out as {}
  expect(value_key({ value: map })).toBe(value_key({ value: map }))
  // key order and undefined (unset) entries don't matter
  expect(value_key({ a: 1, b: [Infinity], c: undefined })).toBe(
    value_key({ b: [Infinity], a: 1 }),
  )
})

test(`memo_by_identity recomputes per object only when its key changes`, async () => {
  const memo = memo_by_identity<number>()
  const [first, second] = [{}, {}]
  const compute = vi.fn(() => compute.mock.calls.length)
  const results = [
    memo(first, `a`, compute),
    memo(first, `a`, compute), // reused
    memo(second, `a`, compute), // another object, however alike
    memo(first, `b`, compute), // another key replaces the kept result
    memo(first, `a`, compute),
    memo(second, `a`, compute), // untouched by the other object's keys
  ]
  expect(results).toEqual([1, 1, 2, 3, 4, 2])
  // a throwing compute caches nothing, and a rejected promise is dropped for a retry
  expect(() =>
    memo(first, `c`, () => {
      throw new Error(`boom`)
    }),
  ).toThrow(`boom`)
  expect(memo(first, `c`, () => 7)).toBe(7)
  const async_memo = memo_by_identity<Promise<number>>()
  const failed = async_memo(first, `a`, () => Promise.reject(new Error(`lost`)))
  expect(async_memo(first, `a`, () => Promise.resolve(1))).toBe(failed)
  await expect(failed).rejects.toThrow(`lost`)
  const retried = async_memo(first, `a`, () => Promise.resolve(2))
  await expect(retried).resolves.toBe(2)
  expect(async_memo(first, `a`, () => Promise.resolve(3))).toBe(retried)
})

test(`same_while_equal keeps the first of a run of equal values`, () => {
  const keep = same_while_equal<{ gap: number }>()
  const first = { gap: Infinity }
  expect(keep(first)).toBe(first)
  expect(keep({ gap: Infinity })).toBe(first)
  const next = { gap: 500 }
  expect(keep(next)).toBe(next)
})

test(`plain_copy deep-copies plain data, keeps other objects and an own __proto__ key`, () => {
  const typed = new Float64Array([1])
  const input = { list: [{ num: 1 }], typed, ...JSON.parse(`{"__proto__":{"flag":true}}`) }
  const copy = plain_copy(input)
  expect(copy).toEqual(input)
  expect(copy.list[0]).not.toBe(input.list[0])
  expect(copy.typed).toBe(typed)
  // assigning the key would have set the copy's prototype instead
  expect(Object.hasOwn(copy, `__proto__`)).toBe(true)
  expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
})

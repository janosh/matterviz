import { html_to_text } from 'svelte-widgets/utils'
import {
  decode_url_safe_base64,
  memo_by_identity,
  parse_leading_num,
  parse_num_token,
  same_while_equal,
  toggle_item,
  plain_copy,
} from '#lib/utils'
import { describe, expect, test, vi } from 'vite-plus/test'

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

test(`memo_by_identity recomputes per object only when its key changes`, async () => {
  const memo = memo_by_identity<number>()
  const [one, two] = [{}, {}]
  const compute = vi.fn(() => compute.mock.calls.length)
  // reused; another object, however alike; another key replaces the kept result, so the first
  // key recomputes; the other object is untouched by those keys
  const results = [one, one, two, one, one, two].map((target, idx) =>
    memo(target, `aaabaa`[idx], compute),
  )
  expect(results).toEqual([1, 1, 2, 3, 4, 2])
  // a throwing compute caches nothing, and a rejected promise is dropped for a retry
  expect(() => memo(one, `c`, () => JSON.parse(`{`))).toThrow(SyntaxError)
  expect(memo(one, `c`, () => 7)).toBe(7)
  const async_memo = memo_by_identity<Promise<number>>()
  const failed = async_memo(one, `a`, () => Promise.reject(new Error(`lost`)))
  await expect(failed).rejects.toThrow(`lost`)
  await expect(async_memo(one, `a`, () => Promise.resolve(2))).resolves.toBe(2)
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
  const own_proto = JSON.parse(`{"__proto__":{"flag":true}}`)
  const input = { list: [{ num: 1 }], typed: new Float64Array([1]), ...own_proto }
  const copy = plain_copy(input)
  expect(copy).toEqual(input)
  expect([copy.list[0] === input.list[0], copy.typed === input.typed]).toEqual([false, true])
  expect(Object.hasOwn(copy, `__proto__`)).toBe(true) // not assigned as the copy's prototype
  expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
})

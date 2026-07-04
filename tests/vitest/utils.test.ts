import { decode_url_safe_base64, merge_nested, parse_leading_num, parse_num_token } from '$lib'
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

describe(`merge_nested`, () => {
  test(`merges flat and nested objects`, () => {
    expect(merge_nested({ a: 1, b: 2 }, { b: 20 })).toEqual({ a: 1, b: 20 })
    expect(
      merge_nested({ top: 1, nested: { a: 1, b: 2 } }, {
        top: 10,
        nested: { b: 20 },
      } as never),
    ).toEqual({ top: 10, nested: { a: 1, b: 20 } })
  })

  test.each([
    { user: undefined, desc: `undefined user` },
    { user: {}, desc: `empty user object` },
  ])(`handles $desc`, ({ user }) => {
    const defaults = { a: 1, b: { c: 2 } }
    expect(merge_nested(defaults, user)).toEqual(defaults)
  })

  test(`replaces arrays and handles null values`, () => {
    expect(
      merge_nested(
        { list: [1, 2], nested: { arr: [3] } },
        {
          list: [4],
          nested: { arr: [5] },
        },
      ),
    ).toEqual({ list: [4], nested: { arr: [5] } })
    expect(
      merge_nested({ a: 1, nested: { b: 2 } }, {
        a: null,
        nested: { b: null },
      } as never),
    ).toEqual({ a: null, nested: { b: null } })
  })

  test(`replaces nested object with null without throwing`, () => {
    expect(merge_nested({ nested: { a: 1, b: 2 } }, { nested: null } as never)).toEqual({
      nested: null,
    })
  })

  test(`only merges 1 level deep`, () => {
    expect(
      merge_nested({ level1: { level2: { level3: { a: 1, b: 2 } } } }, {
        level1: { level2: { level3: { a: 10 } } },
      } as never),
    ).toEqual({ level1: { level2: { level3: { a: 10 } } } })
  })

  test(`adds new keys at both levels`, () => {
    expect(
      merge_nested({ a: 1, nested: { x: 10 } }, { b: 2, nested: { y: 20 } } as never),
    ).toEqual({ a: 1, b: 2, nested: { x: 10, y: 20 } })
  })

  test.each([
    { user: { a: 0 }, expected: { a: 0 }, desc: `zero` },
    { user: { a: false }, expected: { a: false }, desc: `false` },
    { user: { a: `` }, expected: { a: `` }, desc: `empty string` },
  ])(`handles falsy $desc`, ({ user, expected }) => {
    expect(merge_nested({ a: 1 }, user as never)).toEqual(expected)
  })

  test(`does not mutate inputs`, () => {
    const defaults = { a: 1, nested: { b: 2 } }
    const user = { a: 10, nested: { b: 20 } }
    const [def_copy, user_copy] = [defaults, user].map((obj) => structuredClone(obj))
    merge_nested(defaults, user)
    expect([defaults, user]).toEqual([def_copy, user_copy])
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

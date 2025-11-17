import { to_query } from '$lib/io/fetch'
import { describe, expect, test } from 'vitest'

describe(`to_query`, () => {
  test.each([
    [{ foo: `bar`, baz: `qux` }, `foo=bar&baz=qux`, `basic string params`],
    [{ foo: `bar`, count: 42 }, `foo=bar&count=42`, `numbers`],
    [{ foo: `bar`, empty: ``, baz: `qux` }, `foo=bar&baz=qux`, `omits empty strings`],
    [{ foo: `bar`, undef: undefined, baz: `qux` }, `foo=bar&baz=qux`, `omits undefined`],
    [{}, ``, `empty object`],
    [{ foo: ``, bar: `` }, ``, `all empty values`],
    [{ key: `value with spaces` }, `key=value+with+spaces`, `URL encodes spaces`],
    [{ special: `a&b=c` }, `special=a%26b%3Dc`, `encodes special chars`],
    [{ zero: 0, one: 1 }, `zero=0&one=1`, `includes zero values`],
    [{ empty: ``, zero: 0, undef: undefined }, `zero=0`, `mixed empty/zero/undefined`],
    [{ a: `1`, b: `2`, c: `3` }, `a=1&b=2&c=3`, `maintains order`],
  ])(`%s -> %s (%s)`, (input, expected) => {
    expect(to_query(input)).toBe(expected)
  })

  test(`handles unicode characters`, () => {
    const result = to_query({ emoji: `🎉`, text: `こんにちは` })
    expect(result).toContain(`emoji`)
    expect(result).toContain(`text`)
  })
})

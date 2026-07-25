import { download, to_query } from '$lib/io/fetch'
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

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
    [{ emoji: `🎉` }, `emoji=%F0%9F%8E%89`, `percent-encodes unicode as UTF-8`],
  ])(`%s -> %s (%s)`, (input, expected, _description) => {
    expect(to_query(input)).toBe(expected)
  })
})

describe(`download`, () => {
  test(`releases browser resources when the synthetic click throws`, () => {
    const revoke_url = vi.spyOn(URL, `revokeObjectURL`).mockImplementation(() => {})
    vi.spyOn(URL, `createObjectURL`).mockReturnValue(`blob:test`)
    const remove_link = vi.spyOn(Element.prototype, `remove`)
    vi.spyOn(HTMLAnchorElement.prototype, `click`).mockImplementation(() => {
      throw new Error(`click failed`)
    })

    expect(() => download(`content`, `test.txt`, `text/plain`)).toThrow(`click failed`)
    expect(remove_link).toHaveBeenCalledOnce()
    expect(revoke_url).toHaveBeenCalledExactlyOnceWith(`blob:test`)
  })
})

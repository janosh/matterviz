// Unit tests for JSON tree utility functions
import {
  build_path,
  collect_all_paths,
  compute_diff,
  estimate_byte_size,
  find_matching_paths,
  format_byte_size,
  format_path,
  format_preview,
  get_ancestor_paths,
  get_child_count,
  get_value_type,
  is_css_color,
  is_expandable,
  is_expandable_type,
  is_url,
  matches_search,
  parse_path,
  serialize_for_copy,
  values_equal,
} from '$lib/layout/json-tree/utils'
import { describe, expect, it } from 'vitest'

describe(`get_value_type`, () => {
  it.each([
    [null, `null`],
    [undefined, `undefined`],
    [`hello`, `string`],
    [42, `number`],
    [3.14, `number`],
    [true, `boolean`],
    [false, `boolean`],
    [Symbol(`test`), `symbol`],
    [BigInt(123), `bigint`],
    [() => {}, `function`],
    [[], `array`],
    [[1, 2, 3], `array`],
    [{}, `object`],
    [{ a: 1 }, `object`],
    [new Date(), `date`],
    [/test/g, `regexp`],
    [new Map(), `map`],
    [new Set(), `set`],
    [new Error(`test`), `error`],
  ])(`returns %p for %s`, (value, expected) => {
    expect(get_value_type(value)).toBe(expected)
  })

  it(`handles NaN as number`, () => {
    expect(get_value_type(NaN)).toBe(`number`)
  })

  it(`handles Infinity as number`, () => {
    expect(get_value_type(Infinity)).toBe(`number`)
    expect(get_value_type(-Infinity)).toBe(`number`)
  })
})

describe(`is_expandable_type`, () => {
  it.each([
    [`object`, true],
    [`array`, true],
    [`map`, true],
    [`set`, true],
    [`string`, false],
    [`number`, false],
    [`boolean`, false],
    [`null`, false],
    [`undefined`, false],
    [`date`, false],
    [`regexp`, false],
    [`function`, false],
  ])(`returns %p for type %s`, (type, expected) => {
    expect(is_expandable_type(type as Parameters<typeof is_expandable_type>[0])).toBe(
      expected,
    )
  })
})

describe(`is_expandable`, () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [[], true],
    [[1, 2], true],
    [new Map(), true],
    [new Set(), true],
    [`string`, false],
    [42, false],
    [null, false],
    [undefined, false],
    [new Date(), false],
  ])(`returns %p for %j`, (value, expected) => {
    expect(is_expandable(value)).toBe(expected)
  })
})

describe(`get_child_count`, () => {
  it.each([
    [[], 0],
    [[1, 2, 3], 3],
    [{}, 0],
    [{ a: 1, b: 2 }, 2],
    [new Map([[`a`, 1], [`b`, 2]]), 2],
    [new Set([1, 2, 3, 4]), 4],
    [`string`, 0],
    [42, 0],
    [null, 0],
  ])(`returns correct count for %j`, (value, expected) => {
    expect(get_child_count(value)).toBe(expected)
  })
})

describe(`format_path`, () => {
  it(`returns empty string for empty segments`, () => {
    expect(format_path([])).toBe(``)
  })

  it(`handles single string segment`, () => {
    expect(format_path([`root`])).toBe(`root`)
  })

  it(`handles multiple string segments`, () => {
    expect(format_path([`users`, `name`])).toBe(`users.name`)
  })

  it(`handles numeric segments with bracket notation`, () => {
    expect(format_path([`users`, 0])).toBe(`users[0]`)
    expect(format_path([`arr`, 0, `name`])).toBe(`arr[0].name`)
  })

  it(`handles special characters with bracket notation`, () => {
    expect(format_path([`data`, `key-with-dash`])).toBe(`data["key-with-dash"]`)
    expect(format_path([`data`, `key with space`])).toBe(`data["key with space"]`)
  })

  it(`escapes quotes in keys`, () => {
    expect(format_path([`data`, `key"with"quotes`])).toBe(`data["key\\"with\\"quotes"]`)
  })

  it(`formats root numeric index correctly`, () => {
    expect(format_path([0, `name`])).toBe(`[0].name`)
    expect(format_path([0])).toBe(`[0]`)
    expect(format_path([42, `nested`, 3])).toBe(`[42].nested[3]`)
  })

  it(`formats root special key with bracket notation`, () => {
    expect(format_path([`key.with.dot`])).toBe(`["key.with.dot"]`)
    expect(format_path([`key.with.dot`, `child`])).toBe(`["key.with.dot"].child`)
    expect(format_path([`key-with-dash`])).toBe(`["key-with-dash"]`)
  })

  it(`round-trips correctly with parse_path`, () => {
    // Root numeric index
    expect(parse_path(format_path([0, `name`]))).toEqual([0, `name`])
    // Root special key with dots
    expect(parse_path(format_path([`key.with.dot`]))).toEqual([`key.with.dot`])
    // Mixed path
    expect(parse_path(format_path([`users`, 0, `data`, `key.with.dot`]))).toEqual([
      `users`,
      0,
      `data`,
      `key.with.dot`,
    ])
  })
})

describe(`build_path`, () => {
  it(`builds path from empty parent`, () => {
    expect(build_path(``, `key`)).toBe(`key`)
    expect(build_path(``, 0)).toBe(`[0]`)
  })

  it(`builds path from empty parent with special keys`, () => {
    expect(build_path(``, `key.with.dot`)).toBe(`["key.with.dot"]`)
    expect(build_path(``, `key-with-dash`)).toBe(`["key-with-dash"]`)
    expect(build_path(``, `key"with"quotes`)).toBe(`["key\\"with\\"quotes"]`)
  })

  it.each([`123`, `0`, `-1`, `1.5`, `1e10`])(
    `treats numeric-looking key %p as string`,
    (key) => {
      const path = build_path(`obj`, key)
      expect(path).toBe(`obj["${key}"]`)
      expect(parse_path(path)).toEqual([`obj`, key])
    },
  )

  it(`appends string key with dot notation`, () => {
    expect(build_path(`root`, `child`)).toBe(`root.child`)
  })

  it(`appends numeric key with bracket notation`, () => {
    expect(build_path(`arr`, 0)).toBe(`arr[0]`)
  })

  it(`handles special characters`, () => {
    expect(build_path(`data`, `special-key`)).toBe(`data["special-key"]`)
  })

  it(`handles nested paths`, () => {
    let path = build_path(``, `users`)
    path = build_path(path, 0)
    path = build_path(path, `name`)
    expect(path).toBe(`users[0].name`)
  })
})

describe(`serialize_for_copy`, () => {
  it.each([
    [undefined, `undefined`],
    [null, `null`],
    [`hello`, `hello`],
    [42, `42`],
    [true, `true`],
    [false, `false`],
    [BigInt(123), `123n`],
    [Symbol(`test`), `Symbol(test)`],
    [new Date(`2024-01-15T10:30:00.000Z`), `2024-01-15T10:30:00.000Z`],
    [/test/gi, `/test/gi`],
    [new Error(`Something went wrong`), `Error: Something went wrong`],
  ])(`serializes %p correctly`, (value, expected) => {
    expect(serialize_for_copy(value)).toBe(expected)
  })

  it(`serializes function to its source`, () => {
    const fn = function example() {
      return 42
    }
    expect(serialize_for_copy(fn)).toContain(`function example()`)
  })

  it.each([
    [[1, 2, 3], [1, 2, 3]],
    [{ a: 1, b: 2 }, { a: 1, b: 2 }],
    [new Map([[`a`, 1], [`b`, 2]]), [[`a`, 1], [`b`, 2]]],
    [new Set([1, 2, 3]), [1, 2, 3]],
  ])(`serializes %p to JSON`, (value, expected) => {
    expect(JSON.parse(serialize_for_copy(value))).toEqual(expected)
  })

  it(`handles circular references`, () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    expect(serialize_for_copy(obj)).toContain(`[Circular]`)
    // Also in Map/Set values
    const map = new Map([[`circular`, obj]])
    expect(serialize_for_copy(map)).toContain(`[Circular]`)
    const set = new Set([obj])
    expect(serialize_for_copy(set)).toContain(`[Circular]`)
  })
})

describe(`format_preview`, () => {
  it.each([
    [[1, 2, 3], `Array(3)`],
    [[], `Array(0)`],
    [{ a: 1 }, `{1 key}`],
    [{ a: 1, b: 2 }, `{2 keys}`],
    [{}, `{0 keys}`],
    [new Map([[`a`, 1], [`b`, 2]]), `Map(2)`],
    [new Set([1, 2, 3]), `Set(3)`],
    [`hello`, `"hello"`],
    [new Date(`2024-01-15T10:30:00.000Z`), `2024-01-15T10:30:00.000Z`],
    [/test/gi, `/test/gi`],
    [new Error(`fail`), `Error: fail`],
    [Symbol(`desc`), `Symbol(desc)`],
    [BigInt(999), `999n`],
  ])(`formats %p correctly`, (value, expected) => {
    expect(format_preview(value)).toBe(expected)
  })

  it(`truncates long string`, () => {
    expect(format_preview(`a`.repeat(100), 50)).toBe(`"${`a`.repeat(50)}..."`)
  })

  it(`formats functions with ƒ prefix`, () => {
    function named_fn() {}
    expect(format_preview(named_fn)).toBe(`ƒ named_fn()`)
    expect(format_preview(() => {})).toBe(`ƒ anonymous()`)
  })

  it.each([
    [6.022e23, `6.022e+23`],
    [1e-10, `1e-10`],
    [0.000000000001, `1e-12`],
  ])(`formats scientific number %p as %p`, (value, expected) => {
    expect(format_preview(value)).toBe(expected)
  })

  it.each([
    `日本語テキスト`,
    `🚀 🎨 🔧`,
    `∑∏∫∂∇`,
    `First\nSecond\tThird`,
    ``,
    `   `,
  ])(`preserves unicode/special string: %p`, (str) => {
    expect(format_preview(str)).toBe(`"${str}"`)
  })
})

describe(`matches_search`, () => {
  it.each(
    [
      // empty query
      [`path`, `key`, `value`, ``, false],
      // path matches (case-insensitive)
      [`users.name`, `name`, `John`, `user`, true],
      [`USERS.name`, `name`, `John`, `user`, true],
      // key matches (case-insensitive)
      [`path`, `firstName`, `John`, `name`, true],
      [`path`, `FIRSTNAME`, `John`, `name`, true],
      // numeric key
      [`arr`, 123, `value`, `12`, true],
      // string value (case-insensitive)
      [`path`, `key`, `Hello World`, `world`, true],
      [`path`, `key`, `HELLO`, `hello`, true],
      // number value
      [`path`, `key`, 42, `42`, true],
      [`path`, `key`, 3.14, `3.14`, true],
      // boolean value
      [`path`, `key`, true, `true`, true],
      [`path`, `key`, false, `fal`, true],
      // object/array don't match directly
      [`path`, `key`, { nested: true }, `nested`, false],
      [`path`, `key`, [1, 2, 3], `1`, false],
      // null key
      [`root`, null, `value`, `root`, true],
      [`root`, null, `value`, `key`, false],
    ] as const,
  )(`matches_search(%p, %p, %p, %p) = %p`, (path, key, value, query, expected) => {
    expect(matches_search(path, key, value, query)).toBe(expected)
  })
})

describe(`collect_all_paths`, () => {
  it(`returns empty array for primitives`, () => {
    expect(collect_all_paths(`string`)).toEqual([])
    expect(collect_all_paths(42)).toEqual([])
    expect(collect_all_paths(null)).toEqual([])
  })

  it(`collects paths from nested object`, () => {
    const obj = {
      a: { b: { c: 1 } },
      d: 2,
    }
    const paths = collect_all_paths(obj, `root`)
    expect(paths).toContain(`root`)
    expect(paths).toContain(`root.a`)
    expect(paths).toContain(`root.a.b`)
  })

  it(`collects paths from array`, () => {
    const arr = [{ a: 1 }, { b: 2 }]
    const paths = collect_all_paths(arr, `items`)
    expect(paths).toContain(`items`)
    expect(paths).toContain(`items[0]`)
    expect(paths).toContain(`items[1]`)
  })

  it(`respects max_depth`, () => {
    const obj = { a: { b: { c: { d: 1 } } } }
    const paths = collect_all_paths(obj, `root`, 2, 0)
    expect(paths).toContain(`root`)
    expect(paths).toContain(`root.a`)
    expect(paths).not.toContain(`root.a.b`)
  })

  it(`handles circular references without infinite loop`, () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    // Should not throw or infinite loop - circular refs are detected and skipped
    const paths = collect_all_paths(obj, `root`)
    // The root path should be collected, but the circular self reference
    // won't add its children (since they're already seen)
    expect(paths).toContain(`root`)
  })

  it(`collects paths in Map and Set`, () => {
    const map = new Map([[`key`, { nested: true }]])
    const set = new Set([{ inner: 1 }])
    expect(collect_all_paths({ map }, `root`)).toContain(`root.map[0]`)
    expect(collect_all_paths({ set }, `root`)).toContain(`root.set[0]`)
  })
})

describe(`find_matching_paths`, () => {
  it(`returns empty set for empty query`, () => {
    const result = find_matching_paths({ a: 1 }, ``)
    expect(result.size).toBe(0)
  })

  it(`finds matching paths in nested object`, () => {
    const obj = {
      users: [
        { name: `Alice` },
        { name: `Bob` },
      ],
    }
    const result = find_matching_paths(obj, `Alice`)
    expect(result.has(`users[0].name`)).toBe(true)
  })

  it(`finds matches in Map keys (case-insensitive)`, () => {
    const map = new Map([
      [`Alice_Key`, `value1`],
      [`bob_key`, `value2`],
    ])
    const result = find_matching_paths({ data: map }, `alice`)
    expect(result.has(`data[0]`)).toBe(true)
    expect(result.has(`data[1]`)).toBe(false)
  })

  it(`finds matches in keys and values`, () => {
    const obj = {
      alice: `not a name`,
      other: `Alice is here`,
    }
    const result = find_matching_paths(obj, `alice`)
    expect(result.has(`alice`)).toBe(true)
    expect(result.has(`other`)).toBe(true)
  })
})

describe(`get_ancestor_paths`, () => {
  it.each([
    [``, []],
    [`root`, []],
    [`users[0].name`, [`users`, `users[0]`]],
    [`a.b.c.d`, [`a`, `a.b`, `a.b.c`]],
  ])(`get_ancestor_paths(%p) = %p`, (path, expected) => {
    const result = get_ancestor_paths(path)
    expect(result).toEqual(expected)
  })
})

describe(`parse_path`, () => {
  it(`returns empty array for empty path`, () => {
    expect(parse_path(``)).toEqual([])
  })

  it(`parses simple dot-notation path`, () => {
    expect(parse_path(`a.b.c`)).toEqual([`a`, `b`, `c`])
  })

  it(`parses bracket notation with numbers`, () => {
    expect(parse_path(`arr[0][1]`)).toEqual([`arr`, 0, 1])
  })

  it(`parses mixed notation`, () => {
    expect(parse_path(`users[0].name`)).toEqual([`users`, 0, `name`])
  })

  it(`parses bracket notation with strings`, () => {
    expect(parse_path(`data["special-key"]`)).toEqual([`data`, `special-key`])
  })

  it(`unescapes quotes in bracketed keys`, () => {
    expect(parse_path(`data["key\\"with\\"quotes"]`)).toEqual([`data`, `key"with"quotes`])
  })

  it(`round-trips keys with quotes via build_path and parse_path`, () => {
    const key_with_quotes = `say "hello"`
    const path = build_path(`root`, key_with_quotes)
    const segments = parse_path(path)
    expect(segments).toEqual([`root`, key_with_quotes])
  })

  it(`handles unclosed bracket with numeric index`, () => {
    // Malformed path with unclosed bracket should still parse trailing number correctly
    expect(parse_path(`a[0`)).toEqual([`a`, 0])
    expect(parse_path(`arr[123`)).toEqual([`arr`, 123])
  })

  it(`handles unclosed bracket with string key`, () => {
    // Unclosed bracket with quoted string
    expect(parse_path(`data["key`)).toEqual([`data`, `key`])
  })

  it(`handles empty brackets`, () => {
    // Empty brackets are silently ignored
    expect(parse_path(`a[]`)).toEqual([`a`])
    expect(parse_path(`a[].b`)).toEqual([`a`, `b`])
  })

  it(`handles negative indices`, () => {
    expect(parse_path(`a[-1]`)).toEqual([`a`, -1])
  })
})

describe(`values_equal`, () => {
  it.each([
    [`hello`, `hello`, true],
    [42, 42, true],
    [true, true, true],
    [null, null, true],
    [`hello`, `world`, false],
    [42, 43, false],
    [true, false, false],
    [null, undefined, false],
    [{}, null, false],
    [`42`, 42, false],
    [true, 1, false],
    [/test/gi, /test/gi, true],
    [/test/g, /test/i, false],
    [[1, 2, 3], [4, 5, 6], true], // same length = equal (shallow)
    [[1, 2], [1, 2, 3], false],
    [{ a: 1, b: 2 }, { c: 3, d: 4 }, true], // same key count = equal (shallow)
    [{ a: 1 }, { a: 1, b: 2 }, false],
  ])(`values_equal(%p, %p) = %p`, (val_a, val_b, expected) => {
    expect(values_equal(val_a, val_b)).toBe(expected)
  })

  it(`compares dates by timestamp`, () => {
    const date1 = new Date(`2024-01-15`)
    const date2 = new Date(`2024-01-15`)
    const date3 = new Date(`2024-01-16`)
    expect(values_equal(date1, date2)).toBe(true)
    expect(values_equal(date1, date3)).toBe(false)
  })

  it(`treats NaN as equal to NaN`, () => {
    // NaN === NaN is false in JS, but for change detection we want NaN === NaN
    expect(values_equal(NaN, NaN)).toBe(true)
    expect(values_equal(NaN, 0)).toBe(false)
    expect(values_equal(0, NaN)).toBe(false)
    expect(values_equal(NaN, null)).toBe(false)
  })
})

describe(`is_url`, () => {
  it.each([
    [`https://example.com`, true],
    [`http://localhost:3000/path`, true],
    [`https://example.com/path?q=1&b=2#hash`, true],
    [`https://sub.domain.example.co.uk`, true],
    [`ftp://example.com`, false],
    [`not a url`, false],
    [`example.com`, false],
    [``, false],
    [`https://`, false], // no path after protocol
    [` https://example.com `, true], // trimmed
  ])(`is_url(%p) = %p`, (str, expected) => {
    expect(is_url(str)).toBe(expected)
  })
})

describe(`is_css_color`, () => {
  it.each([
    // hex colors (case-insensitive, 3/4/6/8 digit)
    [`#fff`, true],
    [`#ABCDEF`, true],
    [`#abcd`, true], // 4-digit with alpha
    [`#aabbccdd`, true], // 8-digit with alpha
    // functional colors
    [`rgb(255, 0, 0)`, true],
    [`rgba(255, 0, 0, 0.5)`, true],
    [`hsl(120, 100%, 50%)`, true],
    [`hsla(120, 100%, 50%, 0.5)`, true],
    [`oklch(0.5 0.2 120)`, true],
    [`oklab(0.5 0.1 -0.1)`, true],
    [`lch(50 30 120)`, true],
    [`lab(50 20 -30)`, true],
    [`color(display-p3 1 0 0)`, true],
    // non-colors
    [`red`, false],
    [`not a color`, false],
    [`#gg`, false],
    [`#12345`, false], // 5 digits invalid
    [`rgb`, false],
    [``, false],
    [` #fff `, true], // trimmed
    // CSS injection prevention: semicolons rejected
    [`rgb(0,0,0);position:fixed`, false],
    [`#fff;background:red`, false],
    // CSS injection prevention: url() injection blocked by [^)]* regex
    [`rgb(255,0,0) url(https://evil.com/track.png)`, false],
    [`hsl(0,0%,0%) url(data:,x)`, false],
  ])(`is_css_color(%p) = %p`, (str, expected) => {
    expect(is_css_color(str)).toBe(expected)
  })
})

describe(`estimate_byte_size`, () => {
  it.each([
    [null, 4],
    [undefined, 9],
    [true, 4],
    [false, 5],
    [42, 2],
    [3.14, 4],
    [`hello`, 7], // 5 chars + 2 for quotes
    [``, 2], // empty string + quotes
    [[], 2], // empty array brackets
    [{}, 2], // empty object braces
    [[1, 2, 3], 8], // 2 + 3*(1+1)
    [{ ab: 1 }, 9], // 2 + 2(key) + 4(quotes+colon+comma) + 1(value)
  ])(`estimates %p as %d bytes`, (value, expected) => {
    expect(estimate_byte_size(value)).toBe(expected)
  })

  it(`respects max_depth`, () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } }
    expect(estimate_byte_size(deep, 2)).toBeLessThan(estimate_byte_size(deep, 5))
  })

  it(`handles Map and Set`, () => {
    expect(estimate_byte_size(new Map([[`key`, `val`]]))).toBeGreaterThan(2)
    expect(estimate_byte_size(new Set([1, 2, 3]))).toBeGreaterThan(2)
  })
})

describe(`format_byte_size`, () => {
  it.each([
    [0, `0 B`],
    [100, `100 B`],
    [1023, `1023 B`],
    [1024, `1.0 KB`],
    [1536, `1.5 KB`],
    [10240, `10.0 KB`],
    [1048576, `1.0 MB`],
    [1572864, `1.5 MB`],
  ])(`format_byte_size(%d) = %p`, (bytes, expected) => {
    expect(format_byte_size(bytes)).toBe(expected)
  })
})

describe(`compute_diff`, () => {
  it(`returns empty map for identical primitives`, () => {
    expect(compute_diff(42, 42).size).toBe(0)
    expect(compute_diff(`hello`, `hello`).size).toBe(0)
    expect(compute_diff(true, true).size).toBe(0)
    expect(compute_diff(null, null).size).toBe(0)
  })

  it(`detects changed primitives`, () => {
    const diff = compute_diff(1, 2, `root`)
    expect(diff.size).toBe(1)
    expect(diff.get(`root`)).toEqual({
      status: `changed`,
      path: `root`,
      old_value: 1,
      new_value: 2,
    })
  })

  it(`detects type changes`, () => {
    const diff = compute_diff(`string`, 42, `val`)
    expect(diff.get(`val`)?.status).toBe(`changed`)
    expect(diff.get(`val`)?.old_value).toBe(`string`)
    expect(diff.get(`val`)?.new_value).toBe(42)
  })

  it(`detects added object keys`, () => {
    const diff = compute_diff({ a: 1 }, { a: 1, b: 2 }, `root`)
    expect(diff.size).toBe(1)
    expect(diff.get(`root.b`)).toEqual({
      status: `added`,
      path: `root.b`,
      new_value: 2,
    })
  })

  it(`detects removed object keys`, () => {
    const diff = compute_diff({ a: 1, b: 2 }, { a: 1 }, `root`)
    expect(diff.size).toBe(1)
    expect(diff.get(`root.b`)).toEqual({
      status: `removed`,
      path: `root.b`,
      old_value: 2,
    })
  })

  it(`detects changed object values`, () => {
    const diff = compute_diff({ a: 1 }, { a: 99 }, `root`)
    expect(diff.get(`root.a`)).toEqual({
      status: `changed`,
      path: `root.a`,
      old_value: 1,
      new_value: 99,
    })
  })

  it(`detects added array elements`, () => {
    const diff = compute_diff([1, 2], [1, 2, 3], `arr`)
    expect(diff.size).toBe(1)
    expect(diff.get(`arr[2]`)).toEqual({
      status: `added`,
      path: `arr[2]`,
      new_value: 3,
    })
  })

  it(`detects removed array elements`, () => {
    const diff = compute_diff([1, 2, 3], [1, 2], `arr`)
    expect(diff.size).toBe(1)
    expect(diff.get(`arr[2]`)).toEqual({
      status: `removed`,
      path: `arr[2]`,
      old_value: 3,
    })
  })

  it(`handles nested object diffs`, () => {
    const old_val = { user: { name: `Alice`, age: 30 } }
    const new_val = { user: { name: `Bob`, age: 30 } }
    const diff = compute_diff(old_val, new_val)
    expect(diff.size).toBe(1)
    expect(diff.get(`user.name`)?.status).toBe(`changed`)
    expect(diff.has(`user.age`)).toBe(false) // unchanged
  })

  it(`handles multiple changes at different depths`, () => {
    const old_val = { a: 1, b: { c: 2, d: 3 } }
    const new_val = { a: 99, b: { c: 2, d: 100, e: 5 } }
    const diff = compute_diff(old_val, new_val)
    expect(diff.get(`a`)?.status).toBe(`changed`)
    expect(diff.get(`b.d`)?.status).toBe(`changed`)
    expect(diff.get(`b.e`)?.status).toBe(`added`)
    expect(diff.has(`b.c`)).toBe(false) // unchanged
  })

  it(`returns empty map for identical objects`, () => {
    const obj = { a: 1, b: [2, 3], c: { d: 4 } }
    expect(compute_diff(obj, { ...obj, b: [2, 3], c: { d: 4 } }).size).toBe(0)
  })

  it(`handles circular references without infinite loop`, () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    // Should not throw — circular refs are detected and skipped
    const diff = compute_diff(obj, { a: 2 })
    expect(diff.get(`a`)?.status).toBe(`changed`)
  })

  it(`compares dates via string form`, () => {
    expect(compute_diff(new Date(`2024-01-15`), new Date(`2024-01-15`)).size).toBe(0)
    expect(
      compute_diff(new Date(`2024-01-15`), new Date(`2024-01-16`), `d`).get(`d`)?.status,
    )
      .toBe(`changed`)
  })

  it(`uses empty string as default root path`, () => {
    expect(compute_diff(1, 2).get(``)?.status).toBe(`changed`)
  })

  it(`treats NaN as equal to NaN (including nested)`, () => {
    expect(compute_diff(NaN, NaN).size).toBe(0)
    expect(compute_diff({ x: NaN }, { x: NaN }).size).toBe(0)
    expect(compute_diff(NaN, 42).get(``)?.status).toBe(`changed`)
  })

  it(`detects changes in Map values`, () => {
    const old_map = new Map([[`a`, 1], [`b`, 2]])
    const new_map = new Map([[`a`, 1], [`b`, 99]])
    const diff = compute_diff(old_map, new_map, `m`)
    // Map entries are wrapped as { key, value } to match rendering
    expect(diff.size).toBe(1)
    expect(diff.get(`m[1].value`)?.status).toBe(`changed`)
  })

  it(`detects Map key changes`, () => {
    const old_map = new Map([[`a`, 1]])
    const new_map = new Map([[`b`, 1]])
    const diff = compute_diff(old_map, new_map, `m`)
    expect(diff.size).toBe(1)
    expect(diff.get(`m[0].key`)?.status).toBe(`changed`)
    expect(diff.get(`m[0].key`)?.old_value).toBe(`a`)
    expect(diff.get(`m[0].key`)?.new_value).toBe(`b`)
  })

  it(`detects added/removed Map entries`, () => {
    const old_map = new Map([[`a`, 1]])
    const new_map = new Map([[`a`, 1], [`b`, 2]])
    const diff = compute_diff(old_map, new_map, `m`)
    expect(diff.size).toBe(1)
    expect(diff.get(`m[1]`)?.status).toBe(`added`)
  })

  it(`detects changes in Set values`, () => {
    const old_set = new Set([1, 2, 3])
    const new_set = new Set([1, 2])
    const diff = compute_diff(old_set, new_set, `s`)
    expect(diff.size).toBe(1)
    expect(diff.get(`s[2]`)?.status).toBe(`removed`)
  })

  it(`returns empty map for identical Maps and Sets`, () => {
    expect(compute_diff(new Map([[`a`, 1]]), new Map([[`a`, 1]])).size).toBe(0)
    expect(compute_diff(new Set([1, 2]), new Set([1, 2])).size).toBe(0)
  })
})

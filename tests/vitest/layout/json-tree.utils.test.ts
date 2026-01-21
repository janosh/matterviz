// Unit tests for JSON tree utility functions
import {
  build_path,
  collect_all_paths,
  find_matching_paths,
  format_path,
  format_preview,
  get_ancestor_paths,
  get_child_count,
  get_value_type,
  is_expandable,
  is_expandable_type,
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
})

describe(`matches_search`, () => {
  it(`returns false for empty query`, () => {
    expect(matches_search(`path`, `key`, `value`, ``)).toBe(false)
  })

  it(`matches path (case-insensitive)`, () => {
    expect(matches_search(`users.name`, `name`, `John`, `user`)).toBe(true)
    expect(matches_search(`USERS.name`, `name`, `John`, `user`)).toBe(true)
  })

  it(`matches key (case-insensitive)`, () => {
    expect(matches_search(`path`, `firstName`, `John`, `name`)).toBe(true)
    expect(matches_search(`path`, `FIRSTNAME`, `John`, `name`)).toBe(true)
  })

  it(`matches numeric key`, () => {
    expect(matches_search(`arr`, 123, `value`, `12`)).toBe(true)
  })

  it(`matches string value (case-insensitive)`, () => {
    expect(matches_search(`path`, `key`, `Hello World`, `world`)).toBe(true)
    expect(matches_search(`path`, `key`, `HELLO`, `hello`)).toBe(true)
  })

  it(`matches number value`, () => {
    expect(matches_search(`path`, `key`, 42, `42`)).toBe(true)
    expect(matches_search(`path`, `key`, 3.14, `3.14`)).toBe(true)
  })

  it(`matches boolean value`, () => {
    expect(matches_search(`path`, `key`, true, `true`)).toBe(true)
    expect(matches_search(`path`, `key`, false, `fal`)).toBe(true)
  })

  it(`does not match object/array values directly`, () => {
    expect(matches_search(`path`, `key`, { nested: true }, `nested`)).toBe(false)
    expect(matches_search(`path`, `key`, [1, 2, 3], `1`)).toBe(false)
  })

  it(`handles null key`, () => {
    expect(matches_search(`root`, null, `value`, `root`)).toBe(true)
    expect(matches_search(`root`, null, `value`, `key`)).toBe(false)
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
  it(`returns empty array for empty path`, () => {
    expect(get_ancestor_paths(``)).toEqual([])
  })

  it(`returns empty array for root path`, () => {
    expect(get_ancestor_paths(`root`)).toEqual([])
  })

  it(`returns ancestor paths`, () => {
    const ancestors = get_ancestor_paths(`users[0].name`)
    expect(ancestors).toContain(`users`)
    expect(ancestors).toContain(`users[0]`)
    expect(ancestors).not.toContain(`users[0].name`)
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
})

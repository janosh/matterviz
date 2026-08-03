import { flatten_row, parse_ndjson } from '$lib/io/ndjson'
import { describe, expect, test } from 'vitest'

const manifest_row = {
  key: {
    pair_id: `ifp-abc`,
    film_source_id: `mp-1`,
    film_miller: [1, 1, 1],
    substrate_miller: [0, 0, 1],
  },
  film_source_name: `GaN`,
  match_area: 123.4,
  substrate_match: {
    zsl_match: { area: 1 },
    strain: [
      [0, 0],
      [0, 0],
    ],
  },
}

describe(`parse_ndjson`, () => {
  test(`parses one object per line and skips blanks`, () => {
    expect(parse_ndjson(`{"a":1}\n\n{"a":2}\n   \n{"a":3}\n`)).toEqual({
      rows: [{ a: 1 }, { a: 2 }, { a: 3 }],
      skipped_lines: 0,
    })
  })

  test(`tolerates a torn last line from a file mid-write`, () => {
    expect(parse_ndjson(`{"a":1}\n{"a":2}\n{"a":3,"nested":{"incomplete`)).toEqual({
      rows: [{ a: 1 }, { a: 2 }],
      skipped_lines: 1,
    })
  })

  test.each([
    [`bare number`, `42`],
    [`bare string`, `"hello"`],
    [`array line`, `[1,2,3]`],
    [`null line`, `null`],
    [`garbage`, `not json at all`],
  ])(`skips non-object line: %s`, (_label, line) => {
    expect(parse_ndjson(`{"ok":true}\n${line}\n{"ok":false}`)).toEqual({
      rows: [{ ok: true }, { ok: false }],
      skipped_lines: 1,
    })
  })

  test.each([``, `\n\n\n`])(`empty content %j yields no rows without throwing`, (content) => {
    expect(parse_ndjson(content)).toEqual({ rows: [], skipped_lines: 0 })
  })
})

describe(`flatten_row`, () => {
  test(`flattens nested objects to dot paths and compacts small primitive arrays`, () => {
    expect(flatten_row(manifest_row)).toEqual({
      'key.pair_id': `ifp-abc`,
      'key.film_source_id': `mp-1`,
      'key.film_miller': `(1,1,1)`,
      'key.substrate_miller': `(0,0,1)`,
      film_source_name: `GaN`,
      match_area: 123.4,
      // depth-2 values nested inside `substrate_match` collapse
      'substrate_match.zsl_match': `…`,
      'substrate_match.strain': `…`,
    })
  })

  test.each([
    [`long array`, { arr: [1, 2, 3, 4, 5, 6, 7] }, `arr`, `…`],
    [`mixed array`, { arr: [1, { a: 2 }] }, `arr`, `…`],
    [`string array`, { tags: [`x`, `y`] }, `tags`, `(x,y)`],
    [`null value`, { val: null }, `val`, null],
    [`boolean value`, { val: true }, `val`, true],
    [`prototype key`, Object.fromEntries([[`__proto__`, `value`]]), `__proto__`, `value`],
  ])(`%s`, (_label, row, key, expected) => {
    expect(flatten_row(row)[key]).toBe(expected)
  })

  test(`respects a custom max_depth`, () => {
    const row = { a: { b: { c: 1 } } }
    expect(flatten_row(row, 1)).toEqual({ a: `…` })
    expect(flatten_row(row, 3)).toEqual({ 'a.b.c': 1 })
  })
})

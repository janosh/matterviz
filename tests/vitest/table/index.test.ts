import type { D3InterpolateName } from '$lib/colors'
import type { CellVal, ColumnFilter, Label, RowData, SortCriterion } from '$lib/table'
import {
  CATEGORY_LIMIT,
  cell_matches_filter,
  cell_text,
  column_filter_panel,
  compare_rows,
  compute_column_stats,
  discover_columns,
  format_datetime,
  get_column_id,
  infer_datetime_kind,
  make_cell_color_scale,
  merge_domains,
  middle_ellipsis_parts,
  parse_datetime_val,
  parse_numeric_val,
  resolve_color_domain,
  row_matches_query,
  table_to_delimited,
  table_to_json,
  table_to_latex,
  table_to_markdown,
  virtual_window,
  with_category_toggled,
  with_numeric_bound,
} from '$lib/table'
import { strip_html } from '$lib/utils'
import { describe, expect, it } from 'vitest'

// one-shot wrapper around the memoized factory, for the single-cell assertions below
const calc_cell_color = (
  val: number | null | undefined,
  all_values: CellVal[],
  better: `higher` | `lower` | undefined,
  color_scale: D3InterpolateName | null = `interpolateViridis`,
  scale_type: `linear` | `log` = `linear`,
) => make_cell_color_scale(all_values, better, color_scale, scale_type)(val)

it(`encodes grouped column IDs without changing ungrouped IDs`, () => {
  expect(get_column_id({ label: `x` })).toBe(`x`)
  expect(get_column_id({ key: `x`, label: `X`, group: `g` })).toBe(`["x","g"]`)
  expect(get_column_id({ key: `x`, label: `X`, group: `g` })).not.toBe(
    get_column_id({ key: `x (g)`, label: `X` }),
  )
})

describe(`column stats and color domains`, () => {
  const values = [...Array.from({ length: 20 }, (_v, idx) => idx * 5), 10_000]

  it(`summarizes a column in one pass, ignoring non-numeric entries`, () => {
    const stats = compute_column_stats([1, 2, 3, null, undefined, NaN], `higher`)
    expect(stats).toMatchObject({ min: 1, max: 3, mean: 2, median: 2, count: 3, best: 3 })
    expect(compute_column_stats([1, 2, 3], `lower`)?.best).toBe(1)
    expect(compute_column_stats([1, 2, 3])?.best).toBeNull()
    expect(compute_column_stats([null, undefined, NaN])).toBeNull()
  })

  // Pinned exactly: a loose "somewhere below the outlier" bound would pass for almost any
  // wrong quantile implementation. 21 values -> q05 index 1.0, q95 index 19.0.
  it(`clips a quantile domain inside the outlier-driven full range`, () => {
    const stats = compute_column_stats(values)
    if (!stats) throw new Error(`expected stats`)
    expect(resolve_color_domain(stats, `minmax`)).toEqual([0, 10_000])
    expect(resolve_color_domain(stats, `quantile`)).toEqual([5, 95])
    expect([stats.q_lo, stats.median, stats.q_hi]).toEqual([5, 50, 95])
  })

  // The last case would report an Infinity mean if the stats summed before dividing: four
  // values at MAX_VALUE/2 overflow the running sum though each is perfectly representable.
  const huge = Number.MAX_VALUE / 2
  it.each([
    [`a single value`, [7], { min: 7, max: 7, mean: 7, median: 7, q_lo: 7, q_hi: 7 }],
    [`all-equal values`, [3, 3, 3], { min: 3, max: 3, mean: 3, median: 3, q_lo: 3, q_hi: 3 }],
    [
      `values whose sum overflows`,
      [huge, huge, huge, huge],
      { min: huge, max: huge, mean: huge, median: huge, q_lo: huge, q_hi: huge },
    ],
  ])(`handles %s without collapsing`, (_desc, input, expected) => {
    const stats = compute_column_stats(input)
    expect(stats).toMatchObject(expected)
    // a zero-width quantile range must fall back to min/max, not produce an empty domain
    if (stats)
      expect(resolve_color_domain(stats, `quantile`)).toEqual([expected.min, expected.max])
  })

  it(`treats non-finite values as uncolorable everywhere`, () => {
    expect(compute_column_stats([1, 2, Infinity, -Infinity])).toMatchObject({
      min: 1,
      max: 2,
      count: 2,
    })
    const scale = make_cell_color_scale([1, 2, Infinity], `higher`)
    expect(scale(Infinity).bg).toBeNull()
    expect(scale(2).bg).not.toBeNull()
  })

  it(`keeps log scaling when a supplied domain reaches zero`, () => {
    const log_scale = make_cell_color_scale(
      [1, 10, 100],
      `higher`,
      `interpolateViridis`,
      `log`,
      [0, 100],
    )
    const linear_scale = make_cell_color_scale(
      [1, 10, 100],
      `higher`,
      `interpolateViridis`,
      `linear`,
      [0, 100],
    )
    expect(log_scale(10).bg).not.toBe(linear_scale(10).bg)
    expect(log_scale(10).bg).toBe(
      make_cell_color_scale([1, 100], `higher`, `interpolateViridis`, `log`)(10).bg,
    )
  })

  it(`falls back to min/max when quantiles are not requested`, () => {
    const stats = compute_column_stats(values, undefined, false)
    expect(stats).toMatchObject({ q_lo: 0, q_hi: 10_000, median: null, min: 0, max: 10_000 })
  })

  it.each([
    [
      [-8, 1, 2],
      [-8, 8],
    ],
    [
      [1, 2, 3],
      [-3, 3],
    ],
    [
      [0, 0],
      [-1, 1],
    ],
  ])(`centers a diverging domain on zero for %s`, (input, expected) => {
    const stats = compute_column_stats(input)
    if (!stats) throw new Error(`expected stats`)
    expect(resolve_color_domain(stats, `diverging`)).toEqual(expected)
  })

  it(`merges a shared-domain group to its widest extent`, () => {
    expect(
      merge_domains([
        [0, 5],
        [-2, 3],
        [1, 9],
      ]),
    ).toEqual([-2, 9])
    expect(merge_domains([])).toBeNull()
  })

  it(`clamps values outside a supplied domain`, () => {
    const scale = make_cell_color_scale(
      [0, 10, 10_000],
      `higher`,
      `interpolateViridis`,
      `linear`,
      [0, 10],
    )
    expect(scale(10_000).bg).toBe(scale(10).bg)
    expect(scale(5).bg).not.toBe(scale(10).bg)
  })
})

describe(`make_cell_color_scale`, () => {
  it.each<{
    name: string
    val: number | null | undefined
    all_values: CellVal[]
    color_scale: D3InterpolateName | null
    scale_type?: `linear` | `log`
  }>([
    {
      name: `null value`,
      val: null,
      all_values: [1, 2, 3],
      color_scale: `interpolateViridis`,
    },
    {
      name: `undefined value`,
      val: undefined,
      all_values: [1, 2, 3],
      color_scale: `interpolateViridis`,
    },
    {
      name: `NaN value`,
      val: NaN,
      all_values: [1, 50, 100],
      color_scale: `interpolateViridis`,
    },
    {
      name: `null color_scale`,
      val: 5,
      all_values: [1, 5, 10],
      color_scale: null,
    },
    {
      name: `empty all_values`,
      val: 5,
      all_values: [],
      color_scale: `interpolateViridis`,
    },
    {
      name: `only non-numeric all_values`,
      val: 50,
      all_values: [null, `a`, undefined],
      color_scale: `interpolateViridis`,
    },
    {
      name: `all NaN all_values`,
      val: 50,
      all_values: [NaN, NaN],
      color_scale: `interpolateViridis`,
    },
    {
      name: `negative with log scale`,
      val: -5,
      all_values: [-5, 50, 100],
      color_scale: `interpolateViridis`,
      scale_type: `log`,
    },
  ])(`returns null colors for $name`, ({ val, all_values, color_scale, scale_type }) => {
    const result = calc_cell_color(val, all_values, `higher`, color_scale, scale_type)
    expect(result).toEqual({ bg: null, text: null })
  })

  it.each([
    { name: `undefined better`, val: 50, all_values: [1, 50, 100], better: undefined },
    {
      name: `zero with linear scale`,
      val: 0,
      all_values: [0, 50, 100],
      better: `higher` as const,
    },
    {
      name: `all-zero log scale`,
      val: 0,
      all_values: [0, 0],
      better: `higher` as const,
      scale_type: `log` as const,
    },
    {
      name: `negative with linear scale`,
      val: -50,
      all_values: [-100, 0, 100],
      better: `higher` as const,
    },
    {
      name: `log scale positive values`,
      val: 100,
      all_values: [10, 100, 1000],
      better: `higher` as const,
      scale_type: `log` as const,
    },
    {
      name: `mixed types in all_values`,
      val: 50,
      all_values: [null, `text`, 10, 50, 100, undefined, true, { obj: 1 }],
      better: `higher` as const,
    },
    {
      name: `single numeric value`,
      val: 42,
      all_values: [42],
      better: `higher` as const,
    },
    {
      name: `NaN filtered from all_values`,
      val: 50,
      all_values: [1, NaN, 100],
      better: `higher` as const,
    },
  ])(`returns valid colors for $name`, ({ val, all_values, better, scale_type }) => {
    const result = calc_cell_color(val, all_values, better, `interpolateViridis`, scale_type)
    expect(result.bg).not.toBeNull()
    expect(result.text).not.toBeNull()
  })

  it(`returns appropriate contrast text colors`, () => {
    const values = [1, 50, 100]
    expect(calc_cell_color(1, values, `higher`, `interpolateViridis`).text).toBe(`white`)
    expect(calc_cell_color(100, values, `higher`, `interpolateViridis`).text).toBe(`black`)
  })

  it(`uses distinct endpoint colors and reverses the gradient for lower values`, () => {
    const values = [1, 50, 100]
    const low_higher = calc_cell_color(1, values, `higher`).bg
    const high_higher = calc_cell_color(100, values, `higher`).bg
    expect(low_higher).not.toBe(high_higher)
    expect(low_higher).toBe(calc_cell_color(100, values, `lower`).bg)
    expect(high_higher).toBe(calc_cell_color(1, values, `lower`).bg)
  })

  it(`maps log-scale zero to the lowest positive endpoint color`, () => {
    const values = [0, 10, 100]
    for (const better of [`higher`, `lower`] as const) {
      expect(calc_cell_color(0, values, better, undefined, `log`).bg).toBe(
        calc_cell_color(10, values, better, undefined, `log`).bg,
      )
    }
  })

  it(`rejects invalid color scale names`, () => {
    const invalid_scale = `interpolateNonExistent` as D3InterpolateName
    expect(() => calc_cell_color(50, [1, 50, 100], `higher`, invalid_scale)).toThrow(
      `Unknown D3 color interpolator: interpolateNonExistent`,
    )
  })
})

it(`discovers columns from the first 50 rows' keys, skipping style/class`, () => {
  const rows = [
    { b: 1, style: `x` },
    { a: 2, class: `y` },
    ...Array.from({ length: 60 }, () => ({ b: 3 })),
    { late: 1 },
  ]
  expect(discover_columns(rows)).toEqual([{ label: `b` }, { label: `a` }])
  expect(discover_columns([])).toEqual([])
})

it.each([
  [`abcdefghijklmnopqrstuvwxyz`, [`abcdefghijklmnopqr`, `stuvwxyz`]], // tail capped at 8
  [`abcdefghij`, [`abcde`, `fghij`]], // short strings split in half
  [`a👨‍👩‍👧b👨‍👩‍👧`, [`a👨‍👩‍👧`, `b👨‍👩‍👧`]], // graphemes, not code units
])(`middle_ellipsis_parts(%j) = %j`, (text, expected) => {
  expect(middle_ellipsis_parts(text)).toEqual(expected)
})

describe(`strip_html`, () => {
  it.each([
    [`<span>hello</span>`, `hello`],
    [`<div><span>nested</span></div>`, `nested`],
    [`<a href="https://example.com" class="link">link text</a>`, `link text`],
    [`plain text`, `plain text`],
    [``, ``],
    [`before<br/>after`, `beforeafter`],
    [`<b>bold</b> and <i>italic</i>`, `bold and italic`],
    [`T < 300 K and P > 1 bar`, `T < 300 K and P > 1 bar`], // a comparison pair is not a tag
    [`<B>UPPER</B>`, `UPPER`], // tags are case-insensitive
    [`<!-- note -->kept`, `kept`],
  ])(`strip_html(%j) = %j`, (input, expected) => {
    expect(strip_html(input)).toBe(expected)
  })

  // Cell text feeds search, the filter panels and every export. `<[^>]*>` eats ordinary prose
  // caught between a comparison pair just as happily as a tag, so this cell read back as
  // `T  1 bar` and no longer matched `300`. A tag has to open with a letter, `/` or `!`.
  it(`leaves a comparison pair in prose alone, since it is not markup`, () => {
    const prose = `T < 300 K and P > 1 bar`
    expect(cell_text(prose)).toBe(prose)
    expect(row_matches_query({ val: prose }, `300`)).toBe(true)
    // a real tag in the same cell is still stripped
    expect(cell_text(`<b>T < 300 K</b>`)).toBe(`T < 300 K`)
  })
})

describe(`parse_numeric_val`, () => {
  it.each<[CellVal, number | null]>([
    [42, 42],
    [Infinity, null],
    [NaN, null],
    [`1.23 ± 0.05`, 1.23],
    [`-1.5 +- 0.2`, -1.5],
    [`2.890(8)`, 2.89],
    [`−3.5`, -3.5], // unicode minus
    [`<b>10</b>`, 10],
    [`<span data-sort-value="1000">1,000</span>`, 1000],
    [`<span data-sort-value="zulu">9</span>`, null], // non-numeric sort value wins
    [`<span data-sort-value="">n/a</span>`, null], // blank is no sort key, but Number('') is 0
    [`<span data-sort-value="0">n/a</span>`, 0], // an explicit zero still counts
    [`abc`, null],
    [``, null],
    [null, null],
    [new Date(0), null],
  ])(`%j -> %j`, (val, expected) => {
    expect(parse_numeric_val(val)).toBe(expected)
  })
})

describe(`compare_rows`, () => {
  const rows = (...vals: CellVal[]): RowData[] => vals.map((val) => ({ val }))
  const order = (vals: CellVal[], ascending = true) =>
    rows(...vals)
      .toSorted((row1, row2) => compare_rows(row1, row2, [{ key: `val`, ascending }]))
      .map((row) => row.val)

  it.each([true, false])(`sinks invalid values with ascending=%s`, (ascending) => {
    const invalid_date = new Date(NaN)
    expect(cell_text(invalid_date)).toBe(``)
    expect(order([null, 3, undefined, 1, NaN, 2, invalid_date], ascending)).toEqual([
      ...(ascending ? [1, 2, 3] : [3, 2, 1]),
      null,
      undefined,
      NaN,
      invalid_date,
    ])
  })

  it(`puts numbers before strings and compares strings in natural order`, () => {
    expect(order([`10`, `abc`, `9`, `a2`, `a10`, 2])).toEqual([
      2,
      `9`,
      `10`,
      `a2`,
      `a10`,
      `abc`,
    ])
    expect(order([`b`, `B`, `a`])).toEqual([`a`, `b`, `B`]) // case-insensitive keeps input order for ties
  })

  // Sorting used to read the raw cell, so a markup cell compared by its tag name: `<b>Mango</b>`
  // sorted under `b`, ahead of `<i>Zebra</i>` and `<span>Apple</span>`, and every markup cell
  // sorted ahead of every plain one because `<` precedes every letter.
  it(`orders markup cells by their visible text, not their tags`, () => {
    // oxfmt-ignore
    expect(order([`<span>Apple</span>`, `<i>Zebra</i>`, `<b>Mango</b>`]))
      .toEqual([`<span>Apple</span>`, `<b>Mango</b>`, `<i>Zebra</i>`])
    // oxfmt-ignore
    expect(order([`<b>Beta</b>`, `Alpha`, `<i>Gamma</i>`, `Delta`]))
      .toEqual([`Alpha`, `<b>Beta</b>`, `Delta`, `<i>Gamma</i>`])
    // a non-numeric data-sort-value still wins over the rendered text: `Zulu` alone would
    // sort last, `aaa` puts it first (a numeric one makes it a number, which sorts earlier still)
    // oxfmt-ignore
    expect(order([`<b data-sort-value="aaa">Zulu</b>`, `Alpha`]))
      .toEqual([`<b data-sort-value="aaa">Zulu</b>`, `Alpha`])
  })

  // A boolean or object cell (both admitted by CellVal) reached the comparator as a non-string,
  // and the type-mismatch branch answered "the other one first" in BOTH directions. That is not
  // a total order, so the same rows came out in a different order depending on how they went in.
  it.each([
    [`a boolean`, true],
    [`an object`, { a: 1 }],
    [`an invalid date`, new Date(NaN)],
  ])(`compares a string against %s antisymmetrically`, (_case, other) => {
    const cmp = (val1: CellVal, val2: CellVal) =>
      compare_rows({ val: val1 }, { val: val2 }, [{ key: `val`, ascending: true }])
    expect(cmp(`abc`, other)).toBe(-cmp(other, `abc`))
  })

  it(`sorts one multiset to one order whatever order it arrives in`, () => {
    const permutations: CellVal[][] = [
      [`abc`, true, 5, false, `zed`],
      [5, false, `zed`, `abc`, true],
      [true, `zed`, 5, `abc`, false],
      [`zed`, `abc`, false, true, 5],
    ]
    const results = permutations.map((permutation) => order(permutation))
    for (const result of results) expect(result).toEqual(results[0])
    expect(results[0]).toEqual([5, `abc`, false, true, `zed`]) // numbers first, then text
  })

  // Every case sorts on a primary key that ties, so only a working secondary criterion can
  // produce the expected name order
  const by_name: SortCriterion = { key: `name`, ascending: true }
  const by_score: SortCriterion = { key: `score`, ascending: true }
  // oxfmt-ignore
  it.each<[string, RowData[], SortCriterion[], string[]]>([
    [`dates compare by time`,
      [{ when: new Date(2024, 0, 2), name: `b` }, { when: new Date(2024, 0, 1), name: `z` }, { when: new Date(2024, 0, 2), name: `a` }],
      [{ key: `when`, ascending: false }, by_name], [`a`, `b`, `z`]],
    // both-NaN rows sink together but still order by name among themselves
    [`both primary values are invalid`,
      [{ score: NaN, name: `b` }, { score: NaN, name: `a` }, { score: 1, name: `c` }],
      [by_score, by_name], [`c`, `a`, `b`]],
    // null vs undefined is equally invalid, so the secondary criterion decides
    [`null and undefined meet`,
      [{ score: null, name: `b` }, { score: undefined, name: `a` }],
      [by_score, by_name], [`a`, `b`]],
  ])(`honours later criteria when %s`, (_case, data, criteria, expected) => {
    const sorted = data.toSorted((row1, row2) => compare_rows(row1, row2, criteria))
    expect(sorted.map((row) => row.name)).toEqual(expected)
  })
})

describe(`search and filters`, () => {
  it(`matches the query against all values or only the given keys, optionally fuzzily`, () => {
    const row = { Model: `<b>Alpha</b>`, Score: 0.5, Note: null }
    expect(row_matches_query(row, `alp`)).toBe(true)
    expect(row_matches_query(row, `0.5`)).toBe(true)
    expect(row_matches_query(row, `0.5`, { keys: [`Model`] })).toBe(false)
    expect(row_matches_query(row, `aph`)).toBe(false)
    // fuzzy = in-order character subsequence, so `apl` matches but reordered `pal` does not
    expect(row_matches_query(row, `aph`, { fuzzy: true })).toBe(true)
    expect(row_matches_query(row, `pal`, { fuzzy: true })).toBe(false)
  })

  it.each<[CellVal, ColumnFilter, boolean]>([
    [`1.5 ± 0.1`, { kind: `numeric`, min: 1, max: 2 }, true],
    [3, { kind: `numeric`, min: 1, max: 2 }, false],
    [`abc`, { kind: `numeric`, min: 0 }, false],
    [5, { kind: `numeric`, max: 5 }, true],
    [`<i>oxide</i>`, { kind: `category`, values: [`oxide`] }, true],
    [null, { kind: `category`, values: [``] }, true],
    [`Fe2O3`, { kind: `text`, text: `e2o` }, true],
    [`Fe2O3`, { kind: `text`, text: `cu` }, false],
  ])(`cell_matches_filter(%j, %j) = %j`, (val, filter, expected) => {
    expect(cell_matches_filter(val, filter)).toBe(expected)
  })

  it(`picks the filter panel kind from config, then the data, capping auto-detected checklists`, () => {
    const tags = Array.from({ length: CATEGORY_LIMIT + 1 }, (_, idx) => ({ Tag: `t${idx}` }))
    const few = [{ Tag: `b` }, { Tag: `<i>a</i>` }, { Tag: null }, { Tag: `b` }]
    expect(column_filter_panel({ label: `Tag` }, few, `Tag`, false)).toEqual({
      kind: `category`,
      options: [`a`, `b`], // distinct, markup-stripped, sorted; invalid cells skipped
    })
    expect(column_filter_panel({ label: `Tag` }, tags, `Tag`, false)).toEqual({
      kind: `text`,
      options: [],
    })
    // an explicit category column lists every value however many there are
    expect(
      column_filter_panel({ label: `Tag`, filter: `category` }, tags, `Tag`, false).options,
    ).toHaveLength(CATEGORY_LIMIT + 1)
    expect(column_filter_panel({ label: `Tag` }, few, `Tag`, true).kind).toBe(`numeric`)
    expect(column_filter_panel({ label: `Tag`, filter: `text` }, few, `Tag`, true).kind).toBe(
      `text`,
    )
    expect(column_filter_panel({ label: `Tag` }, [], `Tag`, false).kind).toBe(`text`)
  })

  it(`collapses no-op filters to undefined when editing bounds and checklists`, () => {
    const min_only = with_numeric_bound(undefined, `min`, ` 1.5 `)
    expect(min_only).toEqual({ kind: `numeric`, min: 1.5 })
    expect(with_numeric_bound(min_only, `max`, `abc`)).toEqual({ kind: `numeric`, min: 1.5 })
    expect(with_numeric_bound(min_only, `min`, ``)).toBeUndefined()
    // a text filter on the same column is replaced, not merged
    expect(with_numeric_bound({ kind: `text`, text: `x` }, `max`, `2`)).toEqual({
      kind: `numeric`,
      max: 2,
    })

    const options = [`a`, `b`, `c`]
    const without_b = with_category_toggled(undefined, `b`, options)
    expect(without_b).toEqual({ kind: `category`, values: [`a`, `c`] })
    expect(with_category_toggled(without_b, `a`, options)).toEqual({
      kind: `category`,
      values: [`c`],
    })
    expect(with_category_toggled(without_b, `b`, options)).toBeUndefined() // all allowed again
  })
})

describe(`date/time columns`, () => {
  const plain: Label = { label: `When` }
  const explicit: Label = { label: `When`, datetime_format: `datetime` }

  it.each<[CellVal, Label, number | null]>([
    [`2024-01-02`, plain, new Date(2024, 0, 2).getTime()], // local midnight, not UTC
    [`2024-01-02T03:04:05Z`, plain, Date.UTC(2024, 0, 2, 3, 4, 5)],
    [`2024-01-02 03:04`, plain, new Date(2024, 0, 2, 3, 4).getTime()],
    [`2024-01-02T03:04:05.123456789Z`, plain, Date.UTC(2024, 0, 2, 3, 4, 5, 123)],
    [1_700_000_000, plain, null], // bare numbers need an explicit datetime column
    [1_700_000_000, explicit, 1_700_000_000_000], // epoch seconds scale to ms
    [1_700_000_000_000, explicit, 1_700_000_000_000],
    [12345, explicit, null], // too small to be a timestamp
    [`<span data-sort-value="1700000000000">x</span>`, explicit, 1_700_000_000_000],
    [`not a date`, explicit, null],
    [new Date(NaN), plain, null],
  ])(`parse_datetime_val(%j) = %j`, (val, col, expected) => {
    expect(parse_datetime_val(val, col)).toBe(expected)
  })

  it(`infers the column kind from config first, then from a sample`, () => {
    expect(infer_datetime_kind({ label: `x`, datetime_format: `time` }, [])).toBe(`time`)
    expect(infer_datetime_kind(explicit, [])).toBe(`datetime`)
    expect(infer_datetime_kind(plain, [`2024-01-02`, `2024-01-03`])).toBe(`date`)
    // one value with a time of day upgrades the whole column
    expect(infer_datetime_kind(plain, [`2024-01-02`, `2024-01-03T10:00`])).toBe(`datetime`)
    expect(infer_datetime_kind(plain, [`abc`, 5, null])).toBeNull()
  })

  it(`formats in local time and as relative age`, () => {
    const stamp = new Date(2024, 0, 2, 3, 4).getTime()
    const now = new Date(2024, 0, 3, 5, 34).getTime()
    expect(format_datetime(stamp, `date`)).toBe(`2024-01-02`)
    expect(format_datetime(stamp, `time`)).toBe(`03:04`)
    expect(format_datetime(stamp, `datetime`)).toBe(`2024-01-02 03:04`)
    expect(format_datetime(stamp, `iso`)).toBe(new Date(stamp).toISOString())
    expect(format_datetime(stamp, `relative`, now)).toBe(`1d 2h 30m ago`)
    expect(format_datetime(now, `relative`, stamp)).toBe(`1d 2h 30m from now`)
    // leading zero units are skipped and at most three units render
    expect(format_datetime(new Date(2017, 6, 23, 9, 57).getTime(), `relative`, now)).toBe(
      `6y 5mo 2w ago`,
    )
    // a zero remainder adds no trailing 0m term, but a lone minutes term still renders
    expect(format_datetime(now - 2 * 24 * 60 * 60_000, `relative`, now)).toBe(`2d ago`)
    expect(format_datetime(now - 60 * 60_000, `relative`, now)).toBe(`1h ago`)
    expect(format_datetime(now - 90 * 60_000, `relative`, now)).toBe(`1h 30m ago`)
    expect(format_datetime(now - 30_000, `relative`, now)).toBe(`0m ago`)
  })
})

describe(`virtual_window`, () => {
  const base = { item_size: 10, count: 100, viewport: 50 }

  it.each([
    // [scroll, overscan, min_window] -> exact [start, end]
    [0, 0, 0, [0, 5]],
    [123, 0, 0, [12, 18]], // partially visible rows at both edges count
    [120, 2, 0, [10, 19]],
    [0, 2, 0, [0, 7]], // overscan clamped at the top
    [990, 2, 0, [93, 100]], // past the end: clamped to the last page, then overscan
    [5000, 0, 0, [95, 100]],
    [0, 0, 30, [0, 30]], // min_window extends the window
    [900, 0, 30, [90, 100]], // but never past count
    [-40, 0, 0, [0, 1]], // negative scroll (leading label track): only the first row peeks in
  ])(`scroll=%d overscan=%d min_window=%d -> %j`, (scroll, overscan, min_window, expected) => {
    expect(virtual_window({ ...base, scroll, overscan, min_window })).toEqual({
      start: expected[0],
      end: expected[1],
    })
  })

  it(`renders min_window rows while the viewport is unmeasured and nothing for empty data`, () => {
    expect(virtual_window({ ...base, viewport: 0, scroll: 0, min_window: 60 })).toEqual({
      start: 0,
      end: 60,
    })
    expect(virtual_window({ ...base, count: 0, scroll: 0 })).toEqual({ start: 0, end: 0 })
  })
})

describe(`table exporters`, () => {
  const matrix = {
    headers: [`Name`, `a|b`, `Val`],
    rows: [
      [`x, "q"`, `multi\nline`, `1`],
      [`50% & $3_{}`, `^~\\`, `2`],
      [`cr\rline`, ``, `3`], // a bare CR is a record separator to most readers: quoted too
    ],
    numeric: [false, false, true],
  }

  it(`emits CSV with RFC 4180 quoting and TSV with flattened newlines`, () => {
    expect(table_to_delimited(matrix, `,`)).toBe(
      `Name,a|b,Val\n"x, ""q""","multi\nline",1\n50% & $3_{},^~\\,2\n"cr\rline",,3`,
    )
    expect(table_to_delimited(matrix, `\t`).split(`\n`).slice(1)).toEqual([
      `x, "q"\tmulti line\t1`,
      `50% & $3_{}\t^~\\\t2`,
      `cr line\t\t3`,
    ])
  })

  it(`exports JSON keyed by stripped headers, stripping only string cells`, () => {
    const when = new Date(Date.UTC(2024, 0, 2))
    const rows: RowData[] = [{ 'n<sub>val</sub>': 1, Name: `<b>Fe</b>`, When: when, Skip: 5 }]
    const columns = [
      { label: `n<sub>val</sub>`, key: `n<sub>val</sub>` },
      { label: `Name`, key: `Name` },
      { label: `When`, key: `When` },
    ]
    expect(JSON.parse(table_to_json(rows, columns))).toEqual([
      { nval: 1, Name: `Fe`, When: when.toISOString() },
    ])
  })

  it(`escapes markdown backslashes, pipes and newlines and right-aligns numeric columns`, () => {
    const [header, align, row_1, row_2] = table_to_markdown(matrix).split(`\n`)
    expect(header).toBe(`| Name | a\\|b | Val |`)
    expect(align).toBe(`| :--- | :--- | ---: |`)
    expect(row_1).toBe(`| x, "q" | multi<br>line | 1 |`)
    expect(row_2).toBe(`| 50% & $3_{} | ^~\\\\ | 2 |`)
  })

  it(`escapes LaTeX specials once and builds a booktabs tabular`, () => {
    const lines = table_to_latex(matrix).split(`\n`)
    expect(lines[0]).toBe(`\\begin{tabular}{llr}`)
    expect(lines[6]).toBe(
      `  50\\% \\& \\$3\\_\\{\\} & \\textasciicircum{}\\textasciitilde{}\\textbackslash{} & 2 \\\\`,
    )
    expect(lines.at(-1)).toBe(`\\end{tabular}`)
  })
})

// Tests for HeatmapMatrix types, helpers, and element axis orderings.

import type { ChemicalElement } from '$lib/element'
import {
  ELEMENT_ORDERINGS,
  elements_to_axis,
  make_color_override_key,
  matrix_to_rows,
  ORDERING_LABELS,
} from '$lib/heatmap-matrix'
import { describe, expect, test } from 'vitest'

describe(`elements_to_axis`, () => {
  test(`returns all 118 elements with sequential sort_value and typed data`, () => {
    const axis = elements_to_axis()
    expect(axis).toHaveLength(118)
    expect(axis[0].label).toBe(`H`)
    expect(axis[117].label).toBe(`Og`)
    // sort_value is 0..N-1
    expect(axis.map((item) => item.sort_value)).toEqual(
      Array.from({ length: 118 }, (_, idx) => idx),
    )
    // every item is keyed by its symbol and carries that element's own record and category
    for (const item of axis) {
      expect(item.key).toBe(item.label)
      expect(item.data?.symbol).toBe(item.label)
      expect(item.category).toBe(item.data?.category)
    }
    // data is typed ChemicalElement
    const fe = axis.find((item) => item.label === `Fe`)
    expect(fe?.data?.number).toBe(26)
    expect(fe?.data?.name).toBe(`Iron`)
  })

  test(`filters to subset of symbols`, () => {
    const axis = elements_to_axis([`Fe`, `O`, `H`])
    expect(axis.map((item) => item.label)).toEqual([`H`, `O`, `Fe`])
  })

  test.each([
    { input: [`Au`], expected: [`Au`], desc: `single element` },
    { input: [] as string[], expected: [], desc: `empty subset` },
    { input: [`Fe`, `Fe`, `O`], expected: [`O`, `Fe`], desc: `duplicates deduplicated` },
    { input: [`Fe`, `Xx`], expected: [`Fe`], desc: `invalid symbol ignored` },
  ])(`subset edge case: $desc`, ({ input, expected }) => {
    const axis = elements_to_axis(input as Parameters<typeof elements_to_axis>[0])
    expect(axis.map((item) => item.label)).toEqual(expected)
  })
})

describe(`built-in orderings`, () => {
  // Every named ordering sorts ascending by its element property with nulls trailing; the
  // property lookup remaps atomic_number -> number and electronegativity -> pauling values
  test.each(ELEMENT_ORDERINGS.filter((ordering) => ordering !== `alphabetical`))(
    `%s sorts all 118 elements ascending with nulls last`,
    (ordering) => {
      const axis = elements_to_axis(undefined, ordering)
      expect(axis).toHaveLength(118)
      const key =
        ({ atomic_number: `number`, electronegativity: `electronegativity_pauling` } as const)[
          ordering as string
        ] ?? ordering
      const values = axis.map((item) => item.data?.[key as keyof ChemicalElement] ?? null)
      const non_null = values.filter((value): value is number => value !== null)
      expect(non_null.length).toBeGreaterThan(0)
      const nulls = Array<null>(values.length - non_null.length).fill(null)
      expect(values).toEqual([...non_null.toSorted((val_a, val_b) => val_a - val_b), ...nulls])
    },
  )

  test(`alphabetical orders by symbol`, () => {
    const labels = elements_to_axis(undefined, `alphabetical`).map((item) => item.label)
    expect(labels).toHaveLength(118)
    expect(labels[0]).toBe(`Ac`)
    expect(labels).toEqual([...labels].toSorted())
  })

  test(`electronegativity uses pauling values (Tl/Cu order differs from plain EN)`, () => {
    // Tl: electronegativity=2.04, electronegativity_pauling=1.62
    // Cu: electronegativity=1.9, electronegativity_pauling=1.9
    // pauling: Tl(1.62) < Cu(1.9) -- plain EN: Cu(1.9) < Tl(2.04)
    const labels = elements_to_axis([`Tl`, `Cu`, `Au`, `Pt`], `electronegativity`).map(
      (item) => item.label,
    )
    // pauling EN: Tl(1.62) < Cu(1.9) < Pt(2.28) < Au(2.54)
    expect(labels).toEqual([`Tl`, `Cu`, `Pt`, `Au`])
  })
})

describe(`custom comparator`, () => {
  test(`reverse atomic number`, () => {
    const axis = elements_to_axis(undefined, (a, b) => b.number - a.number)
    expect(axis[0].label).toBe(`Og`)
    expect(axis[117].label).toBe(`H`)
  })

  test(`sort by name length with subset`, () => {
    const axis = elements_to_axis(
      [`B`, `Fe`, `Au`, `C`],
      (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name),
    )
    // Gold(4), Iron(4), Boron(5), Carbon(6)
    expect(axis.map((item) => item.label)).toEqual([`Au`, `Fe`, `B`, `C`])
  })
})

describe(`ORDERING_LABELS`, () => {
  test(`unique labels, keys match ELEMENT_ORDERINGS`, () => {
    const labels = Object.values(ORDERING_LABELS)
    expect(new Set(labels).size).toBe(labels.length)
    expect(new Set(ELEMENT_ORDERINGS)).toEqual(new Set(Object.keys(ORDERING_LABELS)))
  })
})

test(`color override keys retain their persisted NUL-separated format`, () => {
  expect(make_color_override_key(`Fe`, `O`)).toBe(`Fe\0O`)
})

test(`matrix_to_rows keys rows by y label and x labels`, () => {
  const x_items = [{ label: `A` }, { label: `B` }]
  const y_items = [{ label: `X` }, { label: `Y` }]
  const rows = matrix_to_rows(x_items, y_items, [
    [1, 2],
    [3, null],
  ])
  expect(rows).toEqual([
    { y_key: `X`, A: 1, B: 2 },
    { y_key: `Y`, A: 3, B: null },
  ])
})

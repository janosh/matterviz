// Tests for HeatmapMatrix types, helpers, and element axis orderings.

import { element_data } from '$lib/element'
import {
  COLOR_OVERRIDE_KEY_SEPARATOR,
  ELEMENT_ORDERINGS,
  elements_to_axis,
  make_color_override_key,
  matrix_to_rows,
  ORDERING_LABELS,
  rows_to_csv,
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
    // every item has required fields
    for (const item of axis) {
      expect(item.key).toBe(item.label)
      expect(item.category).toBeTruthy()
      expect(item.data).toBeDefined()
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
  test.each(ELEMENT_ORDERINGS)(`ordering '%s' returns 118 items`, (ordering) => {
    expect(elements_to_axis(undefined, ordering)).toHaveLength(118)
  })

  test(`atomic_number produces monotonically increasing Z values`, () => {
    const axis = elements_to_axis(undefined, `atomic_number`)
    expect(axis[0].label).toBe(`H`)
    expect(axis[1].label).toBe(`He`)
    const z_values = axis.map((item) => item.data?.number ?? 0)
    for (let idx = 1; idx < z_values.length; idx++) {
      expect(z_values[idx], `Z[${idx}] > Z[${idx - 1}]`).toBeGreaterThan(
        z_values[idx - 1],
      )
    }
  })

  test(`alphabetical orders by symbol`, () => {
    const axis = elements_to_axis(undefined, `alphabetical`)
    const labels = axis.map((item) => item.label)
    expect(labels[0]).toBe(`Ac`)
    expect(labels).toEqual([...labels].sort())
  })

  test(`mendeleev_number: He near start, superheavy Og at end`, () => {
    const axis = elements_to_axis(undefined, `mendeleev_number`)
    const he_idx = axis.findIndex((item) => item.label === `He`)
    const og_idx = axis.findIndex((item) => item.label === `Og`)
    expect(he_idx).toBeLessThan(10)
    expect(og_idx).toBeGreaterThan(100)
  })

  test(`electronegativity uses pauling values (Tl/Cu order differs from plain EN)`, () => {
    // Tl: electronegativity=2.04, electronegativity_pauling=1.62
    // Cu: electronegativity=1.9, electronegativity_pauling=1.9
    // pauling: Tl(1.62) < Cu(1.9) -- plain EN: Cu(1.9) < Tl(2.04)
    const axis = elements_to_axis([`Tl`, `Cu`], `electronegativity`)
    expect(axis[0].label).toBe(`Tl`)
    expect(axis[1].label).toBe(`Cu`)
  })

  test(`atomic_mass puts H first`, () => {
    expect(elements_to_axis(undefined, `atomic_mass`)[0].label).toBe(`H`)
  })

  test(`density puts Os or Ir near end (densest)`, () => {
    const last_10 = elements_to_axis(undefined, `density`).slice(-10).map((item) =>
      item.label
    )
    expect(last_10, `expected Os or Ir in last 10 by density`).toSatisfy(
      (labels: string[]) => labels.includes(`Os`) || labels.includes(`Ir`),
    )
  })

  // Orderings with nullable properties should put nulls last
  test.each([`melting_point`, `n_valence`] as const)(
    `%s puts null values last`,
    (ordering) => {
      const axis = elements_to_axis(undefined, ordering)
      const null_count = element_data.filter((el) => el[ordering] === null).length
      if (null_count > 0) {
        const last_n = axis.slice(-null_count)
        for (const item of last_n) {
          expect(item.data?.[ordering], `${item.label}`).toBeNull()
        }
        expect(axis[0].data?.[ordering]).not.toBeNull()
      }
    },
  )

  test(`first_ionization: He last among non-null (highest IE)`, () => {
    const non_null = elements_to_axis(undefined, `first_ionization`)
      .filter((item) => item.data?.first_ionization !== null)
    expect(non_null.at(-1)?.label).toBe(`He`)
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

describe(`make_color_override_key`, () => {
  test(`builds stable unambiguous key format`, () => {
    expect(make_color_override_key(`Fe`, `O`)).toBe(
      `Fe${COLOR_OVERRIDE_KEY_SEPARATOR}O`,
    )
  })
})

describe(`subset + ordering combined`, () => {
  test(`subset sorted by electronegativity`, () => {
    const labels = elements_to_axis([`Fe`, `Cu`, `Au`, `Pt`], `electronegativity`)
      .map((item) => item.label)
    // pauling EN: Fe(1.83) < Cu(1.9) < Pt(2.28) < Au(2.54)
    expect(labels).toEqual([`Fe`, `Cu`, `Pt`, `Au`])
  })
})

describe(`export helpers`, () => {
  test(`matrix_to_rows and rows_to_csv serialize matrix data`, () => {
    const x_items = [{ label: `A` }, { label: `B` }]
    const y_items = [{ label: `X` }, { label: `Y` }]
    const rows = matrix_to_rows(x_items, y_items, [[1, 2], [3, null]])
    expect(rows).toEqual([
      { y_key: `X`, A: 1, B: 2 },
      { y_key: `Y`, A: 3, B: null },
    ])
    const csv = rows_to_csv(rows)
    expect(csv).toContain(`y_key,A,B`)
    expect(csv).toContain(`X,1,2`)
    expect(csv).toContain(`Y,3,`)
  })

  test(`rows_to_csv escapes commas, quotes, and newlines`, () => {
    const csv = rows_to_csv([
      { y_key: `Fe,O`, A: `He"Ne`, B: `line1\nline2` },
    ])
    expect(csv).toContain(`"Fe,O"`)
    expect(csv).toContain(`"He""Ne"`)
    expect(csv).toContain(`"line1\nline2"`)
  })
})

import WyckoffTable from '$lib/symmetry/WyckoffTable.svelte'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'

describe(`WyckoffTable`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  test(`renders nothing when wyckoff_positions is empty`, () => {
    mount(WyckoffTable, { target: document.body, props: { wyckoff_positions: [] } })
    expect(document.querySelector(`table`)).toBeFalsy()
  })

  test(`renders nothing when wyckoff_positions is null`, () => {
    mount(WyckoffTable, { target: document.body, props: { wyckoff_positions: null } })
    expect(document.querySelector(`table`)).toBeFalsy()
  })

  test(`renders table with wyckoff positions`, () => {
    const mock_wyckoff_positions = [
      { wyckoff: `4a`, elem: `H`, abc: [0, 0, 0], site_indices: [0, 1, 2, 3] },
      { wyckoff: `1b`, elem: `O`, abc: [0.5, 0.5, 0.5], site_indices: [4] },
    ]

    mount(WyckoffTable, {
      target: document.body,
      props: {
        wyckoff_positions: mock_wyckoff_positions,
      },
    })

    const table = document.querySelector(`table`)
    expect(table).toBeTruthy()

    const headers = table?.querySelectorAll(`thead th`)
    expect(headers).toHaveLength(3)
    expect(headers?.[0]?.textContent).toBe(`Wyckoff`)
    expect(headers?.[1]?.textContent).toBe(`Element`)
    expect(headers?.[2]?.textContent).toBe(`Fractional Coords`)

    const rows = table?.querySelectorAll(`tbody tr`)
    expect(rows).toHaveLength(2)

    // Check first row content
    const first_row_cells = rows?.[0]?.querySelectorAll(`td`)
    expect(first_row_cells?.[0]?.textContent).toBe(`4a`)
    expect(first_row_cells?.[1]?.textContent?.trim()).toBe(`H`)
    expect(first_row_cells?.[2]?.textContent).toBe(`(0 , 0 , 0)`)
  })

  test(`component can be imported without errors`, () => {
    expect(WyckoffTable).toBeDefined()
    expect(typeof WyckoffTable).toBe(`function`)
  })
})

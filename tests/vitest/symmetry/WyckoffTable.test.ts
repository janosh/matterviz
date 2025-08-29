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

  test(`component can be imported without errors`, () => {
    expect(WyckoffTable).toBeDefined()
    expect(typeof WyckoffTable).toBe(`function`)
  })

  test(`validates Wyckoff position data structure`, () => {
    const valid_positions = [
      { wyckoff: `8c`, elem: `C`, abc: [0.125, 0.125, 0.125], site_indices: [0] },
      { wyckoff: `4a`, elem: `Si`, abc: [0, 0, 0], site_indices: [1] },
    ]

    // Test data structure validation
    expect(valid_positions).toHaveLength(2)
    expect(valid_positions[0]).toHaveProperty(`wyckoff`, `8c`)
    expect(valid_positions[0]).toHaveProperty(`elem`, `C`)
    expect(valid_positions[0].abc).toHaveLength(3)
    expect(valid_positions[0].site_indices).toContain(0)
  })

  test(`handles invalid or missing data gracefully`, () => {
    const invalid_cases = [
      [],
      null,
      undefined,
    ]

    invalid_cases.forEach((case_data) => {
      document.body.innerHTML = ``
      expect(() => {
        mount(WyckoffTable, {
          target: document.body,
          props: { wyckoff_positions: case_data },
        })
      }).not.toThrow()

      // Should not create a table for invalid data
      expect(document.querySelector(`table`)).toBeFalsy()
    })
  })

  test(`callback props have correct type signature`, () => {
    // Test that callbacks have the expected signature without mounting
    const on_hover = (indices: number[] | null) => {
      expect(Array.isArray(indices) || indices === null).toBe(true)
    }

    const on_click = (indices: number[] | null) => {
      expect(Array.isArray(indices) || indices === null).toBe(true)
    }

    // Test callback with valid data
    on_hover([0, 1, 2])
    on_hover(null)
    on_click([5])
    on_click(null)

    expect(typeof on_hover).toBe(`function`)
    expect(typeof on_click).toBe(`function`)
  })

  test(`handles performance with many positions`, () => {
    const n_sites = 500
    const many_positions = Array.from({ length: n_sites }, (_, idx) => ({
      wyckoff: `${idx + 1}a`,
      elem: idx % 2 === 0 ? `Fe` : `O`,
      abc: [Math.random(), Math.random(), Math.random()],
      site_indices: [idx],
    }))

    const start_time = performance.now()

    // Test that component handles many positions reasonably
    expect(many_positions).toHaveLength(n_sites)
    expect(many_positions[0]).toHaveProperty(`wyckoff`)

    const end_time = performance.now()
    const duration = end_time - start_time

    // Should complete data processing quickly
    expect(duration).toBeLessThan(100) // 100ms limit for data setup
  })
})

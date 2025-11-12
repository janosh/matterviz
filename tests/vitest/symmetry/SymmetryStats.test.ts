import { SymmetryStats } from '$lib/symmetry'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { flushSync, mount, unmount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

/**
 * Helper function to create mock MoyoDataset for testing
 */
function create_mock_sym_data(overrides: Partial<MoyoDataset> = {}): MoyoDataset {
  const default_data = {
    number: 225,
    hm_symbol: `Fm-3m`,
    hall_number: 523,
    pearson_symbol: `cF4`,
    operations: [
      {
        rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
        translation: [0.0, 0.0, 0.0] as const,
      },
      {
        rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1] as const,
        translation: [0.0, 0.0, 0.5] as const,
      },
      {
        rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
        translation: [0.5, 0.0, 0.0] as const,
      },
    ],
    std_cell: {
      lattice: {
        basis: [5.0, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0] as const,
      },
      positions: [[0.0, 0.0, 0.0]],
      numbers: [1] as const,
    },
    wyckoffs: [`a`],
  }
  return { ...default_data, ...overrides } as MoyoDataset
}

describe(`SymmetryStats`, () => {
  test.each([null, undefined])(
    `displays no-data message when sym_data is %s`,
    (sym_data) => {
      mount(SymmetryStats, { target: document.body, props: { sym_data } })

      const container = doc_query(`.symmetry-stats`)
      const no_data_div = container.querySelector(`.no-data`)

      expect(no_data_div).toBeTruthy()
      expect(no_data_div?.textContent).toContain(`No symmetry data available`)

      // Controls should still be visible so users can adjust settings
      expect(container.querySelector(`.controls`)).toBeTruthy()
      // Stats-grid should not be rendered without data
      expect(container.querySelector(`.stats-grid`)).toBeFalsy()
    },
  )

  test(`renders all symmetry information`, () => {
    const sym_data = create_mock_sym_data({
      number: 225,
      hm_symbol: `Fm-3m`,
      hall_number: 523,
      pearson_symbol: `cF4`,
    })
    mount(SymmetryStats, { target: document.body, props: { sym_data } })

    const container = doc_query(`.symmetry-stats`)
    const text = container.textContent || ``

    // Verify all key information is displayed
    expect(text).toContain(`Space Group`)
    expect(text).toContain(`225`)
    expect(text).toContain(`Hermann-Mauguin`)
    expect(text).toContain(`Fm-3m`)
    expect(text).toContain(`Hall Number`)
    expect(text).toContain(`523`)
    expect(text).toContain(`Pearson`)
    expect(text).toContain(`cF4`)
    expect(text).toContain(`Wyckoff Positions`)
    expect(text).toContain(`Total sym ops:`)
  })

  describe(`Controls section`, () => {
    test(`renders symprec input with correct default value`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data },
      })

      const symprec_input = doc_query<HTMLInputElement>(`.controls input[type="number"]`)
      expect(symprec_input).toBeTruthy()
      expect(symprec_input.value).toBe(`0.0001`) // 1e-4
      // Step can be represented as "1e-5" or "0.00001", both are valid
      expect(parseFloat(symprec_input.step)).toBe(1e-5)
    })

    test(`renders setting select with correct default value`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data },
      })

      const setting_select = doc_query<HTMLSelectElement>(`.controls select`)
      expect(setting_select).toBeTruthy()
      expect(setting_select.value).toBe(`Moyo`)

      // Check both options are present
      const options = Array.from(setting_select.options).map((opt) => opt.value)
      expect(options).toEqual([`Moyo`, `Spglib`])
    })

    test(`accepts custom symprec value`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data, settings: { symprec: 1e-5, algo: `Moyo` } },
      })

      const symprec_input = doc_query<HTMLInputElement>(`.controls input[type="number"]`)
      expect(symprec_input.value).toBe(`0.00001`) // 1e-5
    })

    test(`accepts custom setting value`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data, settings: { symprec: 1e-4, algo: `Spglib` } },
      })

      const setting_select = doc_query<HTMLSelectElement>(`.controls select`)
      // Note: initial value might not update immediately, check after flush
      flushSync()
      expect(setting_select.value).toBe(`Spglib`)
    })

    test(`symprec input is bindable`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data, settings: { symprec: 1e-4, algo: `Moyo` } },
      })

      const symprec_input = doc_query<HTMLInputElement>(`.controls input[type="number"]`)
      expect(symprec_input.value).toBe(`0.0001`)

      // User changes the input value
      symprec_input.value = `0.001`
      symprec_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()

      expect(symprec_input.value).toBe(`0.001`)
    })
  })

  describe(`Stats grid section`, () => {
    test(`displays wyckoff count computed from sym_data`, () => {
      // Test with 1 wyckoff position
      const sym_data_one = create_mock_sym_data({ wyckoffs: [`a`] })
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: sym_data_one },
      })

      let stats_grid = doc_query(`.stats-grid`)
      expect(stats_grid.textContent).toContain(`Wyckoff Positions`)
      expect(stats_grid.textContent).toContain(`1`)

      document.body.innerHTML = ``

      // Test with multiple wyckoff positions with different letters/elements
      const sym_data_multi = create_mock_sym_data({
        wyckoffs: [`a`, `b`, `c`],
        std_cell: {
          lattice: {
            basis: [5.0, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0] as const,
          },
          positions: [[0.0, 0.0, 0.0], [0.5, 0.0, 0.0], [0.0, 0.5, 0.0]],
          numbers: [1, 2, 3],
        },
      })
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: sym_data_multi },
      })

      stats_grid = doc_query(`.stats-grid`)
      expect(stats_grid.textContent).toContain(`3`)

      document.body.innerHTML = ``

      // Test with empty wyckoffs array
      const sym_data_empty = create_mock_sym_data({
        wyckoffs: [],
        std_cell: {
          lattice: {
            basis: [5.0, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0] as const,
          },
          positions: [],
          numbers: [],
        },
      })
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: sym_data_empty },
      })

      stats_grid = doc_query(`.stats-grid`)
      expect(stats_grid.textContent).toContain(`0`)
    })

    test(`displays "N/A" when Hermann-Mauguin symbol is missing`, () => {
      const sym_data = create_mock_sym_data({ hm_symbol: undefined })
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data },
      })

      const stats_grid = doc_query(`.stats-grid`)
      expect(stats_grid.textContent).toContain(`Hermann-Mauguin`)
      expect(stats_grid.textContent).toContain(`N/A`)
    })
  })

  describe(`Operations summary section`, () => {
    test(`displays total number of operations`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data },
      })

      const ops_summary = doc_query(`.sym-ops-summary`)
      expect(ops_summary.textContent).toContain(`Total sym ops:`)
      expect(ops_summary.textContent).toContain(`3`)
    })

    test(`calculates and displays operation breakdown correctly`, () => {
      // Create operations: 1 identity (pure translation), 1 rotation, 1 roto-translation
      const sym_data = create_mock_sym_data({
        operations: [
          {
            // Identity + translation = pure translation
            rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
            translation: [0.5, 0.0, 0.0] as const,
          },
          {
            // Non-identity rotation, no translation = pure rotation
            rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1] as const,
            translation: [0.0, 0.0, 0.0] as const,
          },
          {
            // Non-identity rotation + translation = roto-translation
            rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1] as const,
            translation: [0.5, 0.0, 0.0] as const,
          },
        ],
      })
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data },
      })

      const ops_summary = doc_query(`.sym-ops-summary`)
      const breakdown_text = ops_summary.textContent || ``

      // Check breakdown format: (nT + nR + nRT)
      expect(breakdown_text).toMatch(/1T/)
      expect(breakdown_text).toMatch(/1R/)
      expect(breakdown_text).toMatch(/1RT/)
    })

    test(`handles operations with no symmetry operations`, () => {
      const sym_data = create_mock_sym_data({ operations: [] })
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data },
      })

      const ops_summary = doc_query(`.sym-ops-summary`)
      expect(ops_summary.textContent).toContain(`0`)
      expect(ops_summary.textContent).toContain(`0T`)
      expect(ops_summary.textContent).toContain(`0R`)
      expect(ops_summary.textContent).toContain(`0RT`)
    })
  })

  describe(`Tooltips`, () => {
    test(`shows tooltips by default`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data },
      })

      const symprec_label = doc_query(`.controls label:has(input[type="number"]) span`)
      expect(symprec_label.title).toContain(`Symmetry precision`)

      const setting_label = doc_query(`.controls label:has(select) span`)
      expect(setting_label.title).toContain(`Moyo`)

      const space_group_div = Array.from(document.querySelectorAll(`.stats-grid > div`))
        .find((el) => el.textContent?.includes(`Space Group`)) as HTMLElement
      expect(space_group_div.title).toContain(`Space group number`)
    })

    test(`hides tooltips when show_tooltips=false`, () => {
      const sym_data = create_mock_sym_data()
      const settings = { symprec: 1e-4, algo: `Moyo` as const }
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data, settings, show_tooltips: false },
      })

      const symprec_label = doc_query(`.controls label:has(input[type="number"]) span`)
      expect(symprec_label.title).toBe(``)

      const setting_label = doc_query(`.controls label:has(select) span`)
      expect(setting_label.title).toBe(``)

      // Note: Space Group and sym-ops-summary use template strings, so they always show
      const space_group_div = Array.from(document.querySelectorAll(`.stats-grid > div`))
        .find((el) => el.textContent?.includes(`Space Group`)) as HTMLElement
      expect(space_group_div.title).toContain(`at 0.0001 (using Moyo algo)`)

      const hermann_mauguin_div = Array.from(
        document.querySelectorAll(`.stats-grid > div`),
      )
        .find((el) => el.textContent?.includes(`Hermann-Mauguin`)) as HTMLElement
      expect(hermann_mauguin_div.title).toBe(``)
    })
  })

  describe(`Custom HTML attributes`, () => {
    test(`passes through custom HTML attributes`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: {
          sym_data,
          id: `custom-id`,
          'data-testid': `test-stats`,
        },
      })

      const container = doc_query(`.symmetry-stats`)
      expect(container.id).toBe(`custom-id`)
      expect(container.getAttribute(`data-testid`)).toBe(`test-stats`)
    })

    test(`passes through custom styles`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: {
          sym_data,
          style: `--accent-color: red; padding: 20px`,
        },
      })

      const container = doc_query(`.symmetry-stats`)
      expect(container.getAttribute(`style`)).toContain(`--accent-color: red`)
      expect(container.getAttribute(`style`)).toContain(`padding: 20px`)
    })

    test(`merges custom class with default class`, () => {
      const sym_data = create_mock_sym_data()
      mount(SymmetryStats, {
        target: document.body,
        props: {
          sym_data,
          class: `custom-class`,
        },
      })

      const container = doc_query(`.symmetry-stats`)
      expect(container.classList.contains(`symmetry-stats`)).toBe(true)
      expect(container.classList.contains(`custom-class`)).toBe(true)
    })
  })

  describe(`Edge cases`, () => {
    test.each([1e-10, 1e-2, 0.5, 1.0])(
      `accepts extreme symprec values: %f`,
      (symprec) => {
        const sym_data = create_mock_sym_data()
        mount(SymmetryStats, {
          target: document.body,
          props: { sym_data, settings: { symprec, algo: `Moyo` } },
        })

        const symprec_input = doc_query<HTMLInputElement>(
          `.controls input[type="number"]`,
        )
        expect(parseFloat(symprec_input.value)).toBeCloseTo(symprec, 10)
      },
    )

    test(`correctly classifies symmetry operations by type`, () => {
      const EPS = 1e-10
      const sym_data = create_mock_sym_data({
        operations: [
          {
            // Identity rotation + translation = pure translation
            rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
            translation: [0.5, 0.0, 0.0] as const,
          },
          {
            // Non-identity rotation + no translation = pure rotation
            rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1] as const,
            translation: [0.0, 0.0, 0.0] as const,
          },
          {
            // Non-identity rotation + translation = roto-translation
            rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1] as const,
            translation: [0.25, 0.25, 0.0] as const,
          },
          {
            // Identity + very small translation (below EPS) = pure rotation
            rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
            translation: [EPS / 2, 0.0, 0.0] as const,
          },
        ],
      })
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data },
      })

      const ops_summary = doc_query(`.sym-ops-summary`)
      const breakdown_text = ops_summary.textContent || ``

      // Verify correct breakdown: 1T + 2R + 1RT
      expect(breakdown_text).toMatch(/1T\s/)
      expect(breakdown_text).toMatch(/2R\s/)
      expect(breakdown_text).toMatch(/1RT/)
      expect(breakdown_text).toContain(`4`) // Total operations
    })
  })

  describe(`Null and undefined handling`, () => {
    test.each([null, undefined])(
      `no-data state has proper styling when sym_data is %s`,
      (sym_data) => {
        mount(SymmetryStats, {
          target: document.body,
          props: { sym_data },
        })

        const no_data_div = doc_query(`.no-data`)
        expect(no_data_div).toBeTruthy()

        // Check that the no-data div is a child of symmetry-stats
        expect(document.querySelector(`.symmetry-stats .no-data`)).toBeTruthy()

        // Verify the message paragraph exists
        const message = no_data_div.querySelector(`p`)
        expect(message).toBeTruthy()
        expect(message?.textContent).toBe(`No symmetry data available`)
      },
    )

    test.each([null, undefined])(
      `can be styled with custom attributes when sym_data is %s`,
      (sym_data) => {
        mount(SymmetryStats, {
          target: document.body,
          props: {
            sym_data,
            class: `custom-class`,
            id: `test-id`,
          },
        })

        const container = doc_query(`.symmetry-stats`)
        expect(container.id).toBe(`test-id`)
        expect(container.classList.contains(`custom-class`)).toBe(true)

        // Verify no-data message is still displayed
        const no_data_div = container.querySelector(`.no-data`)
        expect(no_data_div).toBeTruthy()
      },
    )

    test.each([null, undefined])(
      `transitions properly from valid data to %s`,
      (sym_data) => {
        const valid_sym_data = create_mock_sym_data()
        const component = mount(SymmetryStats, {
          target: document.body,
          props: { sym_data: valid_sym_data },
        })

        // Initially should show stats
        expect(document.querySelector(`.stats-grid`)).toBeTruthy()
        expect(document.querySelector(`.no-data`)).toBeFalsy()

        // Update to null/undefined
        unmount(component)
        document.body.innerHTML = ``
        mount(SymmetryStats, {
          target: document.body,
          props: { sym_data },
        })

        // Now should show no-data message
        expect(document.querySelector(`.stats-grid`)).toBeFalsy()
        expect(document.querySelector(`.no-data`)).toBeTruthy()
      },
    )
  })
})

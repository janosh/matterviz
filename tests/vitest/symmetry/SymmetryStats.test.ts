import { SymmetryStats } from '$lib/symmetry'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

// Helper function to create mock MoyoDataset for testing
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
  test.each<MoyoDataset | null | undefined>([null, undefined])(
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

  describe(`Controls section`, () => {
    test(`renders controls with correct defaults`, () => {
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: create_mock_sym_data() },
      })

      const symprec_input = doc_query<HTMLInputElement>(`.controls input[type="number"]`)
      expect(symprec_input.value).toBe(`0.0001`) // 1e-4
      expect(parseFloat(symprec_input.step)).toBeCloseTo(1e-4, 12)

      const algo_select = doc_query<HTMLSelectElement>(`.controls select`)
      expect(algo_select.value).toBe(`Moyo`)
      expect(Array.from(algo_select.options).map((opt) => opt.value)).toEqual([
        `Moyo`,
        `Spglib`,
      ])
    })

    test.each([
      {
        symprec: 1e-5,
        algo: `Moyo` as const,
        expected_symprec: `0.00001`,
        expected_algo: `Moyo`,
      },
      {
        symprec: 1e-4,
        algo: `Spglib` as const,
        expected_symprec: `0.0001`,
        expected_algo: `Spglib`,
      },
    ])(
      `accepts custom settings: symprec=$symprec, algo=$algo`,
      ({ symprec, algo, expected_symprec, expected_algo }) => {
        mount(SymmetryStats, {
          target: document.body,
          props: { sym_data: create_mock_sym_data(), settings: { symprec, algo } },
        })
        flushSync()
        expect(doc_query<HTMLInputElement>(`.controls input[type="number"]`).value).toBe(
          expected_symprec,
        )
        expect(doc_query<HTMLSelectElement>(`.controls select`).value).toBe(expected_algo)
      },
    )

    test(`symprec uses oninput for immediate updates`, () => {
      // Verifies symprec input triggers updates while typing.
      let update_count = 0
      const current_settings = { symprec: 1e-4, algo: `Moyo` as const }

      mount(SymmetryStats, {
        target: document.body,
        props: {
          sym_data: create_mock_sym_data(),
          get settings() {
            return current_settings
          },
          set settings(val) {
            update_count++
            Object.assign(current_settings, val)
          },
        },
      })

      const symprec_input = doc_query<HTMLInputElement>(`.controls input[type="number"]`)

      // Simulate typing (input events should trigger updates)
      for (const val of [`0.0`, `0.00`, `0.001`]) {
        symprec_input.value = val
        symprec_input.dispatchEvent(new Event(`input`, { bubbles: true }))
        flushSync()
      }
      expect(update_count).toBe(3)

      // Change event no longer drives the update.
      symprec_input.dispatchEvent(new Event(`change`, { bubbles: true }))
      flushSync()
      expect(update_count).toBe(3)
    })

    test(`symprec ignores incomplete scientific notation while typing`, () => {
      let update_count = 0
      const current_settings = { symprec: 1e-4, algo: `Moyo` as const }

      mount(SymmetryStats, {
        target: document.body,
        props: {
          sym_data: create_mock_sym_data(),
          get settings() {
            return current_settings
          },
          set settings(val) {
            update_count++
            Object.assign(current_settings, val)
          },
        },
      })

      const symprec_input = doc_query<HTMLInputElement>(`.controls input[type="number"]`)
      symprec_input.value = `1e-`
      symprec_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()

      expect(update_count).toBe(0)
      expect(current_settings.symprec).toBe(1e-4)
    })

    test.each([
      { symprec_input_value: `0.01`, expected_step: 0.01 },
      { symprec_input_value: `0.002`, expected_step: 0.001 },
      { symprec_input_value: `0.00067`, expected_step: 0.0001 },
    ])(`symprec step follows order of magnitude for $symprec_input_value`, ({
      symprec_input_value,
      expected_step,
    }) => {
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: create_mock_sym_data() },
      })

      const symprec_input = doc_query<HTMLInputElement>(`.controls input[type="number"]`)
      expect(parseFloat(symprec_input.step)).toBeCloseTo(1e-4, 12)

      symprec_input.value = symprec_input_value
      symprec_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()
      expect(parseFloat(symprec_input.step)).toBeCloseTo(expected_step, 12)
    })

    test(`symprec input keeps focus while typing`, () => {
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: create_mock_sym_data() },
      })
      const symprec_input = doc_query<HTMLInputElement>(`.controls input[type="number"]`)
      symprec_input.focus()

      for (const val of [`0.0`, `0.00`, `0.001`]) {
        symprec_input.value = val
        symprec_input.dispatchEvent(new Event(`input`, { bubbles: true }))
        flushSync()
        expect(document.activeElement).toBe(symprec_input)
      }
    })

    test(`escape blurs symprec input`, () => {
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: create_mock_sym_data() },
      })
      const symprec_input = doc_query<HTMLInputElement>(`.controls input[type="number"]`)
      symprec_input.focus()
      expect(document.activeElement).toBe(symprec_input)

      symprec_input.dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
      )
      flushSync()

      expect(document.activeElement).not.toBe(symprec_input)
    })
  })

  describe(`Stats grid section`, () => {
    test.each([
      { wyckoffs: [`a`], numbers: [1], expected: 1 },
      { wyckoffs: [`a`, `b`, `c`], numbers: [1, 2, 3], expected: 3 },
      { wyckoffs: [], numbers: [], expected: 0 },
    ])(
      `displays wyckoff count: $expected for $numbers.length atoms`,
      ({ wyckoffs, numbers, expected }) => {
        // std_cell.numbers determines atom count, wyckoffs provides labels
        const std_cell = {
          lattice: { basis: [5.0, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0] },
          positions: numbers.map(() => [0.0, 0.0, 0.0]),
          numbers,
        }
        mount(SymmetryStats, {
          target: document.body,
          props: {
            sym_data: create_mock_sym_data(
              { wyckoffs, std_cell } as Partial<MoyoDataset>,
            ),
          },
        })
        expect(doc_query(`.stats-grid`).textContent).toContain(`${expected}`)
      },
    )

    test(`displays "?" in space group when Hermann-Mauguin symbol is missing`, () => {
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: create_mock_sym_data({ hm_symbol: undefined }) },
      })
      const text = doc_query(`.stats-grid`).textContent
      // HM symbol is now shown inline with space group number as "225 (?)"
      expect(text).toContain(`225 (?)`)
    })

    test(`removes whitespace in Hermann-Mauguin symbol display`, () => {
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: create_mock_sym_data({ number: 227, hm_symbol: `F d -3 m` }) },
      })
      const text = doc_query(`.stats-grid`).textContent
      expect(text).toContain(`227 (Fd-3m)`)
    })

    test.each(
      [
        [1, `triclinic`],
        [15, `monoclinic`],
        [74, `orthorhombic`],
        [142, `tetragonal`],
        [167, `trigonal`],
        [194, `hexagonal`],
        [225, `cubic`],
      ] as const,
    )(`space group %d → %s crystal system`, (space_group, crystal_system) => {
      mount(SymmetryStats, {
        target: document.body,
        props: { sym_data: create_mock_sym_data({ number: space_group }) },
      })
      expect(doc_query(`.stats-grid`).textContent).toContain(crystal_system)
    })
  })

  describe(`Operations summary section`, () => {
    test.each([
      {
        desc: `default ops (3 total)`,
        operations: undefined, // use default
        expected: { total: `3`, patterns: [`1T`, `1R`, `1RT`] },
      },
      {
        desc: `empty ops`,
        operations: [],
        expected: { total: `0`, patterns: [`0T`, `0R`, `0RT`] },
      },
      {
        desc: `1T + 1R + 1RT`,
        operations: [
          { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0.5, 0.0, 0.0] }, // translation
          { rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1], translation: [0.0, 0.0, 0.0] }, // rotation
          { rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1], translation: [0.5, 0.0, 0.0] }, // roto-translation
        ] as MoyoDataset[`operations`],
        expected: { total: `3`, patterns: [`1T`, `1R`, `1RT`] },
      },
    ])(`$desc`, ({ operations, expected }) => {
      const sym_data = operations === undefined
        ? create_mock_sym_data()
        : create_mock_sym_data({ operations })
      mount(SymmetryStats, { target: document.body, props: { sym_data } })

      const text = doc_query(`.sym-ops-summary`).textContent || ``
      expect(text).toContain(expected.total)
      for (const pattern of expected.patterns) {
        expect(text).toMatch(new RegExp(pattern))
      }
    })
  })

  describe(`Tooltips`, () => {
    test.each([
      {
        show_tooltips: true,
        symprec_contains: `Symmetry precision`,
        algo_contains: `Moyo`,
      },
      { show_tooltips: false, symprec_contains: ``, algo_contains: `` },
    ])(
      `show_tooltips=$show_tooltips`,
      ({ show_tooltips, symprec_contains, algo_contains }) => {
        mount(SymmetryStats, {
          target: document.body,
          props: { sym_data: create_mock_sym_data(), show_tooltips },
        })

        const symprec_title =
          doc_query(`.controls label:has(input[type="number"]) span`).title
        const algo_title = doc_query(`.controls label:has(select) span`).title

        if (show_tooltips) {
          expect(symprec_title).toContain(symprec_contains)
          expect(algo_title).toContain(algo_contains)
        } else {
          expect(symprec_title).toBe(``)
          expect(algo_title).toBe(``)
        }
      },
    )
  })

  test.each([1e-10, 1e-2, 0.5, 1.0])(`accepts extreme symprec: %f`, (symprec) => {
    mount(SymmetryStats, {
      target: document.body,
      props: { sym_data: create_mock_sym_data(), settings: { symprec, algo: `Moyo` } },
    })
    expect(
      parseFloat(doc_query<HTMLInputElement>(`.controls input[type="number"]`).value),
    ).toBeCloseTo(symprec, 10)
  })
})

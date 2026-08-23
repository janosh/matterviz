import type { SymmetryDataset } from '$lib/symmetry'
import { SymmetryStats } from '$lib/symmetry'
import { type ComponentProps, flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query, make_wyckoff_dataset } from '../setup'

// Mock dataset: one H atom on Wyckoff `a`, space group 225, plus the given overrides
function create_mock_sym_data(overrides: Partial<SymmetryDataset> = {}): SymmetryDataset {
  const default_data = {
    ...make_wyckoff_dataset([[0, 0, 0]], [1], [`a`]),
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
  }
  return { ...default_data, ...overrides } as SymmetryDataset
}

const mount_stats = (
  props: ComponentProps<typeof SymmetryStats> = { sym_data: create_mock_sym_data() },
) => mount(SymmetryStats, { target: document.body, props })
const get_symprec_input = () => doc_query<HTMLInputElement>(`.controls input[type="number"]`)
// Type into the symprec field the way a user does: one input event per keystroke
const type_symprec = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event(`input`, { bubbles: true }))
  flushSync()
}

describe(`SymmetryStats`, () => {
  test.each<SymmetryDataset | null | undefined>([null, undefined])(
    `displays no-data message when sym_data is %s`,
    (sym_data) => {
      mount_stats({ sym_data })

      const container = doc_query(`.symmetry-stats`)
      const no_data_div = container.querySelector(`.no-data`)

      expect(no_data_div).toBeInstanceOf(HTMLElement)
      expect(no_data_div?.textContent).toContain(`No symmetry data available`)

      // Controls should still be visible so users can adjust settings
      expect(container.querySelector(`.controls`)).toBeInstanceOf(HTMLElement)
      // Stats-grid should not be rendered without data
      expect(container.querySelector(`.stats-grid`)).toBeNull()
    },
  )

  describe(`Controls section`, () => {
    test(`renders controls with correct defaults`, () => {
      mount_stats()

      const symprec_input = get_symprec_input()
      expect(symprec_input.value).toBe(`0.0001`) // 1e-4
      expect(Number(symprec_input.step)).toBeCloseTo(1e-4, 12)

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
        mount_stats({ sym_data: create_mock_sym_data(), settings: { symprec, algo } })
        flushSync()
        expect(get_symprec_input().value).toBe(expected_symprec)
        expect(doc_query<HTMLSelectElement>(`.controls select`).value).toBe(expected_algo)
      },
    )

    // Mount with a tracked bindable settings prop and return the symprec input plus
    // a live view of how often the component reassigned settings
    const mount_with_tracked_settings = () => {
      const state = { update_count: 0, settings: { symprec: 1e-4, algo: `Moyo` as const } }
      mount_stats({
        sym_data: create_mock_sym_data(),
        get settings() {
          return state.settings
        },
        set settings(val) {
          state.update_count++
          Object.assign(state.settings, val)
        },
      })
      return { state, symprec_input: get_symprec_input() }
    }

    test(`symprec uses oninput for immediate updates`, () => {
      // Verifies symprec input triggers updates while typing.
      const { state, symprec_input } = mount_with_tracked_settings()

      // Simulate typing (input events should trigger updates)
      for (const val of [`0.0`, `0.00`, `0.001`]) {
        type_symprec(symprec_input, val)
      }
      expect(state.update_count).toBe(3)

      // Change event no longer drives the update.
      symprec_input.dispatchEvent(new Event(`change`, { bubbles: true }))
      flushSync()
      expect(state.update_count).toBe(3)
    })

    test(`symprec ignores incomplete scientific notation while typing`, () => {
      const { state, symprec_input } = mount_with_tracked_settings()
      type_symprec(symprec_input, `1e-`)

      expect(state.update_count).toBe(0)
      expect(state.settings.symprec).toBe(1e-4)
    })

    test.each([
      { symprec_input_value: `0.01`, expected_step: 0.01 },
      { symprec_input_value: `0.002`, expected_step: 0.001 },
      { symprec_input_value: `0.00067`, expected_step: 0.0001 },
    ])(
      `symprec step follows order of magnitude for $symprec_input_value`,
      ({ symprec_input_value, expected_step }) => {
        mount_stats()

        const symprec_input = get_symprec_input()
        expect(Number(symprec_input.step)).toBeCloseTo(1e-4, 12)

        type_symprec(symprec_input, symprec_input_value)
        expect(Number(symprec_input.step)).toBeCloseTo(expected_step, 12)
      },
    )

    test(`symprec input keeps focus while typing`, () => {
      mount_stats()
      const symprec_input = get_symprec_input()
      symprec_input.focus()

      for (const val of [`0.0`, `0.00`, `0.001`]) {
        type_symprec(symprec_input, val)
        expect(document.activeElement).toBe(symprec_input)
      }
    })

    test(`escape blurs symprec input`, () => {
      mount_stats()
      const symprec_input = get_symprec_input()
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
    // Distinct orbits, not atoms: two H on `a` + one He on `b` are 2 Wyckoff positions
    test.each([
      { wyckoffs: [`a`], numbers: [1], expected: 1, sequence: `a` },
      { wyckoffs: [`a`, `a`, `b`], numbers: [1, 1, 2], expected: 2, sequence: `b a` },
      { wyckoffs: [`a`, `b`, `c`], numbers: [1, 2, 3], expected: 3, sequence: `c b a` },
      { wyckoffs: [], numbers: [], expected: 0, sequence: `` },
    ])(
      `Wyckoff Positions tile counts $expected distinct orbits`,
      ({ wyckoffs, numbers, expected, sequence }) => {
        const positions = numbers.map((_, idx) => [idx / 4, 0, 0])
        mount_stats({
          sym_data: create_mock_sym_data(make_wyckoff_dataset(positions, numbers, wyckoffs)),
        })
        const tiles = Array.from(document.querySelectorAll(`.stats-grid > div`)).map((tile) =>
          tile.textContent?.replaceAll(/\s+/g, ` `).trim(),
        )
        expect(tiles).toContain(`Wyckoff Positions ${expected}`)
        if (sequence) expect(tiles).toContain(`Wyckoff Sequence ${sequence}`)
        else expect(tiles.some((tile) => tile?.startsWith(`Wyckoff Sequence`))).toBe(false)
      },
    )

    test(`displays "?" in space group when Hermann-Mauguin symbol is missing`, () => {
      mount_stats({ sym_data: create_mock_sym_data({ hm_symbol: undefined }) })
      const text = doc_query(`.stats-grid`).textContent
      // HM symbol is now shown inline with space group number as "225 (?)"
      expect(text).toContain(`225 (?)`)
    })

    test(`removes whitespace in Hermann-Mauguin symbol display`, () => {
      mount_stats({ sym_data: create_mock_sym_data({ number: 227, hm_symbol: `F d -3 m` }) })
      const text = doc_query(`.stats-grid`).textContent
      expect(text).toContain(`227 (Fd-3m)`)
    })

    test.each([
      [1, `triclinic`],
      [15, `monoclinic`],
      [74, `orthorhombic`],
      [142, `tetragonal`],
      [167, `trigonal`],
      [194, `hexagonal`],
      [225, `cubic`],
    ] as const)(`space group %d → %s crystal system`, (space_group, crystal_system) => {
      mount_stats({ sym_data: create_mock_sym_data({ number: space_group }) })
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
        ] as SymmetryDataset[`operations`],
        expected: { total: `3`, patterns: [`1T`, `1R`, `1RT`] },
      },
    ])(`$desc`, ({ operations, expected }) => {
      const sym_data =
        operations === undefined
          ? create_mock_sym_data()
          : create_mock_sym_data({ operations })
      mount_stats({ sym_data })

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
        mount_stats({ sym_data: create_mock_sym_data(), show_tooltips })

        const symprec_title = doc_query(`.controls label:has(input[type="number"]) span`).title
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
    mount_stats({ sym_data: create_mock_sym_data(), settings: { symprec, algo: `Moyo` } })
    expect(Number(get_symprec_input().value)).toBeCloseTo(symprec, 10)
  })
})

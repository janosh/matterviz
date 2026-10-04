import type { SymmetryDataset } from '#lib/symmetry/index.js'
import SymmetryStats from '#lib/symmetry/SymmetryStats.svelte'
import { type ComponentProps, flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query, set_input } from '../setup'
import { make_wyckoff_dataset } from '../test-fixtures'

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
  set_input(input, value)
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
      [1e-5, `Moyo`],
      [1e-4, `Spglib`],
      [1e-10, `Moyo`],
      [1e-2, `Spglib`],
      [0.5, `Moyo`],
      [1.0, `Moyo`],
    ] as const)(`accepts custom settings: symprec=%f, algo=%s`, (symprec, algo) => {
      mount_stats({ sym_data: create_mock_sym_data(), settings: { symprec, algo } })
      flushSync()
      expect(Number(get_symprec_input().value)).toBeCloseTo(symprec, 12)
      expect(doc_query<HTMLSelectElement>(`.controls select`).value).toBe(algo)
    })

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
      const { state, symprec_input } = mount_with_tracked_settings()
      for (const val of [`0.0`, `0.00`, `0.001`]) type_symprec(symprec_input, val)
      expect(state.update_count).toBe(3)

      // Change event no longer drives the update
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

    // the Hermann-Mauguin symbol follows the space group number, condensed; `?` when missing
    test.each([
      [{ hm_symbol: undefined }, `225 (?)`],
      [{ number: 227, hm_symbol: `F d -3 m` }, `227 (Fd-3m)`],
    ])(`space group tile shows %j as %s`, (overrides, expected) => {
      mount_stats({ sym_data: create_mock_sym_data(overrides) })
      expect(doc_query(`.stats-grid`).textContent).toContain(expected)
    })

    // The number → system mapping is pinned in spacegroups.test.ts; this covers the tile's
    // lattice-system suffix, shown only where it differs from the crystal system (trigonal)
    test.each([
      [225, `Crystal System cubic`],
      [167, `Crystal System trigonal (rhombohedral lattice)`],
      [143, `Crystal System trigonal (hexagonal lattice)`],
    ] as const)(`space group %d → %s tile`, (space_group, expected) => {
      mount_stats({ sym_data: create_mock_sym_data({ number: space_group }) })
      const tiles = Array.from(document.querySelectorAll(`.stats-grid > div`)).map((tile) =>
        tile.textContent?.replaceAll(/\s+/g, ` `).trim(),
      )
      expect(tiles).toContain(expected)
    })
  })

  describe(`Operations summary section`, () => {
    test.each([
      {
        desc: `default ops (identity counts as R)`,
        operations: undefined,
        expected: `3 (1T + 1R + 1RT)`,
      },
      { desc: `empty ops`, operations: [], expected: `0 (0T + 0R + 0RT)` },
      {
        desc: `1T + 1R + 1RT`,
        operations: [
          { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0.5, 0.0, 0.0] }, // translation
          { rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1], translation: [0.0, 0.0, 0.0] }, // rotation
          { rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1], translation: [0.5, 0.0, 0.0] }, // roto-translation
        ] as SymmetryDataset[`operations`],
        expected: `3 (1T + 1R + 1RT)`,
      },
    ])(`$desc`, ({ operations, expected }) => {
      mount_stats({ sym_data: create_mock_sym_data(operations && { operations }) })
      const text = doc_query(`.sym-ops-summary`).textContent?.replaceAll(/\s+/g, ` `).trim()
      expect(text).toBe(`Total sym ops: ${expected}`)
    })
  })

  describe(`Tooltips`, () => {
    test.each([
      { show_tooltips: true, symprec_title: /Symmetry precision/, algo_title: /Moyo/ },
      { show_tooltips: false, symprec_title: /^$/, algo_title: /^$/ },
    ])(`show_tooltips=$show_tooltips`, ({ show_tooltips, symprec_title, algo_title }) => {
      mount_stats({ sym_data: create_mock_sym_data(), show_tooltips })
      expect(doc_query(`.controls label:has(input[type="number"]) span`).title).toMatch(
        symprec_title,
      )
      expect(doc_query(`.controls label:has(select) span`).title).toMatch(algo_title)
    })
  })
})

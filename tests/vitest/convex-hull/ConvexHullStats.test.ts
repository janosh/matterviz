import { ConvexHullStats } from '$lib/convex-hull'
import type { ConvexHullEntry, PhaseStats } from '$lib/convex-hull/types'
import { flushSync, mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

const mock_stats = (overrides: Partial<PhaseStats> = {}): PhaseStats => ({
  total: 100,
  unary: 3,
  binary: 20,
  ternary: 50,
  quaternary: 27,
  quinary_plus: 0,
  stable: 15,
  unstable: 85,
  elements: 4,
  chemical_system: `Li-Fe-P-O`,
  energy_range: { min: -2.5, max: 0.5, avg: -0.8 },
  hull_distance: { max: 0.4, avg: 0.12 },
  ...overrides,
})

const mock_entry = (overrides: Partial<ConvexHullEntry> = {}): ConvexHullEntry => ({
  composition: { Li: 1, Fe: 1, P: 1, O: 4 },
  energy: -50,
  e_form_per_atom: -0.5,
  e_above_hull: 0.1,
  is_stable: false,
  is_element: false,
  x: 0.25,
  y: 0.25,
  z: 0.25,
  visible: true,
  ...overrides,
})

type Props = {
  phase_stats: PhaseStats | null
  stable_entries: ConvexHullEntry[]
  unstable_entries: ConvexHullEntry[]
}
const mount_stats = (props: Partial<Props> = {}) =>
  mount(ConvexHullStats, {
    target: document.body,
    props: {
      phase_stats: mock_stats(),
      stable_entries: [],
      unstable_entries: [],
      ...props,
    },
  })

// Shared helpers
const switch_to_table = () => {
  ;(document.querySelectorAll(`.view-toggle button`)[1] as HTMLElement).click()
  flushSync()
}
const get_headers = () =>
  Array.from(document.querySelectorAll(`th`)).map((th) => th.textContent?.trim())

describe(`ConvexHullStats`, () => {
  beforeEach(() => vi.clearAllMocks())

  test(`renders view toggle buttons and all phase type counts`, () => {
    mount_stats({
      phase_stats: mock_stats({ unary: 4, binary: 20, ternary: 50, quaternary: 26 }),
    })
    const text = document.body.textContent ?? ``
    // View toggle buttons replace the old h4 heading
    const buttons = document.querySelectorAll(`.view-toggle button`)
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent?.trim()).toBe(`Stats`)
    expect(buttons[1].textContent?.trim()).toBe(`Table`)
    expect(buttons[0].classList.contains(`active`)).toBe(true)
    for (
      const [type, count] of [[`Unary`, 4], [`Binary`, 20], [`Ternary`, 50], [
        `Quaternary`,
        26,
      ]] as const
    ) {
      expect(text).toContain(`${type} phases`)
      expect(text).toContain(`${count}`)
    }
  })

  test(`displays chemical system, stability counts, energy and hull stats`, () => {
    mount_stats({
      phase_stats: mock_stats({
        chemical_system: `Li-Fe-P-O`,
        total: 150,
        stable: 25,
        unstable: 125,
        energy_range: { min: -2.567, max: 0.123, avg: -1.234 },
        hull_distance: { max: 0.456, avg: 0.089 },
      }),
    })
    const text = document.body.textContent ?? ``
    expect(text).toContain(`Total entries in Li-Fe-P-O`)
    expect(text).toContain(`150`)
    expect(text).toContain(`Stable phases`)
    expect(text).toContain(`25`)
    // Check combined formation energy line: min / avg / max
    expect(text).toContain(`Min / avg / max (eV/atom)`)
    expect(text).toContain(`−2.567 / −1.234 / 0.123`)
    // Check combined hull distance line: max / avg
    expect(text).toContain(`Max / avg (eV/atom)`)
    expect(text).toContain(`0.456 / 0.089`)
  })

  test.each([
    [`click`, (el: HTMLElement) => el.click()],
    [
      `Enter key`,
      (el: HTMLElement) =>
        el.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true })),
    ],
  ])(`copies stat item on %s`, (_, trigger) => {
    mount_stats()
    trigger(doc_query(`[data-testid="pd-total-entries"]`))
    flushSync()
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
  })

  test(`renders both histograms when entries have energy and hull data`, () => {
    // mock_entry has both e_form_per_atom and e_above_hull by default
    mount_stats({ stable_entries: [mock_entry()] })
    expect(document.querySelectorAll(`.histogram`).length).toBe(2)
  })

  test.each([
    {
      system: `Li-Fe`,
      ternary: 0,
      quaternary: 0,
      shown: [`Binary`],
      hidden: [`Ternary`, `Quaternary`],
    },
    {
      system: `Li-Fe-O`,
      ternary: 10,
      quaternary: 0,
      shown: [`Ternary`],
      hidden: [`Quaternary`],
    },
  ])(
    `conditional phase display for $system system`,
    ({ system, ternary, quaternary, shown, hidden }) => {
      mount_stats({
        phase_stats: mock_stats({ chemical_system: system, ternary, quaternary }),
      })
      const text = document.body.textContent ?? ``
      for (const type of shown) expect(text).toContain(`${type} phases`)
      for (const type of hidden) expect(text).not.toContain(`${type} phases`)
    },
  )

  test(`renders empty stat items when phase_stats is null`, () => {
    mount_stats({ phase_stats: null })
    expect(doc_query(`.convex-hull-stats`).querySelectorAll(`.stat-item`).length).toBe(
      0,
    )
  })

  test(`energy_per_atom fallback renders both histograms`, () => {
    mount_stats({
      stable_entries: [
        mock_entry({
          e_form_per_atom: undefined,
          energy_per_atom: -0.3,
          e_above_hull: 0.1,
        }),
      ],
    })
    expect(document.querySelectorAll(`.histogram`).length).toBe(2)
  })

  test(`zero totals does not produce NaN in percentages`, () => {
    mount_stats({
      phase_stats: mock_stats({ total: 0, stable: 0, unstable: 0 }),
      stable_entries: [],
    })
    const text = document.body.textContent ?? ``
    expect(text).not.toContain(`NaN`)
  })

  test(`non-finite energy values are excluded from histograms`, () => {
    mount_stats({
      stable_entries: [
        mock_entry({ e_form_per_atom: NaN, e_above_hull: Infinity }),
        mock_entry({ e_form_per_atom: Infinity, e_above_hull: NaN }),
      ],
    })
    // NaN/Infinity are filtered out → no histogram data → 0 histograms
    expect(document.querySelectorAll(`.histogram`).length).toBe(0)
  })

  test(`missing energy fields render without errors`, () => {
    mount_stats({
      stable_entries: [
        mock_entry({ e_form_per_atom: undefined, energy_per_atom: undefined }),
      ],
    })
    expect(doc_query(`.convex-hull-stats`)).toBeTruthy()
  })

  test(`stat items have accessibility attributes and copy hint`, () => {
    mount_stats()
    const items = Array.from(document.querySelectorAll(`.stat-item`))
    for (const item of items) {
      expect(item.getAttribute(`role`)).toBe(`button`)
      expect(item.getAttribute(`tabindex`)).toBe(`0`)
    }
    expect(doc_query(`[data-testid="pd-total-entries"]`).getAttribute(`title`)).toContain(
      `Click to copy`,
    )
  })

  test(`passes through HTML attributes`, () => {
    mount(ConvexHullStats, {
      target: document.body,
      props: {
        phase_stats: mock_stats(),
        stable_entries: [],
        unstable_entries: [],
        class: `custom-class`,
        style: `background: red;`,
      },
    })
    const container = doc_query(`.convex-hull-stats`)
    expect(container.classList.contains(`custom-class`)).toBe(true)
    expect(container.getAttribute(`style`)).toContain(`background: red`)
  })

  describe(`table view mode`, () => {
    const stable = [
      mock_entry({
        composition: { Fe: 2, O: 3 },
        e_above_hull: 0,
        e_form_per_atom: -1.5,
        is_stable: true,
        reduced_formula: `Fe2O3`,
      }),
      mock_entry({
        composition: { Li: 1 },
        e_above_hull: 0,
        e_form_per_atom: 0,
        is_stable: true,
        is_element: true,
        reduced_formula: `Li`,
      }),
    ]
    const unstable = [
      mock_entry({
        composition: { Li: 1, Fe: 1, O: 2 },
        e_above_hull: 0.15,
        e_form_per_atom: -0.8,
        reduced_formula: `LiFeO2`,
      }),
      mock_entry({
        composition: { Li: 2, O: 1 },
        e_above_hull: 0.05,
        e_form_per_atom: -1.2,
        reduced_formula: `Li2O`,
      }),
    ]

    test(`view toggle switches between stats and table, round-trips correctly`, () => {
      mount_stats({ stable_entries: stable, unstable_entries: unstable })
      // Stats is default
      expect(document.querySelector(`.stat-item`)).not.toBeNull()
      expect(document.querySelector(`.table-container`)).toBeNull()
      const [stats_btn, table_btn] = document.querySelectorAll(
        `.view-toggle button`,
      ) as NodeListOf<HTMLElement>
      expect(stats_btn.classList.contains(`active`)).toBe(true)

      // Switch to table
      table_btn.click()
      flushSync()
      expect(document.querySelector(`.stat-item`)).toBeNull()
      expect(document.querySelector(`.table-container`)).not.toBeNull()
      expect(table_btn.classList.contains(`active`)).toBe(true)
      expect(stats_btn.classList.contains(`active`)).toBe(false)

      // Switch back to stats
      stats_btn.click()
      flushSync()
      expect(document.querySelector(`.stat-item`)).not.toBeNull()
      expect(document.querySelector(`.table-container`)).toBeNull()
    })

    test(`table shows all visible entries with correct columns`, () => {
      mount_stats({ stable_entries: stable, unstable_entries: unstable })
      switch_to_table()

      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(4)
      for (const formula of [`Fe2O3`, `Li`, `LiFeO2`, `Li2O`]) {
        expect(document.body.textContent).toContain(formula)
      }
      const headers = get_headers()
      for (const col of [`#`, `Stable`, `Formula`]) {
        expect(headers).toContain(col)
      }
      // Columns with HTML subscripts render as text without tags
      expect(headers.length).toBeGreaterThanOrEqual(7)
    })

    test(`table excludes non-visible entries`, () => {
      const hidden = mock_entry({
        composition: { Zr: 1 },
        visible: false,
        reduced_formula: `Zr`,
      })
      mount_stats({ stable_entries: stable, unstable_entries: [hidden] })
      switch_to_table()

      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(2)
      const cells = Array.from(document.querySelectorAll(`td`)).map((td) =>
        td.textContent?.trim()
      )
      expect(cells).not.toContain(`Zr`)
    })

    test.each([
      {
        desc: `shown when available`,
        energy_per_atom: -5.2 as number | undefined,
        expected: true,
      },
      { desc: `hidden when unavailable`, energy_per_atom: undefined, expected: false },
    ])(`E_raw column $desc`, ({ energy_per_atom, expected }) => {
      mount_stats({
        stable_entries: [mock_entry({ energy_per_atom, reduced_formula: `X` })],
        unstable_entries: [],
      })
      switch_to_table()
      expect(get_headers().some((h) => h?.includes(`raw`))).toBe(expected)
    })

    test(`ID column and value shown when entry_id available`, () => {
      mount_stats({
        stable_entries: [mock_entry({ entry_id: `mp-1234`, reduced_formula: `X` })],
        unstable_entries: [],
      })
      switch_to_table()
      expect(get_headers()).toContain(`ID`)
      expect(document.body.textContent).toContain(`mp-1234`)
    })

    test(`composition fallback when reduced_formula missing`, () => {
      mount_stats({
        stable_entries: [
          mock_entry({
            composition: { Ca: 1, Ti: 1, O: 3 },
            reduced_formula: undefined,
            name: undefined,
          }),
        ],
        unstable_entries: [],
      })
      switch_to_table()
      for (const el of [`Ca`, `Ti`, `O`]) {
        expect(document.body.textContent).toContain(el)
      }
    })

    test(`table has #, Stable columns with row numbers and hull indicators`, () => {
      mount_stats({
        stable_entries: [
          mock_entry({ is_stable: true, e_above_hull: 0, reduced_formula: `Fe` }),
        ],
        unstable_entries: [
          mock_entry({ is_stable: false, e_above_hull: 0.1, reduced_formula: `FeO` }),
        ],
      })
      switch_to_table()

      const headers = get_headers()
      expect(headers).toContain(`#`)
      expect(headers).toContain(`Stable`)
      // Row numbers start at 1
      const first_cells = Array.from(document.querySelectorAll(`tbody tr:first-child td`))
        .map((td) => td.textContent?.trim())
      expect(first_cells).toContain(`1`)
      // On-hull vs above-hull markers
      const all_cells = document.querySelectorAll(`td`)
      expect(Array.from(all_cells).filter((td) => td.innerHTML.includes(`On hull`)))
        .toHaveLength(1)
      expect(Array.from(all_cells).filter((td) => td.innerHTML.includes(`Above hull`)))
        .toHaveLength(1)
    })

    test(`on_entry_click callback fires on row click`, () => {
      const clicked: ConvexHullEntry[] = []
      mount(ConvexHullStats, {
        target: document.body,
        props: {
          phase_stats: mock_stats(),
          stable_entries: stable,
          unstable_entries: [],
          on_entry_click: (entry: ConvexHullEntry) => clicked.push(entry),
        },
      })
      switch_to_table()

      const first_row = document.querySelector(`tbody tr`) as HTMLElement
      expect(first_row).not.toBeNull()
      first_row.click()
      flushSync()
      expect(clicked).toHaveLength(1)
      expect(clicked[0].reduced_formula).toBe(stable[0].reduced_formula)
    })
  })

  describe(`side-by-side layout`, () => {
    test(`renders both stats and table simultaneously`, () => {
      mount(ConvexHullStats, {
        target: document.body,
        props: {
          phase_stats: mock_stats(),
          stable_entries: [mock_entry({ reduced_formula: `Fe` })],
          unstable_entries: [],
          layout: `side-by-side`,
        },
      })
      // Both should be visible at once (no toggle)
      expect(document.querySelector(`.stat-item`)).not.toBeNull()
      expect(document.querySelector(`.table-container`)).not.toBeNull()
      expect(document.querySelector(`.side-by-side`)).not.toBeNull()
      // No toggle buttons in side-by-side
      expect(document.querySelector(`.view-toggle`)).toBeNull()
    })
  })

  describe(`min N_el filter`, () => {
    test(`dropdown visible for ternary+ systems, hidden for binary-only`, () => {
      const ternary = mock_entry({
        composition: { Li: 1, Fe: 1, O: 2 },
        reduced_formula: `LiFeO2`,
      })
      const binary = mock_entry({ composition: { Fe: 1, O: 1 }, reduced_formula: `FeO` })

      mount_stats({ stable_entries: [ternary, binary] })
      switch_to_table()
      expect(document.querySelector(`.nel-filter select`)).not.toBeNull()

      document.body.innerHTML = ``
      mount_stats({ stable_entries: [binary] })
      switch_to_table()
      expect(document.querySelector(`.nel-filter`)).toBeNull()
    })
  })

  test.each([
    [5, true, `shown when count > 0`],
    [0, false, `hidden when count is 0`],
  ] as [number, boolean, string][])(
    `Quinary+ row: %s (%s)`,
    (quinary_plus, should_show) => {
      mount_stats({ phase_stats: mock_stats({ quinary_plus }) })
      const text = document.body.textContent ?? ``
      if (should_show) expect(text).toContain(`Quinary+`)
      else expect(text).not.toContain(`Quinary+`)
    },
  )
})

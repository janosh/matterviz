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
  max_arity: 4,
  ...overrides,
})

const mock_entry = (
  overrides: Partial<ConvexHullEntry> = {},
): ConvexHullEntry => ({
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
  layout?: `toggle` | `side-by-side`
  on_entry_click?: (entry: ConvexHullEntry) => void
  highlighted_entry_id?: string
  entry_href?: (entry: ConvexHullEntry) => string | null
  class?: string
  style?: string
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
const mount_stats_table = (props: Partial<Props> = {}) => {
  mount_stats(props)
  switch_to_table()
}
const get_headers = () =>
  Array.from(document.querySelectorAll(`th`)).map((th) => th.textContent?.trim())
const normalize_formula_html = (html: string): string =>
  html
    .replace(`<strong>`, ``)
    .replace(`</strong>`, ``)
    .replaceAll(/\s+/g, ` `)
    .trim()
const normalize_formula_text = (text: string): string =>
  text.replaceAll(/\s+/g, ` `).trim()
const get_table_filter_select = (
  label_text: string,
): HTMLSelectElement | null => {
  const filter_labels = Array.from(
    document.querySelectorAll(`.table-filters label`),
  )
  const matching_label = filter_labels.find((label_element) =>
    label_element.textContent?.includes(label_text)
  )
  return (matching_label?.querySelector(`select`) as
    | HTMLSelectElement
    | null) ?? null
}
const set_select_value = (select_element: HTMLSelectElement, value: string) => {
  const option_idx = Array.from(select_element.options).findIndex((
    option_element,
  ) => option_element.value === value)
  if (option_idx >= 0) select_element.selectedIndex = option_idx
  select_element.value = value
  select_element.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
}
const mount_table_with_single_entry = (
  entry_overrides: Partial<ConvexHullEntry>,
  prop_overrides: Partial<Props> = {},
) => {
  mount_stats_table({
    stable_entries: [mock_entry({ reduced_formula: `Fe`, ...entry_overrides })],
    unstable_entries: [],
    ...prop_overrides,
  })
}

describe(`ConvexHullStats`, () => {
  beforeEach(() => vi.clearAllMocks())
  const get_polymorph_select = (): HTMLSelectElement | null =>
    get_table_filter_select(`Polymorphs`)

  test(`renders view toggle buttons and all phase type counts`, () => {
    mount_stats({
      phase_stats: mock_stats({
        unary: 4,
        binary: 20,
        ternary: 50,
        quaternary: 26,
      }),
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
        el.dispatchEvent(
          new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
        ),
    ],
    [
      `Space key`,
      (el: HTMLElement) =>
        el.dispatchEvent(
          new KeyboardEvent(`keydown`, { key: ` `, bubbles: true }),
        ),
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
      max_arity: 2,
      ternary: 0,
      quaternary: 0,
      shown: [`Binary`],
      hidden: [`Ternary`, `Quaternary`],
    },
    {
      system: `Li-Fe-O`,
      max_arity: 3,
      ternary: 10,
      quaternary: 0,
      shown: [`Ternary`],
      hidden: [`Quaternary`],
    },
  ])(
    `conditional phase display for $system system`,
    ({ system, max_arity, ternary, quaternary, shown, hidden }) => {
      mount_stats({
        phase_stats: mock_stats({
          chemical_system: system,
          max_arity,
          ternary,
          quaternary,
        }),
      })
      const text = document.body.textContent ?? ``
      for (const type of shown) expect(text).toContain(`${type} phases`)
      for (const type of hidden) expect(text).not.toContain(`${type} phases`)
    },
  )

  test(`renders empty stat items when phase_stats is null`, () => {
    mount_stats({ phase_stats: null })
    expect(
      doc_query(`.convex-hull-stats`).querySelectorAll(`.stat-item`).length,
    ).toBe(
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
    expect(doc_query(`[data-testid="pd-total-entries"]`).getAttribute(`title`))
      .toContain(
        `Click to copy`,
      )
  })

  test(`passes through HTML attributes`, () => {
    mount_stats({
      class: `custom-class`,
      style: `background: red;`,
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
      const [stats_btn, table_btn] = Array.from(
        document.querySelectorAll(`.view-toggle button`),
      ) as HTMLElement[]
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
      mount_stats_table({ stable_entries: stable, unstable_entries: unstable })

      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(4)
      const headers = get_headers()
      const formula_idx = headers.indexOf(`Formula`)
      expect(formula_idx).toBeGreaterThanOrEqual(0)
      const formula_html_cells = Array.from(document.querySelectorAll(`tbody tr`))
        .map((row) =>
          normalize_formula_html(
            (row.querySelectorAll(`td`)[formula_idx] as HTMLElement)?.innerHTML ?? ``,
          )
        )
      const formula_text_cells = Array.from(document.querySelectorAll(`tbody tr`))
        .map((row) =>
          normalize_formula_text(
            (row.querySelectorAll(`td`)[formula_idx] as HTMLElement)?.textContent ?? ``,
          )
        )
      expect(formula_html_cells.some((formula) => formula.includes(`<sub>`))).toBe(true)
      expect(formula_text_cells).toContain(`Li`)
      expect(formula_text_cells.some((formula) => /Fe.*O.*3|O.*3.*Fe/.test(formula)))
        .toBe(
          true,
        )
      expect(
        formula_text_cells.some((formula) => /Li.*Fe.*O.*2|Li.*O.*2.*Fe/.test(formula)),
      ).toBe(true)
      expect(formula_text_cells.some((formula) => /Li.*2.*O|O.*Li.*2/.test(formula)))
        .toBe(
          true,
        )
      for (const col of [`#`, `Formula`]) {
        expect(headers).toContain(col)
      }
      // Columns with HTML subscripts render as text without tags
      expect(headers.length).toBeGreaterThanOrEqual(6)
    })

    test(`table excludes non-visible entries`, () => {
      const hidden = mock_entry({
        composition: { Zr: 1 },
        visible: false,
        reduced_formula: `Zr`,
      })
      mount_stats_table({ stable_entries: stable, unstable_entries: [hidden] })

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
      {
        desc: `hidden when unavailable`,
        energy_per_atom: undefined,
        expected: false,
      },
    ])(`E_raw column $desc`, ({ energy_per_atom, expected }) => {
      mount_stats_table({
        stable_entries: [mock_entry({ energy_per_atom, reduced_formula: `X` })],
        unstable_entries: [],
      })
      expect(get_headers().some((h) => h?.includes(`raw`))).toBe(expected)
    })

    test(`ID column and value shown when entry_id available`, () => {
      mount_stats_table({
        stable_entries: [
          mock_entry({ entry_id: `mp-1234`, reduced_formula: `X` }),
        ],
        unstable_entries: [],
      })
      expect(get_headers()).toContain(`ID`)
      expect(document.body.textContent).toContain(`mp-1234`)
    })

    test(`composition fallback when reduced_formula missing`, () => {
      mount_stats_table({
        stable_entries: [
          mock_entry({
            composition: { Ca: 1, Ti: 1, O: 3 },
            reduced_formula: undefined,
            name: undefined,
          }),
        ],
        unstable_entries: [],
      })
      const headers = get_headers()
      const formula_idx = headers.indexOf(`Formula`)
      const formula_cell = document.querySelector(
        `tbody tr td:nth-child(${formula_idx + 1})`,
      )
      expect(formula_cell?.innerHTML.replaceAll(/\s+/g, ` `)).toContain(
        `Ca Ti O<sub>3</sub>`,
      )
    })

    test(`reformats reduced_formula containing <sub> markup without losing stoichiometry`, () => {
      mount_stats_table({
        stable_entries: [
          mock_entry({
            composition: { Fe: 2, O: 3 },
            reduced_formula: `Fe<sub>2</sub>O<sub>3</sub>`,
            is_stable: true,
            e_above_hull: 0,
          }),
        ],
        unstable_entries: [],
      })
      const headers = get_headers()
      const formula_idx = headers.indexOf(`Formula`)
      const formula_cell = document.querySelector(
        `tbody tr td:nth-child(${formula_idx + 1})`,
      ) as HTMLElement | null
      const formula_text = normalize_formula_text(formula_cell?.textContent ?? ``)
      expect(formula_text).toMatch(/Fe.*2.*O.*3|O.*3.*Fe.*2/)
    })

    test(`table has # column with row numbers and bold stable formulas`, () => {
      mount_stats_table({
        stable_entries: [
          mock_entry({
            composition: { Fe: 1 },
            is_stable: true,
            e_above_hull: 0,
          }),
        ],
        unstable_entries: [
          mock_entry({
            composition: { Fe: 1, O: 1 },
            is_stable: false,
            e_above_hull: 0.1,
          }),
        ],
      })

      const headers = get_headers()
      expect(headers).toContain(`#`)
      expect(headers).toContain(`Formula`)
      // Row numbers start at 1
      const first_cells = Array.from(
        document.querySelectorAll(`tbody tr:first-child td`),
      )
        .map((td) => td.textContent?.trim())
      expect(first_cells).toContain(`1`)
      // Stable formulas are bold
      const all_cells = Array.from(document.querySelectorAll(`td`))
      expect(
        all_cells.some((td) => td.innerHTML.includes(`<strong>`)),
      ).toBe(true)
    })

    test(`on_entry_click callback fires on row click`, () => {
      const clicked: ConvexHullEntry[] = []
      mount_stats({
        stable_entries: stable,
        unstable_entries: [],
        on_entry_click: (entry: ConvexHullEntry) => clicked.push(entry),
      })
      switch_to_table()

      const first_row = document.querySelector(`tbody tr`) as HTMLElement
      expect(first_row).not.toBeNull()
      first_row.click()
      flushSync()
      expect(clicked).toHaveLength(1)
      expect(clicked[0].reduced_formula).toBe(stable[0].reduced_formula)
    })

    test(`shows entry count in filter bar`, () => {
      mount_stats_table({ stable_entries: stable, unstable_entries: unstable })
      const count_el = document.querySelector(`.filter-count`)
      expect(count_el).not.toBeNull()
      expect(count_el?.textContent?.trim()).toBe(`4 entries`)
    })
  })

  describe(`side-by-side layout`, () => {
    test(`renders both stats and table simultaneously`, () => {
      mount_stats({
        stable_entries: [mock_entry({ reduced_formula: `Fe` })],
        unstable_entries: [],
        layout: `side-by-side`,
      })
      // Both should be visible at once (no toggle)
      expect(document.querySelector(`.stat-item`)).not.toBeNull()
      expect(document.querySelector(`.table-container`)).not.toBeNull()
      expect(document.querySelector(`.side-by-side`)).not.toBeNull()
      // No toggle buttons in side-by-side
      expect(document.querySelector(`.view-toggle`)).toBeNull()
    })

    test(`passes root_style to table container for left alignment`, () => {
      mount_stats({
        stable_entries: [mock_entry({ reduced_formula: `Fe` })],
        unstable_entries: [],
        layout: `side-by-side`,
      })
      const table_container = doc_query(`.table-container`)
      const style = table_container.getAttribute(`style`) ?? ``
      expect(style).toContain(`margin-inline: 0`)
      expect(style).toContain(`min-height: 0`)
      // flex: 1 1 0 gets normalized by browser to flex-grow/shrink/basis
      expect(style).toMatch(/flex-grow:\s*1|flex:\s*1\s+1\s+0/)
    })
  })

  describe(`min N_el filter`, () => {
    test(`dropdown visible for ternary+ systems, hidden for binary-only`, () => {
      const ternary = mock_entry({
        composition: { Li: 1, Fe: 1, O: 2 },
        reduced_formula: `LiFeO2`,
      })
      const binary = mock_entry({
        composition: { Fe: 1, O: 1 },
        reduced_formula: `FeO`,
      })

      mount_stats({ stable_entries: [ternary, binary] })
      switch_to_table()
      expect(get_table_filter_select(`Min N`)).not.toBeNull()

      document.body.innerHTML = ``
      mount_stats({ stable_entries: [binary] })
      switch_to_table()
      // With only binary entries, max_n_el ≤ 2 so no min N_el filter shown
      expect(get_table_filter_select(`Min N`)).toBeNull()
      // Export controls should still be available without filters
      expect(document.querySelector(`.export-actions .icon-btn`)).not
        .toBeNull()
    })
  })

  describe(`table export`, () => {
    const export_entry = mock_entry({
      entry_id: `mp-123`,
      reduced_formula: `Fe`,
    })
    const export_props = {
      phase_stats: mock_stats({ chemical_system: `Li-Fe-P-O` }),
      stable_entries: [export_entry],
      unstable_entries: [],
    }

    test.each([
      { format: `CSV`, ext: `csv`, mime_type: `text/csv;charset=utf-8` },
      {
        format: `JSON`,
        ext: `json`,
        mime_type: `application/json;charset=utf-8`,
      },
    ])(
      `exports $format via dropdown and closes menu`,
      ({ format, ext, mime_type }) => {
        const create_url = vi.spyOn(URL, `createObjectURL`).mockReturnValue(
          `blob:test`,
        )
        const revoke_url = vi.spyOn(URL, `revokeObjectURL`).mockImplementation(
          () => {},
        )
        const anchor_click = vi.spyOn(HTMLAnchorElement.prototype, `click`)
          .mockImplementation(() => {})
        const append = vi.spyOn(document.body, `append`)
        try {
          mount_stats_table(export_props)
          doc_query(`.export-actions .icon-btn`).click()
          flushSync()

          const options = Array.from(
            document.querySelectorAll(`.export-dropdown .dropdown-option`),
          ) as HTMLButtonElement[]
          options.find((el) => el.textContent?.includes(format))?.click()
          flushSync()

          expect(document.querySelector(`.export-dropdown`)).toBeNull()
          expect(create_url).toHaveBeenCalledTimes(1)
          expect((create_url.mock.calls[0]?.[0] as Blob).type).toBe(mime_type)
          expect(anchor_click).toHaveBeenCalledTimes(1)
          expect(revoke_url).toHaveBeenCalledTimes(1)
          expect((append.mock.calls[0]?.[0] as HTMLAnchorElement).download)
            .toBe(
              `li-fe-p-o.${ext}`,
            )
        } finally {
          create_url.mockRestore()
          revoke_url.mockRestore()
          anchor_click.mockRestore()
          append.mockRestore()
        }
      },
    )
  })

  test.each([
    [5, true],
    [0, false],
  ] as [number, boolean][])(
    `Quinary+ row with count=%s visible=%s`,
    (quinary_plus, should_show) => {
      mount_stats({ phase_stats: mock_stats({ quinary_plus }) })
      const text = document.body.textContent ?? ``
      expect(text.includes(`Quinary+`)).toBe(should_show)
    },
  )

  describe(`highlighted_entry_id`, () => {
    const make_entry_with_id = (
      entry_id: string,
      data?: Record<string, unknown>,
    ) =>
      mock_entry({
        entry_id,
        reduced_formula: entry_id,
        data: data as Record<string, unknown>,
      })

    // happy-dom can't parse `color-mix()` CSS, so Svelte's `style={row.style}`
    // compiles to `element.style.cssText = value` which silently fails.
    // We detect highlighted rows by the style attribute being present (even if empty)
    // vs absent for non-highlighted rows.
    const get_rows_with_style = () =>
      Array.from(document.querySelectorAll(`tbody tr`)).filter((row) =>
        row.hasAttribute(`style`) && row.getAttribute(`style`) !== `null`
      )

    test.each([
      {
        desc: `entry_id`,
        entries: () => [make_entry_with_id(`mp-123`), make_entry_with_id(`mp-456`)],
        highlight_id: `mp-123`,
        expected_text: `mp-123`,
      },
      {
        desc: `data.mat_id`,
        entries: () => [
          make_entry_with_id(`entry-1`, { mat_id: `mp-999` }),
          make_entry_with_id(`entry-2`),
        ],
        highlight_id: `mp-999`,
        expected_text: `entry-1`,
      },
      {
        desc: `data.structure_id`,
        entries: () => [make_entry_with_id(`entry-A`, { structure_id: `struct-42` })],
        highlight_id: `struct-42`,
        expected_text: `entry-A`,
      },
    ])(
      `highlights row matching $desc`,
      ({ entries, highlight_id, expected_text }) => {
        mount_stats({
          stable_entries: entries(),
          unstable_entries: [],
          highlighted_entry_id: highlight_id,
        })
        switch_to_table()

        const styled = get_rows_with_style()
        expect(styled).toHaveLength(1)
        expect(styled[0].textContent).toContain(expected_text)
      },
    )

    test.each([
      { desc: `undefined`, highlight_id: undefined as string | undefined },
      { desc: `nonexistent`, highlight_id: `nonexistent` },
    ])(`no row highlighted when ID is $desc`, ({ highlight_id }) => {
      mount_stats({
        stable_entries: [make_entry_with_id(`mp-1`)],
        unstable_entries: [],
        highlighted_entry_id: highlight_id,
      })
      switch_to_table()
      expect(get_rows_with_style()).toHaveLength(0)
    })
  })

  // Shared entries: Fe2O3 x2 (polymorphs) + Li2O x1 (unique)
  const polymorph_entries = [
    mock_entry({
      composition: { Fe: 2, O: 3 },
      reduced_formula: `Fe2O3-a`,
      entry_id: `a`,
    }),
    mock_entry({
      composition: { Fe: 2, O: 3 },
      reduced_formula: `Fe2O3-b`,
      entry_id: `b`,
    }),
    mock_entry({
      composition: { Li: 2, O: 1 },
      reduced_formula: `Li2O`,
      entry_id: `c`,
    }),
  ]

  describe(`Poly column (polymorph counting)`, () => {
    const get_poly_values = () => {
      const poly_idx = get_headers().indexOf(`Poly`)
      return Array.from(document.querySelectorAll(`tbody tr`)).map((row) =>
        row.querySelectorAll(`td`)[poly_idx]?.textContent?.trim() ?? ``
      )
    }

    test(`shows count > 1 for polymorphs, 1 for unique, and column header exists`, () => {
      mount_stats_table({ stable_entries: polymorph_entries })

      expect(get_headers()).toContain(`Poly`)
      const poly = get_poly_values()
      expect(poly.filter((val) => val === `2`)).toHaveLength(2)
      expect(poly.filter((val) => val === `1`)).toHaveLength(1)
    })

    test(`reduces formula before counting (Fe4O6 groups with Fe2O3)`, () => {
      mount_stats_table({
        stable_entries: [
          mock_entry({
            composition: { Fe: 2, O: 3 },
            reduced_formula: `Fe2O3`,
            entry_id: `a`,
          }),
          mock_entry({
            composition: { Fe: 4, O: 6 },
            reduced_formula: `Fe4O6`,
            entry_id: `b`,
          }),
        ],
      })
      expect(get_poly_values()).toEqual([`2`, `2`])
    })
  })

  describe(`entry_href prop`, () => {
    test(`renders ID as link when entry_href returns a URL, passes entry to callback`, () => {
      const received_entries: ConvexHullEntry[] = []
      const target_entry = mock_entry({
        entry_id: `mp-123`,
        reduced_formula: `Fe`,
      })
      mount_stats({
        stable_entries: [target_entry],
        unstable_entries: [],
        entry_href: (entry: ConvexHullEntry) => {
          received_entries.push(entry)
          return `/materials/${entry.entry_id}`
        },
      })
      switch_to_table()

      // Callback received the correct entry
      expect(received_entries.length).toBeGreaterThanOrEqual(1)
      expect(received_entries[0].entry_id).toBe(`mp-123`)

      const link = document.querySelector(`td a[href]`) as HTMLAnchorElement
      expect(link).not.toBeNull()
      expect(link.getAttribute(`href`)).toBe(`/materials/mp-123`)
      expect(link.textContent).toBe(`mp-123`)
      expect(link.getAttribute(`target`)).toBe(`_blank`)
      expect(link.getAttribute(`rel`)).toBe(`noopener`)
    })

    test.each([
      { desc: `entry_href returns null`, href: () => null },
      { desc: `entry_href not provided`, href: undefined },
    ])(`renders plain ID when $desc`, ({ href }) => {
      mount_table_with_single_entry({ entry_id: `mp-456` }, {
        entry_href: href,
      })

      expect(document.querySelector(`td a[href]`)).toBeNull()
      expect(document.body.textContent).toContain(`mp-456`)
    })

    test(`escapes HTML special chars in entry_id to prevent XSS`, () => {
      mount_table_with_single_entry(
        { entry_id: `<img src=x onerror=alert(1)>` },
        { entry_href: () => `/materials/test` },
      )

      // The raw <img> tag must NOT appear as an element — it should be escaped
      expect(document.querySelector(`td img`)).toBeNull()
      // The link should still be rendered (escaping doesn't break the <a> tag)
      const link = document.querySelector(`td a[href]`) as HTMLAnchorElement
      expect(link).not.toBeNull()
      expect(link.getAttribute(`href`)).toBe(`/materials/test`)
    })

    test(`escapes HTML special chars in fallback ID rendering (no link)`, () => {
      mount_table_with_single_entry(
        { entry_id: `<img src=x onerror=alert(1)>` },
        { entry_href: undefined },
      )

      expect(document.querySelector(`td img`)).toBeNull()
      expect(document.querySelector(`td a[href]`)).toBeNull()
      expect(document.body.textContent).toContain(
        `<img src=x onerror=alert(1)>`,
      )
    })

    test.each([
      { desc: `javascript URL`, href: () => `javascript:alert(1)` },
      {
        desc: `data URL`,
        href: () => `data:text/html,<script>alert(1)</script>`,
      },
      { desc: `vbscript URL`, href: () => `vbscript:msgbox("xss")` },
    ])(`renders plain ID when entry_href returns unsafe $desc`, ({ href }) => {
      mount_table_with_single_entry({ entry_id: `mp-unsafe` }, {
        entry_href: href,
      })

      expect(document.querySelector(`td a[href]`)).toBeNull()
      expect(document.body.textContent).toContain(`mp-unsafe`)
    })
  })

  describe(`formula_filter (polymorphs dropdown)`, () => {
    test(`hidden when no polymorphs but table-filters visible`, () => {
      // Ternary entry → max_n_el > 2 → table-filters renders,
      // but unique compositions → no Polymorphs dropdown
      mount_stats({
        stable_entries: [
          mock_entry({
            composition: { Li: 1, Fe: 1, O: 2 },
            reduced_formula: `LiFeO2`,
            entry_id: `a`,
          }),
          mock_entry({
            composition: { Fe: 1, O: 1 },
            reduced_formula: `FeO`,
            entry_id: `b`,
          }),
        ],
      })
      switch_to_table()
      expect(document.querySelector(`.table-filters`)).not.toBeNull()
      expect(document.body.textContent).not.toContain(`Polymorphs`)
    })

    test(`appears with correct options when polymorphs exist`, () => {
      mount_stats_table({ stable_entries: polymorph_entries })

      const poly_select = get_polymorph_select()
      expect(poly_select).not.toBeNull()
      if (!poly_select) return

      const options = Array.from(poly_select.options).map((opt) =>
        opt.textContent?.trim()
      )
      expect(options[0]).toBe(`all`)
      // Fe2O3 has 2 polymorphs → option shows count
      expect(options.some((opt) => opt?.includes(`2`))).toBe(true)
      // Li2O has only 1 entry → not in dropdown
      expect(options.some((opt) => opt?.includes(`Li`))).toBe(false)
    })

    test(`ignores invalid polymorph filter values`, () => {
      mount_stats_table({ stable_entries: polymorph_entries })

      const poly_select = get_polymorph_select()
      expect(poly_select).not.toBeNull()
      if (!poly_select) return

      const first_polymorph_option = Array.from(poly_select.options).find((
        option,
      ) => option.value !== ``)
      expect(first_polymorph_option).toBeDefined()
      if (!first_polymorph_option) return

      set_select_value(poly_select, first_polymorph_option.value)
      expect(poly_select.value).toBe(first_polymorph_option.value)
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)

      const invalid_option = document.createElement(`option`)
      invalid_option.value = `nonexistent-formula`
      invalid_option.textContent = `invalid`
      poly_select.append(invalid_option)
      set_select_value(poly_select, invalid_option.value)

      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)
    })
  })

  describe(`subsystem_coverage`, () => {
    test(`shows subsystem coverage chips with correct pair counts`, () => {
      mount_stats({
        phase_stats: mock_stats({ chemical_system: `Li-Fe-O` }),
        stable_entries: [
          mock_entry({
            composition: { Li: 1, Fe: 1 },
            reduced_formula: `LiFe`,
          }),
          mock_entry({ composition: { Fe: 1, O: 1 }, reduced_formula: `FeO` }),
        ],
      })
      const header = doc_query(`[data-testid="pd-binary-subsystem-coverage"]`)
      expect(header.textContent).toContain(
        `Binary subsystem coverage (3 pairs)`,
      )
      const chips = Array.from(document.querySelectorAll(`.subsystem-chip`))
      expect(chips).toHaveLength(3)
      const chip_text = chips.map((chip) => chip.textContent?.trim())
      expect(chip_text).toContain(`Fe-Li 1`)
      expect(chip_text).toContain(`Fe-O 1`)
      expect(chip_text).toContain(`Li-O 0`)
    })

    test(`ternary entry line includes all 3 pairs`, () => {
      // A single LiFeO2 entry should increment Li-Fe, Fe-O, and Li-O
      mount_stats({
        phase_stats: mock_stats({ chemical_system: `Li-Fe-O` }),
        stable_entries: [
          mock_entry({
            composition: { Li: 1, Fe: 1, O: 2 },
            reduced_formula: `LiFeO2`,
          }),
        ],
      })
      const chip_text = Array.from(document.querySelectorAll(`.subsystem-chip`))
        .map((chip) => chip.textContent?.trim())
      expect(chip_text).toContain(`Fe-Li 1`)
      expect(chip_text).toContain(`Fe-O 1`)
      expect(chip_text).toContain(`Li-O 1`)
    })

    test(`quaternary system line includes 6 pairs`, () => {
      mount_stats({
        phase_stats: mock_stats({ chemical_system: `Li-Fe-P-O` }),
        stable_entries: [mock_entry()],
      })
      expect(document.querySelectorAll(`.subsystem-chip`)).toHaveLength(6)
    })

    test.each([
      { desc: `binary`, system: `Fe-O` },
      { desc: `null phase_stats`, system: null },
    ])(`hidden for $desc system`, ({ system }) => {
      mount_stats({
        phase_stats: system ? mock_stats({ chemical_system: system }) : null,
        stable_entries: system ? [mock_entry({ composition: { Fe: 1, O: 1 } })] : [],
      })
      expect(
        document.querySelector(`[data-testid="pd-binary-subsystem-coverage"]`),
      )
        .toBeNull()
    })
  })
})

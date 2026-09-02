import { ConvexHullStats } from '$lib/convex-hull'
import type { ConvexHullEntry, PhaseStats } from '$lib/convex-hull/types'
import { flushSync, mount } from 'svelte'
import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import { doc_query, mock_object_url } from '../setup'

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
  e_form_range: { min: -2.5, max: 0.5, avg: -0.8 },
  hull_distance: { max: 0.4, avg: 0.12 },
  max_arity: 4,
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
  ...overrides,
})

type Props = {
  phase_stats: PhaseStats | null
  stable_entries: ConvexHullEntry[]
  unstable_entries: ConvexHullEntry[]
  show_stable?: boolean
  show_unstable?: boolean
  hidden_categories?: string[]
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
const normalize_formula_text = (text: string): string => text.replaceAll(/\s+/g, ` `).trim()
const get_table_filter_select = (label_text: string): HTMLSelectElement | null => {
  const filter_labels = Array.from(document.querySelectorAll(`.table-filters label`))
  const matching_label = filter_labels.find((label_element) =>
    label_element.textContent?.includes(label_text),
  )
  return (matching_label?.querySelector(`select`) as HTMLSelectElement | null) ?? null
}
// Svelte's select binding reads the chosen option via querySelector(':checked'), which
// happy-dom doesn't match on <option> (the binding would stick on the first option)
const set_select_value = (select_element: HTMLSelectElement, value: string) => {
  select_element.value = value
  vi.spyOn(select_element, `querySelector`).mockImplementation(
    () => select_element.selectedOptions[0],
  )
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
  const get_polymorph_select = (): HTMLSelectElement => {
    const select = get_table_filter_select(`Polymorphs`)
    if (!select) throw new Error(`Polymorphs select not rendered`)
    return select
  }

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
    for (const [type, count] of [
      [`Unary`, 4],
      [`Binary`, 20],
      [`Ternary`, 50],
      [`Quaternary`, 26],
    ] as const) {
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
        e_form_range: { min: -2.567, max: 0.123, avg: -1.234 },
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

  test(`renders flat stat sections without card chrome or copy controls`, () => {
    mount_stats()
    expect(document.querySelector(`.copy-button`)).toBeNull()
    expect(
      Array.from(document.querySelectorAll(`.info-card, .subsystem-coverage`), (element) =>
        element.textContent?.trim(),
      ),
    ).toEqual([
      expect.stringContaining(`Total entries in Li-Fe-P-O`),
      expect.stringContaining(`Binary subsystem coverage`),
      expect.stringContaining(`Stability`),
      expect.stringContaining(`Eform distribution`),
      expect.stringContaining(`Eabove hull distribution`),
    ])
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
    expect(doc_query(`.convex-hull-stats`).querySelectorAll(`.info-row`)).toHaveLength(0)
  })

  // One histogram per energy distribution with finite data: E_form and E_above_hull;
  // NaN/Infinity are dropped, and an absolute energy_per_atom is NOT a formation energy
  test.each([
    { desc: `E_form and E_hull`, entries: [{}], n_histograms: 2 },
    {
      desc: `energy_per_atom only (not a formation energy → E_hull histogram alone)`,
      entries: [{ e_form_per_atom: undefined, energy_per_atom: -0.3, e_above_hull: 0.1 }],
      n_histograms: 1,
    },
    {
      desc: `missing energies (E_hull only)`,
      entries: [{ e_form_per_atom: undefined, energy_per_atom: undefined }],
      n_histograms: 1,
    },
    {
      desc: `non-finite energies`,
      entries: [
        { e_form_per_atom: NaN, e_above_hull: Infinity },
        { e_form_per_atom: Infinity, e_above_hull: NaN },
      ],
      n_histograms: 0,
    },
  ] as { desc: string; entries: Partial<ConvexHullEntry>[]; n_histograms: number }[])(
    `renders $n_histograms histogram(s) for entries with $desc`,
    ({ entries, n_histograms }) => {
      mount_stats({ stable_entries: entries.map(mock_entry) })
      expect(document.querySelectorAll(`.histogram`)).toHaveLength(n_histograms)
    },
  )

  test(`zero totals does not produce NaN in percentages`, () => {
    mount_stats({
      phase_stats: mock_stats({ total: 0, stable: 0, unstable: 0 }),
      stable_entries: [],
    })
    const text = document.body.textContent ?? ``
    expect(text).not.toContain(`NaN`)
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

    test(`view toggle keeps both panels mounted while switching visibility`, () => {
      mount_stats({ stable_entries: stable, unstable_entries: unstable })
      expect(document.querySelector(`.info-row`)).toBeInstanceOf(HTMLElement)
      expect(document.querySelector(`.table-container`)).toBeInstanceOf(HTMLElement)
      const [stats_btn, table_btn] = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`.view-toggle button`),
      )
      const panels = Array.from(document.querySelectorAll<HTMLElement>(`.view-panel`))
      const panel_states = () =>
        panels.map((panel) => [
          panel.getAttribute(`aria-hidden`),
          panel.hasAttribute(`inert`),
          getComputedStyle(panel).visibility === `hidden`,
        ])
      const expect_visible_panel = (active_idx: number) =>
        expect(panel_states()).toEqual(
          panels.map((_, panel_idx) =>
            panel_idx === active_idx ? [`false`, false, false] : [`true`, true, true],
          ),
        )
      expect_visible_panel(0)

      table_btn.click()
      flushSync()
      expect_visible_panel(1)

      stats_btn.click()
      flushSync()
      expect_visible_panel(0)
    })

    test(`table lists every visible entry: numbered rows, subscripted formulas, bold stable ones`, () => {
      mount_stats_table({ stable_entries: stable, unstable_entries: unstable })

      const rows = Array.from(document.querySelectorAll(`tbody tr`))
      expect(rows).toHaveLength(4)
      expect(doc_query(`.filter-count`).textContent?.trim()).toBe(`4 entries`)
      const headers = get_headers()
      expect(headers).toEqual(expect.arrayContaining([`#`, `Formula`]))
      expect(headers.length).toBeGreaterThanOrEqual(6)
      // Row numbers start at 1
      expect(rows[0].querySelectorAll(`td`)[headers.indexOf(`#`)].textContent?.trim()).toBe(
        `1`,
      )
      const formula_cells = rows.map(
        (row) => row.querySelectorAll(`td`)[headers.indexOf(`Formula`)],
      )
      const formula_texts = formula_cells.map((cell) =>
        normalize_formula_text(cell.textContent ?? ``),
      )
      for (const pattern of [/^Li$/, /Fe.*O.*3/, /Li.*Fe.*O.*2/, /Li.*2.*O/]) {
        expect(formula_texts.some((formula) => pattern.test(formula))).toBe(true)
      }
      // Stoichiometry renders as <sub>, the two stable formulas are bold
      expect(formula_cells.some((cell) => cell.innerHTML.includes(`<sub>`))).toBe(true)
      expect(formula_cells.filter((cell) => cell.innerHTML.includes(`<strong>`))).toHaveLength(
        2,
      )
    })

    test(`table excludes hidden entry groups`, () => {
      const hidden_group_entry = mock_entry({
        composition: { Zr: 1 },
        reduced_formula: `Zr`,
      })
      mount_stats_table({
        stable_entries: stable,
        unstable_entries: [hidden_group_entry],
        show_unstable: false,
      })

      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(2)
      const cells = Array.from(document.querySelectorAll(`td`)).map((td) =>
        td.textContent?.trim(),
      )
      expect(cells).not.toContain(`Zr`)
    })

    test(`table excludes entries with hidden magnetic orderings`, () => {
      mount_stats_table({
        stable_entries: [
          mock_entry({ magnetic_ordering: `FM`, entry_id: `id-fm`, reduced_formula: `FeO` }),
          // oxfmt-ignore
          mock_entry({ magnetic_ordering: `AFM`, entry_id: `id-afm`, reduced_formula: `Fe2O3` }),
        ],
        // no ordering -> unaffected by category filter
        unstable_entries: [mock_entry({ entry_id: `id-plain`, reduced_formula: `Fe3O4` })],
        hidden_categories: [`FM`],
      })
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(2)
      const table_text = doc_query(`tbody`).textContent ?? ``
      expect(table_text).not.toContain(`id-fm`)
      expect(table_text).toContain(`id-afm`)
      expect(table_text).toContain(`id-plain`)
      expect(doc_query(`.filter-count`).textContent).toContain(`2 entries`)
    })

    // Optional columns only render when some entry carries the field
    test.each([
      { header: `raw`, entry: { energy_per_atom: -5.2 }, cell: `−5.2` },
      { header: `raw`, entry: { energy_per_atom: undefined }, cell: null },
      { header: `ID`, entry: { entry_id: `mp-1234` }, cell: `mp-1234` },
      { header: `ID`, entry: { entry_id: undefined }, cell: null },
    ] as { header: string; entry: Partial<ConvexHullEntry>; cell: string | null }[])(
      `$header column for $entry → $cell`,
      ({ header, entry, cell }) => {
        mount_table_with_single_entry({ reduced_formula: `LiFeO2`, ...entry })
        expect(get_headers().some((text) => text?.includes(header))).toBe(cell !== null)
        if (cell) expect(document.body.textContent).toContain(cell)
      },
    )

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
      const formula_cell = document.querySelector(`tbody tr td:nth-child(${formula_idx + 1})`)
      expect(formula_cell?.innerHTML.replaceAll(/\s+/g, ` `)).toContain(`Ca Ti O<sub>3</sub>`)
    })

    test.each([
      `Fe<sub>2</sub>O<sub>3</sub>`,
      `Fe&amp;lt;sub&amp;gt;2&amp;lt;/sub&amp;gt;O&amp;lt;sub&amp;gt;3&amp;lt;/sub&amp;gt;`,
    ])(`preserves stoichiometry in marked-up formula %s`, (reduced_formula) => {
      mount_stats_table({
        stable_entries: [mock_entry({ composition: { Fe: 2, O: 3 }, reduced_formula })],
        unstable_entries: [],
      })
      const formula_idx = get_headers().indexOf(`Formula`)
      const formula_cell = document.querySelector(`tbody tr td:nth-child(${formula_idx + 1})`)
      expect(normalize_formula_text(formula_cell?.textContent ?? ``)).toMatch(
        /Fe.*2.*O.*3|O.*3.*Fe.*2/,
      )
    })

    test(`on_entry_click receives the clicked row's entry after sorting reorders rows`, () => {
      const clicked: ConvexHullEntry[] = []
      mount_stats_table({
        stable_entries: [],
        unstable_entries: unstable, // LiFeO2 (0.15) before Li2O (0.05) in the input
        on_entry_click: (entry: ConvexHullEntry) => clicked.push(entry),
      })

      doc_query(`tbody tr`).click() // first row under the default E_hull ascending sort
      flushSync()
      expect(clicked.map((entry) => entry.reduced_formula)).toEqual([`Li2O`])
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
      expect(document.querySelector(`.info-row`)).toBeInstanceOf(HTMLElement)
      expect(document.querySelector(`.table-container`)).toBeInstanceOf(HTMLElement)
      expect(document.querySelector(`.side-by-side`)).toBeInstanceOf(HTMLElement)
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
      const binary = mock_entry({
        composition: { Fe: 1, O: 1 },
        reduced_formula: `FeO`,
      })

      mount_stats_table({ stable_entries: [ternary, binary] })
      expect(get_table_filter_select(`Min N`)).toBeInstanceOf(HTMLElement)

      document.body.innerHTML = ``
      mount_stats_table({ stable_entries: [binary] })
      // With only binary entries, max_n_el ≤ 2 so no min N_el filter shown
      expect(get_table_filter_select(`Min N`)).toBeNull()
      // Export controls (HeatmapTable built-in) should still be available without filters
      expect(
        document.querySelector(`.table-container .dropdown-wrapper .icon-btn`),
      ).toBeInstanceOf(HTMLElement)
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
      { format: `CSV`, ext: `csv`, mime_type: `text/csv` },
      { format: `JSON`, ext: `json`, mime_type: `application/json` },
    ])(`exports $format via dropdown and closes menu`, ({ format, ext, mime_type }) => {
      const { create, revoke } = mock_object_url()
      let downloaded_as = ``
      // download() clicks a detached anchor; capture filename from the click target
      const anchor_click = vi
        .spyOn(HTMLAnchorElement.prototype, `click`)
        .mockImplementation(function (this: HTMLAnchorElement) {
          downloaded_as = this.download
        })
      onTestFinished(() => anchor_click.mockRestore())
      mount_stats_table(export_props)
      doc_query(`.table-container .dropdown-wrapper .icon-btn`).click()
      flushSync()

      const options = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`.dropdown-pane .dropdown-option`),
      )
      options.find((el) => el.textContent?.includes(format))?.click()
      flushSync()

      expect(document.querySelector(`.dropdown-pane`)).toBeNull()
      expect(create).toHaveBeenCalledTimes(1)
      expect((create.mock.calls[0][0] as Blob).type).toBe(mime_type)
      expect(anchor_click).toHaveBeenCalledTimes(1)
      expect(revoke).toHaveBeenCalledTimes(1)
      expect(downloaded_as).toBe(`li-fe-p-o.${ext}`)
    })
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
    const make_entry_with_id = (entry_id: string, data?: Record<string, unknown>) =>
      mock_entry({
        entry_id,
        reduced_formula: `LiFeO2`,
        data: data as Record<string, unknown>,
      })

    // happy-dom can't parse `color-mix()` CSS, so Svelte's `style={row.style}`
    // compiles to `element.style.cssText = value` which silently fails.
    // We detect highlighted rows by the style attribute being present (even if empty)
    // vs absent for non-highlighted rows.
    const get_rows_with_style = () =>
      Array.from(document.querySelectorAll(`tbody tr`)).filter(
        (row) => row.hasAttribute(`style`) && row.getAttribute(`style`) !== `null`,
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
    ])(`highlights row matching $desc`, ({ entries, highlight_id, expected_text }) => {
      mount_stats_table({
        stable_entries: entries(),
        unstable_entries: [],
        highlighted_entry_id: highlight_id,
      })

      const styled = get_rows_with_style()
      expect(styled).toHaveLength(1)
      expect(styled[0].textContent).toContain(expected_text)
    })

    test.each([
      { desc: `undefined`, highlight_id: undefined as string | undefined },
      { desc: `nonexistent`, highlight_id: `nonexistent` },
    ])(`no row highlighted when ID is $desc`, ({ highlight_id }) => {
      mount_stats_table({
        stable_entries: [make_entry_with_id(`mp-1`)],
        unstable_entries: [],
        highlighted_entry_id: highlight_id,
      })
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
      return Array.from(document.querySelectorAll(`tbody tr`)).map(
        (row) => row.querySelectorAll(`td`)[poly_idx]?.textContent?.trim() ?? ``,
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
      mount_stats_table({
        stable_entries: [target_entry],
        unstable_entries: [],
        entry_href: (entry: ConvexHullEntry) => {
          received_entries.push(entry)
          return `/materials/${entry.entry_id}`
        },
      })

      // Callback received the correct entry
      expect(received_entries.length).toBeGreaterThanOrEqual(1)
      expect(received_entries[0].entry_id).toBe(`mp-123`)

      const link = doc_query(`td a[href]`)
      expect(link.getAttribute(`href`)).toBe(`/materials/mp-123`)
      expect(link.textContent).toBe(`mp-123`)
      expect(link.getAttribute(`target`)).toBe(`_blank`)
      expect(link.getAttribute(`rel`)).toBe(`noopener`)
    })

    // The ID is rendered as escaped text (never markup); a link only for safe, non-null hrefs
    const xss_id = `<img src=x onerror=alert(1)>`
    test.each([
      { desc: `entry_href returns null`, entry_id: `mp-456`, href: () => null, link: null },
      { desc: `entry_href not provided`, entry_id: `mp-456`, href: undefined, link: null },
      {
        desc: `javascript URL`,
        entry_id: `mp-unsafe`,
        href: () => `javascript:alert(1)`,
        link: null,
      },
      {
        desc: `data URL`,
        entry_id: `mp-unsafe`,
        href: () => `data:text/html,<script>alert(1)</script>`,
        link: null,
      },
      {
        desc: `vbscript URL`,
        entry_id: `mp-unsafe`,
        href: () => `vbscript:msgbox("xss")`,
        link: null,
      },
      {
        desc: `HTML in entry_id, linked`,
        entry_id: xss_id,
        href: () => `/materials/test`,
        link: `/materials/test`,
      },
      { desc: `HTML in entry_id, unlinked`, entry_id: xss_id, href: undefined, link: null },
    ])(`$desc → link=$link`, ({ entry_id, href, link }) => {
      mount_table_with_single_entry({ entry_id }, { entry_href: href })
      expect(document.querySelector(`td img`)).toBeNull()
      expect(document.querySelector(`td a[href]`)?.getAttribute(`href`) ?? null).toBe(link)
      expect(document.body.textContent).toContain(entry_id)
    })
  })

  describe(`formula_filter (polymorphs dropdown)`, () => {
    test(`hidden when no polymorphs but table-filters visible`, () => {
      // Ternary entry → max_n_el > 2 → table-filters renders,
      // but unique compositions → no Polymorphs dropdown
      mount_stats_table({
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
      expect(document.querySelector(`.table-filters`)).toBeInstanceOf(HTMLElement)
      expect(document.body.textContent).not.toContain(`Polymorphs`)
    })

    test(`lists only polymorph groups with counts; selecting one filters the table, an invalid value shows all`, () => {
      mount_stats_table({ stable_entries: polymorph_entries })

      const poly_select = get_polymorph_select()
      // Li2O has only 1 entry → not in dropdown
      expect(
        Array.from(poly_select.options).map((opt) => [opt.value, opt.textContent?.trim()]),
      ).toEqual([
        [``, `all`],
        [`Fe2O3`, `Fe2O3 (2)`],
      ])

      set_select_value(poly_select, `Fe2O3`)
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(2)
      expect(doc_query(`.filter-count`).textContent?.trim()).toBe(`2 entries`)
      expect(doc_query(`tbody`).textContent).not.toContain(`Li`)

      const invalid_option = document.createElement(`option`)
      invalid_option.value = `nonexistent-formula`
      invalid_option.textContent = `invalid`
      poly_select.append(invalid_option)
      set_select_value(poly_select, invalid_option.value)
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)
    })
  })

  describe(`subsystem_coverage`, () => {
    test.each([
      {
        desc: `binary entries count once per pair`,
        system: `Li-Fe-O`,
        compositions: [
          { Li: 1, Fe: 1 },
          { Fe: 1, O: 1 },
        ],
        chips: [`Fe-Li 1`, `Fe-O 1`, `Li-O 0`],
      },
      {
        desc: `a ternary entry increments all 3 pairs`,
        system: `Li-Fe-O`,
        compositions: [{ Li: 1, Fe: 1, O: 2 }],
        chips: [`Fe-Li 1`, `Fe-O 1`, `Li-O 1`],
      },
      {
        desc: `quaternary system has 6 pairs`,
        system: `Li-Fe-P-O`,
        compositions: [{ Li: 1, Fe: 1, P: 1, O: 4 }],
        chips: [`Fe-Li 1`, `Fe-O 1`, `Fe-P 1`, `Li-O 1`, `Li-P 1`, `O-P 1`],
      },
    ])(`$desc`, ({ system, compositions, chips }) => {
      mount_stats({
        phase_stats: mock_stats({ chemical_system: system }),
        stable_entries: compositions.map((composition) => mock_entry({ composition })),
      })
      const header = doc_query(`[data-testid="pd-binary-subsystem-coverage"]`)
      expect(header.textContent).toContain(`Binary subsystem coverage (${chips.length} pairs)`)
      expect(header.querySelector(`.copy-button`)).toBeNull()
      const chip_text = Array.from(document.querySelectorAll(`.subsystem-chip`), (chip) =>
        chip.textContent?.trim(),
      )
      expect(chip_text.toSorted()).toEqual(chips)
    })

    test.each([
      { desc: `binary`, system: `Fe-O` },
      { desc: `null phase_stats`, system: null },
    ])(`hidden for $desc system`, ({ system }) => {
      mount_stats({
        phase_stats: system ? mock_stats({ chemical_system: system }) : null,
        stable_entries: system ? [mock_entry({ composition: { Fe: 1, O: 1 } })] : [],
      })
      expect(document.querySelector(`.subsystem-coverage`)).toBeNull()
    })
  })
})

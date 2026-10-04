import ConvexHullStats from '#lib/convex-hull/ConvexHullStats.svelte'
import ConvexHullInfoPane from '#lib/convex-hull/ConvexHullInfoPane.svelte'
import type { ConvexHullEntry, PhaseStats } from '#lib/convex-hull/types.js'
import { flushSync, mount, type ComponentProps } from 'svelte'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { doc_query, mock_object_url, set_select } from '../setup'

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

type Props = Omit<ComponentProps<typeof ConvexHullStats>, `model`> & {
  phase_stats: PhaseStats | null
  stable_entries: ConvexHullEntry[]
  unstable_entries: ConvexHullEntry[]
}
const mount_stats = ({
  phase_stats = mock_stats(),
  stable_entries = [],
  unstable_entries = [],
  ...props
}: Partial<Props> = {}) =>
  mount(ConvexHullStats, {
    target: document.body,
    props: {
      model: {
        phase_stats,
        entries: [
          ...stable_entries.map((entry) => ({ ...entry, is_stable: true })),
          ...unstable_entries.map((entry) => ({ ...entry, is_stable: false })),
        ],
      },
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
  Array.from(document.querySelectorAll(`th`)).map((header_cell) =>
    header_cell.textContent?.trim(),
  )
const normalize_text = (text: string): string => text.replaceAll(/\s+/g, ` `).trim()
const get_table_filter_select = (label_text: string): HTMLSelectElement | null => {
  const filter_labels = Array.from(document.querySelectorAll(`.table-filters label`))
  const matching_label = filter_labels.find((label_element) =>
    label_element.textContent?.includes(label_text),
  )
  return (matching_label?.querySelector(`select`) as HTMLSelectElement | null) ?? null
}
const mount_table_with_single_entry = (
  entry_overrides: Partial<ConvexHullEntry>,
  prop_overrides: Partial<Props> = {},
) => {
  mount_stats_table({
    stable_entries: [mock_entry({ reduced_formula: `Fe`, ...entry_overrides })],
    ...prop_overrides,
  })
}

describe(`ConvexHullStats`, () => {
  const get_polymorph_select = (): HTMLSelectElement => {
    const select = get_table_filter_select(`Polymorphs`)
    if (!select) throw new Error(`Polymorphs select not rendered`)
    return select
  }

  test(`renders the Stats/Table toggle, chemical system, stability and energy stats`, () => {
    mount_stats({
      phase_stats: mock_stats({
        total: 150,
        stable: 25,
        unstable: 125,
        e_form_range: { min: -2.567, max: 0.123, avg: -1.234 },
        hull_distance: { max: 0.456, avg: 0.089 },
      }),
    })
    const buttons = document.querySelectorAll(`.view-toggle button`)
    expect(Array.from(buttons, (btn) => btn.textContent?.trim())).toEqual([`Stats`, `Table`])
    expect(buttons[0].classList.contains(`active`)).toBe(true)
    const text = normalize_text(document.body.textContent ?? ``)
    for (const snippet of [
      `Total entries in Li-Fe-P-O 150`,
      `Stable phases 25 (16.7%)`,
      `Binary phases 20 (13.3%)`,
      `Min / avg / max (eV/atom) −2.567 / −1.234 / 0.123`,
      `Max / avg (eV/atom) 0.456 / 0.089`,
    ]) {
      expect(text).toContain(snippet)
    }
  })

  // arity rows show when their count is non-zero or they fit the system's max arity
  test.each([
    {
      max_arity: 4,
      shown: [`Unary`, `Binary`, `Ternary`, `Quaternary`],
      hidden: [`Quinary+`],
    },
    {
      max_arity: 2,
      ternary: 0,
      quaternary: 0,
      shown: [`Binary`],
      hidden: [`Ternary`, `Quaternary`],
    },
    { max_arity: 3, ternary: 10, quaternary: 0, shown: [`Ternary`], hidden: [`Quaternary`] },
    { max_arity: 4, quinary_plus: 5, shown: [`Quinary+`], hidden: [] },
  ])(`max_arity=$max_arity shows $shown phase rows`, ({ shown, hidden, ...overrides }) => {
    mount_stats({ phase_stats: mock_stats(overrides) })
    const text = document.body.textContent ?? ``
    for (const type of shown) expect(text).toContain(`${type} phases`)
    for (const type of hidden) expect(text).not.toContain(`${type} phases`)
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
    })
    const text = document.body.textContent ?? ``
    expect(text).not.toContain(`NaN`)
  })

  // A closed pane stays mounted but hidden; its stats rebuilt the entry table on every
  // points-threshold step of a slider drag nobody could see
  test.each([false, true])(
    `the hull info pane mounts its stats only while open=%s`,
    (open) => {
      mount(ConvexHullInfoPane, {
        target: document.body,
        props: {
          phase_stats: mock_stats(),
          stable_entries: [mock_entry({ is_stable: true, e_above_hull: 0 })],
          unstable_entries: [mock_entry()],
          max_hull_dist_show_phases: 0.1,
          max_hull_dist_show_labels: 0.1,
          label_threshold: 50,
          pane_open: open,
        },
      })
      flushSync()
      expect(document.querySelectorAll(`.convex-hull-stats`)).toHaveLength(open ? 1 : 0)
    },
  )

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
      // a synthetic corner only closes the hull, so the table leaves it out
      const corner = mock_entry({ composition: { O: 1 }, is_synthetic: true })
      mount_stats_table({ stable_entries: [...stable, corner], unstable_entries: unstable })

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
      const formula_texts = formula_cells.map((cell) => normalize_text(cell.textContent ?? ``))
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
      const cells = Array.from(document.querySelectorAll(`td`)).map((cell) =>
        cell.textContent?.trim(),
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

    // Optional columns only render when some entry carries the field. Cells render once: an
    // absolute energy is not repeated in the E_form column (mislabelled as a formation energy)
    test.each([
      {
        header: `raw`,
        entry: { energy_per_atom: -5.2, e_form_per_atom: undefined },
        cell: `−5.2`,
      },
      { header: `raw`, entry: { energy_per_atom: undefined }, cell: null },
      { header: `ID`, entry: { entry_id: `mp-1234` }, cell: `mp-1234` },
      { header: `ID`, entry: { entry_id: undefined }, cell: null },
    ] as { header: string; entry: Partial<ConvexHullEntry>; cell: string | null }[])(
      `$header column for $entry → $cell`,
      ({ header, entry, cell }) => {
        mount_table_with_single_entry({ reduced_formula: `LiFeO2`, ...entry })
        expect(get_headers().some((text) => text?.includes(header))).toBe(cell !== null)
        if (cell) expect(doc_query(`tbody`).textContent?.split(cell)).toHaveLength(2)
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
      })
      const formula_idx = get_headers().indexOf(`Formula`)
      const formula_cell = document.querySelector(`tbody tr td:nth-child(${formula_idx + 1})`)
      expect(normalize_text(formula_cell?.textContent ?? ``)).toMatch(
        /Fe.*2.*O.*3|O.*3.*Fe.*2/,
      )
    })

    test(`on_entry_click receives the clicked row's entry after sorting reorders rows`, () => {
      const clicked: ConvexHullEntry[] = []
      mount_stats_table({
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
    const binary = mock_entry({ composition: { Fe: 1, O: 1 }, reduced_formula: `FeO` })

    test(`Min N_el dropdown visible for ternary+ systems, hidden for binary-only`, () => {
      const ternary = mock_entry({
        composition: { Li: 1, Fe: 1, O: 2 },
        reduced_formula: `LiFeO2`,
      })

      mount_stats_table({ stable_entries: [ternary, binary] })
      expect(get_table_filter_select(`Min N`)).toBeInstanceOf(HTMLElement)
      // unique compositions → no Polymorphs dropdown even though the filter bar renders
      expect(get_table_filter_select(`Polymorphs`)).toBeNull()

      document.body.innerHTML = ``
      mount_stats_table({ stable_entries: [binary] })
      // With only binary entries, max_n_el ≤ 2 so no min N_el filter shown
      expect(get_table_filter_select(`Min N`)).toBeNull()
      // Export controls (HeatmapTable built-in) should still be available without filters
      expect(
        document.querySelector(`.table-container .dropdown-wrapper .icon-btn`),
      ).toBeInstanceOf(HTMLElement)
    })

    // Math.max(1, ...arities) threw RangeError past ~125k entries
    test(`dropdown options span the max arity of 200k entries without a spread overflow`, () => {
      const binaries = Array.from({ length: 200_000 }, () => binary)
      mount_stats_table({ stable_entries: [...binaries, mock_entry()] })
      const options = get_table_filter_select(`Min N`)?.options ?? []
      expect(Array.from(options, (opt) => opt.value)).toEqual([`1`, `2`, `3`, `4`])
    }, 15_000)
  })

  describe(`table export`, () => {
    const export_entry = mock_entry({
      entry_id: `mp-123`,
      reduced_formula: `Fe`,
    })
    const export_props = {
      phase_stats: mock_stats({ chemical_system: `Li-Fe-P-O` }),
      stable_entries: [export_entry],
    }

    test.each([
      { format: `CSV`, ext: `csv`, mime_type: `text/csv` },
      { format: `JSON`, ext: `json`, mime_type: `application/json` },
    ])(`exports $format via dropdown and closes menu`, async ({ format, ext, mime_type }) => {
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
      options.find((element) => element.textContent?.includes(format))?.click()
      await vi.waitFor(() => expect(document.querySelector(`.dropdown-pane`)).toBeNull())
      expect(create).toHaveBeenCalledTimes(1)
      expect((create.mock.calls[0][0] as Blob).type).toBe(mime_type)
      expect(anchor_click).toHaveBeenCalledTimes(1)
      expect(revoke).toHaveBeenCalledTimes(1)
      expect(downloaded_as).toBe(`li-fe-p-o.${ext}`)
    })
  })

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
      { desc: `no ID`, entries: () => [make_entry_with_id(`mp-1`)], expected_text: null },
      {
        desc: `a nonexistent ID`,
        entries: () => [make_entry_with_id(`mp-1`)],
        highlight_id: `nonexistent`,
        expected_text: null,
      },
    ])(`highlighted row for $desc`, ({ entries, highlight_id, expected_text }) => {
      mount_stats_table({ stable_entries: entries(), highlighted_entry_id: highlight_id })
      const styled = get_rows_with_style()
      expect(styled.map((row) => row.textContent)).toEqual(
        expected_text ? [expect.stringContaining(expected_text)] : [],
      )
    })
  })

  // Fe2O3 x2 (polymorphs) + Li2O x1 (unique)
  const polymorph_entries = [
    mock_entry({ composition: { Fe: 2, O: 3 }, reduced_formula: `Fe2O3-a`, entry_id: `a` }),
    mock_entry({ composition: { Fe: 2, O: 3 }, reduced_formula: `Fe2O3-b`, entry_id: `b` }),
    mock_entry({ composition: { Li: 2, O: 1 }, reduced_formula: `Li2O`, entry_id: `c` }),
  ]

  describe(`Poly column (polymorph counting)`, () => {
    const get_poly_values = () => {
      const poly_idx = get_headers().indexOf(`Poly`)
      return Array.from(document.querySelectorAll(`tbody tr`)).map(
        (row) => row.querySelectorAll(`td`)[poly_idx]?.textContent?.trim() ?? ``,
      )
    }

    test(`counts polymorphs per reduced formula (Fe4O6 groups with Fe2O3), 1 for unique`, () => {
      const fe4o6 = mock_entry({ composition: { Fe: 4, O: 6 }, reduced_formula: `Fe4O6` })
      mount_stats_table({ stable_entries: [...polymorph_entries, fe4o6] })
      expect(get_headers()).toContain(`Poly`)
      expect(get_poly_values().toSorted()).toEqual([`1`, `3`, `3`, `3`])
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
      [`entry_href returns null`, `mp-456`, () => null, null],
      [`entry_href not provided`, `mp-456`, undefined, null],
      [`javascript URL`, `mp-unsafe`, () => `javascript:alert(1)`, null],
      [`data URL`, `mp-unsafe`, () => `data:text/html,<script>alert(1)</script>`, null],
      [`vbscript URL`, `mp-unsafe`, () => `vbscript:msgbox("xss")`, null],
      [`HTML in entry_id, linked`, xss_id, () => `/materials/test`, `/materials/test`],
      [`HTML in entry_id, unlinked`, xss_id, undefined, null],
    ] as [string, string, (() => string | null) | undefined, string | null][])(
      `entry_href: %s`,
      (_desc, entry_id, href, link) => {
        mount_table_with_single_entry({ entry_id }, { entry_href: href })
        expect(document.querySelector(`td img`)).toBeNull()
        expect(document.querySelector(`td a[href]`)?.getAttribute(`href`) ?? null).toBe(link)
        expect(document.body.textContent).toContain(entry_id)
      },
    )
  })

  describe(`formula_filter (polymorphs dropdown)`, () => {
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

      set_select(poly_select, `Fe2O3`)
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(2)
      expect(doc_query(`.filter-count`).textContent?.trim()).toBe(`2 entries`)
      expect(doc_query(`tbody`).textContent).not.toContain(`Li`)

      const invalid_option = document.createElement(`option`)
      invalid_option.value = `nonexistent-formula`
      invalid_option.textContent = `invalid`
      poly_select.append(invalid_option)
      set_select(poly_select, invalid_option.value)
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
      if (!system) expect(document.querySelectorAll(`.info-row`)).toHaveLength(0)
    })
  })
})

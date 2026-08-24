import { StructureInfoPane } from '$lib'
import { info_pane_icon } from '$lib/overlays'
import type { Vec3 } from '$lib/math'
import type { SymmetryDataset, WyckoffPos } from '$lib/symmetry'
import type { ComponentProps } from 'svelte'
import { mount, tick } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, get_dummy_structure, make_wyckoff_dataset } from '../setup'

describe(`StructureInfoPane`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  const mount_info_pane = (props: ComponentProps<typeof StructureInfoPane>) =>
    mount(StructureInfoPane, { target: document.body, props })

  const make_sym_data = (position_count = 1): SymmetryDataset => {
    const positions = Array.from({ length: position_count }, (): [number, number, number] => [
      0, 0, 0,
    ])
    const numbers = Array<number>(position_count).fill(1)
    return {
      ...make_wyckoff_dataset(positions, numbers, Array<null>(position_count).fill(null)),
      number: 227,
      hm_symbol: `F d -3 m`,
      hall_number: 523,
      pearson_symbol: `cF4`,
      operations: [
        {
          rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          translation: [0, 0, 0],
        },
      ],
      std_cell: {
        lattice: { basis: [5, 0, 0, 0, 5, 0, 0, 0, 5] },
        positions,
        numbers,
      },
    }
  }

  // One single-site Wyckoff row per atom, so row and card counts track atom_count together
  const rows_per_site = (atom_count: number): WyckoffPos[] =>
    Array.from({ length: atom_count }, (_, idx) => ({
      wyckoff: `1a`,
      elem: `H`,
      abc: [0, 0, 0],
      site_indices: [idx],
    }))

  test.each([
    [`small`, 1, true],
    [`collapsed_with_toggle`, 50, false],
    [`upper_bound_collapsed`, 500, false],
  ] as const)(
    `site list and symmetry table threshold behavior: %s`,
    async (_scenario_name, atom_count, expanded_by_default) => {
      const structure = get_dummy_structure(`H`, atom_count, true)
      mount_info_pane({
        structure,
        pane_open: true,
        sym_data: make_sym_data(atom_count),
        wyckoff_positions: rows_per_site(atom_count),
      })

      const content = document.body.textContent || ``
      expect(content).toContain(`(${atom_count} sites)`)
      const sites = doc_query<HTMLDetailsElement>(`.sites`)
      expect(sites.open).toBe(expanded_by_default)
      // site cards page at 100, Wyckoff rows do not
      const default_row_count = expanded_by_default ? atom_count : 0
      expect(document.querySelectorAll(`.site-card`)).toHaveLength(
        Math.min(default_row_count, 100),
      )

      const wyckoff = doc_query<HTMLDetailsElement>(`.wyckoff`)
      expect(wyckoff.open).toBe(expanded_by_default)
      const wyckoff_rows = () => document.querySelectorAll(`.wyckoff-row`)
      expect(wyckoff_rows()).toHaveLength(default_row_count)

      wyckoff.querySelector(`summary`)?.click()
      await tick()
      expect(wyckoff_rows()).toHaveLength(atom_count - default_row_count)

      sites.querySelector(`summary`)?.click()
      await tick()
      expect(sites.open).toBe(!expanded_by_default)
      expect(document.querySelectorAll(`.site-card`)).toHaveLength(
        expanded_by_default ? 0 : Math.min(atom_count, 100),
      )
    },
  )

  // The pane must highlight whatever site indices its rows carry, which the session has
  // already re-expressed onto the displayed (conventional/primitive/supercell) structure — it
  // must not recompute rows from sym_data, whose indices address the analyzed cell only
  test(`Wyckoff row hover and click forward the row's (displayed) site indices`, async () => {
    const state = { highlighted_sites: [] as number[], selected_sites: [] as number[] }
    mount_info_pane(
      bind_props(
        {
          structure: get_dummy_structure(`H`, 2, true),
          pane_open: true,
          sym_data: make_sym_data(2),
          wyckoff_positions: [
            { wyckoff: `8c`, elem: `H`, abc: [0, 0, 0] as Vec3, site_indices: [3, 5, 9] },
          ],
        },
        state,
      ),
    )
    const row = doc_query<HTMLTableRowElement>(`.wyckoff-row`)
    expect(row.textContent).toContain(`8c`)
    row.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
    expect(state.highlighted_sites).toEqual([3, 5, 9])
    row.click()
    await tick()
    expect(state.selected_sites).toEqual([3, 5, 9])
    row.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
    expect(state.highlighted_sites).toEqual([])
  })

  // Closed pane stays mounted (display:none); site cards must not rebuild while closed.
  test.each([
    [false, 0],
    [true, 3],
  ])(`pane_open=%s renders %i site cards`, (pane_open, n_cards) => {
    mount_info_pane({ structure: get_dummy_structure(`H`, 3, true), pane_open })
    expect(document.querySelectorAll(`.site-card`)).toHaveLength(n_cards)
  })

  // Tips stay in the DOM even when closed; must match Structure.svelte Ctrl/Cmd handlers.
  test(`Keyboard tip documents Ctrl/Cmd for f/i and plain r`, () => {
    mount_info_pane({ structure: get_dummy_structure(`H`, 1, true), pane_open: false })
    expect(document.body.textContent).toContain(
      `Press Ctrl/Cmd+f for fullscreen, Ctrl/Cmd+i to toggle this pane, r to reset the view`,
    )
    expect(document.querySelector(`.structure-info-toggle path`)?.getAttribute(`d`)).toBe(
      info_pane_icon.d,
    )
  })

  test(`omits sites section entirely above max threshold`, () => {
    const structure = get_dummy_structure(`H`, 600, true)
    mount_info_pane({ structure, pane_open: true })

    const content = document.body.textContent || ``
    expect(content).not.toContain(`Frac.`)
    expect(content).not.toContain(`Cart.`)
    expect(document.querySelector(`.sites`)).toBeNull()
  })

  // `atom_count_thresholds` = [expanded_below, listed_up_to]: the defaults (50, 500) can be
  // raised so a large structure still lists its sites, or lowered to collapse small ones
  test.each<[number, [number, number] | undefined, boolean, boolean]>([
    // [atom_count, thresholds, list rendered?, expanded by default?]
    [600, undefined, false, false],
    [600, [50, 1000], true, false],
    [600, [1000, 1000], true, true],
    [30, undefined, true, true],
    [30, [10, 20], false, false],
    [30, [10, 100], true, false],
  ])(
    `%i sites with atom_count_thresholds=%j lists sites: %s, expanded: %s`,
    (atom_count, atom_count_thresholds, listed, expanded) => {
      const structure = get_dummy_structure(`H`, atom_count, true)
      mount_info_pane({ structure, pane_open: true, atom_count_thresholds })
      const sites = document.querySelector<HTMLDetailsElement>(`.sites`)
      expect(sites !== null).toBe(listed)
      expect(sites?.open ?? false).toBe(expanded)
      expect(document.querySelectorAll(`.site-card`).length > 0).toBe(expanded)
    },
  )

  test(`site cards hover, filter, select, copy, and keyboard navigate`, async () => {
    const structure = get_dummy_structure(`H`, 3, true)
    const state = {
      highlighted_sites: [] as number[],
      hovered_site_idx: null as number | null,
      selected_sites: [] as number[],
    }
    const clipboard_spy = vi.spyOn(navigator.clipboard, `writeText`).mockResolvedValue()

    try {
      mount_info_pane(
        bind_props(
          {
            structure,
            pane_open: true,
          },
          state,
        ),
      )
      const site_cards = () => Array.from(document.querySelectorAll<HTMLElement>(`.site-card`))
      expect(site_cards()).toHaveLength(3)
      expect(site_cards()[0].textContent).toContain(`Frac.`)
      expect(site_cards()[0].textContent).toContain(`Cart.`)
      expect(document.querySelector(`.site-color`)).toBeNull()

      const site_row = site_cards()[1]
      expect(site_row).toBeInstanceOf(HTMLElement)
      site_row.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
      expect(state.highlighted_sites).toEqual([1])
      expect(state.hovered_site_idx).toBe(1)
      site_row.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
      expect(state.highlighted_sites).toEqual([])
      expect(state.hovered_site_idx).toBeNull()

      const filter_input = document.querySelector(`input.info-filter`) as HTMLInputElement
      filter_input.value = `H2`
      filter_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()

      expect(site_cards()).toHaveLength(1)
      expect(site_cards()[0].textContent).toContain(`H2`)

      site_cards()[0].click()
      expect(state.selected_sites).toEqual([1])

      site_cards()[0].dispatchEvent(new KeyboardEvent(`keydown`, { key: `c`, bubbles: true }))
      expect(clipboard_spy).toHaveBeenCalledWith(expect.stringContaining(`Hydrogen`))

      filter_input.value = ``
      filter_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()

      site_cards()[0].focus()
      site_cards()[0].dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `ArrowDown`, bubbles: true }),
      )
      expect(document.activeElement).toBe(site_cards()[1])
    } finally {
      clipboard_spy.mockRestore()
    }
  })

  test(`windows large expanded site lists`, async () => {
    const structure = get_dummy_structure(`H`, 120, true)
    mount_info_pane({ structure, pane_open: true })

    expect(document.querySelectorAll(`.site-card`)).toHaveLength(0)
    const sites = doc_query<HTMLDetailsElement>(`.sites`)
    sites.querySelector(`summary`)?.click()
    await tick()

    expect(document.querySelectorAll(`.site-card`)).toHaveLength(100)
    expect(document.querySelector(`.pager`)?.textContent).toContain(`1-100 of 120`)

    const next_button = Array.from(document.querySelectorAll(`.pager button`)).find(
      (button) => button.textContent?.trim() === `Next`,
    ) as HTMLButtonElement
    next_button.click()
    await tick()

    expect(document.querySelectorAll(`.site-card`)).toHaveLength(100)
    expect(document.querySelector(`.pager`)?.textContent).toContain(`21-120 of 120`)
  })

  // A site selected elsewhere (Wyckoff table, 3D scene) on another page must page to it
  test(`pages to the selected site when it sits beyond the first page`, async () => {
    const structure = get_dummy_structure(`H`, 120, true)
    const scroll_spy = vi.spyOn(HTMLElement.prototype, `scrollIntoView`)
    mount_info_pane({ structure, pane_open: true, selected_sites: [110] })
    doc_query<HTMLDetailsElement>(`.sites summary`).click()
    await tick()

    expect(document.querySelector(`.pager`)?.textContent).toContain(`21-120 of 120`)
    const selected_card = document.querySelector(`.site-card[data-site-idx="110"]`)
    expect(selected_card?.classList.contains(`selected`)).toBe(true)
    expect(scroll_spy).toHaveBeenCalledWith({ block: `nearest` })
    expect(scroll_spy.mock.instances[0]).toBe(selected_card)
    scroll_spy.mockRestore()
  })

  test(`renders the symmetry section only with sym_data, between Cell and Sites`, () => {
    const periodic_structure = get_dummy_structure(`H`, 4, true)
    // card and section headings in document order (site cards follow the Sites summary)
    const headings = (count: number) =>
      [...document.querySelectorAll(`.structure-info h4, .sites summary`)]
        .slice(0, count)
        .map((heading) => heading.textContent?.trim())

    mount_info_pane({ structure: periodic_structure, pane_open: true })
    expect(document.body.textContent).not.toContain(`Space Group`)
    expect(headings(3)).toEqual([`Structure`, `Cell`, `Sites`])

    document.body.innerHTML = ``
    mount_info_pane({
      structure: periodic_structure,
      pane_open: true,
      sym_data: make_sym_data(),
    })
    expect(headings(4)).toEqual([`Structure`, `Cell`, `Symmetry`, `Sites`])
    const with_sym_content = document.body.textContent ?? ``
    expect(with_sym_content).toContain(`227 (Fd-3m)`)
    expect(with_sym_content).toContain(`1 (0 trans, 1 rot, 0 roto-trans)`)
  })
})

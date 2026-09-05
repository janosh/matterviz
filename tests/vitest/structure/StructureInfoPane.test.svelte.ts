import { type AnyStructure, StructureInfoPane } from '$lib'
import { info_pane_icon } from '$lib/overlays'
import * as rdf from '$lib/rdf/calc-rdf'
import * as coordination from '$lib/coordination/calc-coordination'
import * as angles from '$lib/bond-angles/calc-bond-angles'
import type { Vec3 } from '$lib/math'
import type { SymmetryDataset, WyckoffPos } from '$lib/symmetry'
import type { ComponentProps } from 'svelte'
import { mount, tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, get_dummy_structure, make_wyckoff_dataset } from '../setup'

describe(`StructureInfoPane`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })
  afterEach(() => vi.restoreAllMocks())

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
    `symmetry table threshold behavior: %s`,
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
      expect(document.querySelector(`.sites`)).toBeNull()
      expect(document.querySelectorAll(`.site-card`)).toHaveLength(0)
      const default_row_count = expanded_by_default ? atom_count : 0

      const wyckoff = doc_query<HTMLDetailsElement>(`.wyckoff`)
      expect(wyckoff.open).toBe(expanded_by_default)
      const wyckoff_rows = () => document.querySelectorAll(`.wyckoff-row`)
      expect(wyckoff_rows()).toHaveLength(default_row_count)

      wyckoff.querySelector(`summary`)?.click()
      await tick()
      expect(wyckoff_rows()).toHaveLength(atom_count - default_row_count)
    },
  )

  // The pane must highlight whatever site indices its rows carry, which the session has
  // already re-expressed onto the displayed (conventional/primitive/supercell) structure — it
  // must not recompute rows from sym_data, whose indices address the analyzed cell only
  test(`Wyckoff row hover and click forward the row's (displayed) site indices`, async () => {
    const state = $state({ highlighted_sites: [] as number[], selected_sites: [] as number[] })
    mount_info_pane(
      bind_props(
        {
          structure: get_dummy_structure(`H`, 10, true),
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
    expect(document.querySelectorAll(`.site-card`)).toHaveLength(3)
    row.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
    expect(state.highlighted_sites).toEqual([])
  })

  // Closed pane stays mounted (display:none); site cards must not rebuild while closed.
  test.each([
    [false, 0],
    [true, 3],
  ])(`pane_open=%s renders %i site cards`, (pane_open, n_cards) => {
    mount_info_pane({
      structure: get_dummy_structure(`H`, 3, true),
      pane_open,
      selected_sites: [0, 1, 2],
    })
    expect(document.querySelectorAll(`.site-card`)).toHaveLength(n_cards)
  })

  // Tips stay in the DOM even when closed; must match Structure.svelte's plain-letter handlers.
  test(`Keyboard tip documents the plain-letter shortcuts`, () => {
    mount_info_pane({ structure: get_dummy_structure(`H`, 1, true), pane_open: false })
    expect(document.body.textContent).toContain(
      `Press f for fullscreen, i to toggle this pane, g for multi-view, r to reset the view`,
    )
    expect(document.querySelector(`.structure-info-toggle path`)?.getAttribute(`d`)).toBe(
      info_pane_icon.d,
    )
  })

  test(`selected cards hover, copy, and keyboard navigate; search selects sites`, async () => {
    const structure = get_dummy_structure(`H`, 3, true)
    const state = $state({
      highlighted_sites: [] as number[],
      hovered_site_idx: null as number | null,
      selected_sites: [0, 1, 2],
    })
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
      site_row.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
      expect(state.highlighted_sites).toEqual([1])
      expect(state.hovered_site_idx).toBe(1)
      site_row.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
      expect(state.highlighted_sites).toEqual([])
      expect(state.hovered_site_idx).toBeNull()

      const filter_input = doc_query<HTMLInputElement>(`input[aria-label="Find site"]`)
      filter_input.value = `H2`
      filter_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()

      expect(site_cards()).toHaveLength(3) // searching does not change the selection
      const match = doc_query<HTMLButtonElement>(`.site-matches button`)
      expect(match.textContent?.trim()).toBe(`H2`)
      match.click()
      await tick()
      expect(state.selected_sites).toEqual([1])
      expect(site_cards()).toHaveLength(1)
      expect(site_cards()[0].textContent).toContain(`H2`)
      expect(filter_input.value).toBe(``)

      site_cards()[0].dispatchEvent(new KeyboardEvent(`keydown`, { key: `c`, bubbles: true }))
      expect(clipboard_spy).toHaveBeenCalledWith(expect.stringContaining(`Hydrogen`))

      filter_input.value = `H1`
      filter_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      doc_query(`.site-matches button`).dispatchEvent(
        new MouseEvent(`click`, { bubbles: true, shiftKey: true }),
      )
      await tick()
      expect(state.selected_sites).toEqual([1, 0])

      site_cards()[0].focus()
      site_cards()[0].dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `ArrowDown`, bubbles: true }),
      )
      expect(document.activeElement).toBe(site_cards()[1])
    } finally {
      clipboard_spy.mockRestore()
    }
  })

  test.each([30, 600])(
    `inspects selected displayed sites in a %i-atom view`,
    async (atom_count) => {
      const structure = get_dummy_structure(`H`, 1, true)
      const displayed_structure = get_dummy_structure(`O`, atom_count, true)
      displayed_structure.sites[atom_count - 1].properties = {
        force: [3, 4, 0],
        magmom: 2,
        orig_site_idx: 0,
        orig_unit_cell_idx: 0,
        completion_image: true,
      }
      const state = $state({ selected_sites: [atom_count - 1] })
      mount_info_pane(bind_props({ structure, displayed_structure, pane_open: true }, state))
      const cards = document.querySelectorAll(`.site-card`)
      expect(cards).toHaveLength(1)
      expect(cards[0].textContent).toContain(`O${atom_count}`)
      expect(cards[0].textContent).toContain(`5 eV/Å`)
      expect(cards[0].textContent).toContain(`2 μB`)
      expect(cards[0].textContent).not.toMatch(
        /orig_site_idx|orig_unit_cell_idx|completion_image/,
      )
      expect(document.body.textContent).toContain(`(1 sites)`)
      const search = doc_query<HTMLInputElement>(`input[aria-label="Find site"]`)
      search.value = `O`
      search.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      expect(document.querySelectorAll(`.site-matches button`)).toHaveLength(20)
      search.value = `not-an-element`
      search.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      expect(document.querySelector(`.site-matches`)?.textContent).toContain(
        `No matching sites`,
      )
      state.selected_sites = Array.from({ length: atom_count }, (_, idx) => idx)
      await tick()
      expect(document.querySelectorAll(`.site-card.selected`)).toHaveLength(
        Math.min(atom_count, 100),
      )
      if (atom_count > 100) {
        doc_query<HTMLButtonElement>(`.pager button:last-child`).click()
        await tick()
        expect(doc_query(`.site-card`).getAttribute(`data-site-idx`)).toBe(`100`)
      }
    },
  )

  test.each([true, false])(`analysis mounts on demand with crystal=%s`, async (periodic) => {
    const crystal = get_dummy_structure(`H`, 2, true)
    const structure = periodic ? crystal : { sites: crystal.sites }
    const displayed_structure = get_dummy_structure(`O`, 10, periodic)
    const rdf_spy = vi.spyOn(rdf, `calculate_rdf`)
    const cn_spy = vi.spyOn(coordination, `calc_coordination_nums`)
    const angle_spy = vi.spyOn(angles, `calc_bond_angles`)
    const props = $state<{ structure: AnyStructure; pane_open: boolean }>({
      structure,
      pane_open: true,
    })
    mount_info_pane(
      bind_props({ displayed_structure, bonding_strategy: `explicit_only` as const }, props),
    )
    expect(rdf_spy).not.toHaveBeenCalled()
    expect(cn_spy).not.toHaveBeenCalled()
    expect(angle_spy).not.toHaveBeenCalled()
    doc_query(`.analysis summary`).click()
    await tick()
    const selector = doc_query<HTMLSelectElement>(
      `select[aria-label="Structure analysis plot"]`,
    )
    expect(selector.value).toBe(periodic ? `rdf` : `coordination`)
    expect([...selector.options].some((option) => option.value === `rdf`)).toBe(periodic)
    if (periodic) {
      expect(rdf_spy).toHaveBeenCalledWith(structure, {
        cutoff: 8,
        n_bins: 80,
        pbc: undefined,
      })
      expect(cn_spy).not.toHaveBeenCalled()
    }
    selector.value = `coordination`
    // happy-dom does not match selected options with :checked; supply the native DOM result.
    const checked_option = vi
      .spyOn(selector, `querySelector`)
      .mockReturnValue(selector.options[periodic ? 1 : 0])
    selector.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(cn_spy).toHaveBeenCalledWith(structure, { strategy: `explicit_only` })
    expect(angle_spy).not.toHaveBeenCalled()
    selector.value = `angles`
    checked_option.mockReturnValue(selector.options[periodic ? 2 : 1])
    selector.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(angle_spy).toHaveBeenCalledWith(structure, {
      strategy: `explicit_only`,
      center_elements: undefined,
      neighbor_elements: undefined,
    })
    const next_structure = { ...structure, sites: structure.sites.slice(0, 1) }
    props.structure = next_structure
    await tick()
    expect(selector.value).toBe(`angles`)
    expect(angle_spy).toHaveBeenLastCalledWith(
      next_structure,
      expect.objectContaining({ strategy: `explicit_only` }),
    )
    props.pane_open = false
    await tick()
    expect(document.querySelector(`.analysis`)).toBeNull()
    const call_count = angle_spy.mock.calls.length
    props.structure = structure
    await tick()
    expect(angle_spy).toHaveBeenCalledTimes(call_count)
    props.pane_open = true
    await tick()
    expect(doc_query<HTMLSelectElement>(`.analysis select`).value).toBe(`angles`)
    if (periodic) {
      props.structure = { sites: crystal.sites }
      await tick()
      expect(doc_query<HTMLSelectElement>(`.analysis select`).value).toBe(`coordination`)
      expect(document.querySelector(`.analysis option[value="rdf"]`)).toBeNull()
    }
    doc_query(`.analysis summary`).click()
    await tick()
    expect(document.querySelector(`.analysis select`)).toBeNull()
  })

  test(`renders symmetry between Cell and Selected sites when sym_data is present`, () => {
    const periodic_structure = get_dummy_structure(`H`, 4, true)
    // Structure headings precede the selected-site inspector.
    const headings = (count: number) =>
      [...document.querySelectorAll(`.structure-info h4`)]
        .slice(0, count)
        .map((heading) => heading.textContent?.trim())

    mount_info_pane({ structure: periodic_structure, pane_open: true })
    expect(document.body.textContent).not.toContain(`Space Group`)
    expect(headings(3)).toEqual([`Structure`, `Cell`, `Selected sites (0)`])

    document.body.innerHTML = ``
    mount_info_pane({
      structure: periodic_structure,
      pane_open: true,
      sym_data: make_sym_data(),
    })
    expect(headings(4)).toEqual([`Structure`, `Cell`, `Symmetry`, `Selected sites (0)`])
    const with_sym_content = document.body.textContent ?? ``
    expect(with_sym_content).toContain(`227 (Fd-3m)`)
    expect(with_sym_content).toContain(`1 (0 trans, 1 rot, 0 roto-trans)`)
  })
})

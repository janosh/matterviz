import { StructureInfoPane } from '$lib'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import type { ComponentProps } from 'svelte'
import { mount, tick } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { bind_props, get_dummy_structure } from '../setup'

describe(`StructureInfoPane`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  const mount_info_pane = (props: ComponentProps<typeof StructureInfoPane>) =>
    mount(StructureInfoPane, { target: document.body, props })

  const make_sym_data = (): MoyoDataset =>
    ({
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
        positions: [[0, 0, 0]],
        numbers: [1],
      },
      wyckoffs: [`a`],
    }) as unknown as MoyoDataset

  test.each([
    [`small`, 2, true],
    [`collapsed_with_toggle`, 50, false],
    [`upper_bound_collapsed`, 500, false],
  ] as const)(
    `sites visibility behavior: %s`,
    (_scenario_name, atom_count, shows_site_details) => {
      const structure = get_dummy_structure(`H`, atom_count, true)
      mount_info_pane({
        structure,
        pane_open: true,
        atom_count_thresholds: [50, 500],
      })

      const content = document.body.textContent || ``
      expect(content).toContain(`(${atom_count} sites)`)
      if (atom_count >= 50) expect(content).toContain(`Show ${atom_count} sites`)
      if (shows_site_details) {
        expect(content).toContain(`Frac.`)
        expect(content).toContain(`Cart.`)
      } else {
        expect(content).not.toContain(`Frac.`)
        expect(content).not.toContain(`Cart.`)
      }
    },
  )

  test(`omits sites section entirely above max threshold`, () => {
    const structure = get_dummy_structure(`H`, 600, true)
    mount_info_pane({ structure, pane_open: true, atom_count_thresholds: [50, 500] })

    const content = document.body.textContent || ``
    expect(content).not.toContain(`Show 600 sites`)
    expect(content).not.toContain(`Frac.`)
    expect(content).not.toContain(`Cart.`)
  })

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
      const site_cards = () =>
        Array.from(document.querySelectorAll<HTMLDivElement>(`.site-card`))
      expect(site_cards()).toHaveLength(3)

      const site_row = site_cards()[1]
      expect(site_row).toBeInstanceOf(HTMLDivElement)
      site_row.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
      expect(state.highlighted_sites).toEqual([1])
      expect(state.hovered_site_idx).toBe(1)
      site_row.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
      expect(state.highlighted_sites).toEqual([])
      expect(state.hovered_site_idx).toBeNull()

      const filter_input = document.querySelector(`input.site-filter`) as HTMLInputElement
      filter_input.value = `H2`
      filter_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()

      expect(site_cards()).toHaveLength(1)
      expect(site_cards()[0].textContent).toContain(`H2`)

      site_cards()[0].click()
      expect(state.selected_sites).toEqual([1])

      const copy_buttons =
        site_cards()[0].querySelectorAll<HTMLButtonElement>(`button.copy-button`)
      expect(copy_buttons).toHaveLength(1)
      const [copy_button] = copy_buttons
      copy_button.click()
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
    mount_info_pane({ structure, pane_open: true, atom_count_thresholds: [50, 500] })

    expect(document.querySelectorAll(`.site-card`)).toHaveLength(0)
    const toggle = document.querySelector(`button.sites-toggle`) as HTMLButtonElement
    toggle.click()
    await tick()

    expect(document.querySelectorAll(`.site-card`)).toHaveLength(100)
    expect(document.querySelector(`.site-window-controls`)?.textContent).toContain(
      `1-100 of 120`,
    )

    const next_button = Array.from(
      document.querySelectorAll(`.site-window-controls button`),
    ).find((button) => button.textContent?.trim() === `Next`) as HTMLButtonElement
    next_button.click()
    await tick()

    expect(document.querySelectorAll(`.site-card`)).toHaveLength(100)
    expect(document.querySelector(`.site-window-controls`)?.textContent).toContain(
      `21-120 of 120`,
    )
  })

  test(`renders symmetry section only when sym_data exists`, () => {
    const periodic_structure = get_dummy_structure(`H`, 4, true)

    mount_info_pane({ structure: periodic_structure, pane_open: true })
    const no_sym_content = document.body.textContent || ``
    expect(no_sym_content).not.toContain(`Symmetry`)
    expect(no_sym_content).not.toContain(`Space Group`)

    document.body.innerHTML = ``
    mount_info_pane({
      structure: periodic_structure,
      pane_open: true,
      sym_data: make_sym_data(),
    })
    const with_sym_content = document.body.textContent || ``
    expect(with_sym_content).toContain(`Symmetry`)
    expect(with_sym_content).toContain(`Space Group`)
    expect(with_sym_content).toContain(`227 (Fd-3m)`)
    expect(with_sym_content).toContain(`Symmetry Ops`)
    expect(with_sym_content).toContain(`1 (0 trans, 1 rot, 0 roto-trans)`)
  })

  test(`places symmetry section between Cell and Sites content`, () => {
    const structure = get_dummy_structure(`H`, 2, true)
    mount_info_pane({
      structure,
      pane_open: true,
      sym_data: make_sym_data(),
      atom_count_thresholds: [10, 500],
    })

    const section_titles = Array.from(document.querySelectorAll(`h4`)).map(
      (heading) => heading.textContent ?? ``,
    )
    const cell_idx = section_titles.indexOf(`Cell`)
    const symmetry_idx = section_titles.indexOf(`Symmetry`)
    const sites_idx = section_titles.indexOf(`Sites`)

    expect(cell_idx).toBeGreaterThan(-1)
    expect(symmetry_idx).toBeGreaterThan(-1)
    expect(sites_idx).toBeGreaterThan(-1)
    expect(cell_idx).toBeLessThan(symmetry_idx)
    expect(symmetry_idx).toBeLessThan(sites_idx)
  })
})

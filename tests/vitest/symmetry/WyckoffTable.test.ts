import type { WyckoffPos } from '$lib/symmetry'
import { WyckoffTable } from '$lib/symmetry'
import type { MoyoWyckoffPosition } from '@spglib/moyo-wasm'
import type { ComponentProps } from 'svelte'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`WyckoffTable`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  const mount_table = (wyckoff_positions: WyckoffPos[] | null | undefined) =>
    mount(WyckoffTable, {
      target: document.body,
      props: {
        wyckoff_positions: wyckoff_positions as ComponentProps<
          typeof WyckoffTable
        >[`wyckoff_positions`],
      },
    })

  test.each([
    [`empty array`, [] as WyckoffPos[]],
    [`null`, null],
    [`undefined`, undefined],
  ] as [string, WyckoffPos[] | null | undefined][])(
    `renders nothing when wyckoff_positions is %s`,
    (_, wyckoff_positions) => {
      mount_table(wyckoff_positions)
      expect(document.querySelector(`table`)).toBeNull()
    },
  )

  test(`renders duplicate semantic rows without keyed-each crash`, () => {
    const duplicate_semantic_rows: WyckoffPos[] = [
      {
        wyckoff: `1`,
        elem: `Ac`,
        abc: [0, 0, 0],
        site_indices: [0],
      },
      {
        wyckoff: `1`,
        elem: `Ac`,
        abc: [0, 0, 0],
        site_indices: [0],
      },
    ]

    expect(() => mount_table(duplicate_semantic_rows)).not.toThrow()

    const rendered_rows = document.querySelectorAll(`tbody tr`)
    expect(rendered_rows).toHaveLength(2)
  })

  describe(`space-group Wyckoff database integration`, () => {
    const occupied: WyckoffPos[] = [
      { wyckoff: `1a`, elem: `Sr`, abc: [0, 0, 0], site_indices: [0] },
      { wyckoff: `3c`, elem: `O`, abc: [0, 0.5, 0.5], site_indices: [1, 2, 3] },
    ]

    const db_positions: MoyoWyckoffPosition[] = [
      { multiplicity: 1, letter: `a`, site_symmetry: `m-3m`, coordinates: `0,0,0` },
      { multiplicity: 1, letter: `b`, site_symmetry: `m-3m`, coordinates: `1/2,1/2,1/2` },
      { multiplicity: 3, letter: `c`, site_symmetry: `4/mmm`, coordinates: `0,1/2,1/2` },
      { multiplicity: 3, letter: `d`, site_symmetry: `4/mmm`, coordinates: `1/2,0,0` },
    ]

    const header_cells = () =>
      Array.from(document.querySelectorAll(`thead th`)).map((cell) => cell.textContent)

    test(`renders without ITA columns when no db_positions given`, () => {
      mount(WyckoffTable, {
        target: document.body,
        props: { wyckoff_positions: occupied },
      })
      expect(header_cells()).toEqual([`Wyckoff`, `Element`, `Fractional Coords`])
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(2)
      expect(doc_query(`tbody tr td:nth-child(3)`).textContent).toBe(`(0, 0, 0)`)
    })

    test(`adds ITA coords + site symmetry columns from db_positions`, () => {
      mount(WyckoffTable, {
        target: document.body,
        props: { wyckoff_positions: occupied, db_positions },
      })
      expect(header_cells()).toEqual([
        `Wyckoff`,
        `Element`,
        `Fractional Coords`,
        `ITA Coords`,
        `Site Symm.`,
      ])
      const first_row = doc_query(`tbody tr`)
      expect(first_row.textContent).toContain(`(0,0,0)`)
      expect(first_row.textContent).toContain(`m-3m`)
      // occupied letters only — unoccupied hidden by default
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(2)
      expect(document.querySelectorAll(`tbody tr.unoccupied`)).toHaveLength(0)
    })

    test(`show_unoccupied lists empty Wyckoff positions as muted non-interactive rows`, () => {
      mount(WyckoffTable, {
        target: document.body,
        props: { wyckoff_positions: occupied, db_positions, show_unoccupied: true },
      })
      const unoccupied_rows = Array.from(document.querySelectorAll(`tbody tr.unoccupied`))
      expect(unoccupied_rows.map((row) => row.textContent?.trim().slice(0, 2))).toEqual([
        `1b`,
        `3d`,
      ])
      expect(unoccupied_rows[0].textContent).toContain(`(1/2,1/2,1/2)`)
      // occupied rows stay interactive, unoccupied rows are not
      expect(document.querySelectorAll(`tbody tr.wyckoff-row`)).toHaveLength(2)
      expect(unoccupied_rows[0].classList.contains(`wyckoff-row`)).toBe(false)
    })
  })
})

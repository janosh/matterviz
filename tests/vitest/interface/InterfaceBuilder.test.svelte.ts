import InterfaceBuilder from '#lib/interface/InterfaceBuilder.svelte'
import { match_lattices, surface_frame } from '#lib/interface/lattice-match.js'
import type { Heterostructure, LatticeMatchOptions } from '#lib/interface/types.js'
import type { Vec2, Vec3 } from '#lib/math.js'
import { make_slab } from '#lib/slab/make-slab.js'
import type { Crystal } from '#lib/structure/index.js'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { bind_props, doc_query, mouse } from '../setup'
import { make_crystal, make_fcc } from '../test-fixtures'

const fcc_slab = (lattice_const: number, element: string, hkl: Vec3 = [1, 0, 0]) =>
  make_slab(make_fcc(lattice_const, element), hkl, { min_slab_thickness: 4 })
const CU_100 = fcc_slab(3.615, `Cu`)
const AG_100 = fcc_slab(4.086, `Ag`)
const PD_111 = fcc_slab(3.89, `Pd`, [1, 1, 1])
const matches_of = (substrate: Crystal, film: Crystal, options: LatticeMatchOptions = {}) =>
  match_lattices(surface_frame(substrate).basis, surface_frame(film).basis, options)
const MATCHES = matches_of(CU_100, AG_100)

type BuilderState = {
  interface: Heterostructure | null
  error: string | null
  match_idx: number
  max_area: number
  length_tol: number
  angle_tol: number
  gap: number
  vacuum: number
  shift: Vec2
}

describe(`InterfaceBuilder`, () => {
  let mounted: ReturnType<typeof mount> | null = null
  afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = null
    document.body.innerHTML = ``
  })

  const mount_builder = (
    substrate: Crystal,
    film: Crystal,
    overrides: Partial<BuilderState> = {},
  ) => {
    const state = $state<BuilderState>({
      interface: null,
      error: null,
      match_idx: 0,
      max_area: 400,
      length_tol: 0.03,
      angle_tol: 0.01,
      gap: 2,
      vacuum: 15,
      shift: [0, 0],
      ...overrides,
    })
    mounted = mount(InterfaceBuilder, {
      target: document.body,
      props: bind_props({ substrate, film }, state),
    })
    flushSync()
    return state
  }
  const select = () => doc_query<HTMLSelectElement>(`.interface-builder select`)
  const inputs = (type: `number` | `range`) => [
    ...document.querySelectorAll<HTMLInputElement>(`.interface-builder input[type=${type}]`),
  ]
  const set_input = (input: HTMLInputElement, value: number, event: `input` | `change`) => {
    input.value = String(value)
    input.dispatchEvent(new Event(event, { bubbles: true }))
    flushSync()
  }
  const row_value = (term: string): string | undefined =>
    [...document.querySelectorAll(`.interface-builder dl div`)]
      .find((row) => row.querySelector(`dt`)?.textContent === term)
      ?.querySelector(`dd`)?.textContent ?? undefined

  test(`lists every match, plots them and stacks the first on mount`, () => {
    const built = mount_builder(CU_100, AG_100)
    expect(built.error).toBeNull()
    expect(built.interface?.interface_info.match).toEqual(MATCHES[0])
    const options = select().querySelectorAll(`option`)
    expect(options).toHaveLength(MATCHES.length)
    expect(options[0].textContent).toBe(`#1 · 4 : 5 cells · 32.7 Å² · 1.084 % · 63.4°`)
    expect(row_value(`von Mises strain`)).toBe(`1.084 %`)
    expect(document.querySelectorAll(`.interface-builder .effect-ring.selected`)).toHaveLength(
      1,
    )
    // controls sit in purpose-named groups; with matches found the search limits stay folded
    const legends = [...document.querySelectorAll(`.interface-builder legend`)]
    expect(legends.map((legend) => legend.textContent)).toEqual([`Match`, `Stacking`])
    expect(doc_query<HTMLDetailsElement>(`.interface-builder details`).open).toBe(false)
  })

  test(`picking a match in the select or the plot rebuilds the interface`, () => {
    const built = mount_builder(CU_100, AG_100)
    select().value = `3`
    select().dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(built.match_idx).toBe(3)
    expect(built.interface?.interface_info.match).toEqual(MATCHES[3])
    expect(built.interface?.sites).toHaveLength(
      MATCHES[3].n_substrate_cells * CU_100.sites.length +
        MATCHES[3].n_film_cells * AG_100.sites.length,
    )
    const points = document.querySelectorAll(`.interface-builder .scatter [role=button]`)
    expect(points).toHaveLength(MATCHES.length)
    // each point carries its match number, the one the select, stats and a URL use
    const numbers = [...points].map((point) =>
      point.querySelector(`text`)?.textContent?.trim(),
    )
    expect(numbers).toEqual(MATCHES.map((_, idx) => String(idx + 1)))
    points[5].dispatchEvent(mouse(`click`))
    flushSync()
    expect(built.match_idx).toBe(5)
    expect(built.interface?.interface_info.match).toEqual(MATCHES[5])
    expect(row_value(`Match`)).toBe(`#6 of ${MATCHES.length}`)
  })

  // each slider writes its own bound prop and the interface is rebuilt from it
  test.each([
    [0, 1.5, { gap: 1.5 }],
    [1, 22, { vacuum: 22 }],
    [2, 0.5, { shift: [0.5, 0] }],
    [3, 0.25, { shift: [0, 0.25] }],
  ] satisfies [number, number, Partial<BuilderState>][])(
    `slider %i set to %s updates %j`,
    (slider_idx, value, expected) => {
      const built = mount_builder(CU_100, AG_100)
      set_input(inputs(`range`)[slider_idx], value, `input`)
      expect(built).toMatchObject(expected)
      expect(built.interface?.interface_info).toMatchObject(expected)
    },
  )

  // a parent passing a plain array (no bind) must still see the shift: the slider replaces
  // the tuple instead of writing into the caller's array
  test(`shift slider replaces an unbound shift tuple`, () => {
    const shift: Vec2 = [0, 0]
    const state = $state<{ interface: Heterostructure | null }>({ interface: null })
    mounted = mount(InterfaceBuilder, {
      target: document.body,
      props: bind_props({ substrate: CU_100, film: AG_100, shift }, state),
    })
    flushSync()
    set_input(inputs(`range`)[2], 0.5, `input`)
    expect(shift).toEqual([0, 0])
    expect(state.interface?.interface_info.shift).toEqual([0.5, 0])
  })

  // Cu(100) on Pd(111) pairs square with hexagonal super-lattices, so angle_tol matters
  test.each([
    [`length_tol`, 1, 0.01, AG_100],
    [`angle_tol`, 2, 0.002, PD_111],
  ] as const)(`%s input reruns the search`, (key, input_idx, value, film) => {
    const built = mount_builder(CU_100, film)
    const expected = matches_of(CU_100, film, { [key]: value })
    expect(expected).not.toEqual(matches_of(CU_100, film))
    set_input(inputs(`number`)[input_idx], value, `change`)
    expect(built[key]).toBe(value)
    expect(select().querySelectorAll(`option`)).toHaveLength(expected.length)
    expect(built.interface?.interface_info.match).toEqual(expected[0])
  })

  test(`clamps the pick when a smaller search shrinks the list`, () => {
    const built = mount_builder(CU_100, AG_100, { match_idx: 30 })
    expect(built.interface?.interface_info.match).toEqual(MATCHES[30])
    set_input(inputs(`number`)[0], 120, `change`)
    const n_left = MATCHES.filter(({ area }) => area <= 120).length
    expect(built.max_area).toBe(120)
    expect(built.match_idx).toBe(n_left - 1)
    expect(built.interface?.interface_info.match).toEqual(MATCHES[n_left - 1])
  })

  // the 6:1 match of a square film on a 2 × 3.03 rectangle strains the film along y only
  test(`lists strain components in εxx, εyy, εxy order`, () => {
    const mesh = (len_a: number, len_b: number) =>
      make_crystal(
        [
          [len_a, 0, 0],
          [0, len_b, 0],
          [0, 0, 10],
        ],
        [[`Cu`, [0, 0, 0]]],
      )
    mount_builder(mesh(2, 3.03), mesh(1, 1), { max_area: 7 })
    expect(row_value(`Cells film / substrate`)).toBe(`6 / 1`)
    expect(row_value(`Strain εxx, εyy, εxy`)).toBe(`0 %, 1 %, 0 %`)
  })

  test(`shows an empty state when no cell fits`, () => {
    const built = mount_builder(CU_100, AG_100, { max_area: 20 })
    expect([built.interface, built.error]).toEqual([null, null])
    expect(doc_query(`.interface-builder .empty`).textContent).toMatch(
      /No coincidence cell .* length_tol = [\d.]+\s+and angle_tol = [\d.]+\./,
    )
    expect(document.querySelector(`.interface-builder select`)).toBeNull()
    expect(document.querySelector(`.interface-builder dl`)).toBeNull()
    // the search limits are what to loosen now, so their collapsible opens by itself
    const details = doc_query<HTMLDetailsElement>(`.interface-builder details`)
    expect(details.open).toBe(true)
    // and stays open once a larger max area finds matches, not folding under the input
    set_input(inputs(`number`)[0], 400, `change`)
    expect(built.max_area).toBe(400)
    expect(select().querySelectorAll(`option`)).toHaveLength(MATCHES.length)
    expect(details.open).toBe(true)
  })

  // errors from the search and from stacking surface as text instead of throwing
  test.each([
    [`invalid tolerance`, CU_100, { length_tol: 2 }, `length_tol must be in (0, 1), got 2`],
    [`empty substrate`, { ...CU_100, sites: [] }, {}, `substrate slab has no sites`],
  ] satisfies [string, Crystal, Partial<BuilderState>, string][])(
    `surfaces an error for %s`,
    (_, substrate, overrides, message) => {
      const built = mount_builder(substrate, AG_100, overrides)
      expect(built.interface).toBeNull()
      expect(built.error).toBe(message)
      expect(doc_query(`.interface-builder .error`).textContent).toBe(message)
    },
  )
})

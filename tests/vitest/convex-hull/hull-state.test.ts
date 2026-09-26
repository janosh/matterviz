import {
  compute_energy_mode_info,
  compute_hull_model,
  type HullModel,
} from '$lib/convex-hull/model'
import { describe, expect, expectTypeOf, test } from 'vitest'
import { make_phase } from '../test-fixtures'

const precomputed = { e_form_per_atom: -1, e_above_hull: 0 }
const full_refs = [
  make_phase({ Fe: 1 }, -4, precomputed),
  make_phase({ O: 1 }, -2, precomputed),
]
const compound = make_phase({ Fe: 1, O: 1 }, -7.5, precomputed)

describe(`compute_energy_mode_info`, () => {
  const complete_entries = [...full_refs, compound]
  test.each([
    [`user choice`, complete_entries, `precomputed`, false, `precomputed`, true],
    [
      `corrections invalidate precomputed energies`,
      complete_entries,
      `precomputed`,
      true,
      `on-the-fly`,
      true,
    ],
    [
      `missing hull distances`,
      [...full_refs, make_phase({ Fe: 1, O: 1 }, -7.5, { e_form_per_atom: -1 })],
      `precomputed`,
      false,
      `on-the-fly`,
      true,
    ],
    [
      `missing O reference`,
      [full_refs[0], compound],
      `on-the-fly`,
      true,
      `precomputed`,
      false,
    ],
  ] as const)(`%s`, (_label, entries, mode, corrections, energy_mode, can_compute) => {
    expect(compute_energy_mode_info([...entries], mode, corrections)).toMatchObject({
      energy_mode,
      can_compute,
    })
  })
})

describe(`compute_hull_model`, () => {
  test.each([2, 3, 4] as const)(
    `builds an immutable-input %i-component model for renderers and stats`,
    (dim) => {
      const elements = [`Li`, `Fe`, `O`, `Na`].slice(0, dim)
      const composition = Object.fromEntries(elements.map((element) => [element, 1]))
      const entries = Object.freeze(
        [
          ...elements.map((element) => make_phase({ [element]: 1 }, 0)),
          make_phase(composition, -2, { entry_id: `excluded`, exclude_from_hull: true }),
          make_phase(composition, -1, {
            entry_id: `stable`,
            e_above_hull: 0.5,
            is_stable: false,
          }),
          make_phase(composition, 0.25, { entry_id: `unstable` }),
        ].map((entry) =>
          Object.freeze({ ...entry, composition: Object.freeze(entry.composition) }),
        ),
      )
      const original = structuredClone(entries)
      const model = compute_hull_model(entries)
      expectTypeOf<HullModel[`entries`][number]>().toEqualTypeOf<
        Readonly<HullModel[`entries`][number]>
      >()
      expectTypeOf(model.entries[0].composition).toEqualTypeOf<
        Readonly<(typeof model.entries)[0][`composition`]>
      >()
      expectTypeOf(model.facets[0].normal).toEqualTypeOf<readonly number[]>()
      expectTypeOf(model.facets[0].vertex_indices).toEqualTypeOf<readonly number[]>()
      expectTypeOf<NonNullable<HullModel[`phase_stats`]>[`hull_distance`]>().toEqualTypeOf<
        Readonly<{ max: number; avg: number }>
      >()
      expect(entries).toEqual(original)
      expect(model.entries.find((entry) => entry.entry_id === `stable`)).toMatchObject({
        e_form_per_atom: -1,
        e_above_hull: 0,
        is_stable: true,
      })
      expect(model.entries.find((entry) => entry.entry_id === `excluded`)?.is_stable).toBe(
        false,
      )
      const unstable_distance = model.entries.find(
        (entry) => entry.entry_id === `unstable`,
      )?.e_above_hull
      if (unstable_distance === undefined) throw new Error(`Missing hull distance`)
      expect(Math.abs(unstable_distance - 1.25)).toBeLessThanOrEqual(4 * Number.EPSILON)
      expect(model.facets.length).toBeGreaterThan(0)
      const facet_entries = model.facets.flatMap((facet) =>
        facet.vertex_indices.map((idx) => model.entries[idx]),
      )
      expect(facet_entries.every((entry) => !entry.exclude_from_hull)).toBe(true)
      const stable_vertices = facet_entries.filter((entry) => entry.entry_id === `stable`)
      expect(stable_vertices.length).toBeGreaterThan(0)
      for (const entry of stable_vertices) {
        expect(entry).toMatchObject({ e_above_hull: 0, is_stable: true })
        expect(entry).toBe(model.entries.find((candidate) => candidate.entry_id === `stable`))
      }
      expect(model.phase_stats).toMatchObject({ total: dim + 3, stable: dim + 1, unstable: 2 })
    },
  )

  test(`precomputed E_form without unary references still gets hull distances`, () => {
    // no Fe/O entries: E_form cannot be recomputed, so the precomputed values build the hull
    const entries = [
      make_phase({ Fe: 1, O: 1 }, -5, { e_form_per_atom: -1.5 }),
      make_phase({ Fe: 2, O: 3 }, -5, { e_form_per_atom: -1.7 }),
      // a value carried by the data is kept in precomputed mode
      make_phase({ Fe: 1, O: 2 }, -5, { e_form_per_atom: -0.5, e_above_hull: 0.9 }),
    ]
    expect(compute_hull_model(entries).entries.slice(0, 3)).toMatchObject([
      { e_above_hull: 0, is_stable: true },
      { e_above_hull: 0, is_stable: true },
      { e_above_hull: 0.9 },
    ])
  })

  test(`an excluded unary gets a synthetic corner, which phase counts leave out`, () => {
    const entries = [
      make_phase({ Fe: 1 }, -8, { exclude_from_hull: true }),
      make_phase({ O: 1 }, -4),
      make_phase({ Fe: 1, O: 1 }, -7.5),
      make_phase({ Fe: 3, O: 1 }, -7.5),
    ]
    const model = compute_hull_model(entries, { energy_source_mode: `on-the-fly` })
    expect(model.entries.at(-1)).toMatchObject({ composition: { Fe: 1 }, is_synthetic: true })
    // E_form(FeO) = −7.5 − (−8 − 4)/2 = −1.5 against the (excluded) Fe reference energy, so
    // the hull runs Fe corner (0) → FeO (−1.5): at x_O = 0.25 it is −0.75, Fe3O's E_form is
    // −7.5 − (3·−8 − 4)/4 = −0.5, i.e. 0.25 eV/atom above the hull
    expect(model.entries[3].e_above_hull).toBeCloseTo(0.25, 12)
    expect(model.phase_stats?.total).toBe(entries.length)
  })

  test(`supports pseudo-components and rejects an unrenderable arity`, () => {
    const entries = [
      make_phase({ BaO: 1 }, 0),
      make_phase({ TiO2: 1 }, 0),
      make_phase({ BaO: 1, TiO2: 1 }, -1),
    ]
    expect(compute_hull_model(entries, { components: [`BaO`, `TiO2`] }).entries).toHaveLength(
      3,
    )
    expect(() => compute_hull_model([])).toThrow(`found 0`)
  })
})

import {
  compute_energy_mode_info,
  compute_hull_model,
  type HullModel,
} from '$lib/convex-hull/model'
import { describe, expect, expectTypeOf, test } from 'vitest'
import { make_phase } from '../setup'

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

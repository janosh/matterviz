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
  test.each([
    {
      label: `user toggle honoured when precomputed + computable`,
      entries: [...full_refs, compound],
      mode: `precomputed`,
      corrections: false,
      expected: `precomputed`,
      can_compute: true,
    },
    {
      label: `temperature/gas corrections force on-the-fly (precomputed E_form is stale)`,
      entries: [...full_refs, compound],
      mode: `precomputed`,
      corrections: true,
      expected: `on-the-fly`,
      can_compute: true,
    },
    {
      label: `missing precomputed hull distances → on-the-fly`,
      entries: [...full_refs, make_phase({ Fe: 1, O: 1 }, -7.5, { e_form_per_atom: -1 })],
      mode: `precomputed`,
      corrections: false,
      expected: `on-the-fly`,
      can_compute: true,
    },
    {
      label: `no unary reference for O → cannot compute, stays precomputed even with corrections`,
      entries: [make_phase({ Fe: 1 }, -4, precomputed), compound],
      mode: `on-the-fly`,
      corrections: true,
      expected: `precomputed`,
      can_compute: false,
    },
  ] as const)(`$label`, ({ entries, mode, corrections, expected, can_compute }) => {
    const info = compute_energy_mode_info([...entries], mode, corrections)
    expect(info.energy_mode).toBe(expected)
    expect(info.can_compute).toBe(can_compute) // iff every element has a unary reference
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
          make_phase(composition, -1, { entry_id: `stable` }),
          make_phase(composition, 0.25, { entry_id: `unstable` }),
          make_phase(composition, -2, { entry_id: `excluded`, exclude_from_hull: true }),
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
      expectTypeOf(model.hull.facets[0].normal).toEqualTypeOf<readonly number[]>()
      expectTypeOf(model.hull.facets[0].vertex_indices).toEqualTypeOf<readonly number[]>()
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
      expect(model.hull.entries.every((entry) => !entry.exclude_from_hull)).toBe(true)
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

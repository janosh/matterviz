import { compute_energy_mode_info } from '$lib/convex-hull/hull-state.svelte'
import { describe, expect, test } from 'vitest'
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

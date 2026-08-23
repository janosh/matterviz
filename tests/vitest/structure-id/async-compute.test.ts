// The vitest environment has no Worker, so these exercise the synchronous SSR fallback path
// of calc_structure_id_async — including that a thrown error becomes a rejection rather
// than a synchronous throw, which is the contract every caller's .catch() relies on.
import { calc_structure_id, calc_structure_id_async } from '$lib/structure-id'
import {
  structure_from_payload,
  to_structure_id_payload,
} from '$lib/structure-id/worker-payload'
import { describe, expect, test } from 'vitest'
import { make_bcc, make_fcc } from './lattices'

describe(`worker payload`, () => {
  const bulk = make_fcc([2, 2, 2])
  // both queries (fixed cutoff and k-nearest), periodic and not, must see the same geometry
  test.each([
    [`periodic fcc`, bulk, {}],
    [`periodic bcc, fixed`, make_bcc([2, 2, 2]), { cna_mode: `fixed` as const, cutoff: 3.5 }],
    [`slab`, { ...bulk, lattice: { ...bulk.lattice, pbc: [true, true, false] as const } }, {}],
    [`lattice-less cluster`, { sites: make_fcc([3, 3, 3]).sites }, {}],
  ])(`round-trips %s to an identical result`, (_label, structure, options) => {
    const payload = to_structure_id_payload(structure)
    expect(payload.xyz).toHaveLength(structure.sites.length * 3)
    expect(`lattice` in payload).toBe(`lattice` in structure)
    expect(calc_structure_id(structure_from_payload(payload), options)).toEqual(
      calc_structure_id(structure, options),
    )
  })

  test(`rejects a position buffer that is not a whole number of sites`, () => {
    expect(() => structure_from_payload({ xyz: new Float64Array(4) })).toThrow(
      /4 numbers, not a multiple of 3/,
    )
  })
})

describe(`calc_structure_id_async`, () => {
  test(`resolves with the same result the synchronous path produces`, async () => {
    const crystal = make_fcc([2, 2, 2])
    const options = { skip_csp: true }
    const result = await calc_structure_id_async(crystal, options)
    expect(result).toEqual(calc_structure_id(crystal, options))
  })

  test(`dedupes in-flight requests and does not reuse a settled promise`, async () => {
    const crystal = make_fcc([2, 2, 2])
    const first = calc_structure_id_async(crystal, { skip_csp: true })
    const second = calc_structure_id_async(crystal, { skip_csp: true })
    expect(second).toBe(first)
    // Differing options must NOT collapse onto the same entry
    const third = calc_structure_id_async(crystal, { skip_cna: true })
    expect(third).not.toBe(first)
    const [first_result] = await Promise.all([first, second, third])

    const after_settle = calc_structure_id_async(crystal, { skip_csp: true })
    expect(after_settle).not.toBe(first)
    expect(await after_settle).toEqual(first_result)
  })

  test(`rejects rather than throwing synchronously`, async () => {
    // No try/catch around the call itself: a synchronous throw would fail the test here.
    // calc_structure_id's individual validation paths are covered in structure-id.test.ts.
    const promise = calc_structure_id_async({ sites: [] })
    await expect(promise).rejects.toThrow(/structure has no sites/)
  })
})

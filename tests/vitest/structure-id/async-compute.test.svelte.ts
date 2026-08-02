// The vitest environment has no Worker, so these exercise the synchronous SSR fallback path
// of compute_structure_id_async — including that a thrown error becomes a rejection rather
// than a synchronous throw, which is the contract every caller's .catch() relies on.
import { calc_structure_id, compute_structure_id_async } from '$lib/structure-id'
import { describe, expect, test } from 'vitest'
import { make_fcc } from './lattices'

describe(`compute_structure_id_async`, () => {
  test(`resolves with the same result the synchronous path produces`, async () => {
    const crystal = make_fcc([2, 2, 2])
    const options = { skip_csp: true }
    const result = await compute_structure_id_async(crystal, options)
    expect(result).toEqual(calc_structure_id(crystal, options))
  })

  test(`dedupes in-flight requests and does not reuse a settled promise`, async () => {
    const crystal = make_fcc([2, 2, 2])
    const first = compute_structure_id_async(crystal, { skip_csp: true })
    const second = compute_structure_id_async(crystal, { skip_csp: true })
    expect(second).toBe(first)
    // Differing options must NOT collapse onto the same entry
    const third = compute_structure_id_async(crystal, { skip_cna: true })
    expect(third).not.toBe(first)
    const [first_result] = await Promise.all([first, second, third])

    const after_settle = compute_structure_id_async(crystal, { skip_csp: true })
    expect(after_settle).not.toBe(first)
    expect(await after_settle).toEqual(first_result)
  })

  test(`rejects rather than throwing synchronously`, async () => {
    // No try/catch around the call itself: a synchronous throw would fail the test here.
    // calc_structure_id's individual validation paths are covered in structure-id.test.ts.
    const promise = compute_structure_id_async({ sites: [] })
    await expect(promise).rejects.toThrow(/structure has no sites/)
  })
})

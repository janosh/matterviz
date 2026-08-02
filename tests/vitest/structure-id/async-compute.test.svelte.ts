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
    const sync = calc_structure_id(crystal, options)
    expect(result.populations).toEqual(sync.populations)
    expect(result.cna_types).toEqual(sync.cna_types)
  })

  test(`dedupes in-flight requests and does not reuse a settled promise`, async () => {
    const crystal = make_fcc([2, 2, 2])
    const first = compute_structure_id_async(crystal, { skip_csp: true })
    const second = compute_structure_id_async(crystal, { skip_csp: true })
    expect(second).toBe(first)
    // Differing options must NOT collapse onto the same entry
    const third = compute_structure_id_async(crystal, { skip_cna: true })
    expect(third).not.toBe(first)
    await Promise.all([first, second, third])

    const after_settle = compute_structure_id_async(crystal, { skip_csp: true })
    expect(after_settle).not.toBe(first)
    const [first_result, after_result] = await Promise.all([first, after_settle])
    expect(after_result.populations).toEqual(first_result.populations)
  })

  test.each([
    [`no sites`, { sites: [] }, {}, /structure has no sites/],
    [
      `both analyses skipped`,
      undefined,
      { skip_cna: true, skip_csp: true },
      /nothing to compute/,
    ],
    [
      `fixed mode without a cutoff`,
      undefined,
      { cna_mode: `fixed` as const },
      /needs a positive cutoff/,
    ],
  ])(
    `rejects rather than throwing synchronously for %s`,
    async (_label, structure, options, pattern) => {
      const input = structure ?? make_fcc([2, 2, 2])
      // No try/catch around the call itself: a synchronous throw would fail the test here
      const promise = compute_structure_id_async(input, options)
      expect(promise).toBeInstanceOf(Promise)
      await expect(promise).rejects.toThrow(pattern)
    },
  )
})

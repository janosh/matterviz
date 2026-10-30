import { use_async_result } from '#lib/trajectory/async-result.svelte.js'
import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

// Options reach compute as given (an Infinity limit stayed Infinity, not JSON's null) and
// unproxied, and an equal but rebuilt options object starts no second compute
test(`use_async_result passes options by value and recomputes only when they change`, async () => {
  const host = $state({ options: { max_lag: Infinity } })
  const compute = vi.fn(
    async (_input: number, options: { max_lag: number }) => options.max_lag,
  )
  const results: (number | undefined)[] = []
  const dispose = $effect.root(() => {
    use_async_result({
      input: () => 1,
      options: () => host.options, // a $state proxy, as callers pass
      compute,
      set_result: (value) => results.push(value),
      set_loading: () => {},
      set_error: () => {},
    })
  })
  flushSync()
  await Promise.resolve()
  flushSync()
  expect(compute).toHaveBeenCalledOnce()
  const [[, options]] = compute.mock.calls
  expect(options.max_lag).toBe(Infinity)
  expect(() => structuredClone(options)).not.toThrow()
  expect(results.at(-1)).toBe(Infinity)
  host.options = { max_lag: Infinity } // equal, rebuilt
  flushSync()
  expect(compute).toHaveBeenCalledOnce()
  host.options = { max_lag: 50 }
  flushSync()
  expect(compute).toHaveBeenCalledTimes(2)
  dispose()
})

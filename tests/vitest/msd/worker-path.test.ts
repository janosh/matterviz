// Exercises the Web Worker branch of compute_msd_async. happy-dom has no Worker, so
// async-compute.test.ts only ever reaches the synchronous fallback; here a stub Worker
// is installed before the module is imported so the real postMessage plumbing runs.
import type { compute_msd_async as ComputeMsdAsync } from '$lib/msd/async-compute.svelte'
import { calc_msd } from '$lib/msd/calc-msd'
import type { MsdOptions, MsdPositions } from '$lib/msd/index'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drift_positions } from './helpers'

type WorkerMessage = { id: number; input: MsdPositions; options: MsdOptions }
type Listener = (event: {
  data: unknown
  message?: string
  preventDefault: () => void
}) => void

let construction_count = 0
let last_worker_url: string | undefined
let last_worker_options: WorkerOptions | undefined
const posted: { message: WorkerMessage; transfer: Transferable[] }[] = []
// Set to make the next postMessage reply with an error instead of a result
let force_error: string | null = null

class StubWorker {
  private readonly listeners = new Map<string, Listener[]>()

  constructor(url: URL | string, options?: WorkerOptions) {
    construction_count++
    last_worker_url = String(url)
    last_worker_options = options
  }

  addEventListener(type: string, handler: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  postMessage(message: WorkerMessage, transfer: Transferable[] = []): void {
    // The real worker receives a structured clone; if the payload still carried a
    // Svelte $state proxy this would throw, exactly as it would in a browser.
    const cloned = structuredClone(message)
    posted.push({ message: cloned, transfer })
    queueMicrotask(() => {
      const data = force_error
        ? { id: cloned.id, result: null, error: force_error }
        : { id: cloned.id, result: calc_msd(cloned.input, cloned.options), error: null }
      force_error = null
      for (const handler of this.listeners.get(`message`) ?? []) {
        handler({ data, preventDefault: () => {} })
      }
    })
  }
}

let compute_msd_async: typeof ComputeMsdAsync

beforeAll(async () => {
  vi.stubGlobal(`Worker`, StubWorker)
  // Imported after the stub so the module-level singleton picks it up
  ;({ compute_msd_async } = await import(`$lib/msd/async-compute.svelte`))
})

afterEach(() => {
  posted.length = 0
  force_error = null
})

describe(`worker code path`, () => {
  it(`round-trips a request through the worker and matches the sync result`, async () => {
    const positions = drift_positions()
    const result = await compute_msd_async(positions)
    expect(posted).toHaveLength(1)
    expect(result.curves[0].msd).toEqual(calc_msd(positions).curves[0].msd)
  })

  it(`builds the worker exactly once across many computes`, async () => {
    const before = construction_count
    await Promise.all([
      compute_msd_async(drift_positions(20)),
      compute_msd_async(drift_positions(21)),
      compute_msd_async(drift_positions(22)),
    ])
    await compute_msd_async(drift_positions(23))
    expect(construction_count).toBe(before)
    expect(construction_count).toBe(1)
  })

  it(`points the worker at the msd worker module as an ES module`, () => {
    // Vite only detects and rewrites the worker when the URL keeps the `./` prefix and
    // the `.js` extension (see chempot-diagram). Detection turns the source `.js` spec
    // into the real `.ts` module tagged `?worker_file`; losing that means the app would
    // 404 on the worker at runtime and silently never enter this branch.
    expect(last_worker_url).toMatch(/\/src\/lib\/msd\/msd-worker\.ts\?worker_file/)
    expect(last_worker_options).toEqual({ type: `module` })
  })

  it(`sends a structured-cloneable flat payload, never transferring the caller's buffer`, async () => {
    const positions = drift_positions(15)
    await compute_msd_async(positions)
    const { input } = posted[0].message
    expect(input.positions).toBeInstanceOf(Float64Array)
    expect(input.positions).toHaveLength(15 * 2 * 3)
    expect(Array.isArray(input.elements)).toBe(true)
    // Transferring would detach the caller's buffer, which breaks the dedupe cache on a
    // repeat request for the same input, so the buffer is always copied.
    expect(posted[0].transfer).toHaveLength(0)
    expect(positions.positions).toHaveLength(15 * 2 * 3)
  })

  it(`rejects when the worker reports an error`, async () => {
    force_error = `synthetic worker failure`
    await expect(compute_msd_async(drift_positions(16))).rejects.toThrow(
      /synthetic worker failure/,
    )
  })

  it(`dedupes identical in-flight requests to a single postMessage`, async () => {
    const positions = drift_positions(17)
    const [first, second] = [compute_msd_async(positions), compute_msd_async(positions)]
    expect(first).toBe(second)
    await first
    expect(posted).toHaveLength(1)
  })
})

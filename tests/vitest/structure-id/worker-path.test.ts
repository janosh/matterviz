// Exercises the Web Worker branch of calc_structure_id_async. happy-dom has no Worker, so
// async-compute.test.ts only ever reaches the synchronous fallback; here a stub Worker is
// installed before the module is imported so the real postMessage plumbing runs — including the
// structured clone, which is where a Svelte $state proxy or a non-cloneable site property would
// blow up in a browser.
import type { calc_structure_id_async as CalcStructureIdAsync } from '$lib/structure-id/async-compute.svelte'
import { calc_structure_id } from '$lib/structure-id/calc-structure-id'
import type { StructureIdOptions } from '$lib/structure-id/index'
import type { StructureIdPayload } from '$lib/structure-id/worker-payload'
import { structure_from_payload } from '$lib/structure-id/worker-payload'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { make_fcc } from './lattices'

type WorkerMessage = { id: number; input: StructureIdPayload; options: StructureIdOptions }
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

  terminate(): void {}

  postMessage(message: WorkerMessage, transfer: Transferable[] = []): void {
    const cloned = structuredClone(message)
    posted.push({ message: cloned, transfer })
    queueMicrotask(() => {
      // the same decode the real worker (structure-id-worker.ts) performs
      const data = force_error
        ? { id: cloned.id, result: null, error: force_error }
        : {
            id: cloned.id,
            result: calc_structure_id(structure_from_payload(cloned.input), cloned.options),
            error: null,
          }
      force_error = null
      for (const handler of this.listeners.get(`message`) ?? []) {
        handler({ data, preventDefault: () => {} })
      }
    })
  }
}

let calc_structure_id_async: typeof CalcStructureIdAsync

beforeAll(async () => {
  vi.stubGlobal(`Worker`, StubWorker)
  // Imported after the stub so the module-level singleton picks it up
  ;({ calc_structure_id_async } = await import(`$lib/structure-id/async-compute.svelte`))
})

afterEach(() => {
  posted.length = 0
  force_error = null
})

describe(`worker code path`, () => {
  it(`round-trips a cloneable payload through the worker and matches the sync result`, async () => {
    const crystal = make_fcc([2, 2, 2])
    // A non-cloneable site property would throw inside structuredClone if it were forwarded
    crystal.sites[0].properties.on_click = () => {}
    const result = await calc_structure_id_async(crystal)
    expect(posted).toHaveLength(1)
    expect(result).toEqual(calc_structure_id(crystal))
    // Vite only detects and rewrites the worker when the URL keeps the `./` prefix and the
    // `.js` extension. Detection turns the source `.js` spec into the real `.ts` module tagged
    // `?worker_file`; losing that means the app 404s on the worker and silently never enters
    // this branch.
    expect(last_worker_url).toMatch(
      /\/src\/lib\/structure-id\/structure-id-worker\.ts\?worker_file/,
    )
    expect(last_worker_options).toEqual({ type: `module` })
    // Only what the analysis reads crosses the thread: one flat position buffer + lattice
    const { input: payload } = posted[0].message
    expect(Object.keys(payload).toSorted()).toEqual([`lattice`, `xyz`])
    expect(payload.xyz).toBeInstanceOf(Float64Array)
    expect(payload.xyz).toHaveLength(32 * 3)
    expect(Array.from(payload.xyz.subarray(3, 6))).toEqual(crystal.sites[1].xyz)
    expect(payload.lattice?.matrix).toEqual(crystal.lattice.matrix)
    // Nothing is transferred: detaching a caller's buffer would break the dedupe cache
    expect(posted[0].transfer).toHaveLength(0)
  })

  it(`a lattice-less molecule ships no lattice key`, async () => {
    const { sites } = make_fcc([1, 1, 1])
    await calc_structure_id_async({ sites }, { skip_cna: true })
    expect(Object.keys(posted[0].message.input)).toEqual([`xyz`])
  })

  it(`builds the worker exactly once across many computes`, async () => {
    await calc_structure_id_async(make_fcc([2, 2, 2]))
    await Promise.all([
      calc_structure_id_async(make_fcc([2, 2, 3])),
      calc_structure_id_async(make_fcc([2, 3, 3])),
      calc_structure_id_async(make_fcc([3, 3, 3])),
    ])
    expect(construction_count).toBe(1)
  })

  it(`rejects when the worker reports an error`, async () => {
    force_error = `synthetic worker failure`
    await expect(calc_structure_id_async(make_fcc([2, 2, 2]))).rejects.toThrow(
      /synthetic worker failure/,
    )
  })

  it(`dedupes identical in-flight requests to a single postMessage`, async () => {
    const crystal = make_fcc([2, 2, 2])
    const [first, second] = [
      calc_structure_id_async(crystal),
      calc_structure_id_async(crystal),
    ]
    expect(first).toBe(second)
    await first
    expect(posted).toHaveLength(1)
  })
})

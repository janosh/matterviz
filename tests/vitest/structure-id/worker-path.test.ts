// Exercises the Web Worker branch of compute_structure_id_async. happy-dom has no Worker, so
// async-compute.test.svelte.ts only ever reaches the synchronous fallback; here a stub Worker is
// installed before the module is imported so the real postMessage plumbing runs — including the
// structured clone, which is where a Svelte $state proxy or a non-cloneable site property would
// blow up in a browser.
import type { AnyStructure } from '$lib/structure'
import type { compute_structure_id_async as ComputeStructureIdAsync } from '$lib/structure-id/async-compute.svelte'
import { calc_structure_id } from '$lib/structure-id/calc-structure-id'
import type { StructureIdOptions } from '$lib/structure-id/index'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { make_fcc } from './lattices'

type WorkerMessage = { id: number; input: AnyStructure; options: StructureIdOptions }
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
      const data = force_error
        ? { id: cloned.id, result: null, error: force_error }
        : {
            id: cloned.id,
            result: calc_structure_id(cloned.input, cloned.options),
            error: null,
          }
      force_error = null
      for (const handler of this.listeners.get(`message`) ?? []) {
        handler({ data, preventDefault: () => {} })
      }
    })
  }
}

let compute_structure_id_async: typeof ComputeStructureIdAsync

beforeAll(async () => {
  vi.stubGlobal(`Worker`, StubWorker)
  // Imported after the stub so the module-level singleton picks it up
  ;({ compute_structure_id_async } = await import(`$lib/structure-id/async-compute.svelte`))
})

afterEach(() => {
  posted.length = 0
  force_error = null
})

describe(`worker code path`, () => {
  it(`round-trips a request through the worker and matches the sync result`, async () => {
    const crystal = make_fcc([2, 2, 2])
    const result = await compute_structure_id_async(crystal)
    expect(posted).toHaveLength(1)
    const sync = calc_structure_id(crystal)
    expect(result.populations).toEqual(sync.populations)
    expect(result.centrosymmetry).toEqual(sync.centrosymmetry)
    // Vite only detects and rewrites the worker when the URL keeps the `./` prefix and the
    // `.js` extension. Detection turns the source `.js` spec into the real `.ts` module tagged
    // `?worker_file`; losing that means the app 404s on the worker and silently never enters
    // this branch.
    expect(last_worker_url).toMatch(
      /\/src\/lib\/structure-id\/structure-id-worker\.ts\?worker_file/,
    )
    expect(last_worker_options).toEqual({ type: `module` })
  })

  it(`builds the worker exactly once across many computes`, async () => {
    await compute_structure_id_async(make_fcc([2, 2, 2]))
    const before = construction_count
    await Promise.all([
      compute_structure_id_async(make_fcc([2, 2, 3])),
      compute_structure_id_async(make_fcc([2, 3, 3])),
      compute_structure_id_async(make_fcc([3, 3, 3])),
    ])
    expect(construction_count).toBe(before)
    expect(before).toBe(1)
  })

  it(`sends a cloneable payload carrying only what the analysis reads`, async () => {
    const crystal = make_fcc([2, 2, 2])
    // A non-cloneable site property would throw inside structuredClone if it were forwarded
    crystal.sites[0].properties.on_click = () => {}
    await compute_structure_id_async(crystal)
    const { input: structure } = posted[0].message
    expect(structure.sites).toHaveLength(32)
    expect(structure.sites[0].properties).toEqual({})
    expect(`lattice` in structure && structure.lattice.matrix).toEqual(crystal.lattice.matrix)
    // Nothing is transferred: detaching a caller's buffer would break the dedupe cache
    expect(posted[0].transfer).toHaveLength(0)
  })

  it(`rejects when the worker reports an error`, async () => {
    force_error = `synthetic worker failure`
    await expect(compute_structure_id_async(make_fcc([2, 2, 2]))).rejects.toThrow(
      /synthetic worker failure/,
    )
  })

  it(`dedupes identical in-flight requests to a single postMessage`, async () => {
    const crystal = make_fcc([2, 2, 2])
    const [first, second] = [
      compute_structure_id_async(crystal),
      compute_structure_id_async(crystal),
    ]
    expect(first).toBe(second)
    await first
    expect(posted).toHaveLength(1)
  })
})

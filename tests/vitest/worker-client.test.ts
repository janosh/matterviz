// The shared worker client's teardown rules were each learned from a bug, so they need
// tests that fail when the rule is removed - deleting `messageerror` or `terminate()` used
// to leave every module's suite green.
import { create_worker_client } from '$lib/worker-client.svelte'
import { serve_worker } from '$lib/worker-serve'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { install_stub_worker, type StubWorkerInstance, type StubWorkerMessage } from './setup'

// Installed without a `compute`, so the stub records posts and never replies unless told to
let stub: ReturnType<typeof install_stub_worker<StubWorkerMessage>>
const workers = (): StubWorkerInstance[] => stub.instances
const first_post = (worker: StubWorkerInstance) => worker.posted[0].message

const make_client = <Result = string>(
  compute_sync: () => Result = (() => `sync`) as () => Result,
) =>
  create_worker_client<{ tag: string }, Record<string, unknown>, Result>({
    label: `Test`,
    create_worker: () => new Worker(`stub`),
    compute_sync,
    build_payload: (input) => input,
  })

// Fire in-flight requests that share one input identity; return how many posts were sent
const posted_count = (...options_list: Record<string, unknown>[]): number => {
  const run = make_client()
  const input = { tag: `a` }
  for (const options of options_list) void run(input, options).catch(() => {})
  return workers()[0].posted.length
}

beforeEach(() => {
  stub = install_stub_worker()
})
describe(`worker teardown`, () => {
  test.each([
    {
      desc: `messageerror`,
      emit: (worker: StubWorkerInstance) => worker.emit(`messageerror`, {}),
      expected: /could not be deserialized/,
    },
    {
      desc: `error`,
      emit: (worker: StubWorkerInstance) =>
        worker.emit(`error`, { message: `boom`, preventDefault: () => {} }),
      expected: /boom/,
    },
    {
      // serve_worker's reply when the REQUEST failed to deserialize on the worker side
      desc: `id-less error reply`,
      emit: (worker: StubWorkerInstance) =>
        worker.emit(`message`, {
          data: { id: null, result: null, error: `request could not be deserialized` },
        }),
      expected: /request could not be deserialized/,
    },
  ])(
    `a $desc event rejects pending work and terminates the worker`,
    async ({ emit, expected }) => {
      const run = make_client()
      const input = { tag: `a` }
      const pending = run(input, {})
      const [worker] = workers()
      expect(worker.posted).toHaveLength(1)

      emit(worker)
      await expect(pending).rejects.toThrow(expected)
      // leaving the worker alive would keep handing out a dead channel
      expect(worker.terminated).toBe(1)

      // the poisoned key must be gone: the same request has to reach a NEW worker
      const retry = run(input, {})
      expect(workers()).toHaveLength(2)
      expect(workers()[1].posted).toHaveLength(1)
      void retry.catch(() => {})
    },
  )

  test(`explicit cancellation rejects pending work and starts the replacement immediately`, async () => {
    const run = make_client()
    const input = { tag: `same` }
    const first = run(input, {})
    const first_worker = workers()[0]

    run.cancel(`superseded`)
    const second = run(input, {})
    await expect(first).rejects.toThrow(`superseded`)
    expect(first_worker.terminated).toBe(1)

    expect(workers()).toHaveLength(2)
    expect(first_post(workers()[1]).input).toEqual(input)
    expect(run(input, {})).toBe(second)
    expect(workers()[1].posted).toHaveLength(1)
    void second.catch(() => {})
  })

  test(`release terminates an idle worker but leaves in-flight requests alone`, async () => {
    const run = make_client()
    const pending = run({ tag: `busy` }, {})
    const [worker] = workers()
    // Another pane unmounting must not reject this pane's request
    run.release()
    expect(worker.terminated).toBe(0)
    worker.emit(`message`, {
      data: { id: first_post(worker).id, result: `done`, error: null },
    })
    await expect(pending).resolves.toBe(`done`)
    run.release()
    expect(worker.terminated).toBe(1)
    // the next request constructs a fresh worker
    void run({ tag: `next` }, {}).catch(() => {})
    expect(workers()).toHaveLength(2)
  })
})

describe(`request dedupe`, () => {
  test(`nested key order shares one in-flight request`, () => {
    expect(
      posted_count({ fit: { start: 0.1, end: 0.8 } }, { fit: { end: 0.8, start: 0.1 } }),
    ).toBe(1)
  })

  test(`keys that collate equally are still ordered deterministically`, () => {
    const decomposed_accent = `e\u0301`
    const composed_accent = `\u00E9`
    expect(
      posted_count(
        { [decomposed_accent]: 1, [composed_accent]: 2 },
        { [composed_accent]: 2, [decomposed_accent]: 1 },
      ),
    ).toBe(1)
  })

  test(`arrays retain order and cannot collide with plain objects`, () => {
    expect(
      posted_count(
        { value: { alpha: 1 }, values: [1, null] },
        { value: [[`alpha`, 1]], values: [1, null] },
        { value: { alpha: 1 }, values: [null, 1] },
      ),
    ).toBe(3)
  })

  test(`non-plain options use identity`, () => {
    const date = new Date(`2025-01-01T00:00:00Z`)
    const cloned_date = new Date(date)
    expect(posted_count({ value: date }, { value: date }, { value: cloned_date })).toBe(2)
  })

  test(`distinct inputs are never conflated, however alike`, () => {
    const run = make_client()
    void run({ tag: `a` }, {}).catch(() => {})
    void run({ tag: `a` }, {}).catch(() => {})
    // same shape, different object: a content hash would merge these, identity must not
    expect(workers()[0].posted).toHaveLength(2)
  })
})

test(`falls back to compute_sync when Worker is missing`, async () => {
  vi.stubGlobal(`Worker`, undefined)
  const run = make_client()
  await expect(run({ tag: `a` }, {})).resolves.toBe(`sync`)
  expect(workers()).toHaveLength(0)
})

test(`a throwing compute_sync rejects asynchronously and frees the dedupe key`, async () => {
  vi.stubGlobal(`Worker`, undefined)
  const run = make_client(() => {
    throw new Error(`bad input`)
  })
  const input = { tag: `a` }
  let promise: Promise<unknown> | undefined
  expect(() => (promise = run(input, {}))).not.toThrow()
  await expect(promise).rejects.toThrow(`bad input`)
  // A retry must be a fresh promise, not the settled rejection
  await expect(run(input, {})).rejects.toThrow(`bad input`)
})

test(`falls back to compute_sync when the worker constructor throws, and stops retrying it`, async () => {
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const create_worker = vi.fn(() => {
    throw new DOMException(`cannot be accessed from origin`, `SecurityError`)
  })
  const run = create_worker_client<{ tag: string }, Record<string, unknown>, string>({
    label: `Test`,
    create_worker,
    compute_sync: ({ tag }) => `sync:${tag}`,
    build_payload: (input) => input,
  })
  await expect(run({ tag: `a` }, {})).resolves.toBe(`sync:a`)
  await expect(run({ tag: `b` }, {})).resolves.toBe(`sync:b`)
  expect(create_worker).toHaveBeenCalledOnce()
  expect(warn).toHaveBeenCalledOnce()
  warn.mockRestore()
})

test(`an explicit null result is delivered rather than reported as missing`, async () => {
  const run = make_client<number | null>(() => 0)
  const pending = run({ tag: `a` }, {})
  const [worker] = workers()
  worker.emit(`message`, { data: { id: first_post(worker).id, result: null, error: null } })
  await expect(pending).resolves.toBeNull()
})

test.each([
  {
    desc: `worker error`,
    response: { result: null, error: `boom` },
    expected: /boom/,
  },
  {
    desc: `undefined result`,
    response: { result: undefined, error: null },
    expected: /Test worker returned no result for request 1/,
  },
])(`a $desc rejects with the expected message`, async ({ response, expected }) => {
  const run = make_client()
  const pending = run({ tag: `a` }, {})
  const [worker] = workers()
  worker.emit(`message`, { data: { id: first_post(worker).id, ...response } })
  await expect(pending).rejects.toThrow(expected)
})

describe(`per-request options`, () => {
  test(`progress messages reach every caller sharing the request, results settle it`, async () => {
    const run = make_client()
    const input = { tag: `a` }
    const seen: unknown[][] = [[], []]
    const first = run(input, {}, { on_progress: (progress) => seen[0].push(progress) })
    const second = run(input, {}, { on_progress: (progress) => seen[1].push(progress) })
    const [worker] = workers()
    expect(worker.posted).toHaveLength(1)
    const { id } = first_post(worker)
    worker.emit(`message`, { data: { id, progress: 0.5 } })
    worker.emit(`message`, { data: { id, progress: 1 } })
    worker.emit(`message`, { data: { id, result: `done`, error: null } })
    await expect(Promise.all([first, second])).resolves.toEqual([`done`, `done`])
    expect(seen).toEqual([
      [0.5, 1],
      [0.5, 1],
    ])
  })

  test(`aborting the only waiter frees the key and terminates the busy worker at once`, async () => {
    const run = make_client()
    const input = { tag: `a` }
    const controller = new AbortController()
    const pending = run(input, {}, { signal: controller.signal })
    const [worker] = workers()
    controller.abort(new Error(`superseded`))
    await expect(pending).rejects.toThrow(`superseded`)
    // the abandoned compute is still running inside the worker: keeping it alive would make
    // the next request queue behind it
    expect(worker.terminated).toBe(1)
    // a replacement is pre-warmed immediately so the next request does not pay a cold start
    expect(workers()).toHaveLength(2)
    expect(workers()[1].posted).toHaveLength(0)
    // the dropped request must not be handed out again
    void run(input, {}).catch(() => {})
    expect(workers()).toHaveLength(2)
    expect(workers()[1].posted).toHaveLength(1)
  })

  test(`an abort followed by a new request reuses the pre-warmed worker`, async () => {
    // The option-keystroke pattern of use_async_result: abort the superseded compute, then
    // request again in the same tick
    const run = make_client()
    const input = { tag: `a` }
    const controller = new AbortController()
    const aborted = run(input, { lag: 1 }, { signal: controller.signal })
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: `AbortError` })
    const kept = run(input, { lag: 2 })
    // exactly two workers ever: the terminated one and its eager replacement; no third
    expect(workers()).toHaveLength(2)
    const [old_worker, worker] = workers()
    expect(old_worker.terminated).toBe(1)
    expect(old_worker.posted).toHaveLength(1)
    expect(worker.terminated).toBe(0)
    expect(worker.posted).toHaveLength(1)
    expect(first_post(worker).options).toEqual({ lag: 2 })
    worker.emit(`message`, {
      data: { id: first_post(worker).id, result: `done`, error: null },
    })
    await expect(kept).resolves.toBe(`done`)
  })

  test(`a reply from the terminated worker does not settle the replacement's request`, async () => {
    const run = make_client()
    const controller = new AbortController()
    const aborted = run({ tag: `a` }, {}, { signal: controller.signal })
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: `AbortError` })
    const kept = run({ tag: `b` }, {})
    const [old_worker, worker] = workers()
    // a late reply for the aborted id (real workers never deliver after terminate, but the
    // id must be forgotten regardless) leaves the live request pending
    old_worker.emit(`message`, {
      data: { id: first_post(old_worker).id, result: `stale`, error: null },
    })
    let settled = false
    void kept.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    worker.emit(`message`, {
      data: { id: first_post(worker).id, result: `done`, error: null },
    })
    await expect(kept).resolves.toBe(`done`)
  })

  test(`aborting one of two waiters keeps the shared request and worker alive`, async () => {
    const run = make_client()
    const input = { tag: `a` }
    const controller = new AbortController()
    const aborted = run(input, {}, { signal: controller.signal })
    const kept = run(input, {})
    const [worker] = workers()
    controller.abort(new Error(`no longer needed`))
    await expect(aborted).rejects.toThrow(`no longer needed`)
    expect(worker.terminated).toBe(0)
    worker.emit(`message`, {
      data: { id: first_post(worker).id, result: `done`, error: null },
    })
    await expect(kept).resolves.toBe(`done`)
  })

  test(`aborting after the result arrived is a no-op`, async () => {
    const run = make_client()
    const controller = new AbortController()
    const pending = run({ tag: `a` }, {}, { signal: controller.signal })
    const [worker] = workers()
    worker.emit(`message`, {
      data: { id: first_post(worker).id, result: `done`, error: null },
    })
    await expect(pending).resolves.toBe(`done`)
    controller.abort()
    expect(worker.terminated).toBe(0)
  })

  test(`an already-aborted signal rejects without posting`, async () => {
    const run = make_client()
    const signal = AbortSignal.abort()
    await expect(run({ tag: `a` }, {}, { signal })).rejects.toMatchObject({
      name: `AbortError`,
    })
    expect(workers()[0]?.posted ?? []).toHaveLength(0)
  })
})

test(`serve_worker answers an undeserializable request with an id-less error reply`, () => {
  // Stand in for the worker global scope: record listeners and posted replies
  const listeners = new Map<string, (event: unknown) => void>()
  const posted: unknown[] = []
  vi.stubGlobal(`self`, {
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      listeners.set(type, handler),
    postMessage: (message: unknown) => posted.push(message),
  })
  serve_worker((input: number) => input * 2)
  listeners.get(`message`)?.({ data: { id: 7, input: 21, options: {} } })
  listeners.get(`messageerror`)?.({})
  expect(posted).toEqual([
    { id: 7, result: 42, error: null },
    { id: null, result: null, error: expect.stringMatching(/could not be deserialized/) },
  ])
})

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
const reply = (worker: StubWorkerInstance, result: unknown = `done`) =>
  worker.emit(`message`, { data: { id: first_post(worker).id, result, error: null } })

const make_client = <Result = string>(
  compute_sync: (
    input: { tag: string },
    options: Record<string, unknown> | undefined,
    on_progress?: (progress: unknown) => void,
  ) => Result = (() => `sync`) as () => Result,
) =>
  create_worker_client<{ tag: string }, Record<string, unknown>, Result>({
    label: `Test`,
    create_worker: () => new Worker(`stub`),
    compute_sync,
    build_payload: (input) => input,
  })

const make_progress_client = () =>
  make_client((_input, _options, on_progress) => {
    on_progress?.(0.5)
    on_progress?.(1)
    return `done`
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
    [`messageerror`, {}, /could not be deserialized/],
    [`error`, { message: `boom`, preventDefault: () => {} }, /boom/],
    // serve_worker's reply when the REQUEST failed to deserialize on the worker side
    [
      `message`,
      { data: { id: null, result: null, error: `request could not be deserialized` } },
      /request could not be deserialized/,
    ],
  ] as const)(
    `a %s event rejects pending work and terminates the worker`,
    async (event, data, expected) => {
      const run = make_client()
      const input = { tag: `a` }
      const pending = run(input, {})
      const [worker] = workers()
      expect(worker.posted).toHaveLength(1)

      worker.emit(event, data)
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
    reply(worker)
    await expect(pending).resolves.toBe(`done`)
    run.release()
    expect(worker.terminated).toBe(1)
    // the next request constructs a fresh worker
    void run({ tag: `next` }, {}).catch(() => {})
    expect(workers()).toHaveLength(2)
  })
})

describe(`request dedupe`, () => {
  test.each([
    [
      `nested key order`,
      [{ fit: { start: 0.1, end: 0.8 } }, { fit: { end: 0.8, start: 0.1 } }],
      1,
    ],
    [
      `keys that collate equally`,
      [
        { 'e\u0301': 1, '\u00E9': 2 },
        { '\u00E9': 2, 'e\u0301': 1 },
      ],
      1,
    ],
    [
      `ordered arrays and plain objects`,
      [
        { value: { alpha: 1 }, values: [1, null] },
        { value: [[`alpha`, 1]], values: [1, null] },
        { value: { alpha: 1 }, values: [null, 1] },
      ],
      3,
    ],
    [
      `primitive types`,
      [true, false, 1, 1n, `1`, null, undefined].map((value) => ({ value })),
      7,
    ],
    [`special numbers`, [0, -0, NaN, NaN, Infinity, -Infinity].map((value) => ({ value })), 5],
  ] as const)(
    `deduplicates %s without conflating distinct options`,
    (_label, options, count) => {
      expect(posted_count(...options)).toBe(count)
    },
  )

  test.each([() => {}, Symbol(`not cloneable`)])(
    `rejects uncloneable primitive %s`,
    async (value) => {
      await expect(make_client()({ tag: `a` }, { value })).rejects.toThrow(
        `Test worker options cannot contain ${typeof value} values`,
      )
      expect(workers()).toHaveLength(0)
    },
  )

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

  test(`omitted options remain distinct from an explicit empty object`, async () => {
    vi.stubGlobal(`Worker`, undefined)
    const run = make_client((_input, options) =>
      options === undefined ? `default` : `explicit`,
    )
    const input = { tag: `a` }
    await expect(Promise.all([run(input), run(input, {})])).resolves.toEqual([
      `default`,
      `explicit`,
    ])
  })
})

test(`falls back to compute_sync when Worker is missing`, async () => {
  vi.stubGlobal(`Worker`, undefined)
  const progress = vi.fn()
  const run = make_client((_input, _options, on_progress) => {
    on_progress?.(0.5)
    return `sync`
  })
  await expect(run({ tag: `a` }, {}, { on_progress: progress })).resolves.toBe(`sync`)
  expect(progress).toHaveBeenCalledExactlyOnceWith(0.5)
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

test(`worker construction failures reject without moving work onto the main thread`, async () => {
  const create_worker = vi.fn(() => {
    throw new DOMException(`cannot be accessed from origin`, `SecurityError`)
  })
  const compute_sync = vi.fn(({ tag }: { tag: string }) => `sync:${tag}`)
  const run = create_worker_client<{ tag: string }, Record<string, unknown>, string>({
    label: `Test`,
    create_worker,
    compute_sync,
    build_payload: (input) => input,
  })
  await expect(run({ tag: `a` }, {})).rejects.toThrow(`cannot be accessed from origin`)
  await expect(run({ tag: `b` }, {})).rejects.toThrow(`cannot be accessed from origin`)
  expect(create_worker).toHaveBeenCalledTimes(2)
  expect(compute_sync).not.toHaveBeenCalled()
})

test(`a failed post frees the key before an immediate retry`, async () => {
  const run = make_client()
  const input = { tag: `a` }
  // A class instance uses identity for the key but can still fail structured clone.
  const options = {
    value: new (class Options {
      callback = () => `not cloneable`
    })(),
  }
  const first = run(input, options)
  Reflect.deleteProperty(options.value, `callback`)
  const second = run(input, options)
  expect(second).not.toBe(first)
  await expect(first).rejects.toMatchObject({ name: `DataCloneError` })
  expect(workers()[0].posted).toHaveLength(1)
  reply(workers()[0])
  await expect(second).resolves.toBe(`done`)
})

test.each([
  [`abort`, /abort/i, 0],
  [`cancel`, /cancel/i, 0],
  [`progress`, null, 1],
  [`progress-error`, /progress failed/, 1],
  [`error`, /provider failed/, 1],
] as const)(
  `main-thread-only requests share the client lifecycle: %s`,
  async (action, expected_error, provider_calls) => {
    const provider = vi.fn(() => {
      if (action === `error`) throw new Error(`provider failed`)
      return `done`
    })
    const build_payload = vi.fn(() => {
      throw new Error(`must not clone a provider`)
    })
    const run = create_worker_client({
      label: `Provider`,
      create_worker: () => new Worker(`stub`),
      compute_sync: (
        input: { provider: () => string },
        _options: { provider: () => string } | undefined,
        on_progress?: (value: number) => void,
      ) => {
        on_progress?.(1)
        return input.provider()
      },
      build_payload,
      requires_main_thread: () => true,
    })
    const controller = new AbortController()
    const on_progress = vi.fn(() => {
      if (action === `progress-error`) throw new Error(`progress failed`)
    })
    const pending = run({ provider }, { provider }, { signal: controller.signal, on_progress })
    if (action === `abort`) controller.abort()
    else if (action === `cancel`) run.cancel()
    if (expected_error) await expect(pending).rejects.toThrow(expected_error)
    else {
      await expect(pending).resolves.toBe(`done`)
      expect(on_progress).toHaveBeenCalledExactlyOnceWith(1)
    }
    expect(provider).toHaveBeenCalledTimes(provider_calls)
    expect(build_payload).not.toHaveBeenCalled()
    expect(workers()).toHaveLength(0)
  },
)

test.each([
  [null, null, null], // An explicit null is a valid result, not a missing one.
  [null, `boom`, /boom/],
  [undefined, null, /Test worker returned no result for request 1/],
] as const)(`handles result=%s, error=%s`, async (result, error, expected_error) => {
  const run = make_client<string | null>(() => null)
  const pending = run({ tag: `a` }, {})
  const [worker] = workers()
  worker.emit(`message`, { data: { id: first_post(worker).id, result, error } })
  if (expected_error) await expect(pending).rejects.toThrow(expected_error)
  else await expect(pending).resolves.toBeNull()
})

describe(`per-request options`, () => {
  test.each([
    { use_worker: true, shared: true },
    { use_worker: false, shared: true },
    { use_worker: true, shared: false },
    { use_worker: false, shared: false },
  ])(
    `throwing progress rejects only its caller (worker=$use_worker, shared=$shared)`,
    async ({ use_worker, shared }) => {
      if (!use_worker) vi.stubGlobal(`Worker`, undefined)
      const run = make_progress_client()
      const input = { tag: `a` }
      const error = new Error(`progress failed`)
      const throwing = vi.fn(() => {
        throw error
      })
      const failed = run(input, {}, { on_progress: throwing })
      const progress = vi.fn()
      const kept = shared ? run(input, {}, { on_progress: progress }) : undefined
      if (use_worker) {
        const [worker] = workers()
        const { id } = first_post(worker)
        expect(() => worker.emit(`message`, { data: { id, progress: 0.5 } })).not.toThrow()
        expect(worker.terminated).toBe(shared ? 0 : 1)
        worker.emit(`message`, { data: { id, progress: 1 } })
        reply(worker)
      }
      await expect(failed).rejects.toBe(error)
      expect(throwing).toHaveBeenCalledExactlyOnceWith(0.5)
      if (kept) {
        await expect(kept).resolves.toBe(`done`)
        expect(progress.mock.calls).toEqual([[0.5], [1]])
      }
      // Failed/finished subscriptions must not poison this input's dedupe key.
      const retry = run(input, {})
      if (use_worker) {
        const worker = workers().at(-1)
        if (!worker) throw new Error(`retry did not create a worker`)
        const { id } = worker.posted.at(-1)?.message ?? {}
        worker.emit(`message`, { data: { id, result: `done`, error: null } })
      }
      await expect(retry).resolves.toBe(`done`)
      run.release()
    },
  )

  test.each([true, false])(
    `progress defers new subscriptions and skips cancelled ones (worker=%s)`,
    async (use_worker) => {
      if (!use_worker) vi.stubGlobal(`Worker`, undefined)
      const run = make_progress_client()
      const input = { tag: `reentrant` }
      const controller = new AbortController()
      const seen: unknown[] = []
      const joined: Promise<string>[] = []
      const on_progress = (progress: unknown) => {
        seen.push(progress)
        controller.abort()
        // Cap the old live-Set loop so a regression fails instead of hanging the suite.
        if (progress === 0.5 && seen.length < 5) joined.push(run(input, {}, { on_progress }))
      }
      const pending = run(input, {}, { on_progress })
      const cancelled_progress = vi.fn()
      const cancelled = run(
        input,
        {},
        {
          signal: controller.signal,
          on_progress: cancelled_progress,
        },
      )
      if (use_worker) {
        const [worker] = workers()
        const { id } = first_post(worker)
        worker.emit(`message`, { data: { id, progress: 0.5 } })
        worker.emit(`message`, { data: { id, progress: 1 } })
        reply(worker)
      }
      await expect(cancelled).rejects.toMatchObject({ name: `AbortError` })
      await expect(Promise.all([pending, ...joined])).resolves.toEqual([`done`, `done`])
      expect(seen).toEqual([0.5, 1, 1])
      expect(cancelled_progress).not.toHaveBeenCalled()
    },
  )

  test.each([
    { use_worker: true, shared_options: false },
    { use_worker: false, shared_options: false },
    { use_worker: true, shared_options: true },
    { use_worker: false, shared_options: true },
  ])(
    `progress reaches every shared caller (worker=$use_worker, shared options=$shared_options)`,
    async ({ use_worker, shared_options }) => {
      if (!use_worker) vi.stubGlobal(`Worker`, undefined)
      const run = make_progress_client()
      const input = { tag: `a` }
      const seen: unknown[][] = [[], []]
      const options = { on_progress: (progress: unknown) => seen[0].push(progress) }
      const first = run(input, {}, options)
      const second = run(
        input,
        {},
        shared_options ? options : { on_progress: (progress) => seen[1].push(progress) },
      )
      if (use_worker) {
        const [worker] = workers()
        expect(worker.posted).toHaveLength(1)
        const { id: identifier } = first_post(worker)
        worker.emit(`message`, { data: { id: identifier, progress: 0.5 } })
        worker.emit(`message`, { data: { id: identifier, progress: 1 } })
        worker.emit(`message`, { data: { id: identifier, result: `done`, error: null } })
      }
      await expect(Promise.all([first, second])).resolves.toEqual([`done`, `done`])
      expect(seen).toEqual(
        shared_options
          ? [[0.5, 0.5, 1, 1], []]
          : [
              [0.5, 1],
              [0.5, 1],
            ],
      )
    },
  )

  test.each([
    [`same options and explicit reason`, {}, {}, new Error(`superseded`)],
    [`changed options and default reason`, { lag: 1 }, { lag: 2 }, undefined],
  ] as const)(
    `aborting the only waiter frees its key and creates one replacement: %s`,
    async (_label, options, next_options, reason) => {
      const run = make_client()
      const input = { tag: `a` }
      const controller = new AbortController()
      const aborted = run(input, options, { signal: controller.signal })
      const [old_worker] = workers()
      controller.abort(reason)
      await expect(aborted).rejects.toEqual(
        reason ?? expect.objectContaining({ name: `AbortError` }),
      )
      expect(old_worker.terminated).toBe(1)
      expect(old_worker.posted).toHaveLength(1)
      // Abort leaves no unused replacement; the next request creates exactly one.
      expect(workers()).toHaveLength(1)
      const kept = run(input, next_options)
      expect(workers()).toHaveLength(2)
      const worker = workers()[1]
      expect(worker.terminated).toBe(0)
      expect(worker.posted).toHaveLength(1)
      expect(first_post(worker).options).toEqual(next_options)
      reply(worker)
      await expect(kept).resolves.toBe(`done`)
    },
  )

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
    reply(old_worker, `stale`)
    old_worker.emit(`error`, { message: `stale error`, preventDefault: () => {} })
    old_worker.emit(`messageerror`, {})
    old_worker.emit(`message`, { data: { id: null, error: `stale decode error` } })
    let settled = false
    void kept.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    reply(worker)
    await expect(kept).resolves.toBe(`done`)
  })

  test.each([true, false])(
    `aborting one waiter preserves the other (progress=%s)`,
    async (progress) => {
      const run = make_client()
      const input = { tag: `a` }
      const controller = new AbortController()
      const on_progress = vi.fn()
      const aborted = run(input, {}, { signal: controller.signal, on_progress })
      const kept = run(input, {}, progress ? { on_progress } : {})
      const [worker] = workers()
      controller.abort(new Error(`no longer needed`))
      await expect(aborted).rejects.toThrow(`no longer needed`)
      expect(worker.terminated).toBe(0)
      worker.emit(`message`, { data: { id: first_post(worker).id, progress: 0.5 } })
      if (progress) expect(on_progress).toHaveBeenCalledExactlyOnceWith(0.5)
      else expect(on_progress).not.toHaveBeenCalled()
      reply(worker)
      await expect(kept).resolves.toBe(`done`)
    },
  )

  test(`aborting after the result arrived is a no-op`, async () => {
    const run = make_client()
    const controller = new AbortController()
    const pending = run({ tag: `a` }, {}, { signal: controller.signal })
    const [worker] = workers()
    reply(worker)
    controller.abort()
    await expect(pending).resolves.toBe(`done`)
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

test.each([`abort`, `cancel`] as const)(
  `%s prevents queued synchronous computation`,
  async (action) => {
    vi.stubGlobal(`Worker`, undefined)
    const compute_sync = vi.fn(() => `done`)
    const run = make_client(compute_sync)
    const controller = new AbortController()
    const pending = run({ tag: `a` }, {}, { signal: controller.signal })
    if (action === `abort`) controller.abort()
    else run.cancel()
    await expect(pending).rejects.toThrow(/abort|cancel/i)
    expect(compute_sync).not.toHaveBeenCalled()
  },
)

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

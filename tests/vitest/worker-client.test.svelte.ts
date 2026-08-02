// The shared worker client's teardown rules were each learned from a bug, so they need
// tests that fail when the rule is removed - deleting `messageerror` or `terminate()` used
// to leave every module's suite green.
import { create_worker_client } from '$lib/worker-client.svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

type Listener = (event: unknown) => void

// Minimal Worker stand-in: records posts, never replies unless told to, counts terminations
class FakeWorker {
  static instances: FakeWorker[] = []
  posted: { id: number; input: unknown; options: unknown }[] = []
  terminated = 0
  listeners = new Map<string, Listener[]>()

  constructor() {
    FakeWorker.instances.push(this)
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  postMessage(message: { id: number; input: unknown; options: unknown }) {
    this.posted.push(message)
  }
  terminate() {
    this.terminated++
  }
  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const make_client = () =>
  create_worker_client<{ tag: string }, Record<string, unknown>, string>({
    label: `Test`,
    create_worker: () => new FakeWorker() as unknown as Worker,
    compute_sync: () => `sync`,
    build_payload: (input) => input,
  })

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal(`Worker`, FakeWorker)
})

describe(`worker teardown`, () => {
  test.each([
    {
      desc: `messageerror`,
      emit: (worker: FakeWorker) => worker.emit(`messageerror`, {}),
      expected: /could not be deserialized/,
    },
    {
      desc: `error`,
      emit: (worker: FakeWorker) =>
        worker.emit(`error`, { message: `boom`, preventDefault: () => {} }),
      expected: /boom/,
    },
  ])(
    `a $desc event rejects pending work and terminates the worker`,
    async ({ emit, expected }) => {
      const run = make_client()
      const input = { tag: `a` }
      const pending = run(input, {})
      const [worker] = FakeWorker.instances
      expect(worker.posted).toHaveLength(1)

      emit(worker)
      await expect(pending).rejects.toThrow(expected)
      // leaving the worker alive would keep handing out a dead channel
      expect(worker.terminated).toBe(1)

      // the poisoned key must be gone: the same request has to reach a NEW worker
      const retry = run(input, {})
      expect(FakeWorker.instances).toHaveLength(2)
      expect(FakeWorker.instances[1].posted).toHaveLength(1)
      void retry.catch(() => {})
    },
  )
})

describe(`request dedupe`, () => {
  test(`in-flight requests for the same input and options share one post`, () => {
    const run = make_client()
    const input = { tag: `a` }
    void run(input, { alpha: 1 }).catch(() => {})
    void run(input, { alpha: 1 }).catch(() => {})
    expect(FakeWorker.instances[0].posted).toHaveLength(1)
  })

  test.each([
    { desc: `top-level`, first: { alpha: 1, beta: 2 }, second: { beta: 2, alpha: 1 } },
    {
      desc: `nested`,
      first: { fit: { start: 0.1, end: 0.8 } },
      second: { fit: { end: 0.8, start: 0.1 } },
    },
  ])(`$desc option key order does not split one request in two`, ({ first, second }) => {
    const run = make_client()
    const input = { tag: `a` }
    void run(input, first).catch(() => {})
    void run(input, second).catch(() => {})
    expect(FakeWorker.instances[0].posted).toHaveLength(1)
  })

  test(`distinct inputs are never conflated, however alike`, () => {
    const run = make_client()
    void run({ tag: `a` }, {}).catch(() => {})
    void run({ tag: `a` }, {}).catch(() => {})
    // same shape, different object: a content hash would merge these, identity must not
    expect(FakeWorker.instances[0].posted).toHaveLength(2)
  })
})

test(`a falsy result is delivered rather than reported as no result`, async () => {
  const run = create_worker_client<{ tag: string }, Record<string, unknown>, number>({
    label: `Test`,
    create_worker: () => new FakeWorker() as unknown as Worker,
    compute_sync: () => 0,
    build_payload: (input) => input,
  })
  const pending = run({ tag: `a` }, {})
  const [worker] = FakeWorker.instances
  worker.emit(`message`, { data: { id: worker.posted[0].id, result: 0, error: null } })
  await expect(pending).resolves.toBe(0)
})

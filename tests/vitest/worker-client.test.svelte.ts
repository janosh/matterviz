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
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  postMessage(message: { id: number; input: unknown; options: unknown }): void {
    this.posted.push(message)
  }
  terminate(): void {
    this.terminated++
  }
  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const make_client = <Result = string>(
  compute_sync: () => Result = (() => `sync`) as () => Result,
) =>
  create_worker_client<{ tag: string }, Record<string, unknown>, Result>({
    label: `Test`,
    create_worker: () => new FakeWorker() as unknown as Worker,
    compute_sync,
    build_payload: (input) => input,
  })

// Fire in-flight requests that share one input identity; return how many posts were sent
const posted_count = (...options_list: Record<string, unknown>[]): number => {
  const run = make_client()
  const input = { tag: `a` }
  for (const options of options_list) void run(input, options).catch(() => {})
  return FakeWorker.instances[0].posted.length
}

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

  test(`explicit cancellation rejects pending work and starts the replacement immediately`, async () => {
    const run = make_client()
    const input = { tag: `same` }
    const first = run(input, {})
    const first_worker = FakeWorker.instances[0]

    run.cancel(`superseded`)
    const second = run(input, {})
    await expect(first).rejects.toThrow(`superseded`)
    expect(first_worker.terminated).toBe(1)

    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[1].posted[0].input).toEqual(input)
    expect(run(input, {})).toBe(second)
    expect(FakeWorker.instances[1].posted).toHaveLength(1)
    void second.catch(() => {})
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
    expect(FakeWorker.instances[0].posted).toHaveLength(2)
  })
})

test(`falls back to compute_sync when Worker is missing`, async () => {
  vi.stubGlobal(`Worker`, undefined)
  const run = make_client()
  await expect(run({ tag: `a` }, {})).resolves.toBe(`sync`)
  expect(FakeWorker.instances).toHaveLength(0)
})

test(`an explicit null result is delivered rather than reported as missing`, async () => {
  const run = make_client<number | null>(() => 0)
  const pending = run({ tag: `a` }, {})
  const [worker] = FakeWorker.instances
  worker.emit(`message`, { data: { id: worker.posted[0].id, result: null, error: null } })
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
  const [worker] = FakeWorker.instances
  worker.emit(`message`, { data: { id: worker.posted[0].id, ...response } })
  await expect(pending).rejects.toThrow(expected)
})

import type { NumericFrame } from '#lib/trajectory/frame.js'
import { frame_transfers } from '#lib/trajectory/frame.js'
import { parse_xyz_trajectory } from '#lib/trajectory/parse/xyz.js'
import { create_warning_collector } from '#lib/trajectory/parse/shared.js'
import type { FramePreparation } from '#lib/trajectory/prepare.js'
import { FramePreparer } from '#lib/trajectory/prepare.js'
import type {
  PrepareReply,
  PrepareRequest,
  PrepareWorker,
} from '#lib/trajectory/prepare-pool.js'
import { create_prepare_pool, prepare_worker_count } from '#lib/trajectory/prepare-pool.js'
import { summarize_run } from '#lib/trajectory/run.js'
import { host_run, type HostFrameInput } from '#lib/trajectory/runs/host.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import { describe, expect, it, onTestFinished, test, vi } from 'vite-plus/test'
import { synthetic_extxyz } from './fixtures'

const backing = trajectory_from_frames(
  parse_xyz_trajectory(synthetic_extxyz(4, 27), create_warning_collector()).frames,
)
const PREPARATION: FramePreparation = {
  bonding_strategy: `electroneg_ratio`,
  bonding_options: {},
}
const transfers = (frame: NumericFrame) => frame_transfers(frame) as ArrayBuffer[]
const fresh_frame = async (idx: number): Promise<NumericFrame> =>
  structuredClone(await backing.read_frame(idx))

// Stand-in for prepare-worker.ts: answers on a later task, and both directions really transfer
// (structuredClone detaches what a postMessage transfer list names). `hold` keeps replies
// until released, to observe queueing.
const make_workers = ({ hold = false } = {}) => {
  const workers: (PrepareWorker & {
    posted: number[]
    fail: (message: string) => void
    terminated: boolean
  })[] = []
  const held: (() => void)[] = []
  const create_worker = () => {
    const target = new EventTarget()
    const preparer = new FramePreparer()
    const worker = Object.assign(target, {
      posted: [] as number[],
      terminated: false,
      postMessage: (
        message: PrepareRequest<NumericFrame>,
        { transfer }: StructuredSerializeOptions,
      ) => {
        const { id: identifier, input, preparation } = structuredClone(message, { transfer })
        worker.posted.push(identifier)
        const answer = () => {
          if (worker.terminated) return
          const display = preparer.prepare(input, preparation)
          const data: PrepareReply = { id: identifier, display, prepare_ms: 1 }
          target.dispatchEvent(new MessageEvent(`message`, { data: structuredClone(data) }))
        }
        if (hold) held.push(answer)
        else setTimeout(answer, 0)
      },
      terminate: () => (worker.terminated = true),
      fail: (message: string) =>
        target.dispatchEvent(new ErrorEvent(`error`, { message, cancelable: true })),
    }) as unknown as (typeof workers)[number]
    workers.push(worker)
    return worker
  }
  const release = () => held.splice(0).forEach((answer) => answer())
  return { workers, create_worker, release }
}

describe(`create_prepare_pool`, () => {
  it(`prepares like FramePreparer, takes the frame's buffers and reports timing`, async () => {
    const { workers, create_worker } = make_workers()
    const on_timing = vi.fn()
    const pool = create_prepare_pool({ create_worker, transfers, size: 2, on_timing })
    const frame = await fresh_frame(1)
    const expected = new FramePreparer().prepare(await fresh_frame(1), PREPARATION)
    const display = await pool.prepare(frame, PREPARATION)
    expect(frame.coordinates.byteLength).toBe(0) // moved to the worker, not copied
    expect(display.bonds).toEqual(expected.bonds)
    expect(display.bond_placements).toEqual(expected.bond_placements)
    expect(display.frame.coordinates).toEqual(expected.frame.coordinates)
    // reported after the job settles
    await vi.waitFor(() =>
      expect(on_timing).toHaveBeenCalledWith({ prepare_ms: 1, wait_ms: expect.any(Number) }),
    )
    expect(workers).toHaveLength(1) // opened on demand
    pool.dispose()
    expect(workers[0].terminated).toBe(true)
    await expect(pool.prepare(await fresh_frame(0), PREPARATION)).rejects.toThrow(`disposed`)
  })

  it(`posts only to idle workers, and a cancelled queued job never reaches one`, async () => {
    const { workers, create_worker, release } = make_workers({ hold: true })
    const pool = create_prepare_pool({ create_worker, transfers, size: 2 })
    const frames = await Promise.all([0, 1, 2, 3].map(fresh_frame))
    const controller = new AbortController()
    const jobs = frames.map((frame, idx) =>
      pool.prepare(frame, PREPARATION, idx === 2 ? controller.signal : undefined),
    )
    expect(workers.map(({ posted }) => posted)).toEqual([[0], [1]])
    controller.abort(new Error(`seek`))
    await expect(jobs[2]).rejects.toThrow(`seek`)
    expect(frames[2].coordinates.byteLength).toBeGreaterThan(0) // never transferred
    release()
    await Promise.all([jobs[0], jobs[1]])
    expect(workers.map(({ posted }) => posted)).toEqual([[0, 3], [1]])
    release()
    expect((await jobs[3]).bonds).toBeDefined()
    pool.dispose()
  })

  it(`ends workers idle for 10 s, never one with a job, and reopens on demand`, async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { workers, create_worker, release } = make_workers({ hold: true })
    const pool = create_prepare_pool({ create_worker, transfers, size: 2 })
    onTestFinished(pool.dispose)
    const busy = pool.prepare(await fresh_frame(0), PREPARATION)
    vi.advanceTimersByTime(20_000) // a running job keeps its worker
    expect(workers[0].terminated).toBe(false)
    release()
    await busy
    vi.advanceTimersByTime(9999)
    expect(workers[0].terminated).toBe(false)
    vi.advanceTimersByTime(1)
    expect(workers[0].terminated).toBe(true)
    const next = pool.prepare(await fresh_frame(1), PREPARATION)
    expect(workers).toHaveLength(2) // a fresh worker
    release()
    expect((await next).bonds).toBeDefined()
  })

  // Neither a worker that can't be created nor a throwing timing callback strands a job
  it(`a throwing worker factory fails only its job; on_timing can't block settling`, async () => {
    const { create_worker } = make_workers()
    let fail_next = true
    const on_timing = vi.fn(() => {
      throw new Error(`telemetry broke`)
    })
    const pool = create_prepare_pool({
      create_worker: () => {
        if (fail_next) {
          fail_next = false
          throw new Error(`no workers here`)
        }
        return create_worker()
      },
      transfers,
      size: 1,
      on_timing,
    })
    onTestFinished(pool.dispose)
    const failed = pool.prepare(await fresh_frame(0), PREPARATION)
    await expect(failed).rejects.toThrow(`no workers here`)
    // the timing error surfaces separately, after the job resolved
    const unhandled = new Promise((resolve) => process.once(`uncaughtException`, resolve))
    expect((await pool.prepare(await fresh_frame(1), PREPARATION)).bonds).toBeDefined()
    expect(await unhandled).toMatchObject({ message: `telemetry broke` })
  })

  it(`a failing worker rejects only its own job; dispose rejects the rest`, async () => {
    const { workers, create_worker, release } = make_workers({ hold: true })
    const pool = create_prepare_pool({ create_worker, transfers, size: 1 })
    const first = pool.prepare(await fresh_frame(0), PREPARATION)
    const second = pool.prepare(await fresh_frame(1), PREPARATION)
    workers[0].fail(`boom`)
    await expect(first).rejects.toThrow(`Frame preparation worker failed: boom`)
    expect(workers[0].terminated).toBe(true)
    // the queued job went to a fresh worker
    expect(workers[1].posted).toEqual([1])
    const third = pool.prepare(await fresh_frame(2), PREPARATION)
    pool.dispose()
    await expect(second).rejects.toThrow(`disposed`)
    await expect(third).rejects.toThrow(`disposed`)
    release() // late replies after disposal change nothing
  })
})

test.each([
  [1, 1],
  [2, 1],
  [4, 2],
  [16, 4],
])(`prepare_worker_count(%i cores) = %i`, (cores, expected) => {
  expect(prepare_worker_count(cores)).toBe(expected)
})

test(`host_run prepares host replies and frame 0 off the main thread, unless aborted`, async () => {
  type Reply = { idx: number }
  const prepare = vi.fn(async (input: HostFrameInput<Reply>, preparation: FramePreparation) =>
    new FramePreparer().prepare(
      `frame` in input ? input.frame : await fresh_frame(input.reply.idx),
      preparation,
    ),
  )
  const request = vi.fn(async (idx: number): Promise<Reply> => ({ idx }))
  const request_frame = vi.fn(fresh_frame)
  const run = host_run(summarize_run(backing), request_frame, undefined, { request, prepare })
  expect(host_run(summarize_run(backing), request_frame).prepare_frame).toBeUndefined()
  if (!run.prepare_frame) throw new Error(`Missing host preparation`)
  const channels = { precision: `display` } as const
  const display = await run.prepare_frame(2, { ...PREPARATION, channels })
  // the reply goes to the preparation undecoded; read_frame's decoding request is unused
  expect(request).toHaveBeenCalledWith(2, undefined, channels)
  expect(request_frame).not.toHaveBeenCalled()
  expect(prepare).toHaveBeenCalledWith(
    { reply: { idx: 2 } },
    { ...PREPARATION, channels },
    undefined,
  )
  expect(display.bonds).toBeDefined()
  // frame 0 comes from the summary, still prepared off the main thread
  await run.prepare_frame(0, PREPARATION)
  expect(prepare).toHaveBeenLastCalledWith(
    { frame: expect.objectContaining({ vector_keys: expect.any(Array) }) },
    PREPARATION,
    undefined,
  )
  expect(request).toHaveBeenCalledTimes(1)
  const controller = new AbortController()
  request.mockImplementationOnce(async (idx) => {
    controller.abort(new Error(`superseded`))
    return { idx }
  })
  await expect(run.prepare_frame(3, PREPARATION, controller.signal)).rejects.toThrow(
    `superseded`,
  )
  expect(prepare).toHaveBeenCalledTimes(2)
  run.dispose()
  await expect(run.prepare_frame(1, PREPARATION)).rejects.toThrow(`disposed`)
})

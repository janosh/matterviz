import type { CameraFlightController, CameraPose } from './camera-flight'

export type FlightTimeline = {
  start: number
  end: number
  current: number
  prepare: (idx: number, signal: AbortSignal) => Promise<void>
  begin?: () => () => void
}
export type FlightActivity = `play` | `seek` | `thumbnails` | `restore` | null
type FlightTask = {
  signal: AbortSignal
  timeline?: FlightTimeline
  show: (pose: CameraPose, frame?: number) => Promise<void>
}

// A custom frame resolver need not honor its signal. Cancellation must still release the
// camera and let the newest scrub request run; stale completions never reach show().
const abortable = async <Value>(
  promise: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> => {
  signal.throwIfAborted()
  const stopped = Promise.withResolvers<never>()
  const abort = () => stopped.reject(signal.reason)
  signal.addEventListener(`abort`, abort, { once: true })
  try {
    return await Promise.race([promise, stopped.promise])
  } finally {
    signal.removeEventListener(`abort`, abort)
  }
}

export function create_camera_flight_session(hooks: {
  controller: () => CameraFlightController | undefined
  timeline: () => FlightTimeline | undefined
  settle: () => Promise<void>
  on_change: (activity: FlightActivity, has_origin: boolean) => void
}) {
  const lifetime = new AbortController()
  let operation: AbortController | undefined
  let revision = 0
  let queue = Promise.resolve()
  let activity: FlightActivity = null
  let origin:
    | {
        pose: CameraPose
        frame?: number
        resume?: () => void
      }
    | undefined
  const notify = () => hooks.on_change(activity, Boolean(origin))
  const cancel = () => {
    revision++
    operation?.abort()
    activity = null
    notify()
  }

  const run = (
    kind: Exclude<FlightActivity, null>,
    task: (context: FlightTask) => Promise<void>,
    temporary = false,
  ): Promise<boolean> => {
    operation?.abort()
    const requested = ++revision
    activity = kind
    notify()
    const result = queue
      .then(async () => {
        if (requested !== revision || lifetime.signal.aborted) return false
        operation = new AbortController()
        const signal = AbortSignal.any([operation.signal, lifetime.signal])
        const controller = hooks.controller()
        if (!controller) throw new Error(`Wait for the 3D camera to be ready`)
        const timeline = hooks.timeline()
        const frame = timeline?.current
        const pose = controller.capture()
        const lease = controller.begin()
        let resume: (() => void) | undefined
        try {
          resume = timeline?.begin?.()
          if (!temporary && !origin) origin = { pose, frame, resume }
          notify()
          await hooks.settle()
          signal.throwIfAborted()
          await task({
            signal,
            timeline,
            show: async (view, idx) => {
              signal.throwIfAborted()
              if (timeline && idx !== undefined)
                await abortable(timeline.prepare(idx, signal), signal)
              await hooks.settle()
              signal.throwIfAborted()
              lease.apply(view)
            },
          })
          return !signal.aborted
        } catch (error) {
          if (!signal.aborted) throw error
          return false
        } finally {
          try {
            if (temporary && timeline && frame !== undefined && !lifetime.signal.aborted)
              await abortable(timeline.prepare(frame, lifetime.signal), lifetime.signal)
          } finally {
            if (temporary) lease.restore()
            else lease.commit()
            if (temporary && !lifetime.signal.aborted) resume?.()
          }
        }
      })
      .finally(() => {
        if (requested === revision) {
          operation = undefined
          activity = null
          notify()
        }
      })
    // The caller handles its error; the queue must remain usable after a failed read.
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  return {
    run,
    cancel,
    async restore() {
      const saved = origin
      if (!saved) {
        cancel()
        await queue
        return
      }
      const restored = await run(`restore`, async ({ show }) => {
        await show(saved.pose, saved.frame)
      })
      if (restored && origin === saved) {
        origin = undefined
        saved.resume?.()
        notify()
      }
    },
    dispose() {
      cancel()
      lifetime.abort()
      origin = undefined
      notify()
    },
  }
}

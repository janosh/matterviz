import { SceneCapture } from '#lib/scene/capture.js'
import { expect, test, vi } from 'vitest'

test(`capture waits for a completed render, including empty geometry`, async () => {
  const capture = new SceneCapture()
  const done = vi.fn()
  const pending = capture.wait(4, new AbortController().signal).then(done)
  // A previous worker's error is not the outcome of the queued rebuild.
  capture.rendered(4, true, `previous request failed`)
  await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
  capture.rendered(4, false)
  await pending
  expect(done).toHaveBeenCalledOnce()
})

test.each([`geometry`, `revision`, `abort`, `unmount`] as const)(
  `capture rejects on %s and releases its waiter`,
  async (reason) => {
    const capture = new SceneCapture()
    const abort = new AbortController()
    const pending = capture.wait(4, abort.signal).catch((error: unknown) => error)
    const expected = {
      geometry: `memory budget exceeded`,
      revision: `settings changed`,
      abort: `cancelled`,
      unmount: `unmounted`,
    }[reason]
    if (reason === `geometry`) capture.rendered(4, false, expected)
    else if (reason === `revision`) capture.rendered(5, true)
    else if (reason === `abort`) abort.abort()
    else capture.close()
    expect(await pending).toBeInstanceOf(Error)
    expect(((await pending) as Error).message).toContain(expected)
    if (reason === `unmount`)
      await expect(capture.wait(5, new AbortController().signal)).rejects.toThrow(`unmounted`)
    else {
      const retry = capture.wait(5, new AbortController().signal)
      capture.rendered(5, false)
      await expect(retry).resolves.toBeUndefined()
    }
  },
)

test(`a second capture cannot replace the first waiter's revision`, async () => {
  const capture = new SceneCapture()
  const signal = new AbortController().signal
  const first = capture.wait(4, signal)
  await expect(capture.wait(5, signal)).rejects.toThrow(`already pending`)
  capture.rendered(4, false)
  await first
})

import { create_clipboard_feedback } from '$lib/overlays'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe(`create_clipboard_feedback`, () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it(`writes text, flags the key, then clears it after duration`, async () => {
    const write = vi.spyOn(navigator.clipboard, `writeText`).mockResolvedValue()
    const { copied, copy } = create_clipboard_feedback(500)
    await copy(`hello`, `k1`)
    expect(write).toHaveBeenCalledWith(`hello`)
    expect(copied.has(`k1`)).toBe(true)
    vi.advanceTimersByTime(499)
    expect(copied.has(`k1`)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(copied.has(`k1`)).toBe(false)
  })

  it(`logs and does not flag the key when the write fails`, async () => {
    vi.spyOn(navigator.clipboard, `writeText`).mockRejectedValueOnce(new Error(`denied`))
    const err = vi.spyOn(console, `error`).mockImplementation(() => {})
    const { copied, copy } = create_clipboard_feedback()
    await copy(`x`, `k`)
    expect(copied.has(`k`)).toBe(false)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it(`isolates copied state between instances`, async () => {
    vi.spyOn(navigator.clipboard, `writeText`).mockResolvedValue()
    const first = create_clipboard_feedback()
    const second = create_clipboard_feedback()
    await first.copy(`t`, `shared`)
    expect(first.copied.has(`shared`)).toBe(true)
    expect(second.copied.has(`shared`)).toBe(false)
  })

  it(`tracks multiple keys with independent timeouts`, async () => {
    vi.spyOn(navigator.clipboard, `writeText`).mockResolvedValue()
    const { copied, copy } = create_clipboard_feedback(1000)
    await copy(`a`, `k1`)
    vi.advanceTimersByTime(600)
    await copy(`b`, `k2`)
    expect([copied.has(`k1`), copied.has(`k2`)]).toEqual([true, true])
    vi.advanceTimersByTime(400) // k1 reaches 1000ms, k2 at 400ms
    expect([copied.has(`k1`), copied.has(`k2`)]).toEqual([false, true])
    vi.advanceTimersByTime(600) // k2 reaches 1000ms
    expect(copied.has(`k2`)).toBe(false)
  })
})

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
})

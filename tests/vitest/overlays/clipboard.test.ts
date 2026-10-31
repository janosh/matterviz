import { create_clipboard_feedback } from '#lib/overlays/index.js'
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

  // The library helper rejects when given no on_error, but our re-export defaults to logging
  // so that a denied clipboard cannot take down the pane a copy button sits in.
  it.each([
    [`logs`, undefined],
    [`calls on_error`, vi.fn()],
  ])(`a failed write %s and does not flag the key`, async (_desc, on_error) => {
    vi.spyOn(navigator.clipboard, `writeText`).mockRejectedValueOnce(new Error(`denied`))
    const err = vi.spyOn(console, `error`).mockImplementation(() => {})
    const { copied, copy } = create_clipboard_feedback(1000, on_error)
    await expect(copy(`x`, `k`)).resolves.toBe(false)
    expect(copied.has(`k`)).toBe(false)
    if (on_error) expect(on_error).toHaveBeenCalledWith(expect.any(Error), `x`)
    else expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

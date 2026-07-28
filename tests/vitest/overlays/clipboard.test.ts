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

  // The library helper rejects when given no on_error, but our re-export defaults to logging
  // so that a denied clipboard cannot take down the pane a copy button sits in.
  it(`logs and does not flag the key when the write fails`, async () => {
    vi.spyOn(navigator.clipboard, `writeText`).mockRejectedValueOnce(new Error(`denied`))
    const err = vi.spyOn(console, `error`).mockImplementation(() => {})
    const { copied, copy } = create_clipboard_feedback()
    await expect(copy(`x`, `k`)).resolves.toBe(false)
    expect(copied.has(`k`)).toBe(false)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it(`routes a failed write to on_error and does not flag the key`, async () => {
    vi.spyOn(navigator.clipboard, `writeText`).mockRejectedValueOnce(new Error(`denied`))
    const on_error = vi.fn()
    const { copied, copy } = create_clipboard_feedback(1000, on_error)
    await expect(copy(`x`, `k`)).resolves.toBe(false)
    expect(copied.has(`k`)).toBe(false)
    expect(on_error).toHaveBeenCalledWith(expect.any(Error), `x`)
  })

  it(`isolates copied state between instances`, async () => {
    vi.spyOn(navigator.clipboard, `writeText`).mockResolvedValue()
    const first = create_clipboard_feedback()
    const second = create_clipboard_feedback()
    await first.copy(`t`, `shared`)
    expect(first.copied.has(`shared`)).toBe(true)
    expect(second.copied.has(`shared`)).toBe(false)
  })

  it(`gives each key an independent timer, restarted on re-copy`, async () => {
    vi.spyOn(navigator.clipboard, `writeText`).mockResolvedValue()
    const { copied, copy } = create_clipboard_feedback(1000)
    await copy(`a`, `k1`)
    await copy(`b`, `k2`)
    vi.advanceTimersByTime(700)
    await copy(`a`, `k1`) // re-copy restarts only k1's window; k2 unaffected
    vi.advanceTimersByTime(400) // t=1100: k2 expired on its own schedule, k1 reset so alive
    expect([copied.has(`k1`), copied.has(`k2`)]).toEqual([true, false])
    vi.advanceTimersByTime(600) // t=1700: k1's restarted window elapses
    expect(copied.has(`k1`)).toBe(false)
  })
})

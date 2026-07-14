import type * as Sanitize from '$lib/sanitize'
import { describe, expect, test, vi } from 'vitest'

const without_browser_dom = async <T>(
  run: (sanitizers: typeof Sanitize) => T | Promise<T>,
): Promise<T> => {
  const win = globalThis.window
  try {
    // @ts-expect-error - SSR simulation
    globalThis.window = undefined
    vi.resetModules()
    return await run(await import(`$lib/sanitize`))
  } finally {
    globalThis.window = win
    vi.resetModules()
  }
}

describe(`sanitizers without a browser DOM`, () => {
  test(`preserves formula HTML across awaited SSR path`, async () => {
    await without_browser_dom(async ({ sanitize_html }) => {
      expect(globalThis.window).toBeUndefined()
      await Promise.resolve()
      expect(globalThis.window).toBeUndefined()
      expect(sanitize_html(`Li<sub>2</sub>O`)).toBe(`Li<sub>2</sub>O`)
    })
    expect(globalThis.window).toBeDefined()
  })

  test.each([`sanitize_svg`, `sanitize_icon_svg`] as const)(
    `%s returns markup unchanged when DOMPurify is unavailable`,
    async (name) => {
      const payload = `<path d="M0 0" />`
      await without_browser_dom((sanitizers) => {
        expect(sanitizers[name](payload)).toBe(payload)
      })
    },
  )
})

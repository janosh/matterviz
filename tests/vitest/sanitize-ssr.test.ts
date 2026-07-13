import { describe, expect, test, vi } from 'vitest'

type Sanitizers = {
  sanitize_html: (html: unknown) => string
  sanitize_svg: (html: string) => string
  sanitize_icon_svg: (html: string) => string
}

const without_browser_dom = async (run: (sanitizers: Sanitizers) => void) => {
  const win = globalThis.window
  try {
    // @ts-expect-error - SSR simulation
    globalThis.window = undefined
    vi.resetModules()
    const sanitizers = await import(`$lib/sanitize`)
    run(sanitizers)
  } finally {
    globalThis.window = win
    vi.resetModules()
  }
}

describe(`sanitizers without a browser DOM`, () => {
  test.each([
    `<img src=x onerror=alert(1)>`,
    `<script>alert(1)</script>`,
    `<a href="javascript:alert(1)">click</a>`,
  ])(`escapes unsafe HTML instead of returning markup: %s`, async (payload) => {
    await without_browser_dom(({ sanitize_html }) => {
      const result = sanitize_html(payload)
      expect(result).not.toContain(`<`)
      expect(result).toContain(`&lt;`)
    })
  })

  test(`escapes otherwise-safe formatting because it cannot be verified`, async () => {
    await without_browser_dom(({ sanitize_html }) => {
      expect(sanitize_html(`Li<sub>2</sub>O`)).toBe(`Li&lt;sub&gt;2&lt;/sub&gt;O`)
    })
  })

  test.each([`sanitize_svg`, `sanitize_icon_svg`] as const)(
    `escapes SVG markup when DOMPurify is unavailable`,
    async (sanitizer_name) => {
      await without_browser_dom((sanitizers) => {
        const result = sanitizers[sanitizer_name](`<path d="M0 0" onload="alert(1)" />`)
        expect(result).not.toContain(`<path`)
        expect(result).toContain(`&lt;path`)
      })
    },
  )
})

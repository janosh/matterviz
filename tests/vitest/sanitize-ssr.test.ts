import type * as Sanitize from '$lib/sanitize'
import { describe, expect, test, vi } from 'vitest'

const without_browser_dom = async <T>(run: (sanitizers: typeof Sanitize) => T): Promise<T> => {
  const win = globalThis.window
  try {
    // @ts-expect-error - SSR simulation
    globalThis.window = undefined
    vi.resetModules()
    return run(await import(`$lib/sanitize`))
  } finally {
    globalThis.window = win
    vi.resetModules()
  }
}

describe(`sanitizers without a browser DOM`, () => {
  test.each([
    [`<img src=x onerror=alert(1)>`, `sanitize_html`],
    [`<script>alert(1)</script>`, `sanitize_html`],
    [`Li<sub>2</sub>O`, `sanitize_html`],
    [`<path d="M0 0" onload="alert(1)" />`, `sanitize_svg`],
    [`<path d="M0 0" onload="alert(1)" />`, `sanitize_icon_svg`],
  ] as const)(`escapes %s via %s`, async (payload, name) => {
    await without_browser_dom((sanitizers) => {
      const result = sanitizers[name](payload)
      expect(result).not.toContain(`<`)
      expect(result).toContain(`&lt;`)
    })
  })
})

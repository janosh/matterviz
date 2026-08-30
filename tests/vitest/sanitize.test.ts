import {
  compact_formula,
  sanitize_compact_formula,
  sanitize_formula,
  sanitize_html,
  sanitize_html_ssr,
  sanitize_svg,
} from '$lib'
import type * as Sanitize from '$lib/sanitize'
import DOMPurify from 'dompurify'
import { describe, expect, test, vi } from 'vitest'

// XSS payloads that must never survive any sanitizer
const XSS_PAYLOADS = [
  `<script>alert('xss')</script>`,
  `<img src=x onerror=alert(1)>`,
  `<svg onload=alert(1)>`,
  `<iframe src="javascript:alert(1)"></iframe>`,
  `<b onclick=alert(1)>bold</b>`,
  `<a href="javascript:alert(1)">click</a>`,
  `<a href="data:text/html,<script>alert(1)</script>">click</a>`,
  `<div><script>alert(1)</script></div>`,
  `<object data="data:text/html,<script>alert(1)</script>"></object>`,
  `<embed src="javascript:alert(1)">`,
  `<form action="javascript:alert(1)"><input type=submit></form>`,
  `<meta http-equiv="refresh" content="0;url=javascript:alert(1)">`,
  `<base href="javascript:alert(1)">`,
  `<details open ontoggle=alert(1)>`,
  `<body onload=alert(1)>`,
  `<input onfocus=alert(1) autofocus>`,
  `<marquee onstart=alert(1)>`,
  `<template><script>alert(1)</script></template>`,
  `<math><mi href="javascript:alert(1)">x</mi></math>`,
  `<svg><foreignObject><body onload=alert(1)></body></foreignObject></svg>`,
]

function assertNoXss(result: string): void {
  expect(result).not.toContain(`<script`)
  expect(result).not.toMatch(/on\w+\s*=/i)
  expect(result).not.toMatch(/javascript:/i)
  expect(result).not.toMatch(/\bdata:[^,]*,/i)
  expect(result).not.toContain(`<iframe`)
  expect(result).not.toContain(`<object`)
  expect(result).not.toContain(`<embed`)
  expect(result).not.toContain(`<meta`)
  expect(result).not.toContain(`<base`)
  expect(result).not.toContain(`<template`)
  expect(result).not.toContain(`<form`)
}

describe(`sanitize_html`, () => {
  test.each(XSS_PAYLOADS)(`strips XSS from: %s`, (payload) => {
    assertNoXss(sanitize_html(payload))
  })

  test.each([
    [`bold`, `<b>bold</b>`],
    [`italic`, `<i>italic</i>`],
    [`emphasis`, `<em>emphasis</em>`],
    [`strong`, `<strong>strong</strong>`],
    [`subscript`, `<sub>2</sub>`],
    [`superscript`, `<sup>3+</sup>`],
    [`code`, `<code>x = 1</code>`],
    [`span with class`, `<span class="formula">H<sub>2</sub>O</span>`],
    [`span with title`, `<span title="tooltip">text</span>`],
    [`line break`, `text<br>more`],
    [`small`, `<small>footnote</small>`],
    [`Li₂O formula`, `Li<sub>2</sub>O`],
    [`Fe₂O₃ formula`, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Ca²⁺ ion`, `Ca<sup>2+</sup>`],
  ])(`preserves safe %s`, (_name, input) => {
    expect(sanitize_html(input)).toBe(input)
  })

  test(`preserves safe link with rel=noopener`, () => {
    const result = sanitize_html(`<a href="/materials/mp-123" target="_blank">mp-123</a>`)
    expect(result).toContain(`href="/materials/mp-123"`)
    expect(result).toContain(`target="_blank"`)
    expect(result).toContain(`rel="noopener"`)
    expect(result).toContain(`mp-123</a>`)
  })

  test(`merges noopener into existing rel without overwriting`, () => {
    const result = sanitize_html(`<a href="/x" rel="noreferrer">x</a>`)
    const rel_tokens = /rel="(?<rel>[^"]+)"/.exec(result)?.[1]?.split(/\s+/) ?? []
    expect(rel_tokens).toContain(`noreferrer`)
    expect(rel_tokens).toContain(`noopener`)
  })

  test.each([
    [`safe color`, `<span style="color: red">x</span>`, `<span style="color: red">x</span>`],
    [
      `safe multi`,
      `<span style="font-weight: bold; color: blue">x</span>`,
      `<span style="font-weight: bold; color: blue">x</span>`,
    ],
    [`dangerous bg`, `<span style="background: url(evil)">x</span>`, `<span>x</span>`],
    [`dangerous position`, `<span style="position: fixed; top: 0">x</span>`, `<span>x</span>`],
  ])(`style filtering: %s`, (_name, input, expected) => {
    expect(sanitize_html(input)).toBe(expected)
  })

  test.each([`img`, `div`, `p`, `h1`, `table`, `video`, `audio`])(
    `strips non-allowed <%s> tag`,
    (tag) => {
      expect(sanitize_html(`<${tag}>content</${tag}>`)).not.toContain(`<${tag}`)
    },
  )

  test(`handles mixed safe and unsafe content`, () => {
    expect(sanitize_html(`<b>bold</b><script>alert(1)</script><sub>2</sub>`)).toBe(
      `<b>bold</b><sub>2</sub>`,
    )
  })

  test.each([
    [`empty`, ``, ``],
    [`whitespace`, `   `, `   `],
    [`null`, null, ``],
    [`undefined`, undefined, ``],
    [`zero`, 0, `0`],
    [`float`, 42.5, `42.5`],
    [`boolean`, true, `true`],
    [`NaN`, NaN, `NaN`],
  ] as const)(`handles %s input → "%s"`, (_name, input, expected) => {
    expect(sanitize_html(input)).toBe(expected)
  })

  test.each([
    [`malicious toString()`, { toString: (): string => `<script>alert(1)</script>` }],
    [`double-encoded entities`, `<img src=x onerror=&#97;&#108;&#101;&#114;&#116;(1)>`],
    [`null byte injection`, `<scr\u0000ipt>alert(1)</script>`],
  ] as const)(`bypass attempt: %s`, (_name, input) => {
    assertNoXss(sanitize_html(input))
  })

  test(`deeply nested dangerous content is stripped`, () => {
    const result = sanitize_html(
      `<b><i><span><em><strong><script>alert(1)</script></strong></em></span></i></b>`,
    )
    // every wrapper survives intact, only the script leaf is removed
    expect(result).toBe(`<b><i><span><em><strong></strong></em></span></i></b>`)
  })

  // Strings with no `<` bypass DOMPurify entirely. These pin that shortcut to what the
  // sanitizer it skips would have returned, including the characters an HTML serializer
  // would escape (`>`, `&`, nbsp) if the input ever reached the parser. It never does:
  // DOMPurify returns `dirty` itself on the same indexOf('<') check, so equality here holds
  // in any host, not just happy-dom.
  const inert_inputs = [
    `Density (g/cm³)`,
    `He said "hi" — it's fine`,
    `a > b`,
    `AT&T`,
    `&lt;script&gt;alert(1)&lt;/script&gt;`, // entities decode to text, never re-parse as tags
    `nbsp\u00A0separated`,
    `   `,
  ]
  test.each(inert_inputs)(`matches DOMPurify output for %s`, (input) => {
    expect(sanitize_html(input)).toBe(DOMPurify().sanitize(input))
  })

  // Equality alone would still pass if the shortcut were deleted, so assert the bypass:
  // markup-free input must never reach the sanitizer, markup must always reach it.
  test(`skips DOMPurify for markup-free input and uses it otherwise`, async () => {
    vi.resetModules()
    const sanitize_spy = vi.fn((html: string) => html)
    vi.doMock(`dompurify`, () => ({
      default: () => ({ sanitize: sanitize_spy, addHook: () => {} }),
    }))
    try {
      const { sanitize_html: fresh_sanitize } = await import(`$lib/sanitize`)
      for (const input of inert_inputs) fresh_sanitize(input)
      expect(sanitize_spy).not.toHaveBeenCalled()

      fresh_sanitize(`<b>bold</b>`)
      expect(sanitize_spy).toHaveBeenCalled()
    } finally {
      vi.doUnmock(`dompurify`)
      vi.resetModules()
    }
  })
})

describe(`sanitize_formula`, () => {
  test.each([
    [`Fe2O3`, true, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Li2O`, true, `Li<sub>2</sub>O`],
    [`CaTiO3`, true, `CaTiO<sub>3</sub>`],
    [`Fe`, true, `Fe`],
    [``, true, ``],
    [`Fe2O3`, false, `Fe2O3`],
  ])(`formats "%s" (subscripts=%s)`, (formula, use_subscripts, expected) => {
    expect(sanitize_formula(formula, use_subscripts)).toBe(expected)
  })

  test(`strips XSS injected via formula string`, () => {
    assertNoXss(sanitize_formula(`<script>alert(1)</script>`))
    assertNoXss(sanitize_formula(`Fe<img src=x onerror=alert(1)>2O3`))
  })
})

describe(`compact formula helpers`, () => {
  test.each([
    [`Ac6 U2`, `Ac6U2`, `Ac<sub>6</sub>U<sub>2</sub>`],
    [`Ca Ti O3`, `CaTiO3`, `CaTiO<sub>3</sub>`],
    [``, ``, ``],
    [`   `, ``, ``],
    [`Fe\t2\nO\r3`, `Fe2O3`, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Li  2  O`, `Li2O`, `Li<sub>2</sub>O`],
  ])(`compacts and sanitizes "%s"`, (formula, compact, html) => {
    expect(compact_formula(formula)).toBe(compact)
    expect(sanitize_compact_formula(formula)).toBe(html)
  })

  test(`strips XSS with embedded whitespace`, () => {
    const result = sanitize_compact_formula(`Fe<script> alert(1) </script>2O3`)
    expect(result).not.toContain(`<script`)
    expect(result).not.toContain(`alert`)
  })
})

describe(`sanitize_svg`, () => {
  test.each(XSS_PAYLOADS)(`strips XSS from: %s`, (payload) => {
    assertNoXss(sanitize_svg(payload))
  })

  test.each([
    [`dx/dy`, `<tspan dx="2" dy="5">text</tspan>`],
    [`fill/font-weight`, `<tspan fill="red" font-weight="bold">Fe</tspan>`],
  ])(`preserves tspan with %s`, (_name, input) => {
    expect(sanitize_svg(input)).toBe(input)
  })

  test.each([
    `<circle cx="10" r="5" />`,
    `<rect width="10" height="10" />`,
    `<path d="M0 0" />`,
  ])(`strips non-text SVG tag: %s`, (input) => {
    expect(sanitize_svg(input)).toBe(``)
  })

  test(`strips unsafe attributes from tspan`, () => {
    expect(sanitize_svg(`<tspan onclick="alert(1)">x</tspan>`)).toBe(`<tspan>x</tspan>`)
  })

  test(`returns empty string when all content is stripped`, () => {
    expect(sanitize_svg(`<script>alert(1)</script>`)).toBe(``)
    expect(sanitize_svg(``)).toBe(``)
  })
})

// === SSR (no browser DOM) ===

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
  test(`provides byte-identical HTML for SSR and the first client render`, async () => {
    const input = `A & B<br><strong>safe</strong><script>alert(1)</script>`
    const initial_client_html = sanitize_html_ssr(input)
    assertNoXss(initial_client_html)
    await without_browser_dom(({ sanitize_html: server_sanitize }) => {
      expect(server_sanitize(input)).toBe(initial_client_html)
    })
  })

  test(`allowlists formula HTML on SSR (no raw passthrough)`, async () => {
    await without_browser_dom(async ({ sanitize_html: sanitize }) => {
      expect(globalThis.window).toBeUndefined()
      await Promise.resolve()
      expect(globalThis.window).toBeUndefined()
      expect(sanitize(`Li<sub>2</sub>O`)).toBe(`Li<sub>2</sub>O`)
      expect(sanitize(`Li<sub>2</sub>O<script>alert(1)</script>`)).toBe(`Li<sub>2</sub>O`)
    })
    expect(globalThis.window).toBeDefined()
  })

  test(`sanitize_svg strips XSS on SSR instead of returning markup unchanged`, async () => {
    await without_browser_dom((sanitizers) => {
      const { sanitize_svg: ssr_sanitize_svg } = sanitizers
      expect(ssr_sanitize_svg(`<path d="M0 0" /><script>alert(1)</script>`)).not.toContain(
        `script`,
      )
      expect(ssr_sanitize_svg(`<path d="M0 0" onclick="alert(1)"></path>`)).not.toContain(
        `onclick`,
      )
    })
  })
})

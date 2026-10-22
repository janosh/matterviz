import { expect, test } from '@playwright/test'
import type DOMPurifyModule from 'dompurify'
import type * as SanitizeModule from '#lib/sanitize.js'

// sanitize_html skips DOMPurify for markup it proves inert. happy-dom can't vouch for that, so
// this checks the shortcut against real DOMPurify in Chromium with sanitize.ts's own config
// and hook (kept in sync by hand: a drifted copy fails here rather than passing silently)
const inert = [
  `Li<sub>2</sub>Fe<sub>0.5</sub>O<sub>4</sub>`,
  `x<sup>2</sup> <b><i>bold</i></b><br>next <span>a</span><code>b</code><small>c</small>`,
  `<em>"quoted" it's = / ; # é 😀</em>\n\tend`,
  `  leading <strong>space</strong> `,
  `<a href="#mp-1-GGA+U" target="_blank" rel="noopener">mp-1-GGA+U</a>`,
  `<a href="https://materialsproject.org/materials/mp-1" rel="noopener noreferrer">mp-1</a>`,
  `see <a rel="noopener" title="docs page" class="link x" href="/docs/a.b?q=1">docs</a>`,
  `<a>anchor</a> <a title="t">titled</a>`,
  `${`<span>`.repeat(32)}deep${`</span>`.repeat(32)}`,
]
// near misses the shortcut hands to DOMPurify, which rewrites all but the protocol-relative href
const rewritten = [
  `\f<b>x</b>`,
  ` \fx<b>y</b>`,
  `<a title=" docs">x</a>`,
  `<a class="link\v">x</a>`,
  `<a href="#a">x</a>`,
  `<a href="#a" rel="noreferrer">x</a>`,
  `<a href="//evil.com" rel="noopener">x</a>`,
  `<a href="javascript:alert(1)" rel="noopener">x</a>`,
  `<a href="#a" target="a: b" rel="noopener">x</a>`,
  `<a href="#a" rel="noopener"><a href="#b" rel="noopener">b</a></a>`,
  `<b><i>misnested</b></i>`,
  `<sub>a &amp; b</sub>`,
]

test(`inert markup skips DOMPurify only where its output is identical @source`, async ({
  page,
}) => {
  await page.goto(`/acknowledgements`, { waitUntil: `domcontentloaded` })
  const results = await page.evaluate(
    async ({ inert: inert_inputs, rewritten: rewritten_inputs }) => {
      const sanitize_path = `/src/lib/sanitize.ts`
      const purify_path = `/@id/dompurify`
      const { sanitize_html } = (await import(sanitize_path)) as typeof SanitizeModule
      const { default: DOMPurify } = (await import(purify_path)) as {
        default: typeof DOMPurifyModule
      }
      // === copy of sanitize.ts's DOMPurify path ===
      const ensure_token = (value: string, token: string) =>
        [...new Set([...value.split(/\s+/).filter(Boolean), token])].join(` `)
      const style_re =
        /^\s*(?:color|font-weight|font-style|font-size|text-decoration|vertical-align)\s*:/
      const purifier = DOMPurify()
      purifier.addHook(`uponSanitizeAttribute`, (node, data) => {
        if (data.attrName === `style`) {
          const style = data.attrValue
            .split(`;`)
            .filter((rule) => style_re.test(rule))
            .join(`;`)
          if (style) data.attrValue = style
          else data.keepAttr = false
        }
        if (data.attrName === `href`) {
          node.setAttribute(`rel`, ensure_token(node.getAttribute(`rel`) ?? ``, `noopener`))
        }
        if (data.attrName === `rel`) data.attrValue = ensure_token(data.attrValue, `noopener`)
      })
      // oxfmt-ignore
      const forbid_tags = [`script`, `style`, `iframe`, `object`, `embed`, `form`, `input`,
        `textarea`, `select`, `button`, `meta`, `link`, `base`, `template`, `noscript`]
      // oxfmt-ignore
      const allowed_tags = [`a`, `b`, `i`, `em`, `strong`, `sub`, `sup`, `br`, `span`, `code`,
        `small`]
      const allowed_attrs = [`style`, `class`, `title`, `href`, `target`, `rel`]
      const purify = (html: string) =>
        purifier.sanitize(
          purifier.sanitize(html, { ADD_ATTR: [`target`], FORBID_TAGS: forbid_tags }),
          { ALLOWED_TAGS: allowed_tags, ALLOWED_ATTR: allowed_attrs },
        )
      const check = (input: string) => ({
        input,
        got: sanitize_html(input),
        want: purify(input),
      })
      return { inert: inert_inputs.map(check), rewritten: rewritten_inputs.map(check) }
    },
    { inert, rewritten },
  )
  for (const { input, got, want } of results.inert) {
    expect(got, JSON.stringify(input)).toBe(input)
    expect(want, JSON.stringify(input)).toBe(input)
  }
  for (const { input, got, want } of results.rewritten) {
    expect(got, JSON.stringify(input)).toBe(want)
  }
})

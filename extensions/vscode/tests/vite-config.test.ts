import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// Checked as source text, not by importing vite.config.ts: that file sits outside
// tsconfig.json's `include` glob, and importing it here would pull its (pre-existing,
// unrelated) top-level `.ts`-extension imports into this project's type-check.
//
// Without esnext, LightningCSS downlevels light-dark() into an OS-preference polyfill
// that ignores the webview's declared color-scheme (see create_html in extension.ts).
test(`webview build targets esnext so LightningCSS keeps native light-dark()`, () => {
  const config_path = fileURLToPath(new URL(`../vite.config.ts`, import.meta.url))
  const config_source = readFileSync(config_path, `utf8`)
  expect(config_source).toMatch(/^\s*cssTarget:\s*`esnext`,$/m)
})

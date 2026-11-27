import { globSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test } from 'vite-plus/test'

// Repo imports are extensionless (`#lib/math`, `./types`); a `.js`/`.ts` suffix creeping back in
// mixes two conventions. Node-run files load their imports natively, and `#root/*` resolves
// through package.json imports, which TypeScript doesn't probe: both need the extension.
// Replace with oxlint's import/extensions once vite-plus pins oxlint >= 1.95 (tripwire below), which fixes
// pathGroupOverrides being dropped next to a `pattern` object (oxc-project/oxc#29300). Config:
// ignore `three/**` and `#root/**` via pathGroupOverrides, plus an override for NODE_RUN files.
const NODE_RUN =
  /(?:^|\/)(?:vite(?:\.\w+)?\.config|vite-plugins|playwright\.config)\.ts$|^src\/scripts\//
const INTERNAL_WITH_EXT =
  /(?:from|import|vi\.\w+)\s*\(?\s*[`'"](?<specifier>(?:#lib|#site|\.{1,2})\/[^`'"]*\.m?[jt]s)[`'"]/g

test(`internal imports name no .js/.ts extension`, () => {
  const offenders: string[] = []
  const exclude = [`**/node_modules/**`, `extensions/*/{build,dist,lib,out}/**`]
  for (const file of globSync(`{src,tests,extensions}/**/*.{ts,svelte,md}`, { exclude })) {
    if (NODE_RUN.test(file)) continue
    const text = readFileSync(file, `utf8`)
    for (const { groups, index } of text.matchAll(INTERNAL_WITH_EXT))
      offenders.push(
        `${file}:${text.slice(0, index).split(`\n`).length}: ${groups?.specifier}`,
      )
  }
  expect(offenders).toEqual([])
})

test(`oxlint is still < 1.95, so import/extensions can't replace the scan above yet`, () => {
  const vite_plus = createRequire(import.meta.url).resolve(`vite-plus/package.json`)
  const { version } = createRequire(vite_plus)(`oxlint/package.json`)
  const [major, minor] = version.split(`.`).map(Number)
  expect(
    major === 1 && minor < 95,
    `oxlint ${version} fixes pathGroupOverrides: swap this file for import/extensions`,
  ).toBe(true)
})

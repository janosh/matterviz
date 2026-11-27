import { globSync, readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

// Repo imports are extensionless (`#lib/math`, `./types`); a `.js`/`.ts` suffix creeping back
// in mixes two conventions (oxlint's import/extensions can't exempt three's `.js` subpaths).
// Node-run files load their imports natively, and `#root/*` resolves through package.json
// imports, which TypeScript doesn't probe: both need the extension.
const NODE_RUN =
  /(?:^|\/)(?:vite(?:\.\w+)?\.config|vite-plugins|playwright\.config)\.ts$|^src\/scripts\//
const INTERNAL_WITH_EXT =
  /(?:from|import)\s*\(?\s*[`'"](?<specifier>(?:#lib|#site|\.{1,2})\/[^`'"]*\.m?[jt]s)[`'"]/g

test(`internal imports name no .js/.ts extension`, () => {
  const offenders: string[] = []
  const exclude = [`**/node_modules/**`, `extensions/*/{build,dist,lib,out}/**`]
  for (const file of globSync(`{src,tests,extensions}/**/*.{ts,svelte}`, { exclude })) {
    if (NODE_RUN.test(file)) continue
    const text = readFileSync(file, `utf8`)
    for (const { groups, index } of text.matchAll(INTERNAL_WITH_EXT))
      offenders.push(
        `${file}:${text.slice(0, index).split(`\n`).length}: ${groups?.specifier}`,
      )
  }
  expect(offenders).toEqual([])
})

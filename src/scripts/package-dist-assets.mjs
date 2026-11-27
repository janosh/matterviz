import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

// svelte-package compiles src/lib/element/data.ts to dist/element/data.js but keeps its
// `./data.json.gz` imports, which consumers can't load. Inline the decompressed JSON in their
// place, so every export of data.ts ships without a hand-maintained copy of the module.
const gz_path = resolve(import.meta.dirname, `../lib/element/data.json.gz`)
const data_js = resolve(import.meta.dirname, `../../dist/element/data.js`)

const json = JSON.stringify(JSON.parse(gunzipSync(readFileSync(gz_path)).toString(`utf8`)))
let source = readFileSync(data_js, `utf8`)
for (const [from, to] of [
  [`import element_data from './data.json.gz';`, `const element_data = ${json};`],
  [`export { default } from './data.json.gz';`, `export default element_data;`],
]) {
  if (!source.includes(from)) {
    throw new Error(`${data_js}: expected svelte-package output to contain: ${from}`)
  }
  source = source.replace(from, to)
}
writeFileSync(data_js, source)

// Source imports are extensionless (`./types`, `#lib/math`, which svelte-package rewrites to
// `../math`) and svelte-package copies specifiers verbatim, but Node's ESM loader only takes
// full paths. Point each relative import in dist/ at its file (`.js`) or directory index
// (`/index.js`) so modules without .svelte imports load in plain Node too.
const dist_dir = resolve(import.meta.dirname, `../../dist`)
const relative_import =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])(\.{1,2}\/[^'"`?$]*)\2/gu
const is_file = (path) => statSync(path, { throwIfNoEntry: false })?.isFile()
for (const entry of readdirSync(dist_dir, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:js|ts|svelte)$/u.test(entry.name)) continue
  const file = resolve(entry.parentPath, entry.name)
  const source = readFileSync(file, `utf8`)
  const specified = source.replace(relative_import, (match, keyword, quote, specifier) => {
    const target = resolve(dirname(file), specifier)
    if (is_file(target)) return match
    const suffix = [`.js`, `/index.js`].find((ext) => is_file(target + ext))
    if (!suffix) throw new Error(`${file}: no file for import '${specifier}'`)
    return `${keyword}${quote}${specifier}${suffix}${quote}`
  })
  if (specified !== source) writeFileSync(file, specified)
}

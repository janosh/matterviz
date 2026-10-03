import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

// Ensures src/lib/element/data.json exists by decompressing data.json.gz if needed.
// This is imported by vite.config.ts, playwright.config.ts, and tests/vitest/setup.ts
// to ensure the element data is available before bundlers parse imports.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const script_dir = dirname(fileURLToPath(import.meta.url))
const element_dir = resolve(script_dir, `../src/lib/element`)
const gz_path = `${element_dir}/data.json.gz`
const json_path = `${element_dir}/data.json`

if (!existsSync(json_path) && existsSync(gz_path)) {
  writeFileSync(json_path, gunzipSync(readFileSync(gz_path)))
}

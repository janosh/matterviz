import type { ChemicalElement } from '$lib/element/types'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const data_gz_path = resolve(
  dirname(fileURLToPath(import.meta.url)),
  `../../src/lib/element/data.json.gz`,
)

export default JSON.parse(
  gunzipSync(readFileSync(data_gz_path)).toString(`utf8`),
) as ChemicalElement[]

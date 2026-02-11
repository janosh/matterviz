import type { ChemicalElement } from '$lib/element/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const data_gz_path = resolve(
  import.meta.dirname ?? `.`,
  `../../src/lib/element/data.json.gz`,
)

export default JSON.parse(
  gunzipSync(readFileSync(data_gz_path)).toString(`utf8`),
) as ChemicalElement[]

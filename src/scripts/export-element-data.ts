import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const script_dir = dirname(fileURLToPath(import.meta.url))

const { values } = parseArgs({
  options: {
    input: { type: `string`, short: `i` },
    output: { type: `string`, short: `o` },
  },
})

const input_path = resolve(script_dir, values.input ?? `../lib/element/data.ts`)
const output_path = resolve(script_dir, values.output ?? `../../rust/src/elements.json`)

const { default: ts_data } = await import(input_path)

fs.writeFileSync(output_path, JSON.stringify(ts_data, null, 2))
console.log(`Exported ${ts_data.length} elements to ${output_path}`)

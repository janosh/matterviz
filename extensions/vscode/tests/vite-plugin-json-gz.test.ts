import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { vite_plugin_json_gz } from '../vite-plugin-json-gz'

const fixture_path = `${import.meta.dirname}/../test-fixtures/all-viz-types.json.gz`
const expected_data = JSON.parse(gunzipSync(readFileSync(fixture_path)).toString(`utf-8`))

function make_plugin(command: `build` | `serve` = `serve`) {
  const plugin = vite_plugin_json_gz()
  const config_resolved = plugin.configResolved as (cfg: { command: string }) => void
  config_resolved.call({}, { command })
  return plugin.load as (this: { error: (msg: string) => void }, id: string) => unknown
}

describe(`vite_plugin_json_gz`, () => {
  test.each([`foo.json`, `bar.ts`, `data.gz`])(`ignores non-.json.gz file: %s`, (id) => {
    const load = make_plugin()
    expect(load.call({ error: () => {} }, id)).toBeNull()
  })

  test(`dev/serve mode returns JS module matching decompressed content`, () => {
    const load = make_plugin(`serve`)
    const result = load.call({ error: () => {} }, fixture_path) as string
    expect(result).toMatch(/^export default /)
    expect(JSON.parse(result.replace(/^export default /, ``))).toEqual(expected_data)
  })

  test(`build mode returns raw JSON with moduleType:'json'`, () => {
    const load = make_plugin(`build`)
    const result = load.call({ error: () => {} }, fixture_path) as {
      code: string
      moduleType: string
    }
    expect(result.moduleType).toBe(`json`)
    expect(JSON.parse(result.code)).toEqual(expected_data)
  })

  test.each([
    [`missing file`, `/nonexistent/file.json.gz`],
    [
      `invalid JSON`,
      (() => {
        const path = join(tmpdir(), `bad-json-${Date.now()}.json.gz`)
        writeFileSync(path, gzipSync(`{not valid json!!!`))
        return path
      })(),
    ],
  ])(`calls this.error for %s`, (_label, path) => {
    const load = make_plugin()
    const errors: string[] = []
    load.call({ error: (msg: string) => errors.push(msg) }, path)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(`Failed to load`)
  })
})

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
  test.each([`foo.json`, `bar.ts`, `data.gz`, `${fixture_path}?url`, `${fixture_path}?raw`])(
    `returns null for non-matching id: %s`,
    (id) => {
      const load = make_plugin()
      expect(load.call({ error: () => {} }, id)).toBeNull()
    },
  )

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

// The inline plugins in vite.config.ts strip query params before checking extensions,
// so they need explicit ?url skip guards — the bug that broke /convex-hull/chempot-diagram.
const strip_query = (path: string): string => path.replace(/\?.*$/, ``)

describe(`inline vite-plugin-json-gz query handling`, () => {
  const should_handle = (source: string): boolean => {
    const clean = strip_query(source)
    if (!clean.endsWith(`.json.gz`)) return false
    if (source.includes(`raw`) || source.includes(`url`)) return false
    return true
  }

  test.each([
    [`bare .json.gz import`, `data.json.gz`, true],
    [`?url import`, `data.json.gz?url`, false],
    [`?raw import`, `data.json.gz?raw`, false],
    [`non .json.gz`, `data.json`, false],
    [`glob ?url import`, `/src/site/chempot-diagram/entries.json.gz?url`, false],
    [`glob eager import`, `/src/site/phonons/data.json.gz`, true],
  ])(`%s → handled: %s`, (_label, source, expected) => {
    expect(should_handle(source)).toBe(expected)
  })
})

describe(`inline vite-plugin-raw-text query handling`, () => {
  const TEXT_EXT_RE = /\.(xyz|extxyz|cif|poscar|lammpstrj|yaml\.gz)$/

  const should_handle = (source: string): boolean => {
    if (source.includes(`url`)) return false
    const clean = strip_query(source)
    const is_raw_gz = clean.endsWith(`.json.gz`) && source.includes(`raw`)
    return TEXT_EXT_RE.test(clean) || is_raw_gz
  }

  test.each([
    [`bare .xyz`, `trajectory.xyz`, true],
    [`?raw .xyz`, `trajectory.xyz?raw`, true],
    [`?url .xyz`, `trajectory.xyz?url`, false],
    [`bare .extxyz`, `atoms.extxyz`, true],
    [`?url .extxyz`, `atoms.extxyz?url`, false],
    [`bare .cif`, `structure.cif`, true],
    [`?url .cif`, `structure.cif?url`, false],
    [`bare .lammpstrj`, `dump.lammpstrj`, true],
    [`?url .lammpstrj`, `dump.lammpstrj?url`, false],
    [`?raw .json.gz`, `data.json.gz?raw`, true],
    [`?url .json.gz`, `data.json.gz?url`, false],
    [`non-text file`, `image.png`, false],
    [`.json (no gz)`, `data.json`, false],
  ])(`%s → handled: %s`, (_label, source, expected) => {
    expect(should_handle(source)).toBe(expected)
  })
})

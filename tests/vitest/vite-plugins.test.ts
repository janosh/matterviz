import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import {
  three_compat_alias,
  vite_plugin_json_gz,
  vite_plugin_moyo_wasm_source,
} from '../../src/vite-plugins'

const fixture_path = `${import.meta.dirname}/fixtures/file-viewer/all-viz-types.json.gz`
const expected_data = JSON.parse(gunzipSync(readFileSync(fixture_path)).toString(`utf-8`))

function make_plugin(command: `build` | `serve` = `serve`) {
  const plugin = vite_plugin_json_gz()
  const config_resolved = plugin.configResolved as (cfg: { command: string }) => void
  config_resolved.call({}, { command })
  return plugin.load as (this: { error: (msg: string) => void }, id: string) => unknown
}

describe(`vite_plugin_json_gz`, () => {
  test(`query-aware mode resolves bare imports and leaves raw and URL imports unclaimed`, () => {
    const plugin = vite_plugin_json_gz({ resolve_queries: true })
    const resolve_id = plugin.resolveId as (source: string, importer?: string) => string | null
    const importer = join(tmpdir(), `vite.config.ts`)
    expect(resolve_id(`./data.json.gz`, importer)).toBe(join(tmpdir(), `data.json.gz`))
    expect(resolve_id(`./data.json.gz?raw`, importer)).toBeNull()
    expect(resolve_id(`./data.json.gz?url`, importer)).toBeNull()
  })

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
    expect(errors[0]).toContain(`Failed to decompress`)
  })
})

describe(`three_compat_alias`, () => {
  // A string alias would prefix-match and rewrite three/webgpu, three/tsl and
  // three/examples/* onto the compat shim, which only re-exports the WebGL-only names.
  test.each([
    [`three`, true],
    [`three/webgpu`, false],
    [`three/tsl`, false],
    [`three/examples/jsm/controls/OrbitControls.js`, false],
    [`threejs`, false],
  ])(`%s matches: %s`, (specifier, expected) => {
    expect(three_compat_alias.find.test(specifier)).toBe(expected)
  })

  test(`resolves to an existing shim regardless of importing config depth`, () => {
    expect(three_compat_alias.replacement).toMatch(/src\/lib\/scene\/three-compat\.ts$/)
    expect(readFileSync(three_compat_alias.replacement, `utf-8`)).toContain(`three`)
  })
})

// The plugin keys on wasm-bindgen's exact glue literal; if a moyo-wasm upgrade changes it
// the rewrite silently stops and bundles resolve the .wasm next to the glue again
describe(`vite_plugin_moyo_wasm_source`, () => {
  const glue_id = `/node_modules/@spglib/moyo-wasm/moyo_wasm.js`
  const glue_literal = `new URL('moyo_wasm_bg.wasm', import.meta.url)`
  const glue_code = `const wasm_url = ${glue_literal};\nexport default wasm_url`
  const transform = (code: string, id: string) => {
    const plugin = vite_plugin_moyo_wasm_source(
      `test-moyo`,
      `WASM_SOURCE`,
      `import x from 'y'\n`,
    )
    return (plugin.transform as (code: string, id: string) => unknown)(code, id)
  }

  test(`replaces the glue literal with the source expression and prepends the prelude`, () => {
    expect(transform(glue_code, glue_id)).toEqual({
      code: `import x from 'y'\nconst wasm_url = WASM_SOURCE;\nexport default wasm_url`,
      map: null,
    })
  })

  test.each([
    [`non-moyo id`, glue_code, `/node_modules/other/index.js`],
    [`moyo id without the glue literal`, `export const unrelated = 1`, glue_id],
  ])(`leaves %s untouched`, (_label, code, id) => {
    expect(transform(code, id)).toBeNull()
  })
})

// Build helpers shared by root and extension Vite configs, outside the published src/lib.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Plugin } from 'vite'

export const split_query = (path: string): [clean: string, query: string] => {
  const clean = path.replace(/\?.*$/, ``)
  return [clean, path.slice(clean.length)]
}

export const resolve_from_importer = (clean: string, importer?: string): string =>
  importer ? resolve(dirname(split_query(importer)[0]), clean) : clean

// Transparently import .json.gz files as ES modules.
// Query-aware mode leaves ?raw and ?url to peer plugins and resolves bare importer paths.
export function vite_plugin_json_gz({
  resolve_queries = false,
}: { resolve_queries?: boolean } = {}): Plugin {
  let is_build = false
  // Path to read, or null when the id belongs to another plugin.
  const claim = (path: string): string | null => {
    const [clean, query] = resolve_queries ? split_query(path) : [path, ``]
    const delegated = query.includes(`raw`) || query.includes(`url`)
    return !delegated && clean.endsWith(`.json.gz`) ? clean : null
  }
  return {
    name: `vite-plugin-json-gz`,
    enforce: `pre`,
    configResolved(config) {
      is_build = config.command === `build`
    },
    resolveId: resolve_queries
      ? (source, importer) => {
          const clean = claim(source)
          return clean ? resolve_from_importer(clean, importer) : null
        }
      : undefined,
    load(id) {
      const clean = claim(id)
      if (!clean) return null
      try {
        const json_str = gunzipSync(readFileSync(clean)).toString(`utf-8`)
        JSON.parse(json_str) // validate before passing to bundler
        // Rolldown (production) needs moduleType:'json' for import.meta.glob
        // with import:'default' to properly unwrap the default export.
        // Dev/test server doesn't support moduleType, needs JS module format.
        if (is_build) return { code: json_str, moduleType: `json` }
        return `export default ${json_str}`
      } catch (error) {
        return this.error(`Failed to decompress ${id}: ${error}`)
      }
    },
  }
}

// Worker bundles get their own plugin list; .json.gz fixtures must decode there too
export const json_gz_worker_plugins =
  (options?: Parameters<typeof vite_plugin_json_gz>[0]) => (): Plugin[] => [
    vite_plugin_json_gz(options),
  ]

// Redirect bare `three` to the WebGPU compatibility shim without matching subpaths.
// Use a structural type because separate Vite/Vite+ Alias types exceed TS's instantiation depth.
export const three_compat_alias: { find: RegExp; replacement: string } = {
  find: /^three$/,
  replacement: resolve(import.meta.dirname, `lib/scene/three-compat.ts`),
}

// $lib for builds outside SvelteKit (extensions), plus the three shim every bundle needs.
// Array form so `three` matches exactly — a string alias prefix-matches and would rewrite
// three/webgpu, three/tsl and three/examples/* too; `$lib` is meant to prefix-match.
export const lib_aliases: { find: string | RegExp; replacement: string }[] = [
  { find: `$lib`, replacement: resolve(import.meta.dirname, `lib`) },
  three_compat_alias,
]

// wasm-bindgen's moyo glue resolves moyo_wasm_bg.wasm next to itself, which breaks once
// bundled. Rewrite that lookup to `source` (a JS expression); `prelude` is prepended verbatim
// for any import the expression needs.
const moyo_glue_url = `new URL('moyo_wasm_bg.wasm', import.meta.url)`
export const vite_plugin_moyo_wasm_source = (
  name: string,
  source: string,
  prelude = ``,
): Plugin => ({
  name,
  enforce: `pre`,
  transform(code, id) {
    if (!id.includes(`@spglib/moyo-wasm`) || !code.includes(moyo_glue_url)) return null
    return { code: prelude + code.replace(moyo_glue_url, source), map: null }
  },
})

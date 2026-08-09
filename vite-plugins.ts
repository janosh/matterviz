// Build-time helpers shared by the root vite config and every extension's config. They live
// at the repo root rather than under src/lib because svelte-package copies src/lib into the
// published dist, and these are build tooling, not library code.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Plugin } from 'vite'

export const split_query = (path: string): [clean: string, query: string] => {
  const clean = path.replace(/\?.*$/, ``)
  return [clean, path.slice(clean.length)]
}

export const resolve_from_importer = (clean: string, importer?: string) =>
  importer ? resolve(dirname(split_query(importer)[0]), clean) : clean

// Transparently import .json.gz files as ES modules.
// `resolve_queries` is for the root config, which pairs this with a raw_text_plugin that
// claims `?raw` and a Vite built-in that claims `?url`: there, queried ids must be left to
// them and bare ones resolved against their importer. Extension configs have no such
// neighbour, so they take ids as given.
export function vite_plugin_json_gz({
  resolve_queries = false,
}: { resolve_queries?: boolean } = {}): Plugin {
  let is_build = false
  // the path to read, or null when the id belongs to another plugin
  const claim = (path: string): string | null => {
    if (!resolve_queries) return path.endsWith(`.json.gz`) ? path : null
    const [clean, query] = split_query(path)
    if (query.includes(`raw`) || query.includes(`url`)) return null
    return clean.endsWith(`.json.gz`) ? clean : null
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

// Redirect bare `three` — which three/examples/jsm addons and @threlte import, but we don't —
// onto the WebGPU build via a shim supplying the WebGL-only exports it lacks, so the bundle
// carries one copy of three. Exact-match regex: three/webgpu, three/tsl and three/examples/*
// must resolve normally. Resolved against this file so every config gets the same path
// regardless of how deep it sits.
// Typed structurally rather than as vite's `Alias`: the configs are spread across vite and
// vite-plus, whose bundled copies of that type are distinct instances, and comparing the two
// blows TS's instantiation depth.
export const three_compat_alias: { find: RegExp; replacement: string } = {
  find: /^three$/,
  replacement: resolve(import.meta.dirname, `src/lib/scene/three-compat.ts`),
}

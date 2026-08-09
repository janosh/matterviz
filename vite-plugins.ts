// Build-time helpers shared by the root vite config and every extension's config. They live
// at the repo root rather than under src/lib because svelte-package copies src/lib into the
// published dist, and these are build tooling, not library code.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Plugin } from 'vite'

// Transparently import .json.gz files as ES modules.
// The root config wraps this with extra ?raw/?url query handling, which it needs to
// coexist with its raw_text_plugin; extensions use it as-is.
export function vite_plugin_json_gz(): Plugin {
  let is_build = false
  return {
    name: `vite-plugin-json-gz`,
    enforce: `pre`,
    configResolved(config) {
      is_build = config.command === `build`
    },
    load(id) {
      if (!id.endsWith(`.json.gz`)) return null
      try {
        const json_str = gunzipSync(readFileSync(id)).toString(`utf-8`)
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

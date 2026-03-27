import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { Plugin } from 'vite'

// Vite plugin that transparently imports .json.gz files as ES modules
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
        this.error(`Failed to load ${id}: ${error}`)
      }
    },
  }
}

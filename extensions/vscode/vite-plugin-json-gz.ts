import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { Plugin } from 'vite'

// Vite plugin that transparently imports .json.gz files as ES modules
export function vite_plugin_json_gz(): Plugin {
  return {
    name: `vite-plugin-json-gz`,
    enforce: `pre`,
    load(id) {
      if (!id.endsWith(`.json.gz`)) return null
      try {
        const json_data = JSON.parse(gunzipSync(readFileSync(id)).toString(`utf-8`))
        return { code: `export default ${JSON.stringify(json_data)}`, map: null }
      } catch (error) {
        this.error(`Failed to load ${id}: ${error}`)
      }
    },
  }
}

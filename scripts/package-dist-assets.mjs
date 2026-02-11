import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { build } from 'vite'

const root_dir = resolve(dirname(fileURLToPath(import.meta.url)), `..`)
const gz_path = resolve(root_dir, `src/lib/element/data.json.gz`)
const out_dir = resolve(root_dir, `dist/element`)
const xrd_src_path = resolve(
  root_dir,
  `extensions/rust/src/atomic_scattering_params.json`,
)
const xrd_out_dir = resolve(root_dir, `dist/xrd`)
const xrd_out_path = resolve(xrd_out_dir, `atomic_scattering_params.json`)
const tmp_dir = mkdtempSync(resolve(tmpdir(), `matterviz-dist-assets-`))
const entry_path = resolve(tmp_dir, `element-data-entry.mjs`)

mkdirSync(out_dir, { recursive: true })
writeFileSync(
  entry_path,
  `import data from ${JSON.stringify(gz_path)}; export default data;\n`,
)

try {
  await build({
    configFile: false,
    plugins: [
      {
        name: `json-gz-loader`,
        load(id) {
          if (!id.endsWith(`.json.gz`)) return null
          const json = JSON.parse(gunzipSync(readFileSync(id)).toString(`utf8`))
          return `export default ${JSON.stringify(json)};`
        },
      },
    ],
    build: {
      lib: {
        entry: entry_path,
        formats: [`es`],
        fileName: () => `data.js`,
      },
      outDir: out_dir,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        output: {
          exports: `default`,
        },
      },
    },
  })
  mkdirSync(xrd_out_dir, { recursive: true })
  copyFileSync(xrd_src_path, xrd_out_path)
} finally {
  rmSync(tmp_dir, { recursive: true, force: true })
}

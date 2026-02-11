import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root_dir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root_dir, 'extensions/rust/src/atomic_scattering_params.json')
const dest_dir = resolve(root_dir, 'dist/xrd')
const dest = resolve(dest_dir, 'atomic_scattering_params.json')

mkdirSync(dest_dir, { recursive: true })
copyFileSync(src, dest)

// Fail packaging when dist/ still imports repo-private specifiers. svelte-package only rewrites
// default/namespace imports whose identifier is letters+digits, so e.g.
// `import element_data from '#lib/...'` ships an unresolvable '#lib' import to consumers.
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dist_dir = resolve(import.meta.dirname, `../../dist`)
const private_import =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])((?:#\w|\$app\/|\$lib|\$env\/)[^'"]*)\1/gu

const leaks = readdirSync(dist_dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:js|svelte|ts)$/u.test(entry.name))
  .flatMap((entry) => {
    const file = resolve(entry.parentPath, entry.name)
    const source = readFileSync(file, `utf8`)
    return [...source.matchAll(private_import)].map(
      (match) => `${file.slice(dist_dir.length + 1)}: ${match[2]}`,
    )
  })
if (leaks.length) {
  throw new Error(`dist/ has ${leaks.length} unresolved private imports:\n${leaks.join(`\n`)}`)
}

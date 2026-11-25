// LOBSTER samples for the /spectral/cohp demo: one folder per sample holding its
// COHPCAR/COOPCAR/COBICAR.lobster, optionally ICOHPLIST-type lists and a POSCAR, and a
// SOURCE.txt saying where the data comes from (shown with the demo, `[text](url)` links allowed). Adding a folder adds a
// sample.
import { type LobsterFiles, parse_lobster_files } from '#lib/spectral/lobster.js'

export type LobsterSample = LobsterFiles & {
  name: string
  source: string | null // SOURCE.txt, required for bundled samples
}

// LICENSE.txt carries the upstream license with the copied files; it isn't sample data
const raw_files = import.meta.glob<string>([`./*/*`, `!./*/LICENSE.txt`], {
  query: `?raw`,
  import: `default`,
  eager: true,
})

const by_folder: Record<string, Record<string, string>> = {}
for (const [path, text] of Object.entries(raw_files)) {
  const [, folder, filename] = path.split(`/`)
  by_folder[folder] = { ...by_folder[folder], [filename]: text }
}

export const lobster_samples: Record<string, LobsterSample> = Object.fromEntries(
  Object.entries(by_folder).map(([folder, { 'SOURCE.txt': source, ...files }]) => {
    if (!source) throw new Error(`LOBSTER sample "${folder}" has no SOURCE.txt`)
    return [folder, { ...parse_lobster_files(files), name: folder, source: source.trim() }]
  }),
)

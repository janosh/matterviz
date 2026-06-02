import type { XrdPattern } from '$lib/xrd'

// Fixture id = base name without .json/.json.gz. Shared so lookups (e.g. pairing with
// structure files) derive the same key this index uses.
export const fixture_id = (path_or_name: string) =>
  path_or_name
    .split(`/`)
    .at(-1)
    ?.replace(/\.json(\.gz)?$/, ``) ?? path_or_name

// Precomputed XRD pattern index. Large fixtures are gzipped (.json.gz, decompressed
// by the json_gz vite plugin); small ones stay plain .json for readable git diffs.
const modules = import.meta.glob<XrdPattern>([`./*.json`, `./*.json.gz`], {
  eager: true,
  import: `default`,
})
export const xrd_patterns: Record<string, XrdPattern> = Object.fromEntries(
  Object.entries(modules).map(([path, data]) => [fixture_id(path), data]),
)

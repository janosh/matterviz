import { XrdPattern } from '$lib/xrd'

// Precomputed XRD pattern index
// The demo page will import JSON files from this directory.
export const xrd_patterns: Record<string, XrdPattern> = Object.fromEntries(
  Object.entries(
    import.meta.glob(`./*.json`, { eager: true, import: `default` }) as Record<
      string,
      unknown
    >,
  ).map(([path, data]) => {
    const id = path.split(`/`).at(-1)?.replace(`.json`, ``) || path
    return [id, data as XrdPattern]
  }),
)

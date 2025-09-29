import type { XrdPattern } from '$lib/xrd'

// Precomputed XRD pattern index
export const xrd_patterns = Object.fromEntries(
  Object.entries(import.meta.glob(`./*.json`, { eager: true, import: `default` })).map(
    ([path, data]) => {
      const id = path.split(`/`).at(-1)?.replace(`.json`, ``) || path
      return [id, data as XrdPattern]
    },
  ),
)

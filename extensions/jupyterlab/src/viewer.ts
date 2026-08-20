// Lazy-loaded by `index.ts` on first file open so JupyterLab's bootstrap doesn't
// pull three.js + the Svelte component graph into every session.
export type { MatterVizApp } from '$lib/file-viewer/main'
export { create_display } from '$lib/file-viewer/main'
export { parse_in_worker } from '$lib/file-viewer/parse-in-worker'
export { unmount } from 'svelte'

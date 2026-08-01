// Everything that pulls in the MatterViz component graph lives behind this module
// so `index.ts` can stay a thin shim. JupyterLab imports every extension's entry
// during bootstrap, and dragging three.js + the Svelte components into that path
// costs a multi-megabyte download on every Lab start — for a viewer most sessions
// never open. `index.ts` imports this dynamically on the first file open instead.

export type { MatterVizApp } from '$lib/file-viewer/main'
export { create_display } from '$lib/file-viewer/main'
export { parse_file_content } from '$lib/file-viewer/parse'
export { unmount } from 'svelte'

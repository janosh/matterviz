// Shared file-viewer types and filename patterns.

export type ViewType =
  | `trajectory`
  | `structure`
  | `fermi_surface`
  | `isosurface`
  | `convex_hull`
  | `phase_diagram`
  | `json_browser`
  // DOS/bands-only vaspout.h5 results (no structure data to show a trajectory for)
  | `vaspout_electronic`

// Filename patterns for specialized file types (shared between extension host and webview)
export const FERMI_FILE_EXTENSIONS = Object.freeze([`.bxsf`, `.frmsf`])
// oxfmt-ignore
export const FERMI_FILE_RE = new RegExp(`\\.(?:${FERMI_FILE_EXTENSIONS.map((ext) => ext.slice(1)).join(`|`)})$`, `i`)
export const VOLUMETRIC_EXT_RE = /\.cube$/i
export { VASP_VOLUMETRIC_REGEX as VOLUMETRIC_VASP_RE } from '$lib/constants'

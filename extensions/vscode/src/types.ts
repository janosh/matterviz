// Shared types and constants between the extension host (extension.ts) and the webview (main.ts).
// Both build pipelines import from this file to keep types in sync.

export type ViewType =
  | `trajectory`
  | `structure`
  | `fermi_surface`
  | `isosurface`
  | `convex_hull`
  | `phase_diagram`
  | `json_browser`

// Filename patterns for specialized file types (shared between extension host and webview)
export const FERMI_FILE_RE = /\.(bxsf|frmsf)$/i
export const VOLUMETRIC_EXT_RE = /\.cube$/i
export const VOLUMETRIC_VASP_RE = /^(chgcar|aeccar[012]?|elfcar|locpot)/i

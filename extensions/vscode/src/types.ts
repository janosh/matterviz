// Shared types between the extension host (extension.ts) and the webview (main.ts).
// Both build pipelines import from this file to keep types in sync.

export type ViewType =
  | `trajectory`
  | `structure`
  | `fermi_surface`
  | `isosurface`
  | `convex_hull`
  | `phase_diagram`
  | `json_browser`

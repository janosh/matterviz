// Fermi surface sample data files
// Export file info for use in demo pages
import type { FileInfo } from '$lib'

// Auto-discover fermi surface data files using Vite's import.meta.glob
const fermi_file_modules = import.meta.glob(
  [`./*.bxsf`, `./*.bxsf.gz`, `./*.frmsf`, `./*.frmsf.gz`, `./*.json`, `./*.json.gz`],
  { query: `?url`, eager: true, import: `default` },
) as Record<string, string>

// FRMSF files with color data (Fermi velocity, orbital character) instead of eigenvalues
// These contain per-k-point property data for coloring Fermi surfaces
const FRMSF_COLOR_DATA_FILES = new Set([
  `mgb2_vfz.frmsf.gz`, // MgB2 with Fermi velocity z-component
  `mgb2_b2pz.frmsf.gz`, // MgB2 with B 2pz orbital projection
  `mgb2_vfermi.frmsf.gz`, // MgB2 with Fermi velocity magnitude
  `pb_vf3D.frmsf.gz`, // Pb with 3D Fermi velocity (vx, vy, vz)
  `srvo3_orb.frmsf.gz`, // SrVO3 with orbital character
])

// Convert glob results to FileInfo array with categories
export const fermi_surface_files: FileInfo[] = Object.entries(fermi_file_modules)
  .map(([path, url]) => {
    const name = path.split(`/`).pop() || path
    // Remove .gz extension to get base format
    const base_name = name.replace(/\.gz$/i, ``)
    const ext = base_name.split(`.`).pop()?.toLowerCase() || ``

    // Determine category and icon based on format and filename
    let category = `Unknown`
    let category_icon = `📄`

    if (ext === `bxsf`) {
      category = `BXSF`
      category_icon = `🔷`
    } else if (ext === `frmsf`) {
      // Distinguish between eigenvalue files and color data files
      if (FRMSF_COLOR_DATA_FILES.has(name)) {
        category = `FRMSF Color`
        category_icon = `🎨`
      } else {
        category = `FRMSF`
        category_icon = `🔶`
      }
    } else if (ext === `json`) {
      // IFermi JSON Fermi surface files (fs_* prefix)
      category = `IFermi`
      category_icon = `🌐`
    }

    return { name, url, type: ext, category, category_icon }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

// File type colors for FilePicker
export const fermi_file_colors: Record<string, string> = {
  bxsf: `rgba(70, 130, 180, 0.8)`, // Steel blue for XCrySDen
  frmsf: `rgba(255, 140, 0, 0.8)`, // Orange for FermiSurfer
  json: `rgba(138, 43, 226, 0.8)`, // Purple for JSON
}

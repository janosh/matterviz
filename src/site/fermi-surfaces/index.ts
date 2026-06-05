// Fermi surface sample data files
// Export file info for use in demo pages
import type { FileInfo } from '$lib'

// Example files served at /fermi-surfaces/<name> via the static symlink (url built from the
// path key, not the glob value)
const fermi_file_modules = import.meta.glob(
  `$site/fermi-surfaces/*.{bxsf,bxsf.gz,frmsf,frmsf.gz,json.gz}`,
  { query: `?url` },
)

// FRMSF files carrying per-k-point color data (Fermi velocity, orbital character) rather
// than eigenvalues — labeled distinctly from plain FRMSF files in the picker.
const FRMSF_COLOR_DATA_FILES = new Set([
  `mgb2_vfz.frmsf.gz`, // MgB2 with Fermi velocity z-component
  `mgb2_b2pz.frmsf.gz`, // MgB2 with B 2pz orbital projection
  `mgb2_vfermi.frmsf.gz`, // MgB2 with Fermi velocity magnitude
  `pb_vf3D.frmsf.gz`, // Pb with 3D Fermi velocity (vx, vy, vz)
  `srvo3_orb.frmsf.gz`, // SrVO3 with orbital character
])

// Picker category + icon per base format (.json files are assumed IFermi format)
const CATEGORY_BY_EXT: Record<string, { category: string; category_icon: string }> = {
  bxsf: { category: `BXSF`, category_icon: `🔷` },
  frmsf: { category: `FRMSF`, category_icon: `🔶` },
  json: { category: `IFermi`, category_icon: `🌐` },
}

export const fermi_surface_files: FileInfo[] = Object.keys(fermi_file_modules)
  .map((path) => {
    const name = path.split(`/`).pop() ?? path
    // Serve from static/fermi-surfaces (path-derived URL, e.g. /fermi-surfaces/pb.bxsf.gz)
    const url = path.replace(`/src/site`, ``)
    // strip .gz to get the underlying format extension
    const ext = name.replace(/\.gz$/i, ``).split(`.`).pop()?.toLowerCase() ?? ``
    const category =
      ext === `frmsf` && FRMSF_COLOR_DATA_FILES.has(name)
        ? { category: `FRMSF Color`, category_icon: `🎨` }
        : (CATEGORY_BY_EXT[ext] ?? { category: `Unknown`, category_icon: `📄` })
    return { name, url, type: ext, ...category }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

// File type colors for FilePicker
export const fermi_file_colors: Record<string, string> = {
  bxsf: `rgba(70, 130, 180, 0.8)`, // Steel blue for XCrySDen
  frmsf: `rgba(255, 140, 0, 0.8)`, // Orange for FermiSurfer
  json: `rgba(138, 43, 226, 0.8)`, // Purple for JSON
}

import type { FileInfo, FileTypePaint } from '$lib'
import { file_type_paint } from '$lib'
import { SvelteSet } from 'svelte/reactivity'

// The static symlink serves these fixtures at /fermi-surfaces/<name>.
const fermi_file_modules = import.meta.glob(
  `$site/fermi-surfaces/*.{bxsf,bxsf.gz,frmsf,frmsf.gz,json.gz}`,
  { query: `?url` },
)

// FRMSF files carrying per-k-point color data (Fermi velocity, orbital character) rather
// than eigenvalues — labeled distinctly from plain FRMSF files in the picker.
const FRMSF_COLOR_DATA_FILES = new SvelteSet([
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
    const url = path.replace(`/src/site`, ``)
    const ext = name.replace(/\.gz$/i, ``).split(`.`).pop()?.toLowerCase() ?? ``
    const category =
      ext === `frmsf` && FRMSF_COLOR_DATA_FILES.has(name)
        ? { category: `FRMSF Color`, category_icon: `🎨` }
        : (CATEGORY_BY_EXT[ext] ?? { category: `Unknown`, category_icon: `📄` })
    return { name, url, type: ext, ...category }
  })
  .toSorted((file_a, file_b) => file_a.name.localeCompare(file_b.name))

export const fermi_file_paints: Record<string, FileTypePaint> = {
  bxsf: file_type_paint(`rgba(70, 130, 180, 0.8)`), // Steel blue for XCrySDen
  frmsf: file_type_paint(`rgba(255, 140, 0, 0.8)`), // Orange for FermiSurfer
  json: file_type_paint(`rgba(138, 43, 226, 0.8)`), // Purple for JSON
}

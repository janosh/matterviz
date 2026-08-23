import type { FileInfo } from '$lib/io'
import { site_file_info } from '$site/imports'

// The static symlink serves these fixtures at /isosurfaces/<name>.
const volumetric_file_modules = import.meta.glob(`$site/isosurfaces/*.gz`, {
  query: `?url`,
})

export interface VolumetricFileInfo extends FileInfo {
  description: string
}

// `foo.cube.gz` -> cube, `Si-CHGCAR.gz` / `pymatgen-CHGCAR.Fe3O4.gz` -> chgcar, `AECCAR0` ->
// aeccar (the digit picks the core/valence block, not the format)
const volumetric_type = (name: string): string =>
  /\.cube(?:\.gz)?$/i.test(name)
    ? `cube`
    : (/(?<format>CHGCAR|LOCPOT|ELFCAR|PARCHG|AECCAR)\d?/i
        .exec(name)
        ?.groups?.format.toLowerCase() ?? `unknown`)

// Metadata for each example file
const file_metadata: Record<string, { label: string; description: string }> = {
  // Simulated .cube files (small, fast to load)
  'h2o-density.cube.gz': {
    label: `Water`,
    description: `Water molecule electron density (simulated)`,
  },
  'benzene-orbital.cube.gz': {
    label: `Benzene π`,
    description: `Benzene pi orbital with +/- lobes (simulated)`,
  },
  'ch4-esp.cube.gz': {
    label: `Methane ESP`,
    description: `Methane electrostatic potential with +/- regions (simulated)`,
  },
  // Simulated VASP files (small, fast to load)
  'Si-CHGCAR.gz': {
    label: `Si diamond`,
    description: `Silicon diamond charge density (simulated)`,
  },
  'Fe-spin-CHGCAR.gz': {
    label: `Fe BCC spin`,
    description: `Fe BCC spin-polarized: charge + magnetization (simulated)`,
  },
  'hBN-CHGCAR.gz': {
    label: `hBN hex`,
    description: `Hexagonal BN charge density, non-orthogonal lattice (simulated)`,
  },
  'Al-slab-LOCPOT.gz': {
    label: `Al slab`,
    description: `Al(111) slab local potential with vacuum gap (simulated)`,
  },
  // Real DFT files from pymatgen test fixtures (MIT license, materialsproject/pymatgen)
  'pymatgen-CHGCAR.Fe3O4.gz': {
    label: `Fe₃O₄ (real)`,
    description: `Real Fe₃O₄ magnetite charge density, 14 atoms, spin-polarized`,
  },
  'pymatgen-CHGCAR.NiO_SOC.gz': {
    label: `NiO SOC (real)`,
    description: `Real NiO charge density with spin-orbit coupling`,
  },
  'pymatgen-ELFCAR.gz': {
    label: `ELF (real)`,
    description: `Real electron localization function, unusual 18×18×70 grid`,
  },
  // Real .cube files from quantum chemistry calculations (MIT license)
  'caffeine-HOMO.cube.gz': {
    label: `Caffeine HOMO`,
    description: `Caffeine HOMO orbital, B3LYP/6-31G(d) via Psi4`,
  },
  'caffeine-LUMO.cube.gz': {
    label: `Caffeine LUMO`,
    description: `Caffeine LUMO orbital, B3LYP/6-31G(d) via Psi4`,
  },
  'large-grid-CHGCAR.gz': {
    label: `Large grid (perf)`,
    description: `Large 80×80×96 grid for performance testing (issue #317)`,
  },
  // Matching-grid pairs for multi-volume cross-coloring demos (issue #375)
  'glycine-density.cube.gz': {
    label: `Glycine ρ`,
    description: `Glycine electron density on the same grid as glycine-esp (simulated)`,
  },
  'glycine-esp.cube.gz': {
    label: `Glycine ESP`,
    description: `Glycine electrostatic potential on the same grid as glycine-density (simulated)`,
  },
  'Al-slab-CHGCAR.gz': {
    label: `Al slab ρ`,
    description: `Al(111) slab charge density on the same grid as Al-slab-LOCPOT (simulated)`,
  },
  'hBN-ELFCAR.gz': {
    label: `hBN ELF`,
    description: `hBN localization function on the same non-orthogonal grid as hBN-CHGCAR (simulated)`,
  },
  'large-grid-LOCPOT.gz': {
    label: `Large LOCPOT (perf)`,
    description: `80×80×96 local potential matching large-grid-CHGCAR for cross-coloring perf tests`,
  },
}

export const volumetric_files: VolumetricFileInfo[] = Object.keys(volumetric_file_modules)
  .map((path) => {
    const file = site_file_info(path) // e.g. /isosurfaces/h2o-density.cube.gz
    const meta = file_metadata[file.name] ?? { label: file.name, description: file.name }
    return { ...file, type: volumetric_type(file.name), ...meta }
  })
  .toSorted((file_a, file_b) => file_a.name.localeCompare(file_b.name))

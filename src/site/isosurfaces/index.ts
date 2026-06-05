// Isosurface example data files
import type { FileInfo } from '$lib/io'

// Example files served at /isosurfaces/<name> via the static symlink (url built from the
// path key, not the glob value)
const volumetric_file_modules = import.meta.glob(`$site/isosurfaces/*.gz`, {
  query: `?url`,
})

export interface VolumetricFileInfo extends FileInfo {
  description: string
}

// Metadata for each example file
const file_metadata: Record<string, { type: string; label: string; description: string }> = {
  // Simulated .cube files (small, fast to load)
  'h2o-density.cube.gz': {
    type: `cube`,
    label: `Water`,
    description: `Water molecule electron density (simulated)`,
  },
  'benzene-orbital.cube.gz': {
    type: `cube`,
    label: `Benzene π`,
    description: `Benzene pi orbital with +/- lobes (simulated)`,
  },
  'ch4-esp.cube.gz': {
    type: `cube`,
    label: `Methane ESP`,
    description: `Methane electrostatic potential with +/- regions (simulated)`,
  },
  // Simulated VASP files (small, fast to load)
  'Si-CHGCAR.gz': {
    type: `chgcar`,
    label: `Si diamond`,
    description: `Silicon diamond charge density (simulated)`,
  },
  'Fe-spin-CHGCAR.gz': {
    type: `chgcar`,
    label: `Fe BCC spin`,
    description: `Fe BCC spin-polarized: charge + magnetization (simulated)`,
  },
  'hBN-CHGCAR.gz': {
    type: `chgcar`,
    label: `hBN hex`,
    description: `Hexagonal BN charge density, non-orthogonal lattice (simulated)`,
  },
  'Al-slab-LOCPOT.gz': {
    type: `locpot`,
    label: `Al slab`,
    description: `Al(111) slab local potential with vacuum gap (simulated)`,
  },
  // Real DFT files from pymatgen test fixtures (MIT license, materialsproject/pymatgen)
  'pymatgen-CHGCAR.Fe3O4.gz': {
    type: `chgcar`,
    label: `Fe₃O₄ (real)`,
    description: `Real Fe₃O₄ magnetite charge density, 14 atoms, spin-polarized`,
  },
  'pymatgen-CHGCAR.NiO_SOC.gz': {
    type: `chgcar`,
    label: `NiO SOC (real)`,
    description: `Real NiO charge density with spin-orbit coupling`,
  },
  'pymatgen-ELFCAR.gz': {
    type: `elfcar`,
    label: `ELF (real)`,
    description: `Real electron localization function, unusual 18×18×70 grid`,
  },
  // Real .cube files from quantum chemistry calculations (MIT license)
  'caffeine-HOMO.cube.gz': {
    type: `cube`,
    label: `Caffeine HOMO`,
    description: `Caffeine HOMO orbital, B3LYP/6-31G(d) via Psi4`,
  },
  'caffeine-LUMO.cube.gz': {
    type: `cube`,
    label: `Caffeine LUMO`,
    description: `Caffeine LUMO orbital, B3LYP/6-31G(d) via Psi4`,
  },
  'large-grid-CHGCAR.gz': {
    type: `chgcar`,
    label: `Large grid (perf)`,
    description: `Large 80×80×96 grid for performance testing (issue #317)`,
  },
}

export const volumetric_files: VolumetricFileInfo[] = Object.keys(volumetric_file_modules)
  .map((path) => {
    const name = path.split(`/`).pop() ?? path
    const url = path.replace(`/src/site`, ``) // e.g. /isosurfaces/h2o-density.cube.gz
    const meta = file_metadata[name] ?? {
      type: `unknown`,
      label: name,
      description: name,
    }
    return { name, url, ...meta }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

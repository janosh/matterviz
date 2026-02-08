// Isosurface example data files
const volumetric_file_modules = import.meta.glob(
  `./*.gz`,
  { query: `?url`, eager: true, import: `default` },
) as Record<string, string>

export interface VolumetricFileInfo {
  name: string
  url: string
  format: string
  label: string // human-readable system/molecule name
  description: string
}

// Metadata for each example file
const file_metadata: Record<
  string,
  { format: string; label: string; description: string }
> = {
  // Simulated .cube files (small, fast to load)
  'h2o-density.cube.gz': {
    format: `.cube`,
    label: `Water`,
    description: `Water molecule electron density (simulated)`,
  },
  'benzene-orbital.cube.gz': {
    format: `.cube`,
    label: `Benzene π`,
    description: `Benzene pi orbital with +/- lobes (simulated)`,
  },
  'ch4-esp.cube.gz': {
    format: `.cube`,
    label: `Methane ESP`,
    description: `Methane electrostatic potential with +/- regions (simulated)`,
  },
  // Simulated VASP files (small, fast to load)
  'Si-CHGCAR.gz': {
    format: `CHGCAR`,
    label: `Si diamond`,
    description: `Silicon diamond charge density (simulated)`,
  },
  'Fe-spin-CHGCAR.gz': {
    format: `CHGCAR`,
    label: `Fe BCC spin`,
    description: `Fe BCC spin-polarized: charge + magnetization (simulated)`,
  },
  'hBN-CHGCAR.gz': {
    format: `CHGCAR`,
    label: `hBN hex`,
    description: `Hexagonal BN charge density, non-orthogonal lattice (simulated)`,
  },
  'Al-slab-LOCPOT.gz': {
    format: `LOCPOT`,
    label: `Al slab`,
    description: `Al(111) slab local potential with vacuum gap (simulated)`,
  },
  // Real DFT files from pymatgen test fixtures (MIT license, materialsproject/pymatgen)
  'pymatgen-CHGCAR.Fe3O4.gz': {
    format: `CHGCAR`,
    label: `Fe₃O₄ (real)`,
    description: `Real Fe₃O₄ magnetite charge density, 14 atoms, spin-polarized`,
  },
  'pymatgen-CHGCAR.NiO_SOC.gz': {
    format: `CHGCAR`,
    label: `NiO SOC (real)`,
    description: `Real NiO charge density with spin-orbit coupling`,
  },
  'pymatgen-ELFCAR.gz': {
    format: `ELFCAR`,
    label: `ELF (real)`,
    description: `Real electron localization function, unusual 18×18×70 grid`,
  },
  // Real .cube files from quantum chemistry calculations (MIT license)
  'caffeine-HOMO.cube.gz': {
    format: `.cube`,
    label: `Caffeine HOMO`,
    description: `Caffeine HOMO orbital, B3LYP/6-31G(d) via Psi4`,
  },
  'caffeine-LUMO.cube.gz': {
    format: `.cube`,
    label: `Caffeine LUMO`,
    description: `Caffeine LUMO orbital, B3LYP/6-31G(d) via Psi4`,
  },
}

export const volumetric_files: VolumetricFileInfo[] = Object.entries(
  volumetric_file_modules,
)
  .map(([path, url]) => {
    const name = path.split(`/`).pop() || path
    const meta = file_metadata[name] ?? {
      format: `unknown`,
      label: name,
      description: name,
    }
    return { name, url, ...meta }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

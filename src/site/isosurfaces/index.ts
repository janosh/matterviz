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
  'h2o-density.cube.gz': {
    format: `.cube`,
    label: `Water`,
    description: `Water molecule electron density (simulated)`,
  },
  'benzene-orbital.cube.gz': {
    format: `.cube`,
    label: `Benzene`,
    description: `Benzene pi orbital with +/- lobes (simulated)`,
  },
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
  'GaAs-CHGCAR.gz': {
    format: `CHGCAR`,
    label: `GaAs`,
    description: `GaAs zinc blende multi-element charge density (simulated)`,
  },
  'ch4-esp.cube.gz': {
    format: `.cube`,
    label: `Methane ESP`,
    description: `Methane electrostatic potential with +/- regions (simulated)`,
  },
  'ethylene-orbital.cube.gz': {
    format: `.cube`,
    label: `Ethylene`,
    description: `Ethylene pi* anti-bonding orbital (simulated)`,
  },
  'MgO-ELFCAR.gz': {
    format: `ELFCAR`,
    label: `MgO ELF`,
    description: `MgO rocksalt electron localization function (simulated)`,
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

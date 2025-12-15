// Export pymatgen electronic band structure files for demos
// Glob handles both .json (dev) and .json.gz (production)
import type { BaseBandStructure } from '$lib/spectral'

const imports = import.meta.glob<BaseBandStructure>(
  [`./*-bands.json`, `./*-bands.json.gz`],
  { eager: true, import: `default` },
)

// Export with IDs extracted from filenames (e.g. ./cao-2605-bands.json -> cao_2605)
export const electronic_bands = Object.fromEntries(
  Object.entries(imports).map(([path, data]) => [
    path.match(/\/([^/]+)-bands\.json(?:\.gz)?$/)?.[1]?.replace(/-/g, `_`) ?? path,
    data,
  ]),
) as Record<string, BaseBandStructure>

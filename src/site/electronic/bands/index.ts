// Export pymatgen electronic band structure files for demos
// Glob handles both .json (dev) and .json.gz (production)
import { normalize_band_structure } from '$lib/spectral'

const imports = import.meta.glob<unknown>([`./*-bands.json`, `./*-bands.json.gz`], {
  eager: true,
  import: `default`,
})

// Export with IDs extracted from filenames (e.g. ./cao-2605-bands.json -> cao_2605)
export const electronic_bands = Object.fromEntries(
  Object.entries(imports).map(([path, data]) => {
    const bands = normalize_band_structure(data)
    if (!bands) throw new Error(`Invalid electronic bands in ${path}`)
    return [
      /\/(?<id>[^/]+)-bands\.json(?:\.gz)?$/.exec(path)?.[1]?.replaceAll(`-`, `_`) ?? path,
      bands,
    ]
  }),
)

// fcc Cu band structure along the fcc path from the same simulated calculation as
// fermi-surfaces/cu_fcc_bands.bxsf.gz (rows = the grid's band numbers − 1). Kept out of the
// electronic bands glob, which every band demo page parses eagerly.
import { normalize_band_structure } from '#lib/spectral/helpers.js'
import raw_bands from './cu-fcc-bands.json.gz'

const bands = normalize_band_structure(raw_bands)
if (!bands) throw new Error(`Invalid band structure in cu-fcc-bands.json.gz`)
export const cu_fcc_bands = bands

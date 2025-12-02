// Export pymatgen electronic band structure files for demos
import type { BaseBandStructure } from '$lib/bands'

import cao_2605 from './cao-2605-bands.json'
import vbr2_971787 from './vbr2-971787-bands.json'

// Electronic band structures (pymatgen BandStructureSymmLine)
// These are raw pymatgen JSON exports that will be normalized by the Bands component
export const electronic_bands: Record<string, BaseBandStructure> = {
  'CaO (mp-2605)': cao_2605 as unknown as BaseBandStructure,
  'VBr₂ (mp-971787, spin-polarized)': vbr2_971787 as unknown as BaseBandStructure,
}

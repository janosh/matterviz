import type { BaseBandStructure, PhononDos } from '#lib/spectral/types.js'

// Three-point Γ-X phonon band structure and single-peak phonon DOS shared by the dos and
// bands-and-dos test pages and the BandsAndDos unit tests
export const mock_band_structure: BaseBandStructure = {
  type: `phonon`,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
    { label: null, frac_coords: [0.25, 0.0, 0.0], distance: 0.5 },
    { label: `X`, frac_coords: [0.5, 0.0, 0.0], distance: 1.0 },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0.0, 0.0, 0.0], X: [0.5, 0.0, 0.0] },
  distance: [0.0, 0.5, 1.0],
  nb_bands: 3,
  bands: [
    [0.0, 1.0, 2.0],
    [1.0, 2.0, 3.0],
    [2.0, 3.0, 4.0],
  ],
}

export const mock_dos: PhononDos = {
  type: `phonon`,
  frequencies: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
  densities: [0.0, 1.0, 2.0, 3.0, 2.0, 1.0, 0.5, 0.2, 0.0],
}

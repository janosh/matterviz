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

// Four-band Γ-X-M phonon band structure (2 branches) for the bands test page
export const mock_band_structure_gxm: BaseBandStructure = {
  type: `phonon`,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
    { label: null, frac_coords: [0.25, 0.0, 0.0], distance: 0.5 },
    { label: `X`, frac_coords: [0.5, 0.0, 0.0], distance: 1.0 },
    { label: `M`, frac_coords: [0.5, 0.5, 0.0], distance: 1.707 },
  ],
  branches: [
    { start_index: 0, end_index: 2, name: `GAMMA-X` },
    { start_index: 2, end_index: 3, name: `X-M` },
  ],
  labels_dict: { GAMMA: [0.0, 0.0, 0.0], X: [0.5, 0.0, 0.0], M: [0.5, 0.5, 0.0] },
  distance: [0.0, 0.5, 1.0, 1.707],
  nb_bands: 4,
  bands: [
    [0.0, 1.0, 2.0, 2.5],
    [1.0, 2.0, 3.0, 3.5],
    [2.0, 3.0, 4.0, 4.5],
    [3.0, 4.0, 5.0, 5.5],
  ],
}

// Densely sampled three-band Γ-X-M-Γ phonon band structure and a DOS spanning its range,
// for the BandsAndDos-with-Brillouin-zone test page
export const mock_band_structure_gxmg: BaseBandStructure = {
  type: `phonon`,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 0.0 },
    { label: null, frac_coords: [0.1, 0.0, 0.0], distance: 0.2 },
    { label: null, frac_coords: [0.2, 0.0, 0.0], distance: 0.4 },
    { label: null, frac_coords: [0.3, 0.0, 0.0], distance: 0.6 },
    { label: null, frac_coords: [0.4, 0.0, 0.0], distance: 0.8 },
    { label: `X`, frac_coords: [0.5, 0.0, 0.0], distance: 1.0 },
    { label: null, frac_coords: [0.5, 0.1, 0.0], distance: 1.2 },
    { label: null, frac_coords: [0.5, 0.2, 0.0], distance: 1.4 },
    { label: null, frac_coords: [0.5, 0.3, 0.0], distance: 1.6 },
    { label: null, frac_coords: [0.5, 0.4, 0.0], distance: 1.8 },
    { label: `M`, frac_coords: [0.5, 0.5, 0.0], distance: 2.0 },
    { label: null, frac_coords: [0.4, 0.4, 0.0], distance: 2.2 },
    { label: null, frac_coords: [0.3, 0.3, 0.0], distance: 2.4 },
    { label: null, frac_coords: [0.2, 0.2, 0.0], distance: 2.6 },
    { label: null, frac_coords: [0.1, 0.1, 0.0], distance: 2.8 },
    { label: `GAMMA`, frac_coords: [0.0, 0.0, 0.0], distance: 3.0 },
  ],
  branches: [
    { start_index: 0, end_index: 5, name: `GAMMA-X` },
    { start_index: 5, end_index: 10, name: `X-M` },
    { start_index: 10, end_index: 15, name: `M-GAMMA` },
  ],
  labels_dict: { GAMMA: [0.0, 0.0, 0.0], X: [0.5, 0.0, 0.0], M: [0.5, 0.5, 0.0] },
  // oxfmt-ignore
  distance: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0],
  nb_bands: 3,
  // oxfmt-ignore
  bands: [
    [0.0, 0.5, 0.8, 1.0, 0.8, 0.5, 0.8, 1.2, 1.5, 1.8, 2.0, 1.8, 1.5, 1.0, 0.5, 0.0],
    [1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 2.8, 2.6, 2.4, 2.2, 1.0],
    [2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 3.8, 3.6, 3.2, 2.8, 2.0],
  ],
}

export const mock_dos_gxmg: PhononDos = {
  type: `phonon`,
  frequencies: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5],
  densities: [0.0, 1.0, 2.0, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0],
}

// Inline style of the child the BandsAndDos test pages render to check the children
// snippet; its BandsAndDos host needs position: relative to anchor it
export const custom_overlay_style = `position: absolute; top: 10px; right: 10px; background: rgba(255, 255, 255, 0.9); padding: 8px; border-radius: var(--border-radius); font-size: 12px; pointer-events: none; z-index: 10`

// TypeScript type definitions for band structures and density of states

export type BandStructureType = `phonon` | `electronic`
export type PathMode = `union` | `intersection` | `strict`
export type FrequencyUnit = `THz` | `eV` | `meV` | `Ha` | `cm-1`
export type NormalizationMode = `max` | `sum` | `integral` | null

// Q-point representation
export interface QPoint {
  label: string | null
  frac_coords: [number, number, number]
  distance?: number
}

// Branch representation
export interface Branch {
  start_index: number
  end_index: number
  name: string
}

// Base band structure interface
export interface BaseBandStructure {
  lattice_rec: {
    matrix: number[][]
  }
  qpoints: QPoint[]
  branches: Branch[]
  labels_dict: Record<string, [number, number, number]>
  distance: number[]
  nb_bands: number
  bands: number[][] // [nb_bands][nb_qpoints]
}

// Phonon-specific band structure
export interface PhononBandStructure extends BaseBandStructure {
  has_imaginary_modes?: boolean
  has_nac?: boolean
}

// Electronic band structure
export interface ElectronicBandStructure extends BaseBandStructure {
  is_spin_polarized: boolean
  efermi?: number
  is_metal?: boolean
  band_gap?: {
    energy: number
    direct: boolean
  }
}

// Phonon DOS: frequencies as independent variable
export interface PhononDos {
  type: `phonon`
  frequencies: number[]
  densities: number[]
}
// Electronic DOS: energies as independent variable
export interface ElectronicDos {
  type: `electronic`
  energies: number[]
  densities: number[]
  spin_polarized?: boolean
}
// Discriminated union for type-safe DOS handling
export type DosData = PhononDos | ElectronicDos

// Line styling configuration
export type LineKwargs =
  | Record<string, unknown> // Single dict for all lines
  | { acoustic?: Record<string, unknown>; optical?: Record<string, unknown> } // Per mode
  | ((frequencies: number[], band_idx: number) => Record<string, unknown>) // Callable

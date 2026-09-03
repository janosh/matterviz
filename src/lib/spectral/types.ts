// TypeScript type definitions for band structures and density of states

import type { Matrix3x3, Vec3 } from '$lib/math'
import type { InternalPoint } from '$lib/plot'
import type { PymatgenCompleteDos } from './helpers'

export type BandStructureType = `phonon` | `electronic`
export type PathMode = `union` | `intersection` | `strict`
export type { FrequencyUnit } from './frequency-units'
export type NormalizationMode = `max` | `sum` | `integral` | null

// Q-point representation
export interface QPoint {
  label: string | null
  frac_coords: Vec3
  distance?: number
}

// Branch representation
export interface Branch {
  start_index: number
  end_index: number
  name: string
  // Override the legacy two-point discontinuity heuristic when branch provenance is known.
  is_discontinuity?: boolean
}

// Base band structure interface. q-points are fractional and path distances precomputed; the
// reciprocal lattice (rows b_i, 2π included) is kept when the input carries one (pymatgen's
// `lattice_rec`, phonopy's `recip_lattice`) so Cartesian k and the Brillouin zone follow from
// the band data alone. Without it, consumers derive k from a structure's lattice.
export interface BaseBandStructure {
  qpoints: QPoint[]
  recip_lattice?: Matrix3x3
  branches: Branch[]
  labels_dict: Record<string, Vec3>
  distance: number[]
  nb_bands: number
  bands: number[][] // [nb_bands][nb_qpoints]
  spin_down_bands?: number[][] // [nb_bands][nb_qpoints] for spin-polarized electronic bands
  band_widths?: number[][] // [nb_bands][nb_qpoints] - width values for fat bands visualization
}

// Configuration for fat band ribbon rendering
export interface RibbonConfig {
  color?: string // defaults to band line color
  opacity?: number // default 0.3
  max_width?: number // max ribbon half-width in pixels (default 6)
  scale?: number // multiplier for width values (default 1)
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
  band_gap?: { energy: number; direct: boolean; transition?: string }
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
  densities: number[] // Spin-up densities (or total if not spin-polarized)
  spin_down_densities?: number[] // Spin-down densities (only for spin-polarized)
  spin_polarized?: boolean
  efermi?: number
}

// Spin display mode for electronic DOS visualization
export type SpinMode = `mirror` | `overlay` | `up_only` | `down_only` | null
// Spin display mode for band structure visualization (no mirror mode)
export type BandsSpinMode = Exclude<SpinMode, `mirror`>

// Projected DOS type for pymatgen CompleteDos extraction
export type PdosType = `atom` | `orbital`

// Type for stacked area fill data in DOS visualization
export interface StackedAreaData {
  x_values: number[] // frequencies or energies
  upper_densities: number[] // current cumulative
  lower_densities: number[] // previous cumulative (baseline)
  color: string
}

// Discriminated union for type-safe DOS handling
export type DosData = PhononDos | ElectronicDos

// Union type for component props that accept both normalized and pymatgen DOS formats
export type DosInput = DosData | PymatgenCompleteDos

// Band line styling: one style for every band, or one per acoustic/optical mode
export interface BandLineStyle {
  stroke?: string
  stroke_width?: number
}
export type LineKwargs = BandLineStyle | { acoustic?: BandLineStyle; optical?: BandLineStyle }

export interface HoveredData {
  hovered_frequency?: number | null
  hovered_band_point?: InternalPoint | null
  hovered_qpoint_index?: number | null
}

// === Vibrational (IR / Raman) spectroscopy ===

// A complex amplitude as phonopy writes it: [real, imaginary].
export type Complex = [re: number, im: number]

// One atom of a phonopy cell, carrying the mass needed to undo eigenvector mass weighting.
export interface PhononModeAtom {
  symbol: string
  mass: number // atomic mass units
  coordinates: Vec3 // fractional
}

// A single phonon mode. `eigenvector` is [n_atoms][3] complex, in phonopy's convention:
// eigenvector of the mass-weighted dynamical matrix, normalised to sum |e|^2 = 1.
// null when the source file listed a frequency without an eigenvector block.
export interface PhononMode {
  frequency: number // THz, as written by phonopy
  eigenvector: Complex[][] | null
}

export interface PhononQPointModes {
  q_position: Vec3
  distance: number | null
  modes: PhononMode[]
}

// One contiguous q-point path emitted by phonopy band.yaml. Endpoints are inclusive.
export interface PhononPathSegment {
  start_index: number
  end_index: number
  start_label: string | null
  end_label: string | null
}

export interface PhononModeData {
  n_atoms: number
  atoms: PhononModeAtom[]
  lattice: Matrix3x3 | null
  qpoints: PhononQPointModes[]
  path_segments: PhononPathSegment[]
}

export interface PhononModeDataset {
  modes: PhononModeData
  spectrum?: VibrationalSpectrum
  filename?: string
}

export interface PhononModeSelection {
  qpoint_idx: number
  mode_idx: number
}

export type PhononExplorerView = `bands` | `ir` | `raman` | `modes`

// Born effective charges and high-frequency dielectric tensor from a phonopy BORN file.
export interface BornChargeData {
  factor: number // NAC unit conversion factor, recorded but not applied here
  dielectric: Matrix3x3
  born_charges: Matrix3x3[] // one Z* tensor per atom, in units of e
}

// One mode of a vibrational spectrum with its computed activities.
export interface VibrationalMode {
  mode_idx: number
  frequency: number // THz
  ir_intensity: number // e^2/amu, from Born charges and eigenvectors
  raman_activity: number | null // 45a^2 + 7*gamma^2, null when no polarizability data
  depolarization_ratio: number | null
  is_acoustic: boolean
  is_imaginary: boolean
}

// Discrete vibrational spectrum. Deliberately NOT a DosData: DOS normalization applies a
// cm^-1-vs-THz heuristic keyed on max frequency > 100, which would silently mangle
// vibrational modes that legitimately reach 4000 cm^-1.
export interface VibrationalSpectrum {
  modes: VibrationalMode[]
  n_atoms: number
  q_position: Vec3
  has_raman: boolean
}

// Which activity a plot should show.
export type SpectrumKind = `ir` | `raman`
// IR spectra are conventionally drawn as transmittance (peaks pointing down).
export type SpectrumPresentation = `absorbance` | `transmittance`

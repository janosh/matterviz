// Types of band structures, densities of states and vibrational spectra
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import type { InternalPoint, LineStyle } from '#lib/plot/index.js'
import type { ElectronEnergyUnit } from './frequency-units'

// Discriminator of bands and DOS alike: phonon data is in THz (DOS `frequencies`), electronic
// in eV (DOS `energies`; a band-grid DOS in its grid's `energy_unit`). One plot cannot mix the
// two (spectral_type throws).
export type BandStructureType = `phonon` | `electronic`
export type PathMode = `union` | `intersection` | `strict`
export type { ElectronEnergyUnit, FrequencyUnit } from './frequency-units'
export type NormalizationMode = `max` | `sum` | `integral` | null

export interface QPoint {
  label: string | null
  frac_coords: Vec3
  distance?: number
}

// A continuous path segment (any number of q-points >= 1). Jumps (U|K) lie between branches.
export interface Branch {
  start_index: number
  end_index: number
  name: string
}

// Fractional q-points with precomputed path distances. The reciprocal lattice (rows b_i, 2π
// included) is kept when the input has one (pymatgen's `lattice_rec`, phonopy's
// `recip_lattice`), so Cartesian k and the BZ follow from the bands alone; else from a structure.
export interface BaseBandStructure {
  type: BandStructureType
  efermi?: number
  qpoints: QPoint[]
  recip_lattice?: Matrix3x3
  branches: Branch[]
  labels_dict: Record<string, Vec3>
  distance: number[]
  nb_bands: number
  bands: number[][] // [nb_bands][nb_qpoints]
  spin_down_bands?: number[][] // [nb_bands][nb_qpoints] for spin-polarized electronic bands
  // Electronic occupations (0 = empty, 1 = filled) shaped like `bands`/`spin_down_bands`.
  // When present they, not E_F, decide filling for the band gap (see electronic_band_gap).
  occupations?: number[][]
  spin_down_occupations?: number[][]
  band_widths?: number[][] // [nb_bands][nb_qpoints] - width values for fat bands visualization
}

// Configuration for fat band ribbon rendering
export interface RibbonConfig {
  color?: string // defaults to band line color
  opacity?: number // default 0.3
  max_width?: number // max ribbon half-width in pixels (default 6)
  scale?: number // multiplier for width values (default 1)
}

export interface PhononBandStructure extends BaseBandStructure {
  type: `phonon`
  has_imaginary_modes?: boolean
  has_nac?: boolean
}

// Spin polarization is `spin_down_bands` being present; the band gap is derived on demand
// (electronic_band_gap) from the spin channels on display
export interface ElectronicBandStructure extends BaseBandStructure {
  type: `electronic`
}

// Spin channel of a band (spin-polarized band structures only)
export type BandSpin = `up` | `down`

// Where an electronic band edge sits: its energy, band and q-point index (into the band
// structure's `bands`/`spin_down_bands` and `qpoints`), and spin channel when polarized
export interface BandEdge {
  energy: number
  band_idx: number
  qpoint_idx: number
  spin?: BandSpin
}

// electronic_band_gap's result. `is_direct`: VBM and CBM share a q-point (in k, as pymatgen's
// BandStructure.get_band_gap; spins may differ). `direct_gap` is the smallest vertical gap
// within one spin channel (pymatgen's get_direct_band_gap), at its q-point; null when no
// channel has both filled and empty bands.
export interface ElectronicBandGap {
  gap: number
  vbm: BandEdge
  cbm: BandEdge
  is_direct: boolean
  direct_gap: { energy: number; qpoint_idx: number; spin?: BandSpin } | null
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
  // unit of energies, efermi and (inversely) densities: eV from normalize_dos, the band grid's
  // own from band_grid_dos, null when the source names none (labels then say so)
  energy_unit: ElectronEnergyUnit | null
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

// Projection of a pymatgen CompleteDos
export type PdosType = `atom` | `orbital`

// Stacked area fill of a DOS
export interface StackedAreaData {
  x_values: number[] // frequencies or energies
  upper_densities: number[] // current cumulative
  lower_densities: number[] // previous cumulative (baseline)
  color: string
}

export type DosData = PhononDos | ElectronicDos

// Band line styling: one style for every band, one per acoustic/optical mode, or one per band
// and spin channel of a structure (its band_structs key or label, e.g. ElectronicStructure's sheet
// colours)
export type BandLineStyle = Pick<LineStyle, `color` | `width`>
export type LineKwargs =
  | BandLineStyle
  | { acoustic?: BandLineStyle; optical?: BandLineStyle }
  | ((band_idx: number, spin: `up` | `down`, structure: string) => BandLineStyle)

export interface HoveredData {
  hovered_frequency?: number | null // data unit: THz (phonon) or eV (electronic)
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

// Born effective charges and high-frequency dielectric tensor from a phonopy BORN file.
export interface BornChargeData {
  factor: number | null // NAC unit conversion factor (null: calculator default), not applied
  dielectric: Matrix3x3
  born_charges: Matrix3x3[] // one Z* tensor per atom, in units of e
  atom_indices?: number[] // 0-based atoms of phonopy's `# epsilon and Z* of atoms …` comment
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

// Discrete vibrational spectrum: per-mode activities, deliberately not a DosData density grid
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

// ElectronicStructure's panes: the crystal, its Fermi surface, band structure and DOS,
// `phonon` its phonon bands and DOS, `trends` a sweep's descriptors against its axis
export type ElectronicPane = `structure` | `fermi` | `bands` | `dos` | `phonon` | `trends`

// Named band structures and DOS of one kind (electronic or phonon)
export interface SpectraRecords {
  band_structs?: Record<string, BaseBandStructure>
  doses?: Record<string, DosData>
}

// A q- and mode-resolved quantity, e.g. the electron–phonon coupling λ_qν, drawn over a band
// structure as markers at its modes' frequencies wherever its q-points lie on the band path.
// q-points are fractional in the band structure's reciprocal basis (its recip_lattice and its
// qpoints' frame) and may be a full q mesh: points off the path are not drawn.
export interface ModeValues {
  // e.g. `λ<sub>qν</sub>`: titles the colour bar, legend and tooltip as sanitized HTML (plain
  // text in notices)
  label: string
  qpoints: Vec3[]
  frequencies: number[][] // [q][mode] in the bands' data unit (THz), negative = imaginary
  values: number[][] // [q][mode], NaN = no value
}

// A material's phonon spectra beside its electronic ones: dispersion and DOS on one frequency
// axis, Eliashberg functions α²F(ω) (dimensionless) on their own axis over the same frequencies,
// and mode values (e.g. λ_qν) over the dispersion
export interface PhononSpectra extends SpectraRecords {
  a2f?: Record<string, PhononDos>
  mode_values?: ModeValues
}

// An approximate pressure sweep of fcc Cu for demos, built from one simulated calculation: each
// frame's cell is the calculation's scaled to the frame's volume, band energies are rescaled
// about E_F as for free electrons (ε − E_F ∝ 1/a²) and the pressure is the third-order
// Birch–Murnaghan equation of state at that volume with B₀ = 140 GPa and B₀′ = 5 (near Cu's
// measured values). Each frame's DOS is computed from its scaled band grid. The phonons are a
// nearest-neighbour central-force model of fcc (maximum 7.25 THz at ambient, near Cu's) whose
// frequencies stiffen as (V/V₀)^−γ with Grüneisen γ = 2, and α²F(ω) is the phonon DOS scaled
// to λ = 0.13 at ambient, falling as 1/ω² under compression. Illustrative only: no frame is
// the result of a calculation at its pressure.
import { eos_pressure } from '#lib/eos/fit.js'
import type { EosParams } from '#lib/eos/fit.js'
import { band_grid_dos } from '#lib/fermi-surface/dos.js'
import type { BandGridData } from '#lib/fermi-surface/types.js'
import {
  create_frac_to_cart,
  det_3x3,
  dot,
  reciprocal_lattice,
  scale,
  subtract,
} from '#lib/math.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import { trapezoid_weights } from '#lib/spectral/helpers.js'
import type { BaseBandStructure, PhononDos, PhononSpectra } from '#lib/spectral/types.js'
import type { DescriptorSpec, Sweep, SweepFrameLoader } from '#lib/spectral/sweep.js'
import type { Crystal } from '#lib/structure/index.js'
import { make_lattice } from '#lib/structure/parsers/shared.js'

// V₀ = 1 so volumes are V/V₀ and pressures come out in B₀'s GPa
const CU_EOS: EosParams = { e0: 0, v0: 1, b0: 140, b0_prime: 5 }
// V/V₀ of the frames, in ascending pressure
const CU_VOLUME_RATIOS = [1, 0.95, 0.9, 0.85, 0.8, 0.75]

const scale_matrix = (matrix: Matrix3x3, factor: number): Matrix3x3 =>
  matrix.map((row) => row.map((coord) => coord * factor)) as Matrix3x3

// The structure with its cell scaled by `lattice_scale` (fractional positions kept)
export const scale_crystal = (structure: Crystal, lattice_scale: number): Crystal => ({
  ...structure,
  lattice: make_lattice(
    scale_matrix(structure.lattice.matrix, lattice_scale),
    structure.lattice.pbc,
  ),
  sites: structure.sites.map((site) => ({
    ...site,
    xyz: scale(site.xyz, lattice_scale),
  })),
})

// Energies about E_F scaled by 1/s² and the reciprocal lattice by 1/s for a cell scaled by s.
// Grid and path take one E_F (the grid's) so both pin the same level.
const scale_energy = (energy: number, fermi_energy: number, lattice_scale: number) =>
  fermi_energy + (energy - fermi_energy) / lattice_scale ** 2

export const scale_band_grid = (grid: BandGridData, lattice_scale: number): BandGridData => ({
  ...grid,
  k_lattice: scale_matrix(grid.k_lattice, 1 / lattice_scale),
  energies: grid.energies.map((spin) =>
    spin.map((band) => ({
      ...band,
      values: band.values.map((energy) =>
        scale_energy(energy, grid.fermi_energy, lattice_scale),
      ),
    })),
  ),
})

// The band structure of a cell scaled by `lattice_scale`, each band value mapped by `map_value`
// (electrons: scale_energy about E_F, phonons: their stiffening)
export function scale_band_structure(
  bands: BaseBandStructure,
  lattice_scale: number,
  map_value: (value: number) => number,
): BaseBandStructure {
  const map_rows = (rows: number[][]) => rows.map((row) => row.map(map_value))
  return {
    ...bands,
    bands: map_rows(bands.bands),
    ...(bands.spin_down_bands && { spin_down_bands: map_rows(bands.spin_down_bands) }),
    distance: bands.distance.map((dist) => dist / lattice_scale),
    qpoints: bands.qpoints.map((qpoint) =>
      qpoint.distance === undefined
        ? qpoint
        : { ...qpoint, distance: qpoint.distance / lattice_scale },
    ),
    ...(bands.recip_lattice && {
      recip_lattice: scale_matrix(bands.recip_lattice, 1 / lattice_scale),
    }),
  }
}

export const CU_SWEEP_DESCRIPTORS: DescriptorSpec[] = [
  { key: `fermi_dos`, label: `N(E_F)`, unit: `states/eV/cell`, compute: `fermi_dos` },
  { key: `fermi_band_count`, label: `Bands at E_F`, compute: `fermi_band_count` },
  { key: `volume_per_atom`, label: `Volume per atom`, unit: `Å³`, compute: `volume_per_atom` },
  {
    key: `cu_cu_distance`,
    label: `Cu–Cu distance`,
    unit: `Å`,
    compute: `min_pair_distance`,
    pair: [`Cu`, `Cu`],
  },
  { key: `lambda`, label: `λ (electron–phonon)` },
  { key: `omega_log`, label: `ω_log`, unit: `K`, overlay: [`omega_2`] },
  { key: `omega_2`, label: `ω₂`, unit: `K` },
]

// === phonons ===
export const CU_MAX_PHONON_THZ = 7.25
export const CU_GRUNEISEN = 2
export const CU_LAMBDA = 0.13 // electron–phonon coupling at ambient
const KELVIN_PER_THZ = 47.9924 // h · 1 THz / k_B

// Eigenvalues of a real symmetric 3×3 matrix in ascending order, in closed form (Smith 1961)
export function symmetric_eigenvalues(matrix: Matrix3x3): Vec3 {
  const [[a_00, a_01, a_02], [, a_11, a_12], [, , a_22]] = matrix
  const off_diagonal = a_01 ** 2 + a_02 ** 2 + a_12 ** 2
  if (off_diagonal === 0) return [a_00, a_11, a_22].toSorted((lhs, rhs) => lhs - rhs) as Vec3
  const mean = (a_00 + a_11 + a_22) / 3
  const spread = Math.sqrt(
    ((a_00 - mean) ** 2 + (a_11 - mean) ** 2 + (a_22 - mean) ** 2 + 2 * off_diagonal) / 6,
  )
  const shifted = matrix.map((row, row_idx) =>
    row.map((val, col_idx) => (val - (row_idx === col_idx ? mean : 0)) / spread),
  ) as Matrix3x3
  const half_det = Math.min(1, Math.max(-1, det_3x3(shifted) / 2))
  const angle = Math.acos(half_det) / 3
  const largest = mean + 2 * spread * Math.cos(angle)
  const smallest = mean + 2 * spread * Math.cos(angle + (2 * Math.PI) / 3)
  return [smallest, 3 * mean - largest - smallest, largest]
}

// The 12 nearest neighbours of an fcc primitive cell: ±a_i and ±(a_i − a_j)
function fcc_neighbors(lattice: Matrix3x3): Vec3[] {
  const [a_1, a_2, a_3] = lattice
  const half = [a_1, a_2, a_3, subtract(a_1, a_2), subtract(a_2, a_3), subtract(a_1, a_3)]
  const lengths = half.map((vec) => Math.hypot(...vec))
  if (lengths.some((len) => Math.abs(len - lengths[0]) > 1e-6 * lengths[0])) {
    throw new Error(
      `The phonon model needs an fcc primitive cell, got neighbour lengths ${lengths}`,
    )
  }
  return half.flatMap((vec) => [vec, scale(vec, -1)])
}

// Phonon frequencies (arbitrary units, ascending) of a monatomic lattice at Cartesian q, one
// central spring to each neighbour: D(q) = Σ_r r̂ r̂ᵀ (1 − cos q·r)
const model_frequencies = (neighbors: Vec3[], q_vec: Vec3): Vec3 => {
  const matrix = [0, 1, 2].map(() => [0, 0, 0]) as Matrix3x3
  for (const vec of neighbors) {
    const weight = (1 - Math.cos(dot(q_vec, vec))) / dot(vec, vec)
    for (const row of [0, 1, 2]) {
      for (const col of [0, 1, 2]) matrix[row][col] += weight * vec[row] * vec[col]
    }
  }
  return symmetric_eigenvalues(matrix).map((val) => Math.sqrt(Math.max(val, 0))) as Vec3
}

// The model's ambient dispersion along the band structure's path and its DOS (THz, ∫F = 3
// modes per cell) from a 20³ q grid, Gaussian-smeared by 0.1 THz
export function cu_phonons(
  structure: Crystal,
  band_struct: BaseBandStructure,
): { bands: BaseBandStructure; dos: PhononDos } {
  const neighbors = fcc_neighbors(structure.lattice.matrix)
  // the DOS grid spans the cell's own zone, the path's fractions refer to the band structure's
  const cell_recip = reciprocal_lattice(structure.lattice.matrix, { two_pi: true })
  const frequencies_in = (recip: Matrix3x3) => {
    const to_cart = create_frac_to_cart(recip) // q = Σ f_i b_i
    return (frac: Vec3) => model_frequencies(neighbors, to_cart(frac))
  }
  const at = frequencies_in(cell_recip)
  const n_grid = 20
  const grid: number[] = []
  // Γ left out: its three zero modes, smeared to ω ≈ 0, would make ∫ α²F ln ω / ω dω (ω_log)
  // grow with the bin count instead of converging
  for (let flat_idx = 1; flat_idx < n_grid ** 3; flat_idx++) {
    const [idx_a, idx_b, idx_c] = [n_grid ** 2, n_grid, 1].map(
      (stride) => Math.floor(flat_idx / stride) % n_grid,
    )
    grid.push(...at([idx_a / n_grid, idx_b / n_grid, idx_c / n_grid]))
  }
  const along_path = frequencies_in(band_struct.recip_lattice ?? cell_recip)
  const path = band_struct.qpoints.map(({ frac_coords }) => along_path(frac_coords))
  const raw_max = [...grid, ...path.flat()].reduce((max, val) => Math.max(max, val), 0)
  const to_thz = CU_MAX_PHONON_THZ / raw_max
  // bin centres start half a bin up: no bin sits at ω = 0, where α²F/ω diverges
  const [n_bins, sigma] = [200, 0.1]
  const bin_width = (CU_MAX_PHONON_THZ * 1.1) / n_bins
  const frequencies = Array.from({ length: n_bins }, (_, idx) => (idx + 0.5) * bin_width)
  const densities = Array(n_bins).fill(0)
  const norm = 1 / ((n_grid ** 3 - 1) * sigma * Math.sqrt(2 * Math.PI))
  for (const raw of grid) {
    const freq = raw * to_thz
    const [lo, hi] = [freq - 4 * sigma, freq + 4 * sigma].map((edge) =>
      Math.min(n_bins - 1, Math.max(0, Math.floor(edge / bin_width))),
    )
    for (let idx = lo; idx <= hi; idx++) {
      densities[idx] += norm * Math.exp(-(((frequencies[idx] - freq) / sigma) ** 2) / 2)
    }
  }
  const { qpoints, branches, labels_dict, distance } = band_struct
  return {
    bands: {
      type: `phonon`,
      qpoints,
      branches,
      labels_dict,
      distance,
      ...(band_struct.recip_lattice && { recip_lattice: band_struct.recip_lattice }),
      nb_bands: 3,
      bands: [0, 1, 2].map((branch) => path.map((freqs) => freqs[branch] * to_thz)),
    },
    dos: { type: `phonon`, frequencies, densities },
  }
}

// ∫ F(ω) kernel(ω) dω by trapezoids, and the coupling λ = 2 ∫ α²F(ω)/ω dω of an α²F
const integrate = (dos: PhononDos, kernel: (freq: number) => number): number => {
  const weights = trapezoid_weights(dos.frequencies)
  return dos.densities.reduce(
    (sum, density, idx) => sum + weights[idx] * density * kernel(dos.frequencies[idx]),
    0,
  )
}
const coupling = (a2f: PhononDos): number => 2 * integrate(a2f, (freq) => 1 / freq)

// α²F(ω) of shape F(ω) scaled to coupling `lambda`
export function eliashberg_function(dos: PhononDos, lambda: number): PhononDos {
  const factor = lambda / coupling(dos)
  return { ...dos, densities: dos.densities.map((density) => density * factor) }
}

// λ and the Allen–Dynes frequency moments ω_log = exp((2/λ) ∫ α²F ln ω / ω dω) and
// ω₂ = ((2/λ) ∫ α²F ω dω)^½, in K
export function eliashberg_moments(a2f: PhononDos): {
  lambda: number
  omega_log: number
  omega_2: number
} {
  const lambda = coupling(a2f)
  const omega_log = Math.exp((2 / lambda) * integrate(a2f, (freq) => Math.log(freq) / freq))
  const omega_2 = Math.sqrt((2 / lambda) * integrate(a2f, (freq) => freq))
  return { lambda, omega_log: omega_log * KELVIN_PER_THZ, omega_2: omega_2 * KELVIN_PER_THZ }
}

// The phonon spectra and electron–phonon scalars of the frame at volume ratio V/V₀ (cell
// scaled by lattice_scale): frequencies × (V/V₀)^−γ, λ ∝ 1/ω²
export function cu_frame_phonons(
  ambient: { bands: BaseBandStructure; dos: PhononDos },
  volume_ratio: number,
  lattice_scale: number,
): { phonon: PhononSpectra; scalars: Record<string, number> } {
  const stiffening = volume_ratio ** -CU_GRUNEISEN
  const dos: PhononDos = {
    type: `phonon`,
    frequencies: ambient.dos.frequencies.map((freq) => freq * stiffening),
    densities: ambient.dos.densities.map((density) => density / stiffening),
  }
  const a2f = eliashberg_function(dos, CU_LAMBDA / stiffening ** 2)
  return {
    phonon: {
      band_structs: {
        Cu: scale_band_structure(ambient.bands, lattice_scale, (freq) => freq * stiffening),
      },
      doses: { 'phonon DOS': dos },
      a2f: { 'α²F': a2f },
    },
    scalars: eliashberg_moments(a2f),
  }
}

// The sweep: structures up front, and a loader computing each frame's band grid, band
// structure, DOS and phonon spectra when the viewer first shows it, as a remote loader would
// fetch them
export function cu_pressure_sweep(input: {
  structure: Crystal
  band_data: BandGridData
  band_struct: BaseBandStructure
}): Sweep {
  const scales = CU_VOLUME_RATIOS.map((ratio) => Math.cbrt(ratio))
  let ambient: ReturnType<typeof cu_phonons> | undefined
  const load_frame: SweepFrameLoader = async (_series_id, frame_idx) => {
    await new Promise((resolve) => setTimeout(resolve, 0)) // yield before the heavy work
    const band_data = scale_band_grid(input.band_data, scales[frame_idx])
    ambient ??= cu_phonons(input.structure, input.band_struct)
    return {
      ...cu_frame_phonons(ambient, CU_VOLUME_RATIOS[frame_idx], scales[frame_idx]),
      band_data,
      band_structs: {
        Cu: scale_band_structure(input.band_struct, scales[frame_idx], (energy) =>
          scale_energy(energy, input.band_data.fermi_energy, scales[frame_idx]),
        ),
      },
      doses: { 'bands 3–6': band_grid_dos(band_data) },
    }
  }
  return {
    axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
    series: [
      {
        id: `fcc`,
        label: `fcc Cu`,
        frames: CU_VOLUME_RATIOS.map((ratio, idx) => {
          const pressure = eos_pressure(`birch_murnaghan`, CU_EOS, ratio)
          const value = Math.round(pressure * 10) / 10
          return {
            value,
            label: `${value} GPa (V/V₀ = ${ratio.toFixed(2)})`,
            structure: scale_crystal(input.structure, scales[idx]),
          }
        }),
      },
    ],
    descriptors: CU_SWEEP_DESCRIPTORS,
    load_frame,
  }
}

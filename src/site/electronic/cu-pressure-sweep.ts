// An approximate pressure sweep of fcc Cu for demos, built from one simulated calculation: each
// frame's cell is the calculation's scaled to the frame's volume, band energies are rescaled
// about E_F as for free electrons (ε − E_F ∝ 1/a²) and the pressure is the third-order
// Birch–Murnaghan equation of state at that volume with B₀ = 140 GPa and B₀′ = 5 (near Cu's
// measured values). Each frame's DOS is computed from its scaled band grid. Illustrative only:
// no frame is the result of a calculation at its pressure.
import { band_grid_dos } from '#lib/fermi-surface/dos.js'
import type { BandGridData } from '#lib/fermi-surface/types.js'
import type { Matrix3x3 } from '#lib/math.js'
import type { BaseBandStructure } from '#lib/spectral/types.js'
import type { DescriptorSpec, Sweep, SweepFrameLoader } from '#lib/spectral/sweep.js'
import type { Crystal } from '#lib/structure/index.js'
import { make_lattice } from '#lib/structure/parsers/shared.js'

export const CU_BULK_MODULUS_GPA = 140
export const CU_BULK_MODULUS_PRIME = 5
// V/V₀ of the frames, in ascending pressure
export const CU_VOLUME_RATIOS = [1, 0.95, 0.9, 0.85, 0.8, 0.75]

// Third-order Birch–Murnaghan pressure (units of bulk_modulus) at volume ratio V/V₀
export function birch_murnaghan_pressure(
  volume_ratio: number,
  bulk_modulus: number,
  bulk_modulus_prime: number,
): number {
  const eta = volume_ratio ** (-1 / 3) // (V₀/V)^(1/3)
  const correction = 1 + 0.75 * (bulk_modulus_prime - 4) * (eta ** 2 - 1)
  return 1.5 * bulk_modulus * (eta ** 7 - eta ** 5) * correction
}

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
    xyz: site.xyz.map((coord) => coord * lattice_scale) as Crystal[`sites`][number][`xyz`],
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

export function scale_band_structure(
  bands: BaseBandStructure,
  lattice_scale: number,
  fermi_energy: number,
): BaseBandStructure {
  const scale = (rows: number[][]) =>
    rows.map((row) => row.map((energy) => scale_energy(energy, fermi_energy, lattice_scale)))
  return {
    ...bands,
    bands: scale(bands.bands),
    ...(bands.spin_down_bands && { spin_down_bands: scale(bands.spin_down_bands) }),
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
]

// The sweep (structures up front) and a loader computing each frame's band grid, band
// structure and DOS when the viewer first shows it, as a remote loader would fetch them
export function cu_pressure_sweep(input: {
  structure: Crystal
  band_data: BandGridData
  band_struct: BaseBandStructure
}): { sweep: Sweep; load_frame: SweepFrameLoader } {
  const scales = CU_VOLUME_RATIOS.map((ratio) => Math.cbrt(ratio))
  const sweep: Sweep = {
    axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
    series: [
      {
        id: `fcc`,
        label: `fcc Cu`,
        frames: CU_VOLUME_RATIOS.map((ratio, idx) => {
          const pressure = birch_murnaghan_pressure(
            ratio,
            CU_BULK_MODULUS_GPA,
            CU_BULK_MODULUS_PRIME,
          )
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
  }
  const load_frame: SweepFrameLoader = async (_series_id, frame_idx) => {
    await new Promise((resolve) => setTimeout(resolve, 0)) // yield before the heavy work
    const band_data = scale_band_grid(input.band_data, scales[frame_idx])
    return {
      band_data,
      band_structs: {
        Cu: scale_band_structure(
          input.band_struct,
          scales[frame_idx],
          input.band_data.fermi_energy,
        ),
      },
      doses: { 'bands 3–6': band_grid_dos(band_data) },
    }
  }
  return { sweep, load_frame }
}

import { scalar_grid_strides } from '#lib/isosurface/grid.js'
import type { ElectronicDos } from '#lib/spectral/types.js'
import type { BandGridData } from './types'

// Gaussians are summed out to this many sigma (the tail beyond holds 6e-7 of the weight)
const GAUSSIAN_CUTOFF = 5

// Density of states of a band grid's bands (BXSF, FRMSF): every unique k-point weighs 1/N_k
// (an endpoint-inclusive grid's duplicated k = 1 planes are skipped) and each band energy is
// broadened by a unit-area Gaussian of width `sigma` (eV), in states per eV per cell. Without
// spin polarization each band holds two electrons; with it, each channel one. Only the bands
// the grid holds count (a BXSF often lists just those near E_F), so this is their partial DOS.
export function band_grid_dos(
  grid: BandGridData,
  { sigma = 0.1, n_points = 600 }: { sigma?: number; n_points?: number } = {},
): ElectronicDos {
  if (!(sigma > 0)) throw new Error(`band_grid_dos needs sigma > 0, got ${sigma}`)
  if (!Number.isInteger(n_points) || n_points < 2) {
    throw new Error(`band_grid_dos needs an integer n_points >= 2, got ${n_points}`)
  }
  // the unique k-points' energies, per spin channel and band
  const channels = grid.energies.map((bands) =>
    bands.map((band) => {
      const [stride_x, stride_y, stride_z] = scalar_grid_strides(band)
      const [nx, ny, nz] = grid.periodic
        ? band.dims
        : band.dims.map((count) => Math.max(1, count - 1))
      const unique: number[] = []
      for (let ix = 0; ix < nx; ix++)
        for (let iy = 0; iy < ny; iy++)
          for (let iz = 0; iz < nz; iz++)
            unique.push(band.values[ix * stride_x + iy * stride_y + iz * stride_z])
      return unique
    }),
  )
  let [min_energy, max_energy] = [Infinity, -Infinity]
  for (const energy of channels.flat(2)) {
    if (!Number.isFinite(energy)) continue
    min_energy = Math.min(min_energy, energy)
    max_energy = Math.max(max_energy, energy)
  }
  if (min_energy > max_energy)
    throw new Error(`band_grid_dos got a grid without finite energies`)
  const start = min_energy - GAUSSIAN_CUTOFF * sigma
  const step = (max_energy - start + GAUSSIAN_CUTOFF * sigma) / (n_points - 1)
  const energies = Array.from({ length: n_points }, (_, idx) => start + idx * step)
  const electrons_per_state = grid.n_spins === 2 ? 1 : 2
  const norm = 1 / (sigma * Math.sqrt(2 * Math.PI))
  const reach = Math.ceil((GAUSSIAN_CUTOFF * sigma) / step)
  const densities = channels.map((bands) => {
    const density = Array.from({ length: n_points }, () => 0)
    for (const band of bands) {
      const weight = (electrons_per_state * norm) / band.length
      for (const energy of band) {
        if (!Number.isFinite(energy)) continue
        const center = Math.round((energy - start) / step)
        const [lo, hi] = [Math.max(0, center - reach), Math.min(n_points - 1, center + reach)]
        for (let idx = lo; idx <= hi; idx++) {
          const offset = (energies[idx] - energy) / sigma
          density[idx] += weight * Math.exp(-0.5 * offset * offset)
        }
      }
    }
    return density
  })
  return {
    type: `electronic`,
    energies,
    densities: densities[0],
    ...(densities.length === 2 && { spin_down_densities: densities[1], spin_polarized: true }),
    efermi: grid.fermi_energy,
  }
}

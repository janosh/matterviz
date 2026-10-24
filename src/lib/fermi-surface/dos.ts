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
// Energies are linearly binned onto the output grid, then convolved once with the sampled
// Gaussian: O(N_k) per band rather than one Gaussian per k-point.
export function band_grid_dos(
  grid: BandGridData,
  { sigma = 0.1, n_points = 600 }: { sigma?: number; n_points?: number } = {},
): ElectronicDos {
  if (!(sigma > 0)) throw new Error(`band_grid_dos needs sigma > 0, got ${sigma}`)
  if (!Number.isInteger(n_points) || n_points < 2) {
    throw new Error(`band_grid_dos needs an integer n_points >= 2, got ${n_points}`)
  }
  // the unique k-points' energies, per spin channel and band
  let [min_energy, max_energy] = [Infinity, -Infinity]
  const channels = grid.energies.map((bands, spin_idx) =>
    bands.map((band, band_idx) => {
      const [stride_x, stride_y, stride_z] = scalar_grid_strides(band)
      const [nx, ny, nz] = grid.periodic
        ? band.dims
        : band.dims.map((count) => Math.max(1, count - 1))
      const unique = new Float64Array(nx * ny * nz)
      let [write_idx, n_missing] = [0, 0]
      for (let ix = 0; ix < nx; ix++)
        for (let iy = 0; iy < ny; iy++)
          for (let iz = 0; iz < nz; iz++) {
            const energy = band.values[ix * stride_x + iy * stride_y + iz * stride_z]
            if (!Number.isFinite(energy)) n_missing++
            min_energy = Math.min(min_energy, energy)
            max_energy = Math.max(max_energy, energy)
            unique[write_idx++] = energy
          }
      if (n_missing > 0) {
        const band_index = grid.band_indices?.[band_idx] ?? band_idx
        throw new Error(
          `band_grid_dos: band ${band_index} (spin ${spin_idx}) has ${n_missing} of ${unique.length} energies missing or non-finite`,
        )
      }
      return unique
    }),
  )
  if (!(min_energy <= max_energy)) throw new Error(`band_grid_dos got a grid without energies`)
  const start = min_energy - GAUSSIAN_CUTOFF * sigma
  const step = (max_energy - start + GAUSSIAN_CUTOFF * sigma) / (n_points - 1)
  const energies = Array.from({ length: n_points }, (_, idx) => start + idx * step)
  // Gaussian sampled at the grid spacing, scaled to unit area on the grid so binning and
  // convolution conserve every band's electrons exactly
  const reach = Math.min(n_points - 1, Math.ceil((GAUSSIAN_CUTOFF * sigma) / step))
  const kernel = Array.from({ length: 2 * reach + 1 }, (_, idx) =>
    Math.exp(-0.5 * (((idx - reach) * step) / sigma) ** 2),
  )
  const kernel_area = kernel.reduce((sum, value) => sum + value, 0) * step
  const electrons_per_state = grid.n_spins === 2 ? 1 : 2
  const densities = channels.map((bands) => {
    // each energy splits its weight between the two grid points around it
    const binned = new Float64Array(n_points)
    for (const band of bands) {
      const weight = electrons_per_state / band.length / kernel_area
      for (const energy of band) {
        const position = (energy - start) / step
        const lo = Math.min(Math.floor(position), n_points - 2)
        const frac = position - lo
        binned[lo] += weight * (1 - frac)
        binned[lo + 1] += weight * frac
      }
    }
    return energies.map((_, out_idx) => {
      let density = 0
      const [lo, hi] = [Math.max(0, out_idx - reach), Math.min(n_points - 1, out_idx + reach)]
      for (let idx = lo; idx <= hi; idx++)
        density += binned[idx] * kernel[out_idx - idx + reach]
      return density
    })
  })
  return {
    type: `electronic`,
    energies,
    densities: densities[0],
    ...(densities.length === 2 && { spin_down_densities: densities[1], spin_polarized: true }),
    efermi: grid.fermi_energy,
  }
}

// Wire format shared by the Fermi surface extraction worker and its client (kept free of Svelte
// so the worker bundle stays small): a band grid crosses to the worker once under a numeric
// token and later requests name only the token, so the worker's upsampled-grid cache (keyed by
// grid identity) survives mu changes; the meshes travel back by transfer.
import type { BandGridData, FermiSurfaceData } from './types'

export interface ExtractPayload {
  token: number
  grid?: BandGridData // set the first time a token reaches a worker
}

// Structured-cloneable copy of a band grid: Svelte $state proxies are not cloneable, but their
// typed arrays read back raw, so the megabyte value buffers are copied once, by postMessage
export const cloneable_band_grid = (grid: BandGridData): BandGridData => {
  const copy_grids = (grids: BandGridData[`energies`]) =>
    grids.map((bands) =>
      bands.map(({ values, dims, order }) => ({ values, dims: [...dims], order })),
    ) as BandGridData[`energies`]
  const { properties, grid_shift, band_indices } = grid
  return {
    energies: copy_grids(grid.energies),
    k_grid: [...grid.k_grid],
    k_lattice: grid.k_lattice.map((row) => [...row]) as BandGridData[`k_lattice`],
    fermi_energy: grid.fermi_energy,
    n_bands: grid.n_bands,
    n_spins: grid.n_spins,
    periodic: grid.periodic,
    grid_shift: grid_shift && [...grid_shift],
    band_indices: band_indices && [...band_indices],
    properties:
      properties &&
      Object.fromEntries(
        Object.entries(properties).map(([name, field]) => [name, copy_grids(field)]),
      ),
  }
}

// Grids a worker keeps (newest sent first); the client mirrors this to know what it holds
export const WORKER_GRIDS = 4

// Worker side: the grid a payload names. Keeps the newest max_grids grids, so a page showing
// a few viewers does not re-send (and re-upsample) its grids on every request.
export function create_grid_store(
  max_grids = WORKER_GRIDS,
): (payload: ExtractPayload) => BandGridData {
  const grids = new Map<number, BandGridData>()
  return ({ token, grid }) => {
    if (grid) {
      grids.delete(token) // re-insert as newest
      grids.set(token, grid)
      const [oldest] = grids.keys() // Maps iterate in insertion order
      if (grids.size > max_grids) grids.delete(oldest)
    }
    const stored = grids.get(token)
    if (!stored) {
      throw new Error(
        `Fermi extraction worker holds no band grid ${token} (${grids.size} held)`,
      )
    }
    return stored
  }
}

// Every distinct buffer behind a surface's meshes and properties, to move rather than copy
export const fermi_surface_transferables = ({
  isosurfaces,
}: FermiSurfaceData): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>()
  for (const { positions, normals, indices, properties } of isosurfaces) {
    for (const array of [positions, normals, indices, ...Object.values(properties ?? {})]) {
      if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer)
    }
  }
  return [...buffers]
}

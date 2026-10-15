// Fermi extraction wire format (Svelte-free for the worker bundle): a grid crosses once under a
// token that later requests name, so the worker's upsampled grids (cached by identity) persist
import type { BandGridData, FermiSurfaceData } from './types'

export interface ExtractPayload {
  token: number
  grid?: BandGridData // set the first time a token reaches a worker
}

// Grids a worker keeps (newest sent first); the client mirrors this to know what it holds
export const WORKER_GRIDS = 4

// Sets key as the newest entry, evicting the oldest (first iterated) past max_size
export const lru_set = <K, V>(map: Map<K, V>, key: K, value: V, max_size: number): V => {
  map.delete(key)
  map.set(key, value)
  const [oldest] = map.keys()
  if (map.size > max_size) map.delete(oldest)
  return value
}

// Worker side: the grid a payload names, keeping the newest max_grids for a page of viewers
export function create_grid_store(max_grids = WORKER_GRIDS) {
  const grids = new Map<number, BandGridData>()
  return ({ token, grid }: ExtractPayload): BandGridData => {
    if (grid) lru_set(grids, token, grid, max_grids)
    const stored = grids.get(token)
    if (stored) return stored
    throw new Error(`Fermi extraction worker holds no band grid ${token} (${grids.size} held)`)
  }
}

// Every distinct buffer behind a surface's meshes and properties, to move rather than copy
export const fermi_surface_transferables = ({ isosurfaces }: FermiSurfaceData) => {
  const buffers = new Set<ArrayBuffer>()
  for (const { positions, normals, indices, properties = {} } of isosurfaces) {
    for (const { buffer } of [positions, normals, indices, ...Object.values(properties)]) {
      if (buffer instanceof ArrayBuffer) buffers.add(buffer)
    }
  }
  return [...buffers]
}

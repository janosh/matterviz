// Worker-side helpers of the Fermi extraction (Svelte-free for the worker bundle)
import type { FermiSurfaceData } from './types'

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

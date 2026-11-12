// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async wrapper for compute_isosurface_geometries via the shared persistent-worker client.
// Falls back to synchronous main-thread extraction during SSR / where Worker is missing.
import { create_worker_client } from '#lib/worker-client.svelte.js'
import type { GeometryInput, GeometryResult } from './geometry'
import { compute_isosurface_geometries } from './geometry'

// The client itself, so `.mount` travels with it for the component's lifetime
export const compute_geometries_async = create_worker_client<
  GeometryInput,
  Record<string, never>,
  GeometryResult
>({
  label: `Isosurface geometry`,
  create_worker: () =>
    new Worker(new URL(`./geometry-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: compute_isosurface_geometries,
  // Prepared grids may sit behind Svelte $state proxies; rebuild the cloneable subset field
  // by field (typed arrays read back raw through the proxy, so the value buffers are not
  // copied here — structured clone copies them once)
  build_payload: (input) => ({
    volumes: input.volumes.map(({ grid, lattice, origin, surfaces }) => ({
      grid: { values: grid.values, dims: [...grid.dims], order: grid.order },
      lattice: lattice.map((row) => [...row]),
      origin: [...origin],
      surfaces: surfaces.map(({ token, isovalue }) => ({ token, isovalue })),
    })),
  }),
})

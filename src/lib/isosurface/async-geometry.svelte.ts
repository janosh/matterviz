// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async wrapper for compute_isosurface_geometries via the shared persistent-worker client.
// Falls back to synchronous main-thread extraction during SSR / where Worker is missing.
import { create_worker_client, type WorkerRequestOptions } from '$lib/worker-client.svelte'
import type { GeometryInput, GeometryResult } from './geometry'
import { compute_isosurface_geometries } from './geometry'

const run_geometry = create_worker_client<
  GeometryInput,
  Record<string, never>,
  GeometryResult
>({
  label: `Isosurface geometry`,
  create_worker: () =>
    new Worker(new URL(`./geometry-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: compute_isosurface_geometries,
  // Volumes arrive as Svelte $state proxies from the viewer; rebuild the cloneable
  // subset field by field (typed arrays read back raw through the proxy, so the
  // megabyte value buffers are not copied here — structured clone copies them once).
  build_payload: (input) => ({
    volumes: input.volumes.map((job) => ({
      token: job.token,
      volume: {
        values: job.volume.values,
        dims: [...job.volume.dims],
        order: job.volume.order,
        lattice: job.volume.lattice.map((row) => [...row]),
        origin: [...job.volume.origin],
        periodic: job.volume.periodic,
      },
      range: job.range ? job.range.map((bounds) => [...bounds]) : null,
      reference_origin: [...job.reference_origin],
      surfaces: job.surfaces.map(({ token, isovalue }) => ({ token, isovalue })),
    })),
  }),
})

export const compute_geometries_async = (
  input: GeometryInput,
  request_options?: WorkerRequestOptions,
): Promise<GeometryResult> => run_geometry(input, {}, request_options)

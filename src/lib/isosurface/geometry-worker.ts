// Web Worker entry for isosurface geometry extraction; speaks the create_worker_client
// protocol ({ id, input } in, { id, result, error } out) and transfers the result buffers.
import { to_error } from '$lib/utils'
import {
  compute_isosurface_geometries,
  geometry_result_transferables,
  type GeometryInput,
} from './geometry'

// The DOM lib types `self` as a Window whose postMessage takes a targetOrigin; a dedicated
// worker's takes the transfer list directly
const worker_scope = self as unknown as {
  addEventListener(
    type: `message`,
    listener: (event: MessageEvent<{ id: number; input: GeometryInput }>) => void,
  ): void
  postMessage(message: unknown, transfer?: Transferable[]): void
}

worker_scope.addEventListener(`message`, ({ data: { id, input } }) => {
  try {
    const result = compute_isosurface_geometries(input)
    worker_scope.postMessage(
      { id, result, error: null },
      geometry_result_transferables(result),
    )
  } catch (err) {
    worker_scope.postMessage({ id, result: null, error: to_error(err).message }, [])
  }
})

import { auto_volume_layer, index_volumes, retain_volume_layers } from '$lib/isosurface/types'
import type { IsosurfaceLayer, VolumetricData } from '$lib/isosurface/types'

// A publication replaces owned fields; surviving IDs retain all user layers.
export function replace_tool_volumes(
  volumes: VolumetricData[],
  layers: IsosurfaceLayer[],
  owned_ids: readonly string[],
  incoming: VolumetricData[],
) {
  const previous = index_volumes(volumes)
  const owned = new Set(owned_ids)
  const next_volumes = [...volumes.filter(({ id }) => !owned.has(id)), ...incoming]
  const next_layers = retain_volume_layers(layers, index_volumes(next_volumes))
  for (const volume of incoming)
    if (!previous.has(volume.id)) next_layers.push(auto_volume_layer(volume))
  return { volumes: next_volumes, layers: next_layers }
}

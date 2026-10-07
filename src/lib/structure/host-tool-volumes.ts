import {
  auto_volume_layer,
  index_volumes,
  retain_volume_layers,
} from '#lib/isosurface/types.js'
import type { IsosurfaceLayer, VolumetricData } from '#lib/isosurface/types.js'

// One default surface for a tool's fields: the first field gets an auto layer, colored after
// the viewer's other layers; further fields (e.g. a magnetization beside a charge density)
// only join the registry, where the controls offer to add their surfaces.
export const tool_surface = (
  layers: IsosurfaceLayer[],
  fields: readonly VolumetricData[],
): IsosurfaceLayer[] =>
  fields[0] ? [...layers, auto_volume_layer(fields[0], layers.length)] : layers

// A publication replaces owned fields; surviving IDs retain all user layers. A new field is
// drawn only while none of the published fields has a surface, so a run never stacks a
// second default surface over the one the user is adjusting.
export function replace_tool_volumes(
  volumes: VolumetricData[],
  layers: IsosurfaceLayer[],
  owned_ids: readonly string[],
  incoming: VolumetricData[],
) {
  const previous = index_volumes(volumes)
  const owned = new Set(owned_ids)
  const next_volumes = [
    ...volumes.filter(({ id: identifier }) => !owned.has(identifier)),
    ...incoming,
  ]
  const retained = retain_volume_layers(layers, index_volumes(next_volumes))
  const incoming_ids = new Set(incoming.map(({ id: identifier }) => identifier))
  const drawn = retained.some(({ volume_id }) => incoming_ids.has(volume_id))
  const new_fields = incoming.filter(({ id: identifier }) => !previous.has(identifier))
  return {
    volumes: next_volumes,
    layers: drawn ? retained : tool_surface(retained, new_fields),
  }
}

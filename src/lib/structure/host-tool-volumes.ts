import { auto_volume_layer } from '$lib/isosurface/types'
import type { IsosurfaceLayer, VolumetricData } from '$lib/isosurface/types'
import type { StructureToolVolume } from './host-tool.svelte'

// Rebuild one index map for both geometry and color sources. Surviving field IDs retain
// every layer (including zero layers); only genuinely new fields receive defaults.
export function replace_tool_volumes(
  volumes: VolumetricData[],
  layers: IsosurfaceLayer[],
  owned: StructureToolVolume[],
  incoming: StructureToolVolume[],
  active_volume_idx: number,
) {
  const old_fields = new Map<VolumetricData, string>(
    owned.map((volume) => [volume, volume.field_id]),
  )
  const retained = volumes.filter((volume) => !old_fields.has(volume))
  const next_volumes = [...retained, ...incoming]
  // Retained volumes use object identity; replaced tool fields use their stable IDs.
  const next_indices = new Map<VolumetricData | string, number>(
    next_volumes.map((volume, idx) => [volume, idx]),
  )
  incoming.forEach(({ field_id }, idx) => next_indices.set(field_id, retained.length + idx))
  const remap = volumes.map((volume) => next_indices.get(old_fields.get(volume) ?? volume))
  const next_layers: IsosurfaceLayer[] = layers.flatMap((layer) => {
    const volume_idx = remap[layer.volume_idx ?? active_volume_idx]
    return volume_idx === undefined
      ? []
      : [
          {
            ...layer,
            volume_idx,
            color_volume_idx:
              layer.color_volume_idx === undefined ? undefined : remap[layer.color_volume_idx],
          },
        ]
  })
  const previous_ids = new Set(volumes.map((volume) => old_fields.get(volume)))
  for (const [idx, volume] of incoming.entries()) {
    if (!previous_ids.has(volume.field_id))
      next_layers.push(auto_volume_layer(volume, retained.length + idx))
  }
  return {
    volumes: next_volumes,
    layers: next_layers,
    first_idx: retained.length,
    active_idx: remap[active_volume_idx],
  }
}

<script lang="ts">
  // One lighting rig for every Threlte scene, so ambient_light / directional_light mean the
  // same everywhere. `fill` adds a dimmer opposite light (a fraction of `directional`) where
  // back faces would go black (Fermi surfaces, scatter cubes). Positions only set direction.
  import type { Vec3 } from '#lib/math.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { T } from '@threlte/core'

  let {
    ambient = DEFAULTS.structure.ambient_light,
    directional = DEFAULTS.structure.directional_light,
    fill = 0,
    key_position = [3, 10, 10],
    fill_position = [-3, -5, -10],
  }: {
    ambient?: number
    directional?: number
    fill?: number
    key_position?: Vec3
    fill_position?: Vec3
  } = $props()
</script>

<T.AmbientLight intensity={ambient} />
<T.DirectionalLight position={key_position} intensity={directional} />
{#if fill > 0}
  <T.DirectionalLight position={fill_position} intensity={directional * fill} />
{/if}

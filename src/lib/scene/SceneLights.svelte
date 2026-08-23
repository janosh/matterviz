<script lang="ts">
  // One lighting rig for every Threlte scene so SceneControlProps.ambient_light /
  // directional_light mean the same thing everywhere. The key light defaults to where the
  // structure viewer has always had it; `fill` adds a dimmer light from the opposite side (as a
  // fraction of `directional`) for scenes whose back faces would otherwise go black (Fermi
  // surfaces, scatter cubes, ternary prisms). Positions only set the light direction.
  import type { Vec3 } from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
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

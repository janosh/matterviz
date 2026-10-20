<script lang="ts" module>
  import type { Site } from '#lib/structure/index.js'

  export type HighlightTarget = {
    kind: `hover` | `selected` | `active`
    site: Site
    site_idx: number
    color: string
    radius: number
  }
</script>

<script lang="ts">
  // Translucent shells outlining the hovered, selected and active sites. The target list is a
  // pulse-independent input; only the opacity reads the per-frame pulse value, so the list
  // isn't rebuilt every animation frame in every multi-view pane.
  import { HOVER_SHELL_SCALE } from '#lib/scene/index.js'
  import { T } from '@threlte/core'
  import { SphereGeometry } from 'three/webgpu'
  import { disable_raycast } from './scene-picking.svelte'

  let { targets, pulse_opacity }: { targets: HighlightTarget[]; pulse_opacity: number } =
    $props()

  // radius 0.5: scaled by the site radius, so a shell's radius is HOVER_SHELL_SCALE * radius / 2
  const geometry = new SphereGeometry(0.5, 22, 22)
  $effect(() => () => geometry.dispose())
</script>

{#each targets as entry (`${entry.kind}-${entry.site_idx}`)}
  {@const is_pulsing = entry.kind !== `hover`}
  <T.Mesh
    {geometry}
    position={entry.site.xyz}
    scale={HOVER_SHELL_SCALE * entry.radius}
    oncreate={disable_raycast}
  >
    <T.MeshStandardMaterial
      color={entry.color}
      transparent
      opacity={is_pulsing ? pulse_opacity : 0.42}
      emissive={entry.color}
      emissiveIntensity={is_pulsing ? 0.3 : 0.55}
      depthTest={false}
      depthWrite={false}
    />
  </T.Mesh>
{/each}

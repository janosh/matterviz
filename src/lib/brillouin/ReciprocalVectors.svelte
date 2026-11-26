<script lang="ts">
  // Lattice vector arrows (b₁, b₂, b₃ or a, b, c) with HTML labels just past the tips, shared by
  // BrillouinZoneScene, FermiSurfaceScene and WulffScene
  import type { Matrix3x3, Vec3 } from '#lib/math'
  import * as math from '#lib/math'
  import Arrow from '#lib/structure/Arrow.svelte'
  import { SceneLabel } from '#lib/scene/index'
  import type { ComponentProps } from 'svelte'

  let {
    k_lattice,
    vector_scale = 1.0,
    size = 1,
    labels = [`b₁`, `b₂`, `b₃`],
    occlude = false,
  }: {
    k_lattice: Matrix3x3
    vector_scale?: number
    // characteristic scene size: sets all arrow proportions, so a short b (long real-space axis)
    // keeps the same head as the others instead of a flattened one
    size?: number
    labels?: string[] // e.g. a, b, c when drawing real-space axes (WulffScene)
    // objects that hide a label behind them, e.g. a solid shape the arrows poke out of
    occlude?: ComponentProps<typeof SceneLabel>[`occlude`]
  } = $props()

  const vector_colors = [`red`, `green`, `blue`]
</script>

{#each k_lattice as vec, idx (idx)}
  {@const scaled_vec = vec.map((coord) => coord * vector_scale) as Vec3}
  <!-- a fixed gap past the tip, so long and short arrows keep their labels equally close -->
  {@const label_position = math.scale(
    scaled_vec,
    1 + (0.11 * size) / Math.hypot(...scaled_vec),
  )}
  <Arrow
    position={[0, 0, 0]}
    vector={scaled_vec}
    color={vector_colors[idx]}
    scale={1}
    shaft_radius={size * 0.008}
    arrow_head_radius={size * 0.028}
    arrow_head_length={size * 0.1}
  />
  <SceneLabel center position={label_position} {occlude}>
    <span style="color: {vector_colors[idx]}; font-size: 1.2em">
      {labels[idx]}
    </span>
  </SceneLabel>
{/each}

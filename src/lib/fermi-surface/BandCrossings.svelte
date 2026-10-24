<script lang="ts">
  // Dots where bands cross E_F (and a shown energy) on a Bands plot, coloured like the plot's
  // line at that energy; rendered in Bands' children snippet (see FermiBandsLink)
  import { in_range } from '#lib/math.js'
  import type { UserContentProps } from '#lib/plot/core/types.js'
  import { BANDS_CSS_COLORS } from '#lib/spectral/helpers.js'
  import type { BandCrossing } from './fermi-bands-link.svelte'

  let {
    ctx,
    crossings,
    node = $bindable(),
  }: {
    ctx: UserContentProps
    crossings: BandCrossing[]
    node?: SVGSVGElement // where the 3D markers resolve the dots' colours
  } = $props()
</script>

<svg
  bind:this={node}
  class="band-crossings"
  width={ctx.width}
  height={ctx.height}
  style="position: absolute; inset: 0; pointer-events: none"
>
  {#each crossings as { x, energy, level }}
    {#if in_range(x, ctx.x_range) && in_range(energy, ctx.y_range)}
      <circle
        cx={ctx.x_scale_fn(x)}
        cy={ctx.y_scale_fn(energy)}
        r="3"
        fill={BANDS_CSS_COLORS[level]}
        stroke="var(--page-bg, white)"
      />
    {/if}
  {/each}
</svg>

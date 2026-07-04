<script lang="ts">
  import { HTML } from '@threlte/extras'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Vec3 } from '$lib/math'

  let {
    position,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    position: Vec3
    children: Snippet<[{ position: Vec3 }]>
  } = $props()
</script>

<HTML {position} pointerEvents="none">
  <div {...rest} role="tooltip">
    {@render children({ position })}
  </div>
</HTML>

<style>
  div {
    width: max-content;
    max-width: var(--canvas-tooltip-max-width, 16em);
    box-sizing: border-box;
    text-align: var(--canvas-tooltip-text-align, left);
    border-radius: var(--canvas-tooltip-border-radius, var(--border-radius, 3pt));
    background: var(
      --canvas-tooltip-bg,
      light-dark(rgba(226, 232, 240, 0.96), rgba(15, 23, 42, 0.96))
    );
    padding: var(--canvas-tooltip-padding, 1pt 5pt);
    color: var(--canvas-tooltip-text-color, light-dark(#0f172a, #f8fafc));
    font-family: var(--canvas-tooltip-font-family);
    font-size: var(--canvas-tooltip-font-size, clamp(8pt, 3cqmin, 18pt));
    line-height: var(--canvas-tooltip-line-height);
    pointer-events: none;
  }
</style>

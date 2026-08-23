<script lang="ts">
  import type { ColorbarDecoration } from '$lib/plot/core/colorbar-decoration.svelte'
  import ColorBar from '$lib/plot/core/components/ColorBar.svelte'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // Absolutely positioned wrapper around a solver-placed ColorBar (see
  // create_colorbar_decoration). Hovering it locks the tweened position so the bar can't
  // slide away from under the pointer.
  let {
    decoration,
    color_bar,
    wrapper_style = ``,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    decoration: ColorbarDecoration
    color_bar: ComponentProps<typeof ColorBar>
    // Appended to the wrapper's inline style (users pin the bar with `position`/`left`/...)
    wrapper_style?: string
  } = $props()
</script>

<div
  bind:this={decoration.element}
  onmouseenter={() => decoration.tween.set_locked(true)}
  onmouseleave={() => decoration.tween.set_locked(false)}
  class="colorbar-wrapper"
  role="img"
  aria-label="Color scale legend"
  {...decoration.data_attrs}
  {...rest}
  style="left: {decoration.tween.coords.current.x}px; top: {decoration.tween.coords.current
    .y}px; {wrapper_style}"
>
  <ColorBar {...color_bar} />
</div>

<style>
  /* Center the colorbar within its wrapper when shorter than it (e.g. capped by --cbar-max-height
     in fullscreen). Users can override via wrapper_style (inline wins). */
  .colorbar-wrapper {
    position: absolute;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>

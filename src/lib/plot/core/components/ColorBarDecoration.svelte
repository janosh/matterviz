<script lang="ts">
  import type {
    ColorBarDecorationProps,
    PlacedDecoration,
  } from '#lib/plot/core/placed-decoration.svelte.js'
  import ColorBar from '#lib/plot/core/components/ColorBar.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // Absolutely positioned wrapper around a solver-placed ColorBar (see
  // create_colorbar_decoration). Hovering it locks the tweened position so the bar can't
  // slide away from under the pointer.
  let {
    decoration,
    color_bar,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    decoration: PlacedDecoration
    // `wrapper_style` lands on this wrapper and replaces the solver's placement (users pin the
    // bar with `left`/`right`/...); the pinned bar then fills the wrapper
    color_bar: ColorBarDecorationProps
  } = $props()
  // Decoration-only keys are consumed by create_colorbar_decoration, not forwarded to ColorBar
  const {
    tween: _tween,
    responsive: _responsive,
    axis_clearance: _axis_clearance,
    wrapper_style,
    ...bar_props
  } = $derived(color_bar)
</script>

<div
  bind:this={decoration.element}
  onmouseenter={() => decoration.tween.set_locked(true)}
  onmouseleave={() => decoration.tween.set_locked(false)}
  class="colorbar-wrapper"
  role="group"
  aria-label="Color scale legend"
  {...decoration.data_attrs}
  {...rest}
  style={decoration.style}
>
  <ColorBar {...bar_props} wrapper_style={wrapper_style ? `height: 100%; width: 100%;` : ``} />
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

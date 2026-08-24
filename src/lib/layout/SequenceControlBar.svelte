<script lang="ts">
  import type { ShowControlsState } from '$lib/controls'
  import type { Snippet } from 'svelte'
  import type { ClassValue } from 'svelte/elements'

  let {
    controls_config,
    height = $bindable(0),
    class: class_name,
    children,
  }: {
    controls_config: ShowControlsState
    height?: number
    class?: ClassValue
    children: Snippet
  } = $props()
</script>

{#if controls_config.mode !== `never`}
  <section
    class={[`sequence-control-bar`, controls_config.class, class_name]}
    bind:clientHeight={height}
    style={controls_config.style}
  >
    {@render children()}
  </section>
{/if}

<style>
  .sequence-control-bar {
    position: relative;
    display: flex;
    align-items: center;
    flex-wrap: var(--sequence-controls-wrap, nowrap);
    gap: var(--sequence-controls-gap, clamp(4pt, 1.6cqw, 1.5ex));
    width: 100%;
    min-width: 0;
    padding: var(--sequence-controls-padding, clamp(2pt, 0.5cqw, 1ex) clamp(4pt, 1cqw, 1.2ex));
    box-sizing: border-box;
    z-index: var(--sequence-controls-z-index, var(--z-index-viewer-pane, 10));
    border-radius: var(--sequence-controls-border-radius, 4px);
    background: var(
      --sequence-controls-bg,
      var(--surface-bg-hover, light-dark(#f4f4f5, #2a2c33))
    );
    color: var(--sequence-controls-color, light-dark(#1a1a1a, #e8e8e8));
    font-size: var(--sequence-controls-font-size, 0.85rem);
    backdrop-filter: blur(4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    --icon-size: var(--sequence-controls-icon-size, 1.05em);
    &.hover-visible {
      position: absolute;
      inset: 0 0 auto;
    }
    &.always-visible {
      opacity: 1;
      pointer-events: auto;
    }
    &:focus-within {
      z-index: var(--sequence-controls-focus-z-index, var(--z-index-viewer-dropdown, 100));
    }
    :global(svg) {
      width: var(--icon-size);
      height: var(--icon-size);
    }
    :global(.fullscreen-button) {
      --icon-size: var(--sequence-fullscreen-icon-size, 1.25rem);
      --fullscreen-btn-padding: 0;
      --fullscreen-btn-bg: transparent;
    }
    @container (max-width: 520px) {
      flex-wrap: wrap;
    }
  }
  :global(.sequence-viewer:hover) > .sequence-control-bar.hover-visible,
  :global(.sequence-viewer:focus-within) > .sequence-control-bar.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  /* Finger-sized hit areas for every control in the bar. Icons and text keep their size;
     the bar grows from ~20px to 32px rows only on coarse pointers. */
  @media (pointer: coarse) {
    .sequence-control-bar :global(:is(button, select, input[type='number'])) {
      min-height: 32px;
      box-sizing: border-box;
    }
    .sequence-control-bar :global(button) {
      min-width: 32px;
    }
    .sequence-control-bar :global(input[type='range']) {
      height: 32px; /* the track stays thin; this is the touchable strip around it */
    }
  }
</style>

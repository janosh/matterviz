<script lang="ts">
  import type { ShowControlsState } from '$lib/controls'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    controls_config,
    height = $bindable(0),
    children,
    ...rest
  }: HTMLAttributes<HTMLElement> & {
    controls_config: ShowControlsState
    height?: number
    children: Snippet
  } = $props()
</script>

{#if controls_config.mode !== `never`}
  <section
    {...rest}
    class={[`sequence-control-bar`, controls_config.class, rest.class]}
    bind:clientHeight={height}
    style={[rest.style, controls_config.style].filter(Boolean).join(`; `)}
  >
    {@render children()}
  </section>
{/if}

<style>
  section.sequence-control-bar {
    position: relative;
    display: flex;
    align-items: center;
    flex-wrap: var(--sequence-controls-wrap, nowrap);
    gap: var(--sequence-controls-gap, clamp(4pt, 1.6cqw, 1.5ex));
    width: 100%;
    padding: var(--sequence-controls-padding, clamp(2pt, 0.5cqw, 1ex) clamp(4pt, 1cqw, 1.2ex));
    box-sizing: border-box;
    z-index: var(
      --sequence-controls-z-index,
      var(--traj-controls-z-index, var(--z-index-viewer-pane, 10))
    );
    border-radius: var(
      --sequence-controls-border-radius,
      var(--traj-controls-border-radius, var(--traj-border-radius, 4px))
    );
    background: var(
      --sequence-controls-bg,
      var(--traj-controls-bg, var(--surface-bg-hover, light-dark(#f4f4f5, #2a2c33)))
    );
    color: var(
      --sequence-controls-color,
      var(--traj-controls-color, light-dark(#1a1a1a, #e8e8e8))
    );
    font-size: var(--sequence-controls-font-size, var(--traj-controls-font-size, 0.85rem));
    backdrop-filter: blur(4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    --icon-size: var(--sequence-controls-icon-size, var(--traj-controls-icon-size, 1.05em));
  }
  section.sequence-control-bar.hover-visible {
    position: absolute;
    inset: 0 0 auto;
  }
  section.sequence-control-bar.always-visible {
    opacity: 1;
    pointer-events: auto;
  }
  :global(.sequence-viewer:hover) > section.sequence-control-bar.hover-visible,
  :global(.sequence-viewer:focus-within) > section.sequence-control-bar.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  section.sequence-control-bar:focus-within {
    z-index: var(
      --sequence-controls-focus-z-index,
      var(--traj-controls-focus-z-index, var(--z-index-viewer-dropdown, 100))
    );
  }
  section.sequence-control-bar :global(svg) {
    width: var(--icon-size);
    height: var(--icon-size);
  }
</style>

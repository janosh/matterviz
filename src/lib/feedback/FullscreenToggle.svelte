<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    fullscreen = $bindable(false),
    class: className,
    ...rest
  }: HTMLButtonAttributes & {
    fullscreen?: boolean
  } = $props()
</script>

<button
  class="fullscreen-toggle {className ?? ``}"
  onclick={() => (fullscreen = !fullscreen)}
  aria-label={fullscreen ? `Exit fullscreen` : `Enter fullscreen`}
  type="button"
  {...rest}
>
  <Icon
    icon={fullscreen ? `ExitFullscreen` : `Fullscreen`}
    width="18"
    height="18"
  />
</button>

<style>
  .fullscreen-toggle {
    position: absolute;
    top: var(--ctrl-btn-top, 5pt);
    right: var(--fullscreen-btn-right, 4px);
    z-index: var(--fullscreen-btn-z-index, 10);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--fullscreen-btn-padding, 2pt);
    border-radius: var(--fullscreen-btn-border-radius, 3pt);
    background-color: transparent;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s, background-color 0.2s;
  }
  .fullscreen-toggle:hover, .fullscreen-toggle:focus {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
    opacity: var(--fullscreen-btn-hover-opacity, 1);
  }
  /* Note: Parent component should add styles to show on parent hover */
  /* Example: .parent:hover :global(.fullscreen-toggle) { opacity: 1; } */
</style>

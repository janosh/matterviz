<script lang="ts">
  // Fullscreen toggle button (default Icon or custom snippet content), shared by the
  // Trajectory/ChemPotDiagram3D/ConvexHull viewer chromes
  import Icon from '$lib/Icon.svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import { type FullscreenToggleProp, toggle_fullscreen } from './fullscreen'

  let {
    fullscreen = false,
    toggle = true, // pass a snippet to render custom button content
    wrapper = undefined, // element sent fullscreen
    ...rest
  }: HTMLButtonAttributes & {
    fullscreen?: boolean
    toggle?: FullscreenToggleProp
    wrapper?: HTMLDivElement
  } = $props()
</script>

<button
  type="button"
  onclick={() => toggle_fullscreen(wrapper)}
  title="{fullscreen ? `Exit` : `Enter`} fullscreen"
  aria-pressed={fullscreen}
  {...rest}
  class="fullscreen-btn {rest.class ?? ``}"
>
  {#if typeof toggle === `function`}
    {@render toggle({ fullscreen })}
  {:else}
    <Icon icon={fullscreen ? `ExitFullscreen` : `Fullscreen`} />
  {/if}
</button>

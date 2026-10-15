<script lang="ts">
  // A multi-panel component's one fullscreen button, in and hidden like its host panel's own
  import { normalize_show_controls, shows_fullscreen_toggle } from '#lib/controls.js'
  import type { ShowControlsProp } from '#lib/controls.js'
  import FullscreenButton from './FullscreenButton.svelte'

  type Props = {
    fullscreen: boolean
    toggle: boolean
    controls?: ShowControlsProp // the host panel's show_controls
    wrapper?: HTMLElement
  }
  let { fullscreen = $bindable(), toggle, controls, wrapper }: Props = $props()
  const shown = $derived(shows_fullscreen_toggle(toggle, normalize_show_controls(controls)))
</script>

<!-- kept (hidden) while fullscreen so Esc still syncs the flag -->
{#if fullscreen || shown}<FullscreenButton bind:fullscreen hidden={!shown} {wrapper} />{/if}

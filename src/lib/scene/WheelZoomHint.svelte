<script lang="ts">
  import { motion_duration } from '#lib/effects.svelte.js'
  import { fade } from 'svelte/transition'
  import type { WheelZoomGate } from './wheel-zoom.svelte'

  // Brief centered notice when a WheelZoomGate let a plain wheel scroll the page instead of
  // zooming. Passes clicks through and stays mounted while hidden, so the polite live region
  // already exists when its first message arrives.
  let { gate }: { gate: WheelZoomGate } = $props()
</script>

<div class="wheel-zoom-hint" aria-live="polite">
  {#if gate.hint_visible}
    <span transition:fade={{ duration: motion_duration(150) }}>{gate.hint}</span>
  {/if}
</div>

<style>
  .wheel-zoom-hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    z-index: var(--wheel-zoom-hint-z-index, var(--z-index-viewer-dropdown, 100));
    span {
      /* own compositing layer, or WKWebView paints the canvas over this (see app.css); on the
         card, not the always-mounted overlay, so idle viewers hold no extra layer */
      will-change: transform;
      max-width: calc(100% - 2em);
      padding: 0.3rem 0.7rem;
      border-radius: var(--border-radius, 3pt);
      border: var(--pane-border);
      box-shadow: var(--pane-box-shadow);
      background: color-mix(in srgb, var(--pane-bg, #222) 92%, transparent);
      color: var(--pane-color, var(--text-color));
      font-size: 0.85rem;
      text-align: center;
    }
  }
</style>

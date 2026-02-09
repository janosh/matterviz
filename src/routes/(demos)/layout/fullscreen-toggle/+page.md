# FullscreenToggle

A toggle button for fullscreen mode. Designed to appear on hover of a parent container.

## Basic Usage

```svelte example
<script lang="ts">
  import { FullscreenToggle } from 'matterviz/layout'

  let fullscreen = $state(false)
</script>

<div
  style="position: relative; padding: 2em; border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 8px; min-height: 100px; display: grid; place-items: center"
>
  <FullscreenToggle
    bind:fullscreen
    style="opacity: 1; position: absolute; top: 8px; right: 8px"
  />
  <span style="opacity: 0.6">{
    fullscreen ? `Fullscreen mode active` : `Click the button to toggle`
  }</span>
</div>
```

<script lang="ts">
  import { Icon } from 'svelte-widgets'
  import { sync_fullscreen } from 'svelte-widgets/fullscreen'
  import { ExitFullscreen, Fullscreen } from 'svelte-widgets/icons'
  import { chain_handlers } from 'svelte-widgets/utils'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    fullscreen = $bindable(false),
    wrapper,
    bg_css_var = `--fullscreen-bg`,
    on_change,
    ...rest
  }: HTMLButtonAttributes & {
    fullscreen?: boolean
    wrapper?: HTMLElement
    bg_css_var?: string // wrapper CSS var that receives the page background while fullscreen
    on_change?: (fullscreen: boolean) => void
  } = $props()

  const label = $derived(fullscreen ? `Exit fullscreen` : `Enter fullscreen`)

  sync_fullscreen({
    get_wrapper: () => wrapper,
    get_fullscreen: () => fullscreen,
    set_fullscreen: (value) => (fullscreen = value),
    get_bg_css_var: () => bg_css_var,
    on_change: (value) => on_change?.(value),
  })

  async function request_toggle(): Promise<void> {
    if (!wrapper) {
      fullscreen = !fullscreen
      on_change?.(fullscreen)
      return
    }
    try {
      if (document.fullscreenElement === wrapper) await document.exitFullscreen()
      else {
        if (document.fullscreenElement) await document.exitFullscreen()
        await wrapper.requestFullscreen()
      }
    } catch (error) {
      console.error(`Fullscreen operation failed:`, error)
    }
  }
</script>

<button
  type="button"
  title={label}
  aria-label={label}
  {...rest}
  aria-pressed={fullscreen}
  class={[`fullscreen-btn`, rest.class]}
  onclick={chain_handlers(() => void request_toggle(), rest.onclick)}
>
  <Icon icon={fullscreen ? ExitFullscreen : Fullscreen} />
</button>

<style>
  .fullscreen-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--fullscreen-btn-padding, 2pt);
    border-radius: var(--fullscreen-btn-border-radius, var(--border-radius, 3pt));
    background: var(--fullscreen-btn-bg, transparent);
    color: var(--fullscreen-btn-color, inherit);
    cursor: pointer;
    opacity: var(--fullscreen-btn-opacity, 1);
    transition:
      background 0.2s,
      opacity 0.2s;
  }
  .fullscreen-btn:hover,
  .fullscreen-btn:focus-visible {
    background: var(
      --fullscreen-btn-hover-bg,
      color-mix(in srgb, currentcolor 8%, transparent)
    );
    opacity: var(--fullscreen-btn-hover-opacity, 1);
  }
</style>

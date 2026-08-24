<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { FullscreenButton } from 'svelte-widgets'

  // svelte-widgets' button flips the bound flag on click and reports only browser-initiated
  // transitions (Esc, F11) through `on_change`. Viewers forward every real transition to
  // `on_fullscreen_change`, so report from the fullscreenchange event here instead: a click
  // whose request the browser rejects never reaches the host, and a granted one does.
  let {
    fullscreen = $bindable(false),
    wrapper,
    on_change,
    ...rest
  }: ComponentProps<typeof FullscreenButton> = $props()

  let reported = fullscreen
  const report = (next: boolean) => {
    if (next === reported) return
    reported = next
    on_change?.(next)
  }
  $effect(() => {
    // without an element to send fullscreen, the flag itself is the state
    if (!wrapper) {
      report(fullscreen)
      return
    }
    const handle_change = () => report(document.fullscreenElement === wrapper)
    document.addEventListener(`fullscreenchange`, handle_change)
    return () => document.removeEventListener(`fullscreenchange`, handle_change)
  })
</script>

<FullscreenButton bind:fullscreen {wrapper} {...rest} />

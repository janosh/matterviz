<script lang="ts">
  import type { ComponentProps } from 'svelte'
  // Aliased: this component has the same name, and svelte2tsx emits both the import and a
  // `declare const` of it into the packaged declaration, which is a TS2440 conflict and also
  // collapses the props type below to `any`.
  import WidgetFullscreenButton from 'svelte-widgets/FullscreenButton.svelte'
  import { host } from '#lib/host'
  import { SHORTCUTS } from '#lib/shortcuts'

  let {
    fullscreen = $bindable(false),
    wrapper,
    on_change,
    ...rest
  }: ComponentProps<typeof WidgetFullscreenButton> = $props()

  // The widget reports each real browser transition of its wrapper. Without one nothing goes
  // fullscreen and the flag itself is the state, so its flips are reported here instead.
  let reported = fullscreen
  $effect(() => {
    if (fullscreen === reported) return
    reported = fullscreen
    if (!wrapper) on_change?.(fullscreen)
  })

  // A host that cannot fullscreen holds no fullscreen state: a bound `true` (a "start in
  // fullscreen" setting) would leave the viewer's fixed fullscreen styles on with no exit.
  $effect.pre(() => {
    if (!host.fullscreen && fullscreen) fullscreen = false
  })
</script>

<!-- Plain `f` fullscreens the viewer under the pointer. Every viewer renders one of these
  buttons for its own root, so owning the key here keeps one binding across all of them. A host
  that cannot fullscreen an element (host.fullscreen) offers neither button nor key. -->
{#if host.fullscreen}<WidgetFullscreenButton
    bind:fullscreen
    {wrapper}
    {on_change}
    hotkey={SHORTCUTS.fullscreen.keys}
    {...rest}
  />{/if}

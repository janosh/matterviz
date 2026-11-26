<script lang="ts">
  import type { ComponentProps } from 'svelte'
  // Aliased: this component has the same name, and svelte2tsx emits both the import and a
  // `declare const` of it into the packaged declaration, which is a TS2440 conflict and also
  // collapses the props type below to `any`.
  import WidgetFullscreenButton from 'svelte-widgets/FullscreenButton.svelte'
  import { ExitFullscreen, Fullscreen } from 'svelte-widgets/icons'
  import { create_shortcut_flash } from 'svelte-widgets/browser'
  import { host } from '#lib/host.js'
  import { SHORTCUTS, shortcut_title, viewer_keys } from '#lib/shortcuts.js'
  import { FULLSCREEN_BUTTON_LABELS } from 'svelte-widgets/labels'

  let {
    fullscreen = $bindable(false),
    hidden = false,
    wrapper,
    on_change,
    ...rest
  }: ComponentProps<typeof WidgetFullscreenButton> = $props()

  // marks a wrapper as a fullscreen root so nested viewers can spot an outer owner
  const VIEWER_ATTR = `data-mv-fullscreen-root`
  const shortcut_flash = create_shortcut_flash<`fullscreen`>()

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

  // Plain `f` fullscreens the viewer under the pointer. Every viewer renders one of these
  // buttons for its own root, so owning the key here keeps one binding across all of them.
  // Hidden buttons retain an active fullscreen subscription but never handle shortcuts.
  // Chords stay with the browser (Cmd/Ctrl+F is find-in-page) and typing is left alone.
  $effect(() => {
    const root = wrapper
    // A host that cannot fullscreen an element (host.fullscreen) offers neither button nor key.
    if (!root || !host.fullscreen) return
    root.setAttribute(VIEWER_ATTR, ``)
    // Nested viewers (a Structure inside a Trajectory) leave the key to the outer one: both
    // are hovered at once and would each fullscreen their own root on one press. Only the
    // keyboard defers — the nested viewer's own button still works.
    const detach = viewer_keys(() =>
      hidden || root.parentElement?.closest(`[${VIEWER_ATTR}]`)
        ? {}
        : {
            f: () => {
              fullscreen = !fullscreen
              shortcut_flash.show(`fullscreen`)
            },
          },
    )(root)
    return () => {
      root.removeAttribute(VIEWER_ATTR)
      detach()
    }
  })
</script>

{#if host.fullscreen}<WidgetFullscreenButton
    bind:fullscreen
    {wrapper}
    {on_change}
    aria-keyshortcuts={SHORTCUTS.fullscreen.keys}
    title={shortcut_title(
      `fullscreen`,
      { ...FULLSCREEN_BUTTON_LABELS, ...rest.labels }[fullscreen ? `exit` : `enter`],
    )}
    {...rest}
    icons={{
      // Fill 76.8% of the icon box to visually balance the rounded gear.
      enter: { ...Fullscreen, viewBox: `2.885417 2.885417 18.229166 18.229166` },
      exit: { ...ExitFullscreen, viewBox: `1.583333 1.583333 20.833334 20.833334` },
      ...rest.icons,
    }}
    {hidden}
    style={[rest.style, shortcut_flash.style(`fullscreen`), hidden && `display: none`]
      .filter(Boolean)
      .join(`; `)}
  />{/if}

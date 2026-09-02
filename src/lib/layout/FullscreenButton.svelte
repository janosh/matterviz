<script lang="ts">
  import type { ComponentProps } from 'svelte'
  // Aliased: this component has the same name, and svelte2tsx emits both the import and a
  // `declare const` of it into the packaged declaration, which is a TS2440 conflict and also
  // collapses the props type below to `any`.
  import { FullscreenButton as WidgetFullscreenButton } from 'svelte-widgets'
  import { forward_window_keydown } from 'svelte-widgets/attachments'
  import { is_editable_event_target, is_modifier_chord } from 'svelte-widgets/utils'

  // svelte-widgets' button flips the bound flag on click and reports only browser-initiated
  // transitions (Esc, F11) through `on_change`. Viewers forward every real transition to
  // `on_fullscreen_change`, so report from the fullscreenchange event here instead: a click
  // whose request the browser rejects never reaches the host, and a granted one does.
  let {
    fullscreen = $bindable(false),
    wrapper,
    on_change,
    ...rest
  }: ComponentProps<typeof WidgetFullscreenButton> = $props()

  // marks a wrapper as a fullscreen root so nested viewers can spot an outer owner
  const VIEWER_ATTR = `data-mv-fullscreen-root`

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

  // Plain `f` fullscreens the viewer under the pointer. Every viewer renders one of these
  // buttons for its own root, so owning the key here keeps one binding across all of them,
  // and hosts that pass fullscreen_toggle={false} never render us and so never get the key.
  // Chords stay with the browser (Cmd/Ctrl+F is find-in-page) and typing is left alone.
  $effect(() => {
    const root = wrapper
    if (!root) return
    root.setAttribute(VIEWER_ATTR, ``)
    const handle = (event: KeyboardEvent) => {
      if (event.key !== `f` || event.repeat || is_modifier_chord(event)) return false
      if (is_editable_event_target(event.target)) return false
      // Nested viewers (a Structure inside a Trajectory) leave the key to the outer one:
      // both are hovered at once and would each fullscreen their own root on one press.
      // Only the keyboard defers — the nested viewer's own button still works.
      if (root.parentElement?.closest(`[${VIEWER_ATTR}]`)) return false
      fullscreen = !fullscreen
      return true
    }
    const detach = forward_window_keydown({ handle })(root)
    return () => {
      root.removeAttribute(VIEWER_ATTR)
      detach?.()
    }
  })
</script>

<WidgetFullscreenButton bind:fullscreen {wrapper} {...rest} />

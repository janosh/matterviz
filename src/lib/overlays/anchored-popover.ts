import { float, register_escape_layer } from 'svelte-widgets/attachments'

// Shows a dropdown as a native auto popover floated under its trigger: the top layer escapes
// overflow clipping and stacking contexts, and the browser owns light dismiss and keeping one
// auto popover open at a time. `source` makes the trigger part of the popover, so a click on
// it toggles instead of dismissing and reopening. `on_close` reports every close so the
// caller's `open` state follows; unmounting closes it silently.
export const anchored_popover =
  ({
    anchor,
    on_close,
    align = `end`,
  }: {
    anchor: HTMLElement | null | undefined
    on_close: () => void
    align?: `start` | `center` | `end`
  }) =>
  (node: HTMLElement): (() => void) | undefined => {
    if (!anchor) return undefined
    const handle_toggle = (event: ToggleEvent) => {
      if (event.newState === `closed`) on_close()
    }
    // Escape belongs to the open popover (as the innermost svelte-widgets Escape layer):
    // swallowed before a host viewer's own Escape handling (unwinding panes, edit modes) acts
    // on it. Focus goes back to the trigger before hiding: the browser's own restore fires
    // focusin mid-hide, where a tooltip's showPopover throws.
    const release_escape = register_escape_layer((event) => {
      if (!node.matches(`:popover-open`)) return false
      event.preventDefault()
      event.stopPropagation()
      if (node.contains(document.activeElement)) anchor.focus()
      node.hidePopover()
      return true
    })
    node.popover = `auto`
    node.addEventListener(`toggle`, handle_toggle)
    node.showPopover({ source: anchor })
    const stop_float = float({ anchor, placement: `bottom`, align, offset: 4, padding: 4 })(
      node,
    )
    return () => {
      node.removeEventListener(`toggle`, handle_toggle)
      release_escape()
      stop_float?.()
      if (node.matches(`:popover-open`)) node.hidePopover()
    }
  }

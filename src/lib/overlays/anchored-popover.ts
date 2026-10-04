import { float, register_escape_layer } from 'svelte-widgets/attachments'
import type { TransitionConfig } from 'svelte/transition'

// Each open anchored popover's silent close (hide without reporting it through on_close)
const silent_closers = new WeakMap<Element, () => void>()

// Shows a dropdown as a native auto popover floated beside its trigger: the top layer escapes
// overflow clipping and stacking contexts, and the browser owns light dismiss and keeping one
// auto popover open at a time. The trigger becomes the popover's invoker (`popovertarget`), so
// pressing it toggles instead of light-dismissing and reopening. `on_close` reports every
// close so the caller's `open` state follows, from the synchronous `beforetoggle`: the async
// `toggle` comes a frame late, which paints a closed `display: flex` menu in normal flow.
// Unmounting closes it silently. Pair it with `out:close_before_removal` (see there).
export const anchored_popover =
  ({
    anchor,
    on_close,
    placement = `bottom`,
    align = `end`,
  }: {
    anchor: HTMLButtonElement | null | undefined
    on_close: () => void
    placement?: `top` | `bottom` // preferred side; float flips when it doesn't fit
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
    // The top layer lifts the popover out of its ancestors' boxes, but not out of their inherited
    // styles: a host that makes its overlay click-through (axis labels in a foreignObject, hover-
    // only toolbars) would pass `pointer-events: none` on to the menu. `inset` and `margin`
    // undo the UA [popover] box, which would center the menu over `float`'s top/left.
    Object.assign(node.style, { pointerEvents: `auto`, inset: `auto`, margin: `0` })
    anchor.popoverTargetElement = node
    // `show`: the click that just opened it (its native step runs after the caller's handler)
    // must not hide it again; closing on a trigger click is the caller's handler's job
    anchor.popoverTargetAction = `show`
    node.addEventListener(`beforetoggle`, handle_toggle)
    node.showPopover({ source: anchor })
    const stop_float = float({ anchor, placement, align, offset: 4, padding: 4 })(node)
    const close_silently = () => {
      node.removeEventListener(`beforetoggle`, handle_toggle)
      if (!node.matches(`:popover-open`)) return
      const focus_inside = node.contains(document.activeElement)
      node.hidePopover()
      // With focus inside, hiding refocuses the trigger. Keep that for keyboard users; after a
      // mouse pick it would open the trigger's tooltip, so drop focus as removal used to. Blur
      // after hiding: blurring first left the host's :hover stale again.
      const refocused = focus_inside && document.activeElement === anchor
      if (refocused && !anchor.matches(`:focus-visible`)) anchor.blur()
    }
    silent_closers.set(node, close_silently)
    return () => {
      close_silently()
      silent_closers.delete(node)
      release_escape()
      anchor.popoverTargetElement = null
      stop_float?.()
    }
  }

// Outro for an anchored popover's element, which hides it before Svelte removes it. Svelte
// detaches a closing block's DOM before running its attachments' teardown, and Chromium left
// stale hover state when an open top-layer element was removed under the pointer: after
// picking a menu option, the host viewer no longer matched :hover (its hover-only chrome
// stayed hidden) until the pointer left it. An outro runs before the removal, and with no
// duration the removal still happens synchronously.
export const close_before_removal = (node: Element): TransitionConfig => {
  silent_closers.get(node)?.()
  return {}
}

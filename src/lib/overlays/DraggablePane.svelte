<script lang="ts">
  // TEMPORARY: backports the release-time dismissal that svelte-widgets 1.1.0 lacks.
  // Delete this file and re-export DraggablePane straight from svelte-widgets once a
  // release ships the upstream fix, which adds a `dismiss_on` prop defaulting to
  // `release` and makes release mode ignore gestures that began inside.
  //
  // svelte-widgets 1.1.0 closes on pointerdown, which lands before the click's default
  // action, so a control outside the pane that drives `show` (a checkbox two-way bound
  // to it, say) gets its own state rewritten by that close and then flipped straight
  // back by its own click: the pane can be opened from outside but never closed.
  // `persistent` turns the library's press dismissal off (Escape and the close button
  // still work there) and the effect below puts dismissal back at click time.
  import type { ComponentProps } from 'svelte'
  import { DraggablePane } from 'svelte-widgets'
  import { dismiss_on_outside_press } from 'svelte-widgets/attachments'

  let {
    show = $bindable(false),
    pane = $bindable(null),
    toggle_btn = $bindable(null),
    has_been_dragged = $bindable(false),
    dragging = $bindable(false),
    persistent = false,
    on_close,
    ...rest
  }: ComponentProps<typeof DraggablePane> = $props()

  // Where the current gesture started. A drag or resize begins on the pane and may
  // release past its edge, and the browser then fires the click on a common ancestor —
  // outside. Only a gesture that both starts and ends outside is a dismissal.
  let press_started_inside = false

  $effect(() => {
    if (!show || persistent || !pane) return
    const remember_press = (event: PointerEvent) => {
      const target = event.target
      press_started_inside =
        target instanceof Node && [pane, toggle_btn].some((el) => el?.contains(target))
    }
    document.addEventListener(`pointerdown`, remember_press, true)
    const stop_dismissing = dismiss_on_outside_press({
      node: pane,
      inside: [toggle_btn],
      dismiss_on: `release`,
      callback: ({ event }) => {
        // detail is 0 for keyboard and programmatic clicks, which carry no pointerdown of
        // their own and would otherwise inherit the verdict from an unrelated press
        const started_inside =
          press_started_inside && event instanceof MouseEvent && event.detail > 0
        press_started_inside = false
        if (started_inside) return
        show = false
        on_close?.({ via: `pointer` })
      },
    })
    return () => {
      document.removeEventListener(`pointerdown`, remember_press, true)
      stop_dismissing()
    }
  })

  // TEMPORARY: svelte-widgets 1.1.0 renders the corner grip as `pointer-events: none`
  // decoration and dropped the double-click-to-reset gesture the pane used to own. The
  // one visible affordance for undoing a manual resize is therefore inert — the press
  // lands on the pane behind the grip. Delete once a release makes the grip hit-testable
  // and clears the inline size on double-click.
  $effect(() => {
    const pane_el = pane
    if (rest.resize !== `both` || !pane_el) return
    const grip = pane_el.querySelector(`.resize-grip`)
    if (!(grip instanceof SVGElement)) return
    grip.style.pointerEvents = `auto`
    // `resizable` writes both inline dimensions, so both have to go for the pane to fall
    // back to the size its CSS gives it
    const reset_size = () => {
      pane_el.style.width = ``
      pane_el.style.height = ``
    }
    grip.addEventListener(`dblclick`, reset_size)
    return () => grip.removeEventListener(`dblclick`, reset_size)
  })
</script>

<DraggablePane
  bind:show
  bind:pane
  bind:toggle_btn
  bind:has_been_dragged
  bind:dragging
  persistent
  {on_close}
  {...rest}
/>

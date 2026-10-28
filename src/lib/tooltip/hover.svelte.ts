import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
import { mount, unmount, untrack, type Snippet } from 'svelte'
import type { Attachment } from 'svelte/attachments'
import { on } from 'svelte/events'
import { TooltipPin } from './pin.svelte'

// One pinned hover_tooltip on the page: these marks belong to no viewer with its own pin
const pin = new TooltipPin<Element>()

// Rich content for HTML and SVG marks whose native title cannot render unit markup.
// `bg_color` gets the mark's fill for the tooltip (nullish: PlotTooltip's neutral chip); read
// in a child effect so a re-derived mark updates the open tooltip rather than remounting it.
// A click pins the tooltip (see TooltipPin) unless the mark is a control whose click is taken;
// a click elsewhere or Escape unpins it. The pinned mark carries `data-pinned`, so CSS can keep
// its hover look with `:is(:hover, [data-pinned])`.
export const hover_tooltip =
  (
    children: Snippet,
    bg_color?: () => string | null | undefined,
  ): Attachment<HTMLElement | SVGElement> =>
  (node) => {
    const props = $state({
      x: 0,
      y: 0,
      fixed: true,
      children,
      bg_color: undefined as string | null | undefined,
      role: `tooltip`,
      pinned: false,
    })
    if (bg_color) $effect.pre(() => void (props.bg_color = bg_color()))
    let close: (() => void) | undefined
    let hovered = false
    let focused = false
    const hide = () => {
      close?.()
      close = undefined
    }
    const show = () => {
      if (close) return
      const host = document.createElement(`div`)
      // Out of the mark's subtree, so carry over its scheme (an embed themed apart from the
      // page) for the tooltip's light-dark() tokens
      host.style.colorScheme = getComputedStyle(node).colorScheme
      document.body.append(host)
      const component = mount(PlotTooltip, { target: host, props })
      const off_key = on(document, `keydown`, (event) => {
        if (event.key !== `Escape`) return
        event.preventDefault() // spent on this tooltip, so an enclosing popup stays open
        // stays hidden until the next enter or focus, pinned or not
        hovered = false
        focused = false
        pin.unpin()
        hide()
      })
      // while pinned, a press outside the mark and its tooltip unpins
      const off_press = on(document, `pointerdown`, ({ target }) => {
        const inside =
          target instanceof Node && (node.contains(target) || host.contains(target))
        if (props.pinned && !inside) pin.unpin()
      })
      close = () => {
        off_key()
        off_press()
        void unmount(component)
        host.remove()
      }
    }
    const sync = () => (hovered || focused || props.pinned ? show() : hide())
    $effect(() => {
      props.pinned = pin.is(node)
      node.toggleAttribute(`data-pinned`, props.pinned)
      untrack(sync)
    })
    const set_anchor = (x: number, y: number) => {
      if (props.pinned) return
      props.x = x
      props.y = y
    }
    const off = [
      on(node, `pointerenter`, (event) => {
        if (!(event instanceof MouseEvent)) return
        hovered = true
        set_anchor(event.clientX, event.clientY)
        sync()
      }),
      on(node, `pointermove`, (event) => {
        if (event instanceof MouseEvent) set_anchor(event.clientX, event.clientY)
      }),
      on(node, `pointerleave`, () => {
        hovered = false
        sync()
      }),
      on(node, `focus`, () => {
        focused = true
        const bounds = node.getBoundingClientRect()
        set_anchor(bounds.right, bounds.top)
        sync()
      }),
      on(node, `blur`, () => {
        focused = false
        sync()
      }),
    ]
    // Buttons and links already act on click
    if (!node.matches(`button, a[href]`)) off.push(on(node, `click`, () => pin.toggle(node)))
    return () => {
      off.forEach((remove) => remove())
      if (pin.is(node)) pin.unpin()
      hide()
    }
  }

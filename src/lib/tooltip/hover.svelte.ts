import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
import { mount, unmount, type Snippet } from 'svelte'
import type { Attachment } from 'svelte/attachments'
import { on } from 'svelte/events'

// Rich content for HTML and SVG marks whose native title cannot render unit markup.
export const hover_tooltip =
  (children: Snippet): Attachment<HTMLElement | SVGElement> =>
  (node) => {
    const props = $state({
      x: 0,
      y: 0,
      fixed: true,
      children,
      bg_color: `var(--tooltip-bg, light-dark(#eee, #333))`,
      role: `tooltip`,
    })
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
      document.body.append(host)
      const component = mount(PlotTooltip, { target: host, props })
      const off_key = on(document, `keydown`, (event) => {
        if (event.key === `Escape`) hide()
      })
      close = () => {
        off_key()
        void unmount(component)
        host.remove()
      }
    }
    const off = [
      on(node, `pointerenter`, (event) => {
        if (!(event instanceof MouseEvent)) return
        hovered = true
        props.x = event.clientX
        props.y = event.clientY
        show()
      }),
      on(node, `pointermove`, (event) => {
        if (!(event instanceof MouseEvent)) return
        props.x = event.clientX
        props.y = event.clientY
      }),
      on(node, `pointerleave`, () => {
        hovered = false
        if (!focused) hide()
      }),
      on(node, `focus`, () => {
        focused = true
        const bounds = node.getBoundingClientRect()
        props.x = bounds.right
        props.y = bounds.top
        show()
      }),
      on(node, `blur`, () => {
        focused = false
        if (!hovered) hide()
      }),
    ]
    return () => {
      off.forEach((remove) => remove())
      hide()
    }
  }

import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
import { mount, unmount, type Snippet } from 'svelte'
import type { Attachment } from 'svelte/attachments'
import { on } from 'svelte/events'

const NEUTRAL_BG = `var(--tooltip-bg, light-dark(#eee, #333))`

// Rich content for HTML and SVG marks whose native title cannot render unit markup.
// `bg_color` returns the mark's own fill, so the tooltip matches what it describes
// (PlotTooltip contrasts the text); without one it takes the neutral --tooltip-bg. A getter
// read in a child effect, so a re-derived mark updates the open tooltip instead of tearing
// down the attachment (which would unmount it and drop hover/focus state).
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
      bg_color: NEUTRAL_BG,
      role: `tooltip`,
    })
    $effect.pre(() => {
      props.bg_color = bg_color?.() ?? NEUTRAL_BG
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

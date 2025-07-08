import type { Attachment } from 'svelte/attachments'

export interface DraggableOptions {
  handle_selector?: string
  on_drag_start?: (event: MouseEvent) => void
  on_drag?: (event: MouseEvent) => void
  on_drag_end?: (event: MouseEvent) => void
}

// Svelte 5 attachment factory to make an element draggable
// @param options - Configuration options for dragging behavior
// @returns Attachment function that sets up dragging on an element
export function draggable(options: DraggableOptions = {}): Attachment {
  return (element: Element) => {
    const node = element as HTMLElement

    // Use simple variables for maximum performance
    let dragging = false
    let start = { x: 0, y: 0 }
    const initial = { left: 0, top: 0, width: 0 }

    const handle = options.handle_selector
      ? node.querySelector<HTMLElement>(options.handle_selector)
      : node

    if (!handle) {
      console.warn(
        `Draggable: handle not found with selector "${options.handle_selector}"`,
      )
      return
    }

    function handle_mousedown(event: MouseEvent) {
      // Only drag if mousedown is on the handle or its children
      if (!handle?.contains?.(event.target as Node)) return

      dragging = true

      // For position: fixed elements, use getBoundingClientRect for viewport-relative position
      const computed_style = getComputedStyle(node)
      if (computed_style.position === `fixed`) {
        const rect = node.getBoundingClientRect()
        initial.left = rect.left
        initial.top = rect.top
        initial.width = rect.width
      } else {
        // For other positioning, use offset values
        initial.left = node.offsetLeft
        initial.top = node.offsetTop
        initial.width = node.offsetWidth
      }

      node.style.left = `${initial.left}px`
      node.style.top = `${initial.top}px`
      node.style.width = `${initial.width}px`
      node.style.right = `auto` // Prevent conflict with left
      start = { x: event.clientX, y: event.clientY }
      document.body.style.userSelect = `none` // Prevent text selection during drag
      if (handle) handle.style.cursor = `grabbing`

      globalThis.addEventListener(`mousemove`, handle_mousemove)
      globalThis.addEventListener(`mouseup`, handle_mouseup)

      options.on_drag_start?.(event) // Call optional callback
    }

    function handle_mousemove(event: MouseEvent) {
      if (!dragging) return

      // Use the exact same calculation as the fast old implementation
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      node.style.left = `${initial.left + dx}px`
      node.style.top = `${initial.top + dy}px`

      // Only call callback if it exists (minimize overhead)
      if (options.on_drag) options.on_drag(event)
    }

    function handle_mouseup(event: MouseEvent) {
      if (!dragging) return

      dragging = false
      event.stopPropagation()
      document.body.style.userSelect = ``
      if (handle) handle.style.cursor = `grab`

      globalThis.removeEventListener(`mousemove`, handle_mousemove)
      globalThis.removeEventListener(`mouseup`, handle_mouseup)

      options.on_drag_end?.(event) // Call optional callback
    }

    if (handle) {
      handle.addEventListener(`mousedown`, handle_mousedown)
      handle.style.cursor = `grab`
    }

    // Return cleanup function (this is the attachment pattern)
    return () => {
      globalThis.removeEventListener(`mousemove`, handle_mousemove)
      globalThis.removeEventListener(`mouseup`, handle_mouseup)
      if (handle) {
        handle.removeEventListener(`mousedown`, handle_mousedown)
        handle.style.cursor = `` // Reset cursor
      }
    }
  }
}

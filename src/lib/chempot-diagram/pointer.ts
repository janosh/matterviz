// Event/pointer normalization for hover tooltips.
// Handles DOM events and Threlte/Three.js event wrappers (nativeEvent, srcEvent).

export function get_pointer_coords(
  raw_event: unknown,
): { clientX: number; clientY: number } | null {
  const is_pointer_like_event = (
    event_val: unknown,
  ): event_val is PointerEvent | MouseEvent =>
    (typeof PointerEvent !== `undefined` && event_val instanceof PointerEvent) ||
    (typeof MouseEvent !== `undefined` && event_val instanceof MouseEvent)

  if (is_pointer_like_event(raw_event)) {
    return raw_event
  }
  if (!raw_event || typeof raw_event !== `object`) return null
  const event_obj = raw_event as {
    nativeEvent?: unknown
    srcEvent?: unknown
    clientX?: number
    clientY?: number
  }
  const native_event = event_obj.nativeEvent
  if (is_pointer_like_event(native_event)) {
    return native_event
  }
  const src_event = event_obj.srcEvent
  if (is_pointer_like_event(src_event)) {
    return src_event
  }
  const client_x = event_obj.clientX
  const client_y = event_obj.clientY
  if (typeof client_x === `number` && typeof client_y === `number`) {
    return { clientX: client_x, clientY: client_y }
  }
  return null
}

/** Convert pointer event to container-relative coords for tooltip placement. */
export function get_hover_pointer(
  raw_event: unknown,
  container_rect: DOMRect | null | undefined,
): { x: number; y: number } | null {
  const pointer_event = get_pointer_coords(raw_event)
  if (!pointer_event) return null
  const offset_x = container_rect?.left ?? 0
  const offset_y = container_rect?.top ?? 0
  const x = pointer_event.clientX - offset_x + 4
  const y = pointer_event.clientY - offset_y + 4
  return { x, y }
}

/** Add hover pointer to an info object for tooltip placement. */
export function with_hover_pointer<T extends { pointer?: { x: number; y: number } }>(
  info: Omit<T, `pointer`>,
  raw_event: unknown,
  container_rect: DOMRect | null | undefined,
): T {
  const ptr = get_hover_pointer(raw_event, container_rect)
  return { ...info, pointer: ptr ?? undefined } as T
}

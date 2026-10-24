// Cooperative wheel zoom for embedded 3D viewers. A page stacking viewers would otherwise
// hijack its own scroll whenever the pointer crosses one: every canvas zooms on any wheel.
// Here a plain wheel over an idle viewer scrolls the page and flashes a hint, ⌘/Ctrl + wheel
// (and trackpad pinch, which browsers deliver as ctrl+wheel) always zooms, and a click, drag
// or keyboard focus inside the viewer activates it so plain wheels zoom until the pointer
// leaves, Esc or a click elsewhere. Fullscreen viewers always zoom. Double-click is not used:
// it already resets the camera (Structure, ChemPotDiagram3D) or copies an entry (convex hulls).
import { host } from '#lib/host.js'
import { getContext, mount, setContext, unmount } from 'svelte'
import WheelZoomHint from './WheelZoomHint.svelte'

export const WHEEL_ZOOM_HINT_MS = 1500
// A wheel this soon after one that reached the page continues that page scroll: a viewer it
// carries under a still cursor stays quiet instead of every viewer flashing its hint in turn
export const PAGE_SCROLL_GAP_MS = 150
// Last wheel to reach the document: blocked wheels stop propagating, so this was a page scroll
// (or a zoom, after which a quiet viewer is no loss). One listener per gate, removed with it.
let page_wheel_at = -Infinity

export class WheelZoomGate {
  active = false
  hint_visible = $state(false)
  // Pointer over the viewer or focus inside it: reveals hover-only chrome like the gizmo
  #pointer_in = $state(false)
  #focus_in = $state(false)
  get engaged(): boolean {
    return this.#pointer_in || this.#focus_in
  }
  // Zoomable elements inside the viewer (OrbitControls' dom element, a hull canvas) and whether
  // each zooms at all right now (zoom_speed = 0 disables it, so a hint would mislead)
  readonly #surfaces = new Map<Element, () => boolean>()
  #hint_timer: ReturnType<typeof setTimeout> | undefined
  // set while an Escape is dispatched: a popover it closes hands focus back to its trigger
  // inside the viewer, which must not re-activate what Escape just deactivated
  #escaping = false

  get hint(): string {
    const modifier = /mac|iphone|ipad|ipod/i.test(navigator.platform) ? `⌘` : `Ctrl`
    const suffix = host.wheel_zoom === `active` ? ` · click to interact` : ``
    return `${modifier} + scroll to zoom${suffix}`
  }

  // Returns the unregister callback, a no-op once `element` was registered again
  register_surface = (element: Element, zoomable: () => boolean = () => true) => {
    this.#surfaces.set(element, zoomable)
    return () => {
      if (this.#surfaces.get(element) === zoomable) this.#surfaces.delete(element)
    }
  }

  // Attach to the viewer's root, which also renders the hint. The capture-phase listener runs
  // before OrbitControls' own (on the canvas wrapper) or a hull canvas's handler: stopping a
  // blocked wheel there keeps it from zooming, and leaving the default unprevented lets the
  // page scroll. Plain addEventListener, not svelte's `on`, which defers wheel and pointer
  // listeners a microtask.
  attach = (root: HTMLElement): (() => void) => {
    const controller = new AbortController()
    const { signal } = controller
    const hint = mount(WheelZoomHint, { target: root, props: { gate: this } })
    const on_page_wheel = (event: WheelEvent) => (page_wheel_at = event.timeStamp)
    document.addEventListener(`wheel`, on_page_wheel, { passive: true, signal })
    const on_wheel = (event: WheelEvent): void => {
      const mode = host.wheel_zoom
      if (mode === `always` || event.ctrlKey || event.metaKey) return
      // the root's own document or shadow root: in a shadow tree (the notebook widget),
      // document.fullscreenElement is retargeted to the shadow host
      const { fullscreenElement } = root.getRootNode() as Document | ShadowRoot
      if (fullscreenElement?.contains(root) || (mode === `active` && this.active)) return
      // Wheels over panes, legends or a nested viewer's canvas are not this gate's to block. At
      // the root, the target is retargeted into its tree, so contains() holds in a shadow root.
      const { target } = event
      const surface = [...this.#surfaces].find(
        ([element]) => target instanceof Node && element.contains(target),
      )
      if (!surface?.[1]()) return
      event.stopPropagation()
      // a sideways swipe is no attempt to zoom, and a scroll already under way goes on
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (sideways || event.timeStamp - page_wheel_at < PAGE_SCROLL_GAP_MS) {
        on_page_wheel(event)
        return
      }
      this.hint_visible = true
      clearTimeout(this.#hint_timer)
      this.#hint_timer = setTimeout(() => (this.hint_visible = false), WHEEL_ZOOM_HINT_MS)
    }
    root.addEventListener(`wheel`, on_wheel, { capture: true, passive: true, signal })
    // Keyboard focus only: a click already activated, and a window regaining focus re-fires
    // focusin on a viewer clicked long ago, which would then zoom the next page scroll
    // Focus state is written a microtask later: removing a focused element (a pane closing)
    // fires focusout synchronously inside Svelte's update, where writing state is an error
    const set_focus_in = (focus_in: boolean) =>
      queueMicrotask(() => {
        if (!signal.aborted) this.#focus_in = focus_in
      })
    const on_focusin = ({ target }: FocusEvent) => {
      set_focus_in(true)
      if (this.#escaping || !(target instanceof Element)) return
      if (target.matches(`:focus-visible`)) this.active = true
    }
    root.addEventListener(`focusin`, on_focusin, { signal })
    // Tabbing on past the viewer leaves it (a click elsewhere has no relatedTarget here and
    // is handled by pointerdown below)
    const on_focusout = ({ relatedTarget }: FocusEvent) => {
      if (relatedTarget instanceof Node && root.contains(relatedTarget)) return
      set_focus_in(false)
      if (relatedTarget instanceof Node) this.active = false
    }
    root.addEventListener(`focusout`, on_focusout, { signal })
    // touch and pen without hover leave right after every tap, before any wheel could follow
    const on_pointerleave = ({ pointerType }: PointerEvent) => {
      this.#pointer_in = false
      if (pointerType === `mouse`) this.active = false
    }
    root.addEventListener(`pointerleave`, on_pointerleave, { signal })
    root.addEventListener(`pointerenter`, () => (this.#pointer_in = true), { signal })
    // capture: a pane closing on Esc may stop the key before it bubbles up
    const on_keydown = ({ key }: KeyboardEvent): void => {
      if (key !== `Escape`) return
      this.active = false
      // the popover's handler refocuses its trigger during this same dispatch
      this.#escaping = true
      queueMicrotask(() => (this.#escaping = false))
    }
    document.addEventListener(`keydown`, on_keydown, { capture: true, signal })
    // A click or drag inside activates, one elsewhere deactivates (composedPath, not target,
    // which a shadow root like the notebook widget's retargets to its host)
    const on_pointerdown = (event: PointerEvent) =>
      (this.active = event.composedPath().includes(root))
    document.addEventListener(`pointerdown`, on_pointerdown, { capture: true, signal })
    return () => {
      controller.abort()
      clearTimeout(this.#hint_timer)
      this.active = false
      this.hint_visible = false
      this.#pointer_in = false
      this.#focus_in = false
      void unmount(hint)
    }
  }
}

const WHEEL_ZOOM_GATE = Symbol(`wheel-zoom-gate`)

// In a viewer host, during init: provide the gate its scenes' zoom surfaces register with and
// return its attachment, to {@attach} to the viewer root
export const wheel_zoom_gate = (): WheelZoomGate['attach'] =>
  setContext(WHEEL_ZOOM_GATE, new WheelZoomGate()).attach

// In a scene, during init: register `element` (once mounted) as a surface of the enclosing
// gate. Without a gate (a scene composed into a custom Canvas) every wheel zooms, as before.
export function wheel_zoom_surface(
  element: () => Element | null | undefined,
  zoomable?: () => boolean,
): void {
  const gate = getContext<WheelZoomGate | undefined>(WHEEL_ZOOM_GATE)
  if (!gate) return
  $effect(() => {
    const node = element()
    return node ? gate.register_surface(node, zoomable) : undefined
  })
}

// In a scene, during init: whether the enclosing viewer is hovered or focused, for chrome shown
// only then. Without a gate (a scene composed into a custom Canvas) it always is.
export function viewer_engaged(): () => boolean {
  const gate = getContext<WheelZoomGate | undefined>(WHEEL_ZOOM_GATE)
  return () => gate?.engaged ?? true
}

// Automatic browser-environment setup. Domain fixtures belong in setup.ts and are only
// loaded by tests that explicitly import them.
import { clear_text_metrics_cache } from '$lib/plot/core/text-metrics'
import { beforeEach, vi } from 'vitest'

// happy-dom implements `nodeName` per subclass and its base Node.prototype getter returns ''.
// DOMPurify >= 3.4.13 reads nodeName through that base getter (so a clobbering child named
// "nodeName" cannot shadow it), which makes every element look like an unknown tag here and
// the sanitizer strip all markup. Dispatch the base getter to the subclass getter instead;
// browsers and jsdom define it once on Node.prototype and need nothing. Delete once
// https://github.com/capricorn86/happy-dom/issues/2182 is fixed (its NodeIterator also stops
// after a removal, https://github.com/capricorn86/happy-dom/issues/2310, which DOMPurify's
// element-dropping paths hit; the sanitizer tests only exercise ours with allowed markup).
const node_proto = globalThis.Node?.prototype
const base_node_name =
  node_proto && Object.getOwnPropertyDescriptor(node_proto, `nodeName`)?.get
if (node_proto && base_node_name) {
  Object.defineProperty(node_proto, `nodeName`, {
    configurable: true,
    get(this: Node): string {
      for (
        let proto = Object.getPrototypeOf(this);
        proto && proto !== node_proto;
        proto = Object.getPrototypeOf(proto)
      ) {
        const getter = Object.getOwnPropertyDescriptor(proto, `nodeName`)?.get
        if (getter) return getter.call(this)
      }
      return base_node_name.call(this)
    },
  })
}

// Node 22+ has a built-in localStorage Proxy that lacks the standard Storage
// API (getItem/setItem/etc). Vitest's populateGlobal skips overriding globals
// already present unless explicitly allowlisted — localStorage isn't.
// Replace with happy-dom's spec-compliant Storage when methods are missing.
if (typeof localStorage === `undefined` || typeof localStorage.getItem !== `function`) {
  const { Storage } = await import(`happy-dom`)
  Object.defineProperty(globalThis, `localStorage`, {
    value: new Storage(),
    writable: true,
    configurable: true,
  })
}

// happy-dom does not implement the Popover API used by svelte-widgets 1.6.
for (const method of [`showPopover`, `hidePopover`] as const) {
  if (!(method in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      value: () => undefined,
    })
  }
}

// Suppress Three.js multiple instances warning in tests
const original_warn = console.warn
console.warn = (...args: unknown[]) => {
  const message = String(args[0])
  if (message.includes(`Multiple instances of Three.js`)) return
  original_warn(...args)
}

beforeEach(() => {
  document.body.innerHTML = ``
  localStorage.clear()
  // Text measurement (and the tick layouts keyed on its revision) is memoised across calls, so
  // cases stubbing canvas text metrics differently (or not at all) would otherwise read each
  // other's widths.
  clear_text_metrics_cache()
  // Mock clientWidth/clientHeight (happy-dom has no layout engine, returns 0 by default)
  Object.defineProperty(HTMLElement.prototype, `clientWidth`, {
    get: () => 800,
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, `clientHeight`, {
    get: () => 600,
    configurable: true,
  })
})

// ResizeObserver mock: report a useful initial size and allow tests to trigger later
// measurements after changing an observed element's dimensions.
const resize_observers: TestResizeObserver[] = []
export const get_resize_observer_count = (): number => resize_observers.length
class TestResizeObserver implements ResizeObserver {
  readonly observed_elements = new Set<Element>()
  constructor(private readonly callback: ResizeObserverCallback) {
    resize_observers.push(this)
  }
  notify(element: Element): void {
    const { clientWidth: width, clientHeight: height } = element
    this.callback(
      [{ target: element, contentRect: { width, height } } as ResizeObserverEntry],
      this,
    )
  }
  observe(element: Element): void {
    if (!resize_observers.includes(this)) resize_observers.push(this)
    this.observed_elements.add(element)
    queueMicrotask(() => {
      if (this.observed_elements.has(element)) this.notify(element)
    })
  }
  unobserve(element: Element): void {
    this.observed_elements.delete(element)
  }
  disconnect(): void {
    this.observed_elements.clear()
    const observer_idx = resize_observers.indexOf(this)
    if (observer_idx !== -1) resize_observers.splice(observer_idx, 1)
  }
}
export const trigger_resize_observer = (element: Element): void => {
  for (const observer of resize_observers) {
    if (observer.observed_elements.has(element)) observer.notify(element)
  }
}
globalThis.ResizeObserver = TestResizeObserver

// IntersectionObserver mock: happy-dom ships a constructor whose callback never fires, so
// visibility-gated code (create_pulse_animation) can't be exercised. Report visible on observe
// as a real browser does, and let tests dispatch later verdicts. One callback per element is
// enough — production attaches a single observer per wrapper.
const intersection_callbacks = new Map<Element, IntersectionObserverCallback>()
// The verdict each element last received, so re-observing replays it rather than declaring the
// element visible again. Without this the initial report lands a microtask after observe() and
// overwrites any verdict the test delivered in the meantime, quietly un-hiding the element.
const last_verdict = new WeakMap<Element, boolean>()
export const trigger_intersection = (target: Element, isIntersecting: boolean): void => {
  const callback = intersection_callbacks.get(target)
  // loud rather than a silent no-op: an unobserved target means the test is asserting nothing
  if (!callback) throw new Error(`no IntersectionObserver is observing the given element`)
  last_verdict.set(target, isIntersecting)
  callback(
    [{ target, isIntersecting } as IntersectionObserverEntry],
    null as never, // the observer argument, which no caller under test reads
  )
}
globalThis.IntersectionObserver = class {
  readonly #observed = new Set<Element>()
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    this.#observed.add(target)
    intersection_callbacks.set(target, this.callback)
    queueMicrotask(() => {
      // a later observer may have taken this target over before the microtask ran
      if (intersection_callbacks.get(target) !== this.callback) return
      trigger_intersection(target, last_verdict.get(target) ?? true)
    })
  }
  unobserve(target: Element): void {
    this.#release(target)
    this.#observed.delete(target)
  }
  disconnect(): void {
    for (const target of this.#observed) this.#release(target)
    this.#observed.clear()
  }
  // Only drop the registration while it is still ours. The map holds one callback per element,
  // so deleting blindly lets one observer unregister another's and silence its notifications.
  #release(target: Element): void {
    if (intersection_callbacks.get(target) === this.callback)
      intersection_callbacks.delete(target)
  }
} as unknown as typeof IntersectionObserver

// Mock Web Animations API for Svelte transitions (not available in jsdom)
// The mock immediately triggers onfinish to complete transitions synchronously
Element.prototype.animate = vi.fn().mockImplementation(() => {
  const animation = {
    onfinish: null as (() => void) | null,
    cancel: vi.fn(),
    finish: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    reverse: vi.fn(),
    commitStyles: vi.fn(),
    persist: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
  // Call onfinish in next microtask to simulate animation completion
  queueMicrotask(() => animation.onfinish?.())
  return animation
})

// Mock getAnimations for Svelte's animate:flip directive (not available in happy-dom)
Element.prototype.getAnimations = vi.fn().mockReturnValue([])

globalThis.matchMedia = vi.fn().mockImplementation((media_query) => ({
  matches: false,
  media: media_query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

// Mock clipboard API for testing
Object.defineProperty(navigator, `clipboard`, {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
})

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// theme-detection.ts only pulls these from matterviz; mock them so the test
// needs neither the built library nor the (CI-uninstalled) extension deps.
vi.mock(`matterviz/colors`, () => ({ luminance: () => 1 }))
vi.mock(`matterviz/theme`, () => ({ COLOR_THEMES: { light: `light`, dark: `dark` } }))
vi.mock(`matterviz/theme/themes`, () => ({}))

let live_observers = 0
const observers: FakeMutationObserver[] = []
const observed_targets: Node[] = []

class FakeMutationObserver {
  disconnected = false
  constructor(public cb: MutationCallback) {
    live_observers += 1
    observers.push(this)
  }
  observe(target: Node): void {
    observed_targets.push(target)
  }
  disconnect(): void {
    if (this.disconnected) return
    this.disconnected = true
    live_observers -= 1
  }
  takeRecords(): MutationRecord[] {
    return []
  }
}

let prefers_dark = false

beforeEach(() => {
  live_observers = 0
  observers.length = 0
  observed_targets.length = 0
  prefers_dark = false
  globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver
  globalThis.matchMedia = ((query: string) => ({
    matches: query.includes(`dark`) ? prefers_dark : !prefers_dark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia
  vi.resetModules() // fresh module-singleton state per test
})

afterEach(() => {
  document.body.innerHTML = ``
})

const make_shadow_element = (): { host: HTMLElement; inner: HTMLElement } => {
  const host = document.createElement(`div`)
  document.body.append(host)
  const inner = document.createElement(`div`)
  host.attachShadow({ mode: `open` }).append(inner)
  return { host, inner }
}

const trigger_dom_mutation = (): void => {
  const record = { type: `attributes`, attributeName: `class` } as unknown as MutationRecord
  for (const observer of observers) {
    if (!observer.disconnected) observer.cb([record], observer as unknown as MutationObserver)
  }
}

describe(`watch_theme lifecycle`, () => {
  test(`Bug 2: every widget's Shadow DOM host is observed, not just the first`, async () => {
    const { watch_theme } = await import(`../../extensions/anywidget/theme-detection`)
    const { host: host_a, inner: inner_a } = make_shadow_element()
    const { host: host_b, inner: inner_b } = make_shadow_element()

    watch_theme(inner_a, () => {})
    watch_theme(inner_b, () => {})

    expect(observed_targets).toContain(host_a)
    expect(observed_targets).toContain(host_b) // would FAIL with the old early-return
  })

  test(`Bug 1: shared observers are disconnected once the last widget is gone`, async () => {
    const { watch_theme } = await import(`../../extensions/anywidget/theme-detection`)
    const { inner: inner_a } = make_shadow_element()
    const { inner: inner_b } = make_shadow_element()

    const dispose_a = watch_theme(inner_a, () => {})
    const dispose_b = watch_theme(inner_b, () => {})

    expect(live_observers).toBe(3) // 1 shared doc observer + 2 per-element shadow observers
    dispose_a()
    expect(live_observers).toBe(2) // a's shadow observer gone; shared survives for b
    dispose_b()
    expect(live_observers).toBe(0) // b's shadow observer + shared doc observer all gone
  })

  test(`debounces mutations and notifies every current widget, never a stale/disposed one`, async () => {
    vi.useFakeTimers()
    try {
      const { watch_theme } = await import(`../../extensions/anywidget/theme-detection`)
      const el_a = document.createElement(`div`)
      const el_b = document.createElement(`div`)
      document.body.append(el_a, el_b)
      const seen_a: string[] = []
      const seen_b: string[] = []
      const dispose_a = watch_theme(el_a, (theme) => seen_a.push(theme))
      watch_theme(el_b, (theme) => seen_b.push(theme))

      prefers_dark = true // flip system preference, then signal a burst of changes
      trigger_dom_mutation()
      trigger_dom_mutation()
      trigger_dom_mutation()
      // debounce: a burst collapses into one pending timer (old code queued 3)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(20) // past the debounce window
      expect(vi.getTimerCount()).toBe(0) // timer cleared after it fires
      // both widgets react -- the old code only re-checked the first element's closure
      expect(seen_a).toEqual([`dark`])
      expect(seen_b).toEqual([`dark`])

      // after disposing A, a further change must not touch its (stale) callback
      dispose_a()
      prefers_dark = false
      trigger_dom_mutation()
      vi.advanceTimersByTime(20)
      expect(seen_a).toEqual([`dark`]) // unchanged: A no longer notified
      expect(seen_b).toEqual([`dark`, `light`])
    } finally {
      vi.useRealTimers()
    }
  })
})

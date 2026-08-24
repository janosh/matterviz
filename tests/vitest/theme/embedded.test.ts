// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Isolate watcher behavior from palette data and theme registration side effects.
// Black (and transparent black, which is_dark_color must filter out first) read as dark.
vi.mock(`$lib/colors`, () => ({
  perceived_brightness: (color: string) =>
    [`rgba(0,0,0,0)`, `rgb(0,0,0)`, `#000`].includes(color.replaceAll(` `, ``)) ? 0 : 1,
}))
vi.mock(`$lib/theme`, () => ({ COLOR_THEMES: { light: `light`, dark: `dark` } }))
vi.mock(`$lib/theme/themes.mjs`, () => ({}))

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
  globalThis.MutationObserver = FakeMutationObserver
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
  document.body.className = ``
  document.documentElement.removeAttribute(`style`)
  delete document.documentElement.dataset.theme
  globalThis.jupyterlab = undefined
  globalThis.MATTERVIZ_THEMES = undefined
  globalThis.MATTERVIZ_CSS_MAP = undefined
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
    if (!observer.disconnected) observer.cb([record], observer)
  }
}

describe(`embedded theme helpers`, () => {
  test(`prefers a shadow host theme over document and system indicators`, async () => {
    const { detect_parent_theme } = await import(`$lib/theme/embedded`)
    document.body.classList.add(`light`)
    const { host, inner } = make_shadow_element()
    host.dataset.theme = `dark`

    expect(detect_parent_theme(inner)).toBe(`dark`)
  })

  // A declared marker further up the hierarchy beats colour sniffing lower down: a shadow host
  // (marimo cell) with its own panel background inside a data-theme page takes the page's
  // theme. Regression: each ancestor used to be sniffed before the walk reached the marker
  test.each([
    [`dark`, `#fff`, `light`],
    [`light`, `#000`, `dark`],
  ] as const)(
    `data-theme=%s ancestor beats a %s shadow host background`,
    async (declared, host_bg, sniffed) => {
      const { detect_parent_theme } = await import(`$lib/theme/embedded`)
      const page = document.createElement(`div`)
      page.dataset.theme = declared
      document.body.append(page)
      const host = document.createElement(`div`)
      host.style.backgroundColor = host_bg
      page.append(host)
      const inner = document.createElement(`div`)
      host.attachShadow({ mode: `open` }).append(inner)

      expect(detect_parent_theme(inner)).toBe(declared)
      // without a declared marker above, the host's own background decides
      delete page.dataset.theme
      expect(detect_parent_theme(inner)).toBe(sniffed)
    },
  )

  // Host signals must beat the OS preference: a dark JupyterLab on a light OS is dark.
  // Regression: matchMedia used to be consulted before the host branches, making them dead.
  test.each([
    [`<html data-theme>`, () => (document.documentElement.dataset.theme = `dark`)],
    [`<body class>`, () => document.body.classList.add(`vscode-dark`)],
    [
      `JupyterLab shell dataset`,
      () => {
        globalThis.jupyterlab = {
          application: { shell: { dataset: { theme: `JupyterLab Dark` } } },
        }
      },
    ],
  ])(`%s overrides a light system preference`, async (_label, apply_host_signal) => {
    prefers_dark = false
    apply_host_signal()
    const { detect_parent_theme } = await import(`$lib/theme/embedded`)
    expect(detect_parent_theme()).toBe(`dark`)
  })

  // A plain page background is weaker than the OS preference (a site styling its body dark on
  // a light OS is not a themed host); it only decides when matchMedia is unavailable
  test(`document background decides only when matchMedia is unavailable`, async () => {
    prefers_dark = false
    document.documentElement.style.backgroundColor = `#000`
    const { detect_parent_theme } = await import(`$lib/theme/embedded`)
    expect(detect_parent_theme()).toBe(`light`)
    globalThis.matchMedia = undefined as unknown as typeof matchMedia
    expect(detect_parent_theme()).toBe(`dark`)
  })

  // A host that declares `color-scheme` in CSS has stated its theme through the standard API;
  // it outranks the OS preference like a class marker does, and `light dark` means light
  test.each([
    [`dark`, true, `dark`],
    [`light`, true, `light`],
    [`light dark`, true, `light`],
    [`normal`, true, `dark`], // nothing declared: the OS preference decides
  ])(`reads a declared color-scheme %j`, async (scheme, prefers, expected) => {
    prefers_dark = prefers
    document.documentElement.style.colorScheme = scheme
    const { detect_parent_theme } = await import(`$lib/theme/embedded`)
    expect(detect_parent_theme()).toBe(expected)
    // and on a shadow host, where it beats the host's own background colour
    const { host, inner } = make_shadow_element()
    host.style.colorScheme = scheme
    host.style.backgroundColor = `#000`
    expect(detect_parent_theme(inner)).toBe(scheme === `normal` ? `dark` : expected)
  })

  test(`falls back to the system preference when the host declares nothing`, async () => {
    prefers_dark = true
    const { detect_parent_theme } = await import(`$lib/theme/embedded`)
    expect(detect_parent_theme()).toBe(`dark`)
  })

  test(`ignores transparent rgba document backgrounds`, async () => {
    globalThis.matchMedia = undefined as unknown as typeof matchMedia
    document.body.style.backgroundColor = `rgba(0, 0, 0, 0)`
    document.documentElement.style.backgroundColor = `rgba(0, 0, 0, 0)`
    const { detect_parent_theme } = await import(`$lib/theme/embedded`)

    expect(detect_parent_theme()).toBe(`light`)
  })

  test.each([
    [false, `:root`],
    [true, `:host`],
  ])(`generates theme CSS with shadow=%s`, async (is_shadow_dom, selector) => {
    const { get_theme_css } = await import(`$lib/theme/embedded`)
    globalThis.MATTERVIZ_THEMES = { dark: { surface: `#000` } }
    globalThis.MATTERVIZ_CSS_MAP = { surface: `--surface-bg` }

    // color-scheme first: the library's light-dark() tokens and native form controls follow it
    expect(get_theme_css(`dark`, is_shadow_dom)).toBe(
      `${selector} {\n\tcolor-scheme: dark;\n\t--surface-bg: #000;\n}`,
    )
  })
})

describe(`watch_theme lifecycle`, () => {
  test(`Bug 2: every widget's Shadow DOM host is observed, not just the first`, async () => {
    const { watch_theme } = await import(`$lib/theme/embedded`)
    const { host: host_a, inner: inner_a } = make_shadow_element()
    const { host: host_b, inner: inner_b } = make_shadow_element()

    watch_theme(inner_a, () => {})
    watch_theme(inner_b, () => {})

    expect(observed_targets).toContain(host_a)
    expect(observed_targets).toContain(host_b) // would FAIL with the old early-return
  })

  test(`Bug 1: shared observers are disconnected once the last widget is gone`, async () => {
    const { watch_theme } = await import(`$lib/theme/embedded`)
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
      const { watch_theme } = await import(`$lib/theme/embedded`)
      const el_a = document.createElement(`div`)
      const el_b = document.createElement(`div`)
      document.body.append(el_a, el_b)
      const seen_a: string[] = []
      const seen_b: string[] = []
      const dispose_a = watch_theme(el_a, (theme) => seen_a.push(theme))
      const dispose_b = watch_theme(el_b, (theme) => seen_b.push(theme))

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

      // disposing the last widget with a notify still pending clears the timer
      trigger_dom_mutation()
      expect(vi.getTimerCount()).toBe(1)
      dispose_b()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

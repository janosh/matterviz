// @vitest-environment happy-dom
import { detect_parent_theme, watch_theme } from '$lib/theme/embedded'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Isolate watcher behavior from palette data and theme registration side effects.
// Black (and transparent black, which is_dark_color must filter out first) read as dark.
vi.mock(`$lib/colors`, () => ({
  perceived_brightness: (color: string) =>
    [`rgba(0,0,0,0)`, `rgb(0,0,0)`, `#000`].includes(color.replaceAll(` `, ``)) ? 0 : 1,
}))

const observers: FakeMutationObserver[] = []
const observed_targets: Node[] = []
const live_observers = () => observers.filter((obs) => !obs.disconnected).length

class FakeMutationObserver {
  disconnected = false
  constructor(public cb: MutationCallback) {
    observers.push(this)
  }
  observe(target: Node): void {
    observed_targets.push(target)
  }
  disconnect(): void {
    this.disconnected = true
  }
  takeRecords(): MutationRecord[] {
    return []
  }
}

let prefers_dark = false

beforeEach(() => {
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
})

afterEach(() => {
  document.body.innerHTML = ``
  document.body.className = ``
  document.body.removeAttribute(`style`)
  document.documentElement.removeAttribute(`style`)
  delete document.documentElement.dataset.theme
  globalThis.jupyterlab = undefined
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

describe(`detect_parent_theme`, () => {
  // The nearest statement wins, so a shadow host beats <body>, which beats <html>
  test(`prefers the nearest declaration: shadow host over body over html`, () => {
    document.documentElement.dataset.theme = `dark`
    document.body.classList.add(`light`)
    const { host, inner } = make_shadow_element()
    expect(detect_parent_theme()).toBe(`light`)
    expect(detect_parent_theme(inner)).toBe(`light`)
    host.dataset.theme = `dark`
    expect(detect_parent_theme(inner)).toBe(`dark`)
  })

  // A declared marker anywhere up a shadow host's chain decides; a host's own background
  // colour is never sniffed, so without a marker the OS preference applies
  test.each([
    [`dark`, `#fff`],
    [`light`, `#000`],
  ] as const)(
    `data-theme=%s ancestor beats a %s shadow host background`,
    (declared, host_bg) => {
      prefers_dark = declared === `light`
      const { host, inner } = make_shadow_element()
      host.style.backgroundColor = host_bg
      const page = document.createElement(`div`)
      page.dataset.theme = declared
      page.append(host)
      document.body.append(page)

      expect(detect_parent_theme(inner)).toBe(declared)
      delete page.dataset.theme
      expect(detect_parent_theme(inner)).toBe(prefers_dark ? `dark` : `light`)
    },
  )

  // Marker words are matched as tokens, so every host convention reads the same way
  test.each([
    [`vscode-dark`, `dark`],
    [`jp-theme-light`, `light`],
    [`theme-dark`, `dark`],
    [`JupyterLab Dark`, `dark`], // title-cased theme names count too
    [`darkmode`, null], // not a token: no statement
  ])(`reads the class marker %j as %j`, (class_name, expected) => {
    prefers_dark = expected !== `dark` // the OS says the opposite, to prove the marker decides
    document.body.className = class_name
    expect(detect_parent_theme()).toBe(expected ?? (prefers_dark ? `dark` : `light`))
  })

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
    [
      `JupyterLab layout colour`,
      () => document.documentElement.style.setProperty(`--jp-layout-color0`, `#000`),
    ],
  ])(`%s overrides a light system preference`, (_label, apply_host_signal) => {
    prefers_dark = false
    apply_host_signal()
    expect(detect_parent_theme()).toBe(`dark`)
  })

  // A host that declares `color-scheme` in CSS has stated its theme through the standard API;
  // it outranks the OS preference like a class marker does, and `light dark` means light
  test.each([
    [`dark`, true, `dark`],
    [`light`, true, `light`],
    [`light dark`, true, `light`],
    [`only dark`, false, `dark`], // `only` is a modifier, not a scheme
    [`normal`, true, `dark`], // nothing declared: the OS preference decides
  ])(`reads a declared color-scheme %j`, (scheme, prefers, expected) => {
    prefers_dark = prefers
    document.documentElement.style.colorScheme = scheme
    expect(detect_parent_theme()).toBe(expected)
    // and on a shadow host
    const { host, inner } = make_shadow_element()
    host.style.colorScheme = scheme
    expect(detect_parent_theme(inner)).toBe(expected)
  })
})

describe(`watch_theme lifecycle`, () => {
  test(`every widget observes the roots and its own Shadow DOM host, and disposes only its own`, () => {
    const { host: host_a, inner: inner_a } = make_shadow_element()
    const { host: host_b, inner: inner_b } = make_shadow_element()

    const dispose_a = watch_theme(inner_a, () => {})
    const dispose_b = watch_theme(inner_b, () => {})

    expect(observed_targets).toEqual(
      [host_a, host_b].flatMap((host) => [document.documentElement, document.body, host]),
    )
    expect(live_observers()).toBe(2)
    dispose_a()
    expect(live_observers()).toBe(1)
    dispose_b()
    expect(live_observers()).toBe(0)
  })

  test(`reports the theme on subscribe, debounces mutations and stops notifying a disposed widget`, () => {
    vi.useFakeTimers()
    try {
      const el_a = document.createElement(`div`)
      const el_b = document.createElement(`div`)
      document.body.append(el_a, el_b)
      const seen_a: string[] = []
      const seen_b: string[] = []
      const dispose_a = watch_theme(el_a, (theme) => seen_a.push(theme))
      const dispose_b = watch_theme(el_b, (theme) => seen_b.push(theme))
      expect(seen_a).toEqual([`light`]) // the initial theme arrives synchronously
      expect(vi.getTimerCount()).toBe(0)

      prefers_dark = true // flip system preference, then signal a burst of changes
      trigger_dom_mutation()
      trigger_dom_mutation()
      trigger_dom_mutation()
      expect(vi.getTimerCount()).toBe(2) // one pending re-detect per widget, not per mutation
      vi.advanceTimersByTime(20) // past the debounce window
      expect(vi.getTimerCount()).toBe(0)
      expect(seen_a).toEqual([`light`, `dark`])
      expect(seen_b).toEqual([`light`, `dark`])

      // after disposing A, a further change must not touch its (stale) callback
      dispose_a()
      prefers_dark = false
      trigger_dom_mutation()
      vi.advanceTimersByTime(20)
      expect(seen_a).toEqual([`light`, `dark`])
      expect(seen_b).toEqual([`light`, `dark`, `light`])

      // a mutation with nothing changed does not notify; disposing with a pending re-detect clears it
      trigger_dom_mutation()
      vi.advanceTimersByTime(20)
      expect(seen_b).toEqual([`light`, `dark`, `light`])
      trigger_dom_mutation()
      expect(vi.getTimerCount()).toBe(1)
      dispose_b()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

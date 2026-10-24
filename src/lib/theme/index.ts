// Theme system: every color token is defined once in app.css as light-dark(), so the whole
// runtime contract is two attributes on the root — `data-theme` (names the palette, incl. the
// white/black high-contrast overrides) and `color-scheme` (what light-dark() and native form
// controls resolve against).
import { persisted_choice, storage_set } from 'svelte-widgets/storage'

const is_browser = typeof window !== `undefined`
export const THEME_STORAGE_KEY = `matterviz-theme`

// Core theme constants
export const COLOR_THEMES = {
  light: `light`,
  dark: `dark`,
  white: `white`,
  black: `black`,
} as const

export const AUTO_THEME = `auto` as const

export type ThemeType = `light` | `dark`
export const THEME_TYPE: Record<ThemeName, ThemeType> = {
  [COLOR_THEMES.light]: `light`,
  [COLOR_THEMES.dark]: `dark`,
  [COLOR_THEMES.white]: `light`,
  [COLOR_THEMES.black]: `dark`,
}

export type ThemeName = keyof typeof COLOR_THEMES
export type ThemeMode = ThemeName | typeof AUTO_THEME

interface ThemeOption {
  value: ThemeMode
  label: string
  icon: string
}

// Theme options for UI components
export const THEME_OPTIONS: ThemeOption[] = [
  { value: COLOR_THEMES.light, label: `Light`, icon: `☀️` },
  { value: COLOR_THEMES.dark, label: `Dark`, icon: `🌙` },
  { value: COLOR_THEMES.white, label: `White`, icon: `⚪` },
  { value: COLOR_THEMES.black, label: `Black`, icon: `⚫` },
  { value: AUTO_THEME, label: `Auto`, icon: `🔄` },
]

// Type guards and utilities
export const is_valid_theme_name = (value: string): value is ThemeName =>
  Object.hasOwn(COLOR_THEMES, value)

export const is_valid_theme_mode = (value: string): value is ThemeMode =>
  value === AUTO_THEME || is_valid_theme_name(value)

// Theme preference management (best-effort storage: SSR, disabled or full stores fall back to auto)
const THEME_MODES = THEME_OPTIONS.map((option) => option.value)
export const get_theme_preference = (): ThemeMode =>
  persisted_choice(THEME_STORAGE_KEY, THEME_MODES, AUTO_THEME)

export const save_theme_preference = (mode: ThemeMode): void =>
  storage_set(THEME_STORAGE_KEY, mode)

// The scheme an element declares through the CSS API, or null when it names none. `only` is a
// modifier (`only dark`), not a scheme. A value listing BOTH schemes (`light dark`) defers to
// the user's preference rather than declaring light. Since `color-scheme` inherits and
// matterviz's own app.css sets `light dark` on `:root, :host`, returning null there lets the
// walk continue to a real statement (jp-theme-dark / vscode-dark markers, then the OS).
export const declared_color_scheme = (element: Element): ThemeType | null => {
  const tokens = (getComputedStyle(element).colorScheme?.trim().split(/\s+/) ?? []).filter(
    (token) => token !== `only`,
  )
  if (tokens.includes(`light`) && tokens.includes(`dark`)) return null
  const [scheme] = tokens
  return scheme === `dark` || scheme === `light` ? scheme : null
}

// Nearest theme `read` finds at or above `element`, crossing shadow roots. Browsers inherit the
// computed color-scheme so the first read normally answers; the walk covers DOMs that don't and
// the host markers embedded widgets scan for
export const nearest_declared = (
  element: Element | null,
  read: (element: Element) => ThemeType | null = declared_color_scheme,
): ThemeType | null => {
  for (let current = element; current;) {
    const scheme = read(current)
    if (scheme) return scheme
    const root = current.getRootNode()
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
  }
  return null
}

// Not svelte-widgets' system_preference: that lives in a runes module (`theme.svelte.js`
// holds a module-level $state), which workers and the embedded theme bootstrap load
// without the Svelte compiler and so cannot import.
export const get_system_mode = (): ThemeType =>
  is_browser && globalThis.matchMedia?.(`(prefers-color-scheme: dark)`).matches
    ? COLOR_THEMES.dark
    : COLOR_THEMES.light

// === Theme change watching ===
// A theme change lands on data-theme + inline color-scheme (apply_theme_to_dom) or on class
// (JupyterLab, VS Code, marimo) of the element or any ancestor, or comes from the OS preference.
// One MutationObserver serves every subscriber: it watches the union of their ancestor chains
// (crossing shadow hosts) with old values recorded, so a write that changes nothing, or a style
// write touching neither color-scheme nor a property the subscriber reads (a layout variable,
// left/top), notifies no one. Per-subscriber observers on every ancestor used to re-run every
// color read in the subtree on each such write.
type ThemeSubscriber = {
  chain: ReadonlySet<Node>
  props: ReadonlySet<string>
  on_change: () => void
}
const THEME_ATTRIBUTES = [`class`, `data-theme`, `style`]
const subscribers = new Set<ThemeSubscriber>()
const observed_counts = new Map<Node, number>()
let theme_observer: MutationObserver | undefined
let scheme_query: MediaQueryList | undefined
let rebuild_queued = false
let style_parser: CSSStyleDeclaration | undefined

// The element, its ancestors and, across shadow boundaries, the shadow hosts above it
export const theme_ancestors = (node: Element): Element[] => {
  const chain: Element[] = []
  for (let current: Element | null = node; current;) {
    chain.push(current)
    const root = current.getRootNode()
    current =
      current.parentElement ??
      (typeof ShadowRoot !== `undefined` && root instanceof ShadowRoot ? root.host : null)
  }
  return chain
}

const style_declarations = (css_text: string | null): Map<string, string> => {
  style_parser ??= document.createElement(`div`).style
  style_parser.cssText = css_text ?? ``
  const declarations = new Map<string, string>()
  for (let idx = 0; idx < style_parser.length; idx++) {
    const name = style_parser.item(idx)
    declarations.set(name, style_parser.getPropertyValue(name))
  }
  return declarations
}

// Properties whose inline value differs between two style attributes
const changed_style_props = (before: string | null, after: string | null): Set<string> => {
  const [old_decls, new_decls] = [style_declarations(before), style_declarations(after)]
  const changed = new Set<string>()
  for (const [name, value] of old_decls) if (new_decls.get(name) !== value) changed.add(name)
  for (const name of new_decls.keys()) if (!old_decls.has(name)) changed.add(name)
  return changed
}

const handle_theme_records = (records: MutationRecord[]): void => {
  const notified = new Set<ThemeSubscriber>()
  for (const { target, attributeName, oldValue } of records) {
    if (!(target instanceof Element) || !attributeName) continue
    const current = target.getAttribute(attributeName)
    if (current === oldValue) continue
    // class and data-theme can restyle every token through the stylesheets; a style write
    // matters through color-scheme (light-dark()) or an inline value a subscriber reads
    const changed = attributeName === `style` ? changed_style_props(oldValue, current) : null
    if (changed?.size === 0) continue
    const any_subscriber = changed === null || changed.has(`color-scheme`)
    for (const subscriber of subscribers) {
      if (notified.has(subscriber) || !subscriber.chain.has(target)) continue
      if (any_subscriber || [...changed].some((name) => subscriber.props.has(name)))
        notified.add(subscriber)
    }
  }
  for (const subscriber of notified) subscriber.on_change()
}

const notify_all = (): void => {
  for (const subscriber of subscribers) subscriber.on_change()
}

const observe_node = (node: Node): void =>
  theme_observer?.observe(node, {
    attributes: true,
    attributeFilter: THEME_ATTRIBUTES,
    attributeOldValue: true,
  })

// MutationObserver has no unobserve: drop nodes no subscriber watches by re-observing the rest,
// after handing over records already queued for them
const rebuild_observer = (): void => {
  rebuild_queued = false
  if (!theme_observer) return
  handle_theme_records(theme_observer.takeRecords())
  theme_observer.disconnect()
  for (const node of observed_counts.keys()) observe_node(node)
}

// Call `on_change` when the theme `node` renders in may have changed: a class or data-theme
// change on it or an ancestor, an inline color-scheme or one of `props` (CSS property or custom
// property names the caller reads) changing there, or the OS preference flipping. Never on
// subscribe. Returns the teardown.
export function watch_theme_changes(
  node: Element,
  on_change: () => void,
  props: Iterable<string> = [],
): () => void {
  if (!is_browser) return () => {}
  theme_observer ??= new MutationObserver(handle_theme_records)
  if (!scheme_query) {
    scheme_query = globalThis.matchMedia?.(`(prefers-color-scheme: dark)`)
    scheme_query?.addEventListener(`change`, notify_all)
  }
  const chain = new Set<Node>(theme_ancestors(node))
  const subscriber: ThemeSubscriber = { chain, props: new Set(props), on_change }
  subscribers.add(subscriber)
  for (const ancestor of chain) {
    const count = observed_counts.get(ancestor) ?? 0
    observed_counts.set(ancestor, count + 1)
    if (count === 0) observe_node(ancestor)
  }
  return () => {
    if (!subscribers.delete(subscriber)) return
    for (const ancestor of chain) {
      const count = (observed_counts.get(ancestor) ?? 1) - 1
      if (count > 0) observed_counts.set(ancestor, count)
      else observed_counts.delete(ancestor)
    }
    if (subscribers.size === 0) {
      theme_observer?.disconnect()
      theme_observer = undefined
      scheme_query?.removeEventListener(`change`, notify_all)
      scheme_query = undefined
      return
    }
    if (rebuild_queued) return
    rebuild_queued = true
    queueMicrotask(rebuild_observer)
  }
}

export const apply_theme_to_dom = (mode: ThemeMode): void => {
  if (!is_browser) return
  const resolved = mode === AUTO_THEME ? get_system_mode() : mode
  // own keys only: `in` also accepts inherited names like `constructor`
  if (!is_valid_theme_name(resolved)) throw new Error(`Invalid theme mode: ${resolved}`)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = THEME_TYPE[resolved]
}

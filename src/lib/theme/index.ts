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
} as const

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
// modifier (`only dark`), not a scheme. A value listing BOTH schemes (`light dark`) states that
// the element supports either and defers to the user's preference - it is not a declaration of
// light, which is how taking the first token read it. Two things went wrong: a page declaring
// `light dark` under a dark OS preference got the light palette, and because `color-scheme`
// inherits and matterviz's own app.css sets `light dark` on `:root, :host`, the very first
// element answered for every embedded widget, so the jp-theme-dark / vscode-dark markers and
// the OS fallback below were never reached. Null lets the walk continue to a real statement.
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

// A theme change lands on data-theme + inline color-scheme (apply_theme_to_dom) or on class
// (JupyterLab, VS Code, marimo), so watch all three plus the OS preference. Callers own their
// node set, any debounce, and whether to notify on subscribe. Returns the teardown.
const THEME_MUTATIONS = { attributes: true, attributeFilter: [`class`, `data-theme`, `style`] }
export function observe_theme_attributes(nodes: Iterable<Node>, on_change: () => void) {
  const observer = new MutationObserver(on_change)
  for (const node of nodes) observer.observe(node, THEME_MUTATIONS)
  const media = globalThis.matchMedia?.(`(prefers-color-scheme: dark)`)
  media?.addEventListener(`change`, on_change)
  return () => {
    observer.disconnect()
    media?.removeEventListener(`change`, on_change)
  }
}

export const apply_theme_to_dom = (mode: ThemeMode): void => {
  if (!is_browser) return
  const resolved = mode === AUTO_THEME ? get_system_mode() : mode
  if (!(resolved in THEME_TYPE)) throw new Error(`Invalid theme mode: ${resolved}`)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = THEME_TYPE[resolved]
}

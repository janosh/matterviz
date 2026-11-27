// Theme system: every color token is defined once in app.css as light-dark(), so the whole
// runtime contract is two attributes on the root — `data-theme` (names the palette, incl. the
// white/black high-contrast overrides) and `color-scheme` (what light-dark() and native form
// controls resolve against).
import { persisted_choice, storage_set } from 'svelte-widgets/browser'
import { type ColorScheme, system_scheme } from 'svelte-widgets/theme-core'

export const THEME_STORAGE_KEY = `matterviz-theme`

// Core theme constants
export const COLOR_THEMES = {
  light: `light`,
  dark: `dark`,
  white: `white`,
  black: `black`,
} as const

export const AUTO_THEME = `auto` as const

export type ThemeType = ColorScheme
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

export const apply_theme_to_dom = (mode: ThemeMode): void => {
  if (typeof document === `undefined`) return
  const resolved = mode === AUTO_THEME ? system_scheme() : mode
  // own keys only: `in` also accepts inherited names like `constructor`
  if (!is_valid_theme_name(resolved)) throw new Error(`Invalid theme mode: ${resolved}`)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = THEME_TYPE[resolved]
}

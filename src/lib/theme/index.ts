// Theme System for MatterViz

const is_browser = typeof window !== `undefined`
const storage_key = `matterviz-theme`

// Core theme constants - single source of truth
export const COLOR_THEMES = {
  light: `light`,
  dark: `dark`,
  white: `white`,
  black: `black`,
} as const

export const AUTO_THEME = `auto` as const

// whether a theme is light or dark
export const THEME_TYPE: Record<ThemeName, `light` | `dark`> = {
  [COLOR_THEMES.light]: `light`,
  [COLOR_THEMES.dark]: `dark`,
  [COLOR_THEMES.white]: `light`,
  [COLOR_THEMES.black]: `dark`,
} as const

// Types
export type ThemeName = keyof typeof COLOR_THEMES
export type ThemeMode = ThemeName | typeof AUTO_THEME

export interface ThemeOption {
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
export const is_valid_theme_mode = (value: string): value is ThemeMode =>
  Object.keys(COLOR_THEMES).includes(value) || value === AUTO_THEME

export const is_valid_theme_name = (value: string): value is ThemeName =>
  Object.keys(COLOR_THEMES).includes(value)

export const resolve_theme_mode = (
  mode: ThemeMode,
  system_preference: typeof COLOR_THEMES.light | typeof COLOR_THEMES.dark =
    COLOR_THEMES.light,
): ThemeName => (mode === AUTO_THEME ? system_preference : mode)

// Global theme objects
declare global {
  var MATTERVIZ_THEMES: Record<string, Record<string, string>> | undefined
  var MATTERVIZ_CSS_MAP: Record<string, string> | undefined
}

// Theme preference management
export const get_theme_preference = (): ThemeMode => {
  if (!is_browser) return AUTO_THEME
  try {
    const saved = localStorage.getItem(storage_key)
    return is_valid_theme_mode(saved || ``) ? saved as ThemeMode : AUTO_THEME
  } catch {
    return AUTO_THEME
  }
}

export const save_theme_preference = (mode: ThemeMode): void => {
  if (!is_browser) return
  try {
    localStorage.setItem(storage_key, mode)
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

// System color scheme
export const get_system_mode = (): typeof COLOR_THEMES.light | typeof COLOR_THEMES.dark =>
  is_browser && matchMedia(`(prefers-color-scheme: dark)`).matches
    ? COLOR_THEMES.dark
    : COLOR_THEMES.light

// DOM manipulation
export const apply_theme_to_dom = (mode: ThemeMode): void => {
  if (!is_browser) return

  const resolved = resolve_theme_mode(mode, get_system_mode())
  const theme = globalThis.MATTERVIZ_THEMES?.[resolved] || {}
  const css_vars = globalThis.MATTERVIZ_CSS_MAP || {}

  const root = document.documentElement
  Object.entries(theme).forEach(([key, value]) => {
    const css_var = css_vars[key as keyof typeof css_vars]
    if (css_var && value && typeof value === `string`) {
      root.style.setProperty(css_var, value)
    }
  })

  root.style.setProperty(`color-scheme`, THEME_TYPE[resolved])
  root.setAttribute(`data-theme`, resolved)
}

// Initialize theme system
export const init_theme = (): void => {
  if (!is_browser) return

  const mode = get_theme_preference()
  apply_theme_to_dom(mode)

  matchMedia(`(prefers-color-scheme: dark)`).addEventListener(
    `change`,
    () => get_theme_preference() === AUTO_THEME && apply_theme_to_dom(AUTO_THEME),
  )
}

// Theme getters
export const light_theme = () => globalThis.MATTERVIZ_THEMES?.[COLOR_THEMES.light] || {}
export const dark_theme = () => globalThis.MATTERVIZ_THEMES?.[COLOR_THEMES.dark] || {}
export const white_theme = () => globalThis.MATTERVIZ_THEMES?.[COLOR_THEMES.white] || {}
export const black_theme = () => globalThis.MATTERVIZ_THEMES?.[COLOR_THEMES.black] || {}
export const get_theme_by_name = (name: ThemeName) =>
  globalThis.MATTERVIZ_THEMES?.[name] || {}

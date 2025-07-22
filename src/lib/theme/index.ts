// Theme System for MatterViz

const is_browser = typeof window !== `undefined`
const storage_key = `matterviz-theme`

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
  system_preference: ThemeType = COLOR_THEMES.light,
): ThemeName => (mode === AUTO_THEME ? system_preference : mode)

// Theme preference management
export const get_theme_preference = (): ThemeMode => {
  if (!is_browser) return AUTO_THEME
  try {
    const saved = localStorage[storage_key]
    return is_valid_theme_mode(saved || ``) ? saved as ThemeMode : AUTO_THEME
  } catch {
    return AUTO_THEME
  }
}

export const save_theme_preference = (mode: ThemeMode): void => {
  try {
    localStorage[storage_key] = mode
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

export const get_system_mode = (): ThemeType =>
  is_browser && matchMedia(`(prefers-color-scheme: dark)`).matches
    ? COLOR_THEMES.dark
    : COLOR_THEMES.light

export const apply_theme_to_dom = (mode: ThemeMode): void => {
  if (!is_browser) return

  const resolved = resolve_theme_mode(mode, get_system_mode())
  if (!resolved || !(resolved in THEME_TYPE)) {
    throw new Error(`Invalid theme mode: ${resolved}`)
  }
  const theme = globalThis.MATTERVIZ_THEMES?.[resolved] || {}
  const css_vars = globalThis.MATTERVIZ_CSS_MAP || {}

  const root = document.documentElement
  Object.entries(theme).forEach(([key, value]) => {
    const css_var = css_vars[key as keyof typeof css_vars]
    if (css_var && value && typeof value === `string`) {
      root.style.setProperty(css_var, value)
    }
  })

  root.setAttribute(`data-theme`, resolved)
  // Set color-scheme to ensure form elements respect the theme
  const color_scheme = THEME_TYPE[resolved]
  root.style.setProperty(`color-scheme`, color_scheme)
}

// Theme getters
export const light_theme = () => globalThis.MATTERVIZ_THEMES?.[COLOR_THEMES.light] || {}
export const dark_theme = () => globalThis.MATTERVIZ_THEMES?.[COLOR_THEMES.dark] || {}
export const white_theme = () => globalThis.MATTERVIZ_THEMES?.[COLOR_THEMES.white] || {}
export const black_theme = () => globalThis.MATTERVIZ_THEMES?.[COLOR_THEMES.black] || {}
export const get_theme_by_name = (name: ThemeName) =>
  globalThis.MATTERVIZ_THEMES?.[name] || {}

// Theme Detection for AnyWidget

import { luminance } from 'matterviz/colors'
import { COLOR_THEMES, type ThemeType } from 'matterviz/theme'
// oxlint-disable-next-line import/no-unassigned-import -- registers built-in themes
import 'matterviz/theme/themes'

// Extend globalThis with our custom properties
declare global {
  var jupyterlab:
    | {
        application?: { shell?: { dataset?: { theme?: string } } }
      }
    | undefined
  var MATTERVIZ_THEMES: Record<string, Record<string, string>> | undefined
  var MATTERVIZ_CSS_MAP: Record<string, string> | undefined
}

let current_theme: ThemeType = `light`
const theme_observers = new Set<(theme_type: ThemeType) => void>()
let mutation_observer: MutationObserver | null = null
let media_query_listener: MediaQueryList | null = null
let media_query_handler: (() => void) | null = null

export function detect_parent_theme(target_element?: HTMLElement): ThemeType {
  try {
    // Check Shadow DOM context
    if (target_element) {
      const root_node = target_element.getRootNode()
      if (root_node !== document && root_node instanceof ShadowRoot) {
        const theme = check_element_hierarchy(root_node.host)
        if (theme) return theme
      }
    }

    // Check document theme indicators
    const theme_classes = [
      `dark-theme`,
      `light-theme`,
      `vscode-dark`,
      `vscode-light`,
      `dark`,
      `light`,
    ]
    for (const cls of theme_classes) {
      if (document.body.classList.contains(cls)) {
        return cls.includes(`dark`) ? `dark` : `light`
      }
    }

    // System preference
    if (globalThis.matchMedia) {
      if (globalThis.matchMedia(`(prefers-color-scheme: dark)`).matches) return `dark`
      if (globalThis.matchMedia(`(prefers-color-scheme: light)`).matches) return `light`
    }

    // Jupyter Lab theme API
    const jupyter_theme = globalThis.jupyterlab?.application?.shell?.dataset?.theme
    if (jupyter_theme) {
      return jupyter_theme.includes(`dark`) ? `dark` : `light`
    }

    // Jupyter CSS custom properties
    const jp_bg = getComputedStyle(document.documentElement).getPropertyValue(
      `--jp-layout-color0`,
    )
    if (jp_bg) {
      const is_dark = is_dark_color(jp_bg)
      if (is_dark !== null) return is_dark ? `dark` : `light`
    }

    // Analyze background colors
    const backgrounds = [
      getComputedStyle(document.body).backgroundColor,
      getComputedStyle(document.documentElement).backgroundColor,
    ]

    for (const bg of backgrounds) {
      const is_dark = is_dark_color(bg)
      if (is_dark !== null) return is_dark ? `dark` : `light`
    }

    return `light`
  } catch (error) {
    console.warn(`Theme detection failed, defaulting to light:`, error)
    return `light`
  }
}

function check_element_hierarchy(element: Element): ThemeType | null {
  let current_element: Element | null = element

  while (current_element) {
    // Check classes
    const class_list = current_element.classList
    if (
      class_list.contains(`dark-theme`) ||
      class_list.contains(`vscode-dark`) ||
      class_list.contains(`dark`)
    )
      return `dark`
    if (
      class_list.contains(`light-theme`) ||
      class_list.contains(`vscode-light`) ||
      class_list.contains(`light`)
    )
      return `light`

    // Check data attributes
    const data_theme = current_element.getAttribute(`data-theme`)
    if (data_theme === `dark`) return `dark`
    if (data_theme === `light`) return `light`

    // Check computed styles
    const computed_style = getComputedStyle(current_element)
    const bg_color = computed_style.backgroundColor
    const text_color = computed_style.color

    if (bg_color && bg_color !== `rgba(0, 0, 0, 0)` && bg_color !== `transparent`) {
      const is_dark = is_dark_color(bg_color)
      if (is_dark !== null) return is_dark ? `dark` : `light`
    }

    if (text_color && text_color !== `rgba(0, 0, 0, 0)` && text_color !== `transparent`) {
      const text_is_dark = is_dark_color(text_color)
      if (text_is_dark !== null) return text_is_dark ? `light` : `dark`
    }

    current_element = current_element.parentElement
  }

  return null
}

function is_dark_color(color: string): boolean | null {
  if (!color || [`transparent`, `initial`, `inherit`].includes(color)) return null
  return luminance(color) < 0.5
}

function notify_theme_change(target_element?: HTMLElement): void {
  const new_theme = detect_parent_theme(target_element)
  if (new_theme !== current_theme) {
    current_theme = new_theme
    theme_observers.forEach((callback) => callback(new_theme))
  }
}

export function setup_theme_watchers(target_element?: HTMLElement): void {
  if (mutation_observer || media_query_listener) return // Avoid duplicates

  try {
    // Watch for DOM changes
    mutation_observer = new MutationObserver((mutations) => {
      if (
        mutations.some(
          (mut) =>
            mut.type === `attributes` &&
            (mut.attributeName === `class` || mut.attributeName === `data-theme`),
        )
      )
        setTimeout(() => notify_theme_change(target_element), 10) // Debounce
    })

    const observe_opts = { attributes: true, attributeFilter: [`class`, `data-theme`] }
    mutation_observer.observe(document.documentElement, observe_opts)
    if (document.body) mutation_observer.observe(document.body, observe_opts)
    // Shadow DOM hosts (e.g. marimo cells) carry the theme class/data-theme but
    // aren't reachable from document.body/documentElement, so observe them too.
    const root_node = target_element?.getRootNode()
    if (root_node instanceof ShadowRoot)
      mutation_observer.observe(root_node.host, observe_opts)

    // Watch system preference changes
    if (globalThis.matchMedia) {
      media_query_listener = globalThis.matchMedia(`(prefers-color-scheme: dark)`)
      media_query_handler = () => notify_theme_change(target_element)
      media_query_listener.addEventListener(`change`, media_query_handler)
    }

    current_theme = detect_parent_theme(target_element) // Set initial theme
  } catch (error) {
    console.warn(`Failed to setup theme watchers:`, error)
  }
}

export function cleanup_theme_watchers(): void {
  mutation_observer?.disconnect()
  mutation_observer = null

  if (media_query_listener && media_query_handler) {
    media_query_listener.removeEventListener(`change`, media_query_handler)
  }
  media_query_listener = null
  media_query_handler = null
  theme_observers.clear()
}

export function on_theme_change(callback: (theme_type: ThemeType) => void): () => void {
  theme_observers.add(callback)
  return () => {
    theme_observers.delete(callback)
  }
}

export function get_theme_css(theme_type: ThemeType, is_shadow_dom = false): string {
  const theme_name = COLOR_THEMES[theme_type]

  // Get theme data (matterviz/themes.js sets this)
  const theme = globalThis.MATTERVIZ_THEMES?.[theme_name]
  const css_map = globalThis.MATTERVIZ_CSS_MAP

  if (!theme || !css_map) {
    console.warn(`Theme data not available, skipping theme application`)
    return ``
  }

  const css_vars = Object.entries(theme)
    .map(([key, value]) => (css_map[key] ? `${css_map[key]}: ${value};` : ``))
    .filter(Boolean)
    .join(`\n\t`)

  // Use :host for Shadow DOM, :root for regular DOM
  const selector = is_shadow_dom ? `:host` : `:root`
  return `${selector} {\n\t${css_vars}\n}`
}

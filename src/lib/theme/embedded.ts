// Theme Detection for Embedded MatterViz Views

import { luminance } from '$lib/colors'
import { COLOR_THEMES, type ThemeType } from '$lib/theme'
// oxlint-disable-next-line import/no-unassigned-import -- registers built-in themes
import '$lib/theme/themes.mjs'

// Extend globalThis with our custom properties
declare global {
  var jupyterlab:
    | {
        application?: { shell?: { dataset?: { theme?: string } } }
      }
    | undefined
}

type ThemeCallback = (theme_type: ThemeType) => void

// Per-element watcher (callback + last-seen theme for dedup + the element's own
// Shadow-host observer). Widgets can mount in different roots with different
// themes, so each is tracked and torn down independently.
const element_watchers = new Map<
  HTMLElement,
  { callback: ThemeCallback; theme: ThemeType; shadow_observer: MutationObserver | null }
>()
// Shared document observer + media-query listener, created with the first widget
// and disconnected with the last (counted via element_watchers.size).
let doc_observer: MutationObserver | null = null
let media_query_listener: MediaQueryList | null = null
// Pending debounce timer shared across all mutation sources; cleared before each
// reschedule so bursts of mutations collapse into a single notify_theme_change.
let notify_timer: ReturnType<typeof setTimeout> | null = null

const observe_opts = { attributes: true, attributeFilter: [`class`, `data-theme`] }

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

function notify_theme_change(): void {
  notify_timer = null
  // Re-detect every element's theme; notify only those whose theme changed.
  for (const [element, watcher] of element_watchers) {
    const new_theme = detect_parent_theme(element)
    if (new_theme !== watcher.theme) {
      watcher.theme = new_theme
      watcher.callback(new_theme)
    }
  }
}

const schedule_notify = () => {
  // Debounce: cancel any pending notify so only the latest mutation burst fires.
  if (notify_timer) clearTimeout(notify_timer)
  notify_timer = setTimeout(notify_theme_change, 10)
}

function on_dom_mutation(mutations: MutationRecord[]): void {
  if (
    mutations.some(
      (mut) =>
        mut.type === `attributes` &&
        (mut.attributeName === `class` || mut.attributeName === `data-theme`),
    )
  )
    schedule_notify()
}

// Register a widget element + its theme-change callback. Returns a disposer that
// removes this element's subscriber and Shadow-host observer and, once the last
// widget is gone, disconnects the shared document/media-query watchers (fixing a
// leak where observers stayed attached for the page's lifetime).
export function watch_theme(target_element: HTMLElement, callback: ThemeCallback): () => void {
  try {
    // Shared document-level + system-preference watchers (created once for all).
    if (!doc_observer) {
      doc_observer = new MutationObserver(on_dom_mutation)
      doc_observer.observe(document.documentElement, observe_opts)
      if (document.body) doc_observer.observe(document.body, observe_opts)
    }
    if (!media_query_listener && globalThis.matchMedia) {
      media_query_listener = globalThis.matchMedia(`(prefers-color-scheme: dark)`)
      media_query_listener.addEventListener(`change`, schedule_notify)
    }

    // Shadow DOM hosts (e.g. marimo cells) carry the theme class/data-theme but
    // aren't reachable from document, so observe each widget's host individually
    // (not just the first widget's).
    let shadow_observer: MutationObserver | null = null
    const root_node = target_element.getRootNode()
    if (root_node instanceof ShadowRoot) {
      shadow_observer = new MutationObserver(on_dom_mutation)
      shadow_observer.observe(root_node.host, observe_opts)
    }

    element_watchers.set(target_element, {
      callback,
      theme: detect_parent_theme(target_element),
      shadow_observer,
    })
  } catch (error) {
    console.warn(`Failed to setup theme watchers:`, error)
  }

  return () => {
    element_watchers.get(target_element)?.shadow_observer?.disconnect()
    element_watchers.delete(target_element)
    if (element_watchers.size > 0) return // other widgets still need shared watchers

    if (notify_timer) {
      clearTimeout(notify_timer) // drop a pending notify; no widgets left to update
      notify_timer = null
    }
    doc_observer?.disconnect()
    doc_observer = null
    media_query_listener?.removeEventListener(`change`, schedule_notify)
    media_query_listener = null
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

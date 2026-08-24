// Theme Detection for Embedded MatterViz Views

import { perceived_brightness } from '$lib/colors'
import type { ThemeType } from '$lib/theme'

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

// Theme declared by an element's own class list / data-theme attribute (JupyterLab,
// VS Code and marimo all mark their roots this way), or null when it carries none
const DARK_MARKERS = [`dark-theme`, `vscode-dark`, `dark`]
const LIGHT_MARKERS = [`light-theme`, `vscode-light`, `light`]
const declared_theme = (element: Element): ThemeType | null => {
  const data_theme = element.getAttribute(`data-theme`)
  if (DARK_MARKERS.some((cls) => element.classList.contains(cls)) || data_theme === `dark`)
    return `dark`
  if (LIGHT_MARKERS.some((cls) => element.classList.contains(cls)) || data_theme === `light`)
    return `light`
  return null
}

// The standard signal: a host that declares `color-scheme: dark` (or `light`) in CSS has told
// the browser its theme, and that is what every light-dark() token on the page resolves
// against. Computed values are `normal` when nothing declared it and may list both schemes
// (`light dark`), in which case the first is the preferred one.
const declared_color_scheme = (element: Element): ThemeType | null => {
  const scheme = getComputedStyle(element).colorScheme?.trim().split(/\s+/)[0]
  return scheme === `dark` || scheme === `light` ? scheme : null
}

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

    // Hosts mark either root: VS Code/marimo put the theme class on <body>, JupyterLab and
    // many sites on <html> (data-theme); a declared color-scheme is the same statement made
    // through the CSS API, so it ranks with them
    const declared =
      declared_theme(document.documentElement) ??
      declared_theme(document.body) ??
      declared_color_scheme(document.documentElement) ??
      declared_color_scheme(document.body)
    if (declared) return declared

    // Jupyter Lab theme API
    const jupyter_theme = globalThis.jupyterlab?.application?.shell?.dataset?.theme
    // Theme names are title-cased (`JupyterLab Dark`), so match case-insensitively
    if (jupyter_theme) return /dark/i.test(jupyter_theme) ? `dark` : `light`

    // Jupyter CSS custom properties
    const jp_bg = getComputedStyle(document.documentElement).getPropertyValue(
      `--jp-layout-color0`,
    )
    if (jp_bg) {
      const is_dark = is_dark_color(jp_bg)
      if (is_dark !== null) return is_dark ? `dark` : `light`
    }

    // Explicit host signals above win over the OS preference (dark JupyterLab on a light OS
    // is dark), but the OS preference is still an explicit choice, so it beats the generic
    // page-background sniff below: a page styling its body must not override the user's OS theme
    if (globalThis.matchMedia) {
      if (globalThis.matchMedia(`(prefers-color-scheme: dark)`).matches) return `dark`
      if (globalThis.matchMedia(`(prefers-color-scheme: light)`).matches) return `light`
    }

    // Weakest signal: the page's own background color
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

// Theme of a shadow host and its ancestors. A declared marker anywhere up the chain (the
// page's `data-theme`, a host's theme class) beats colour sniffing at every level: a shadow
// host styled with its own light panel background must not out-vote the dark page above it
function check_element_hierarchy(element: Element): ThemeType | null {
  const chain: Element[] = []
  for (let current: Element | null = element; current; current = current.parentElement) {
    chain.push(current)
  }
  for (const current of chain) {
    const declared = declared_theme(current) ?? declared_color_scheme(current)
    if (declared) return declared
  }
  for (const current of chain) {
    const computed_style = getComputedStyle(current)
    const is_dark = is_dark_color(computed_style.backgroundColor)
    if (is_dark !== null) return is_dark ? `dark` : `light`
    const text_is_dark = is_dark_color(computed_style.color)
    if (text_is_dark !== null) return text_is_dark ? `light` : `dark`
  }
  return null
}

function is_dark_color(color: string): boolean | null {
  if (!color || [`transparent`, `rgba(0, 0, 0, 0)`, `initial`, `inherit`].includes(color)) {
    return null
  }
  return perceived_brightness(color) < 0.5
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

// The one rule an embedded widget needs on top of app.css: every token there is light-dark(),
// so pinning the root's color-scheme to the detected theme themes the whole widget (and the
// browser's own menus, inputs and scrollbars) regardless of the host page's scheme.
export const get_theme_css = (theme_type: ThemeType, is_shadow_dom = false): string =>
  `${is_shadow_dom ? `:host` : `:root`} { color-scheme: ${theme_type}; }`

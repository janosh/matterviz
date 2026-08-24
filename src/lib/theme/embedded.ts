// Theme Detection for Embedded MatterViz Views

import { perceived_brightness } from '$lib/colors'
import { declared_color_scheme, type ThemeType } from '$lib/theme'

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

const observe_opts = { attributes: true, attributeFilter: [`class`, `data-theme`, `style`] }

// A theme the host states about itself, read through the standard API first — a declared
// `color-scheme` is what every light-dark() token on the page resolves against — and then
// through the marker conventions hosts use: a `dark`/`light` word in a class token or in
// `data-theme` (JupyterLab `jp-theme-dark`, VS Code `vscode-dark`, marimo `dark`/`data-theme`).
// Computed color-scheme is `normal` when nothing declared it and may list both schemes
// (`light dark`), in which case the first is the preferred one.
const THEME_WORD = /(?:^|[\s_-])(?<scheme>dark|light)(?=$|[\s_-])/i
const declared_theme = (element: Element): ThemeType | null => {
  const scheme = declared_color_scheme(element)
  if (scheme) return scheme
  const markers = `${element.className} ${element.getAttribute(`data-theme`) ?? ``}`
  const word = THEME_WORD.exec(markers)?.groups?.scheme.toLowerCase()
  return word === `dark` || word === `light` ? word : null
}

export function detect_parent_theme(target_element?: HTMLElement): ThemeType {
  try {
    // A widget in a shadow tree (marimo cells) reads its host chain first: a marker anywhere
    // up the chain (the page's data-theme, a host's theme class) is the nearest statement
    const root_node = target_element?.getRootNode()
    for (
      let current: Element | null = root_node instanceof ShadowRoot ? root_node.host : null;
      current;
      current = current.parentElement
    ) {
      const declared = declared_theme(current)
      if (declared) return declared
    }
    // Hosts mark either root: VS Code/marimo put the theme class on <body>, JupyterLab and
    // many sites on <html>
    const declared = declared_theme(document.documentElement) ?? declared_theme(document.body)
    if (declared) return declared

    // JupyterLab: the shell's theme name, or the layout colour its theme CSS defines
    const jupyter_theme = globalThis.jupyterlab?.application?.shell?.dataset?.theme
    if (jupyter_theme) return /dark/i.test(jupyter_theme) ? `dark` : `light`
    const jp_bg = getComputedStyle(document.documentElement).getPropertyValue(
      `--jp-layout-color0`,
    )
    if (jp_bg.trim()) return perceived_brightness(jp_bg) < 0.5 ? `dark` : `light`

    // Nothing declared: the OS preference. A page that merely styles its body dark has not
    // stated a theme, so its colours are not sniffed.
    return globalThis.matchMedia?.(`(prefers-color-scheme: dark)`).matches ? `dark` : `light`
  } catch (error) {
    console.warn(`Theme detection failed, defaulting to light:`, error)
    return `light`
  }
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
        [`class`, `data-theme`, `style`].includes(mut.attributeName ?? ``),
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

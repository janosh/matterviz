// Theme detection for embedded MatterViz views
import { is_concrete_color, perceived_brightness } from '#lib/colors/index.js'
import type { ThemeType } from '#lib/theme/index.js'
import {
  declared_color_scheme,
  get_system_mode,
  nearest_declared,
  watch_theme_changes,
} from '#lib/theme/index.js'

declare global {
  var jupyterlab:
    | {
        application?: { shell?: { dataset?: { theme?: string } } }
      }
    | undefined
}

// A theme the host states about itself, read through the standard API first — a declared
// `color-scheme` is what every light-dark() token on the page resolves against — and then
// through the marker conventions hosts use: a `dark`/`light` word in a class token or in
// `data-theme` (JupyterLab `jp-theme-dark`, VS Code `vscode-dark`, marimo `dark`/`data-theme`).
// Computed color-scheme is `normal` when nothing declared it, and listing both schemes
// (`light dark`) declares neither, so both fall through to the markers.
const THEME_WORD = /(?:^|[\s_-])(?<scheme>dark|light)(?=$|[\s_-])/i
const declared_theme = (element: Element): ThemeType | null => {
  const scheme = declared_color_scheme(element)
  if (scheme) return scheme
  const markers = `${element.className} ${element.getAttribute(`data-theme`) ?? ``}`
  const word = THEME_WORD.exec(markers)?.groups?.scheme.toLowerCase()
  return word === `dark` || word === `light` ? word : null
}

export function detect_parent_theme(target_element?: HTMLElement): ThemeType {
  // The nearest statement above the widget decides: its shadow host chain (marimo cells), then
  // <body> and <html> (VS Code/marimo mark body, JupyterLab and many sites html). The widget's
  // own element is skipped since it carries the color-scheme this detection sets.
  const root_node = target_element?.getRootNode()
  const start = root_node instanceof ShadowRoot ? root_node.host : document.body
  const declared = nearest_declared(start, declared_theme)
  if (declared) return declared

  // JupyterLab: the shell's theme name, or the layout colour its theme CSS defines
  const jupyter_theme = globalThis.jupyterlab?.application?.shell?.dataset?.theme
  if (jupyter_theme) return /dark/i.test(jupyter_theme) ? `dark` : `light`
  const jp_bg = getComputedStyle(document.documentElement)
    .getPropertyValue(`--jp-layout-color0`)
    .trim()
  // a value no color parser reads (a theme's color function) says nothing, rather than
  // throwing out of detection and every watch_theme notification after it
  if (is_concrete_color(jp_bg)) return perceived_brightness(jp_bg) < 0.5 ? `dark` : `light`

  // Nothing declared: the OS preference. A page that merely styles its body dark has not
  // stated a theme, so its colours are not sniffed.
  return get_system_mode()
}

// Report the widget's host theme now and whenever it changes — the theme attributes of <html>,
// <body> and the widget's shadow host (marimo cells), or the OS preference — with mutation
// bursts debounced into one re-detect. Each widget owns its observers, so the returned disposer
// tears down exactly its own.
export function watch_theme(
  target_element: HTMLElement,
  callback: (theme: ThemeType) => void,
): () => void {
  let theme: ThemeType | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const notify = () => {
    timer = undefined
    const next = detect_parent_theme(target_element)
    if (next !== theme) callback((theme = next))
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(notify, 10)
  }
  // its ancestor chain covers <html>, <body> and the shadow host (marimo cells)
  const stop_observing = watch_theme_changes(target_element, schedule)
  // notify on subscribe: callers have no other way to read the host theme
  notify()
  return () => {
    clearTimeout(timer)
    stop_observing()
  }
}

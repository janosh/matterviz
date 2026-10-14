// What the app embedding MatterViz can do beyond the page. A desktop webview may accept an
// element's fullscreen request without its window following (a Tauri window), so such a
// host sets `host.fullscreen = false` once at startup, before mounting viewers, and no viewer or
// plot offers the toggle or its `f` shortcut. A viewer's bindable `fullscreen` prop is then inert:
// nothing requests or exits fullscreen for it.
export const host = { fullscreen: true }

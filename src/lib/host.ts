// What the app embedding MatterViz can do beyond the page. `fullscreen` starts as the Fullscreen
// API's own verdict: an iframe without allow="fullscreen" (a VS Code webview) cannot fullscreen
// an element, so no viewer or plot offers the toggle or its `f` shortcut there, and a viewer's
// bindable `fullscreen` prop is reset to false. A host that knows better sets it once at
// startup, before mounting viewers.
// undefined without a DOM (SSR) or a Fullscreen API (test DOMs), where nothing says no
const fullscreen_enabled: boolean | undefined = globalThis.document?.fullscreenEnabled
export const host = { fullscreen: fullscreen_enabled ?? true }

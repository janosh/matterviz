// What the app embedding MatterViz can do beyond the page. A host that knows better sets these
// once at startup, before mounting viewers.

// When a plain mouse wheel zooms the app's 3D viewers (see WheelZoomGate): `active` (default)
// once a viewer is clicked or focused, `modifier` never (only ⌘/Ctrl + wheel), `always` on every
// wheel, for hosts whose viewer fills the window (no page to scroll)
export type WheelZoomMode = `always` | `active` | `modifier`

// undefined without a DOM (SSR) or a Fullscreen API (test DOMs), where nothing says no
const fullscreen_enabled: boolean | undefined = globalThis.document?.fullscreenEnabled
export const host: { fullscreen: boolean; wheel_zoom: WheelZoomMode } = {
  // starts as the Fullscreen API's own verdict: an iframe without allow="fullscreen" (a VS Code
  // webview) cannot fullscreen an element, so no viewer or plot offers the toggle or its `f`
  // shortcut there, and a viewer's bindable `fullscreen` prop is reset to false
  fullscreen: fullscreen_enabled ?? true,
  wheel_zoom: `active`,
}

// What the app embedding MatterViz can do beyond the page. A desktop webview may accept an
// element's fullscreen request without its window following (Hive's Tauri window), so such a
// host turns `fullscreen` off once at startup, before mounting viewers, and no viewer or plot
// offers the toggle or its `f` shortcut.
export interface HostCapabilities {
  fullscreen: boolean
}

export const host: HostCapabilities = { fullscreen: true }

export const configure_host = (capabilities: Partial<HostCapabilities>): void => {
  Object.assign(host, capabilities)
}

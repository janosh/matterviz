import { get_page_background } from '$lib/colors'

// Setup fullscreen effect with optional callback for when fullscreen state changes
export function setup_fullscreen_effect(
  fullscreen: boolean,
  wrapper: HTMLDivElement | undefined,
  on_fullscreen_change?: (entering_fullscreen: boolean) => void,
): void {
  if (typeof window === `undefined`) return

  if (fullscreen && !document.fullscreenElement && wrapper?.isConnected) {
    wrapper.requestFullscreen().catch(console.error)
    on_fullscreen_change?.(true)
  } else if (!fullscreen && document.fullscreenElement) {
    document.exitFullscreen()
    on_fullscreen_change?.(false)
  }
}

// Set CSS variable to page background when entering fullscreen mode
export function set_fullscreen_bg(
  wrapper: HTMLDivElement | undefined,
  fullscreen: boolean,
  css_var_name: string,
): void {
  if (!wrapper || !fullscreen) return
  const bg = get_page_background()
  if (bg) wrapper.style.setProperty(css_var_name, bg)
}

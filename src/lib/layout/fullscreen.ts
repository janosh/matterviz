import { get_page_background } from '$lib/colors'

// Toggle fullscreen mode for a wrapper element
export async function toggle_fullscreen(wrapper?: HTMLDivElement): Promise<void> {
  if (!wrapper) return
  try {
    if (!document.fullscreenElement) {
      await wrapper.requestFullscreen()
    } else if (document.fullscreenElement === wrapper) {
      await document.exitFullscreen()
    } else {
      await document.exitFullscreen()
      await wrapper.requestFullscreen()
    }
  } catch (error) {
    console.error(`Fullscreen operation failed:`, error)
  }
}

export type InfoItem = Readonly<{
  label: string
  value: string | number
  key?: string
  tooltip?: string
}>

// Setup fullscreen effect with optional callback for when fullscreen state changes
export function setup_fullscreen_effect(
  fullscreen: boolean,
  wrapper: HTMLDivElement | undefined,
  on_fullscreen_change?: (entering_fullscreen: boolean) => void,
): void {
  if (typeof window === `undefined`) return

  if (fullscreen && !document.fullscreenElement && wrapper?.isConnected) {
    wrapper
      .requestFullscreen()
      .then(() => on_fullscreen_change?.(true))
      .catch((error) => {
        console.error(`Fullscreen request failed:`, error)
        on_fullscreen_change?.(false)
      })
  } else if (!fullscreen && document.fullscreenElement === wrapper) {
    // Only exit if this wrapper is the fullscreen element (avoids exiting another component's session)
    document
      .exitFullscreen()
      .then(() => on_fullscreen_change?.(false))
      .catch((error) => {
        console.error(`Exit fullscreen failed:`, error)
        on_fullscreen_change?.(false)
      })
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

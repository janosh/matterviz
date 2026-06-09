import { set_fullscreen_bg } from './fullscreen'

// Two-way sync between a bindable `fullscreen` flag and the browser fullscreen state
// for a wrapper element, plus the fullscreen background CSS var. Creates $effects, so
// it must be called during component init. Shared by BrillouinZone, FermiSurface and
// Structure viewers.
// TODO Trajectory.svelte still has its own fullscreen variant — migrate it here.
export function sync_fullscreen(opts: {
  get_wrapper: () => HTMLDivElement | undefined
  get_fullscreen: () => boolean
  set_fullscreen: (fullscreen: boolean) => void
  bg_css_var: string // e.g. `--struct-bg-fullscreen`
  on_request_error?: (err: Error) => void // called when requestFullscreen rejects
  on_change?: (fullscreen: boolean) => void // called on document fullscreenchange
}): void {
  // Flag -> browser: enter/exit fullscreen when the bound flag changes
  $effect(() => {
    if (typeof window === `undefined`) return
    const wrapper = opts.get_wrapper()
    const fullscreen = opts.get_fullscreen()
    const fs_el = document.fullscreenElement
    if (fullscreen && fs_el !== wrapper && wrapper) {
      wrapper.requestFullscreen().catch((err) => {
        console.error(err)
        opts.on_request_error?.(err)
      })
    } else if (!fullscreen && fs_el === wrapper) void document.exitFullscreen()
    set_fullscreen_bg(wrapper, fullscreen, opts.bg_css_var)
  })

  // Browser -> flag: track fullscreenchange events (covers Esc key, programmatic exit, ...)
  $effect(() => {
    if (typeof document === `undefined`) return () => {}
    const handler = () => {
      const is_fullscreen = Boolean(document.fullscreenElement)
      opts.set_fullscreen(is_fullscreen)
      opts.on_change?.(is_fullscreen)
    }
    document.addEventListener(`fullscreenchange`, handler)
    return () => document.removeEventListener(`fullscreenchange`, handler)
  })
}

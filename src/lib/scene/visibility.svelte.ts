// Reactive page visibility, used to pause per-frame scene work (auto-rotation)
// while the page can't be seen. Desktop embedders like Tauri often disable
// background throttling to keep timers alive, which would otherwise leave every
// auto-rotating WebGL canvas burning GPU in hidden/minimized windows.
export const page_visibility = $state({ visible: true })

if (typeof document !== `undefined`) {
  page_visibility.visible = document.visibilityState === `visible`
  document.addEventListener(`visibilitychange`, () => {
    page_visibility.visible = document.visibilityState === `visible`
  })
}

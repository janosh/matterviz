import ViewerPane from '$lib/overlays/ViewerPane.svelte'
import { flushSync, mount, tick, unmount } from 'svelte'
import { Expand } from 'svelte-widgets/icons'
import { expect, onTestFinished, test, vi } from 'vitest'
import { doc_query, fire, mock_fullscreen, trigger_resize_observer } from '../setup'

test.each([
  [-600, -300, 4, 4],
  [700, 600, 676, 496],
  [4, 8, 580, 143],
])(
  `manual placement survives resizing; fullscreen keeps it visible (delta=%s,%s)`,
  async (delta_x, delta_y, fullscreen_left, fullscreen_top) => {
    mock_fullscreen()
    vi.stubGlobal(`innerWidth`, 1000)
    vi.stubGlobal(`innerHeight`, 700)
    const container = document.createElement(`div`)
    container.style.cssText = `position: relative; container-type: inline-size`
    document.body.append(container)
    vi.spyOn(container, `getBoundingClientRect`).mockReturnValue(
      new DOMRect(100, 100, 800, 500),
    )
    Object.defineProperties(container, {
      clientWidth: { value: 800 },
      offsetWidth: { value: 800 },
      offsetHeight: { value: 500 },
    })
    const component = mount(ViewerPane, {
      target: container,
      props: { pane_name: `export`, class_prefix: `test-export`, closed_icon: Expand },
    })
    onTestFinished(async () => {
      await unmount(component)
      container.remove()
      vi.unstubAllGlobals()
    })
    flushSync()
    const pane = doc_query(`.test-export-pane`)
    const toggle = doc_query<HTMLButtonElement>(`.test-export-toggle`)
    const control_tab = doc_query(`.test-export-pane > .control-tab`)
    const handle = doc_query(`.test-export-pane .drag-handle`)
    Object.defineProperties(pane, {
      offsetParent: { get: () => container },
      offsetLeft: { get: () => Math.round(Number(pane.style.left.slice(0, -2))) },
      offsetTop: { get: () => Math.round(Number(pane.style.top.slice(0, -2))) },
    })
    let scale = 1
    let origin = 100
    vi.spyOn(pane, `getBoundingClientRect`).mockImplementation(
      () =>
        new DOMRect(
          origin + Number(pane.style.left.slice(0, -2)) * scale,
          origin + Number(pane.style.top.slice(0, -2)) * scale,
          300 * scale,
          200 * scale,
        ),
    )
    vi.spyOn(control_tab, `getBoundingClientRect`).mockImplementation(() => {
      const { right, top } = pane.getBoundingClientRect()
      return new DOMRect(right, top, 20 * scale, 60 * scale)
    })
    vi.spyOn(toggle, `getBoundingClientRect`).mockReturnValue(new DOMRect(870, 100, 30, 30))
    await fire(toggle)
    trigger_resize_observer(container)
    const anchored_left = pane.offsetLeft
    expect(control_tab.getBoundingClientRect().right).toBe(896)
    // A delayed anchor update can follow the last ResizeObserver delivery.
    pane.style.left = `800px`
    await vi.waitFor(() => expect(control_tab.getBoundingClientRect().right).toBe(896))

    const pointer = (type: string, client_x: number, client_y = 150) =>
      fire(
        handle,
        new PointerEvent(type, {
          bubbles: true,
          isPrimary: true,
          button: 0,
          pointerId: 1,
          clientX: client_x,
          clientY: client_y,
        }),
      )
    await pointer(`pointerdown`, 890)
    await pointer(`pointermove`, 890 + delta_x, 150 + delta_y)
    const manual_left = `${anchored_left + delta_x}px`
    expect(pane.style.left).toBe(manual_left)
    await pointer(`pointerup`, 890 + delta_x, 150 + delta_y)
    await tick()
    expect(pane.style.left).toBe(manual_left)

    trigger_resize_observer(container)
    trigger_resize_observer(pane)
    await tick()
    expect(pane.style.left).toBe(manual_left)
    await fire(toggle)
    await fire(toggle)
    expect(pane.style.left).toBe(manual_left)

    // A different viewer entering fullscreen must not reposition this pane.
    const other_viewer = document.createElement(`div`)
    document.body.append(other_viewer)
    await other_viewer.requestFullscreen()
    await tick()
    expect(pane.style.left).toBe(manual_left)
    other_viewer.remove()

    // Fullscreen may belong to an outer viewer, as with Structure inside Trajectory.
    await document.body.requestFullscreen()
    await vi.waitFor(() => {
      const { left, top } = pane.getBoundingClientRect()
      expect([left, top]).toEqual([fullscreen_left, fullscreen_top])
      expect(control_tab.getBoundingClientRect().right).toBeLessThanOrEqual(996)
      expect(pane.getBoundingClientRect().bottom).toBeLessThanOrEqual(696)
    })
    // Responsive props can rewrite inline styles after the initial fullscreen layout.
    pane.style.left = `1100px`
    pane.style.top = `800px`
    await vi.waitFor(() => {
      const { left, top } = pane.getBoundingClientRect()
      expect([left, top]).toEqual([676, 496])
    })
    // Fractional insets under a scaled ancestor must converge, not bounce between rounded
    // offsetLeft/Top values on every MutationObserver delivery.
    scale = 3
    origin = 100.75
    vi.mocked(container.getBoundingClientRect).mockReturnValue(
      new DOMRect(origin, origin, 800 * scale, 500 * scale),
    )
    pane.style.left = `-1000.75px`
    pane.style.top = `-1000.75px`
    await vi.waitFor(() => {
      const { left, top } = pane.getBoundingClientRect()
      expect([left, top]).toEqual([4, 4])
    })
    scale = 1
    origin = 100
    vi.mocked(container.getBoundingClientRect).mockReturnValue(new DOMRect(100, 100, 800, 500))
    const corrected = [pane.style.left, pane.style.top]
    await document.exitFullscreen()
    trigger_resize_observer(container)
    await tick()
    expect([pane.style.left, pane.style.top]).toEqual(corrected)
    expect(pane.querySelector(`.reset-button`)).not.toBeNull()
    pane.style.left = `2000px`
    trigger_resize_observer(pane)
    await tick()
    expect(pane.style.left).toBe(`2000px`)

    await fire(doc_query(`.test-export-pane .reset-button`))
    trigger_resize_observer(container)
    expect(pane.style.left).toBe(`${anchored_left}px`)
    expect(pane.querySelector(`.reset-button`)).toBeNull()
  },
)

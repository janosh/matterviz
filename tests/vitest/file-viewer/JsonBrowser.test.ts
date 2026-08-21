import JsonBrowser from '$lib/file-viewer/JsonBrowser.svelte'
import { flushSync, mount, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { doc_query } from '../setup'

const table_rows = (start: number, count: number) =>
  Array.from({ length: count }, (_, idx) => ({ x: start + idx, y: start + idx + 1 }))

const drag_event = (type: `dragover` | `drop`, payload = ``): DragEvent => {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperties(event, {
    clientX: { value: 5 },
    clientY: { value: 50 },
    dataTransfer: { value: { dropEffect: `none`, getData: () => payload } },
  })
  return event
}

const mouse_down = (element: Element): void => {
  element.dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true, clientX: 5 }))
  flushSync()
}

test(`replacing a drag finalizes the previous drag without clearing the new one`, async () => {
  vi.stubGlobal(`requestIdleCallback`, (callback: IdleRequestCallback) =>
    window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0),
  )
  vi.stubGlobal(`cancelIdleCallback`, window.clearTimeout)
  vi.stubGlobal(`requestAnimationFrame`, () => 1)
  const component = mount(JsonBrowser, {
    target: document.body,
    props: {
      value: {
        first: table_rows(1, 3),
        second: table_rows(4, 4),
      },
    },
  })
  onTestFinished(async () => {
    await unmount(component)
    vi.unstubAllGlobals()
  })

  const first_chip = await vi.waitFor(() => doc_query(`.renderable-chip`))
  first_chip.click()

  const panel = await vi.waitFor(() => doc_query(`.viz-panel`))
  vi.spyOn(panel, `getBoundingClientRect`).mockReturnValue(new DOMRect(0, 0, 100, 100))
  const canvas = doc_query(`.canvas`)
  canvas.dispatchEvent(drag_event(`dragover`))
  canvas.dispatchEvent(
    drag_event(`drop`, JSON.stringify({ data_path: `second`, detected_type: `table` })),
  )

  const split_divider = await vi.waitFor(() => doc_query(`.split-divider`))
  mouse_down(split_divider)
  expect(split_divider.classList.contains(`active`)).toBe(true)

  mouse_down(doc_query(`.sidebar-divider`))
  expect(split_divider.classList.contains(`active`)).toBe(false)
  const browser = doc_query(`.json-browser`)
  expect(browser.classList.contains(`dragging`)).toBe(true)

  globalThis.dispatchEvent(new MouseEvent(`mouseup`))
  flushSync()
  expect(browser.classList.contains(`dragging`)).toBe(false)
})

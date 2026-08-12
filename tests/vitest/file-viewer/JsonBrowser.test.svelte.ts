import JsonBrowser from '$lib/file-viewer/JsonBrowser.svelte'
import { flushSync, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { doc_query } from '../setup'

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

test(`replacing a drag finalizes the previous drag without clearing the new one`, async () => {
  vi.stubGlobal(`requestIdleCallback`, (callback: IdleRequestCallback) => {
    return setTimeout(
      () => callback({ didTimeout: false, timeRemaining: () => 50 }),
      0,
    ) as unknown as number
  })
  vi.stubGlobal(`cancelIdleCallback`, (handle: number) => clearTimeout(handle))
  vi.stubGlobal(`requestAnimationFrame`, () => 1)
  vi.stubGlobal(`cancelAnimationFrame`, vi.fn())
  const component = mount(JsonBrowser, {
    target: document.body,
    props: {
      value: {
        first: [
          { x: 1, y: 2 },
          { x: 2, y: 3 },
          { x: 3, y: 4 },
        ],
        second: [
          { x: 4, y: 5 },
          { x: 5, y: 6 },
          { x: 6, y: 7 },
          { x: 7, y: 8 },
        ],
      },
    },
  })
  onTestFinished(async () => {
    await unmount(component)
    vi.unstubAllGlobals()
  })

  const first_chip = await vi.waitFor(() => {
    const chip = [...document.querySelectorAll<HTMLButtonElement>(`.renderable-chip`)].find(
      (node) => node.textContent?.includes(`Table`) && node.textContent.includes(`first`),
    )
    expect(chip).toBeDefined()
    return chip as HTMLButtonElement
  })
  first_chip.click()
  await tick()

  const panel = await vi.waitFor(() => doc_query(`.viz-panel`))
  vi.spyOn(panel, `getBoundingClientRect`).mockReturnValue(new DOMRect(0, 0, 100, 100))
  const canvas = doc_query(`.canvas`)
  canvas.dispatchEvent(drag_event(`dragover`))
  canvas.dispatchEvent(
    drag_event(`drop`, JSON.stringify({ data_path: `second`, detected_type: `table` })),
  )
  await tick()

  const split_divider = await vi.waitFor(() => doc_query(`.split-divider`))
  split_divider.dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true, clientX: 5 }))
  flushSync()
  expect(split_divider.classList.contains(`active`)).toBe(true)

  doc_query(`.sidebar-divider`).dispatchEvent(
    new MouseEvent(`mousedown`, { bubbles: true, clientX: 5 }),
  )
  flushSync()
  expect(split_divider.classList.contains(`active`)).toBe(false)
  expect(doc_query(`.json-browser`).classList.contains(`dragging`)).toBe(true)

  globalThis.dispatchEvent(new MouseEvent(`mouseup`))
  flushSync()
  expect(doc_query(`.json-browser`).classList.contains(`dragging`)).toBe(false)
})

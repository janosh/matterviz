import {
  deferred_fetch_responses,
  get_resize_observer_count,
  mock_fullscreen,
  trigger_resize_observer,
} from './setup'
import { expect, test, vi } from 'vitest'

test.each([
  [0, 0],
  [320, 240],
])(`ResizeObserver respects %d×%d and re-registers once`, async (width, height) => {
  const initial_count = get_resize_observer_count()
  const callback = vi.fn()
  const observer = new ResizeObserver(callback)
  expect(get_resize_observer_count()).toBe(initial_count + 1)

  observer.disconnect()
  expect(get_resize_observer_count()).toBe(initial_count)

  const element = document.createElement(`div`)
  Object.defineProperties(element, {
    clientWidth: { value: width },
    clientHeight: { value: height },
  })
  observer.observe(element)
  expect(get_resize_observer_count()).toBe(initial_count + 1)
  await Promise.resolve()
  expect(callback).toHaveBeenCalledExactlyOnceWith(
    [{ target: element, contentRect: { width, height } }],
    observer,
  )

  observer.unobserve(element)
  trigger_resize_observer(element)
  observer.observe(element)
  observer.disconnect()
  await Promise.resolve()
  expect(callback).toHaveBeenCalledOnce()
  expect(get_resize_observer_count()).toBe(initial_count)
})

test(`deferred fetch responses queue duplicate URLs in request order`, async () => {
  const responses = deferred_fetch_responses()
  const first_response = fetch(`/same.json`)
  const second_response = fetch(`/same.json`)
  const queue = responses.get(`/same.json`)
  expect(queue).toHaveLength(2)

  queue?.shift()?.resolve(new Response(`first`))
  queue?.shift()?.resolve(new Response(`second`))
  await expect(first_response.then((response) => response.text())).resolves.toBe(`first`)
  await expect(second_response.then((response) => response.text())).resolves.toBe(`second`)
})

test(`fullscreen simulation is opt-in and restores the browser API`, async () => {
  const targets: [object, string][] = [
    [document, `fullscreenElement`],
    [document, `exitFullscreen`],
    [HTMLElement.prototype, `requestFullscreen`],
  ]
  const descriptors = () =>
    targets.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key))
  const originals = descriptors()
  const restore = mock_fullscreen()
  const element = document.createElement(`div`)
  const transitions: (Element | null)[] = []
  const on_change = () => transitions.push(document.fullscreenElement)
  document.addEventListener(`fullscreenchange`, on_change)
  try {
    await element.requestFullscreen()
    await document.exitFullscreen()
    expect(transitions).toEqual([element, null])
    restore()
    expect(descriptors()).toEqual(originals)
  } finally {
    document.removeEventListener(`fullscreenchange`, on_change)
  }
})

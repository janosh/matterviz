import { deferred_fetch_responses, get_resize_observer_count } from './setup'
import { expect, test, vi } from 'vitest'

test(`ResizeObserver disconnect unregisters and observe re-registers once`, async () => {
  const initial_count = get_resize_observer_count()
  const callback = vi.fn()
  const observer = new ResizeObserver(callback)
  expect(get_resize_observer_count()).toBe(initial_count + 1)

  observer.disconnect()
  expect(get_resize_observer_count()).toBe(initial_count)

  observer.observe(document.createElement(`div`))
  expect(get_resize_observer_count()).toBe(initial_count + 1)
  await Promise.resolve()
  expect(callback).toHaveBeenCalledOnce()

  observer.disconnect()
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

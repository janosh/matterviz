import { get_resize_observer_count } from './setup'
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

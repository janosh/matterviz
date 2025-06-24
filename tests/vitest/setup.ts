import { beforeEach, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = ``
})

export function doc_query<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector(selector)
  if (!node) throw `No element found for selector: ${selector}`
  return node as T
}

// ResizeObserver mock
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.matchMedia = vi.fn().mockImplementation((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(), // deprecated
  removeListener: vi.fn(), // deprecated
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

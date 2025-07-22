import { beforeEach, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = ``
})

export function doc_query<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector(selector)
  if (!node) throw `No element found for selector: ${selector}`
  return node as T
}

// Test data factory for creating mock structures
export const get_test_structure = (
  element = `H`,
  atoms = 3,
  with_lattice = false,
) => {
  const structure = {
    sites: Array.from({ length: atoms }, (_, idx) => ({
      species: [{ element, occu: 1, oxidation_state: 0 }],
      abc: [0, 0, 0],
      xyz: [idx, 0, 0],
      label: `${element}${idx + 1}`,
      properties: {},
    })),
    charge: 0,
  }

  if (with_lattice) {
    const matrix = [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]]
    const pbc = [true, true, true]
    const lengths = { a: 5.0, b: 5.0, c: 5.0 }
    const angles = { alpha: 90.0, beta: 90.0, gamma: 90.0 }
    const lattice = { ...lengths, ...angles, volume: 125.0, matrix, pbc }
    return { ...structure, lattice }
  }

  return structure
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
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

// Mock clipboard API for testing
Object.defineProperty(navigator, `clipboard`, {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
})

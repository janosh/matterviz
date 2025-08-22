import type { AnyStructure, ElementSymbol, Vec3 } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import * as math from '$lib/math'
import type { PymatgenStructure, Site } from '$lib/structure'
import { beforeEach, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = ``
})

// Mock the symmetry module to prevent WASM loading in tests
vi.mock(`$lib/symmetry`, () => ({
  ensure_moyo_wasm_ready: vi.fn().mockResolvedValue(undefined),
  analyze_structure_symmetry: vi.fn().mockResolvedValue({
    number: 1,
    hm_symbol: `P1`,
    hall_number: 1,
    pearson_symbol: `aP1`,
    operations: [],
    std_cell: {
      positions: [],
      numbers: [],
    },
    wyckoffs: [],
    primitive_cell: {
      positions: [],
      numbers: [],
    },
    primitive_wyckoffs: [],
  }),
  to_cell_json: vi.fn().mockReturnValue(`{}`),
}))

export function doc_query<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector(selector)
  if (!node) throw `No element found for selector: ${selector}`
  return node as T
}

// Test data factory for creating mock structures
export const get_dummy_structure = (
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

// Helper to create test crystal structures with proper lattice handling
export function create_test_structure(
  lattice: Matrix3x3,
  elements: ElementSymbol[],
  frac_coords: Vec3[],
): PymatgenStructure {
  const sites: Site[] = frac_coords.map((frac_coord, idx) => ({
    xyz: math.mat3x3_vec3_multiply(lattice, frac_coord),
    abc: frac_coord,
    species: [{ element: elements[idx], occu: 1, oxidation_state: 0 }],
    label: elements[idx],
    properties: {},
  }))

  return {
    lattice: {
      matrix: lattice,
      pbc: [true, true, true],
      volume: math.det_3x3(lattice),
      a: Math.hypot(...lattice[0]),
      b: Math.hypot(...lattice[1]),
      c: Math.hypot(...lattice[2]),
      alpha: 90,
      beta: 90,
      gamma: 90,
    },
    sites,
  }
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

// Test structure fixtures
export const simple_structure: AnyStructure = {
  id: `test_h2o`,
  sites: [
    {
      species: [{ element: `H`, occu: 1, oxidation_state: 1 }],
      xyz: [0.757, 0.586, 0.0],
      abc: [0.0757, 0.0586, 0.0],
      label: `H`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [0.0, 0.0, 0.0],
      abc: [0.0, 0.0, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `H`, occu: 1, oxidation_state: 1 }],
      xyz: [-0.757, 0.586, 0.0],
      abc: [-0.0757, 0.0586, 0.0],
      label: `H`,
      properties: {},
    },
  ],
  lattice: {
    matrix: [[10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 10.0]],
    pbc: [true, true, true],
    ...{ a: 10.0, b: 10.0, c: 10.0, alpha: 90.0, beta: 90.0, gamma: 90.0 },
    volume: 1000.0,
  },
}

export const complex_structure: AnyStructure = {
  id: `test_complex`,
  sites: [
    {
      species: [{ element: `Li`, occu: 1, oxidation_state: 1 }],
      xyz: [0.0, 0.0, 0.0],
      abc: [0.0, 0.0, 0.0],
      label: `Li`,
      properties: {},
    },
    {
      species: [{ element: `Fe`, occu: 1, oxidation_state: 2 }],
      xyz: [2.5, 0.0, 0.0],
      abc: [0.5, 0.0, 0.0],
      label: `Fe`,
      properties: {},
    },
    {
      species: [{ element: `P`, occu: 1, oxidation_state: 5 }],
      xyz: [0.0, 2.5, 0.0],
      abc: [0.0, 0.5, 0.0],
      label: `P`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [1.25, 1.25, 0.0],
      abc: [0.25, 0.25, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [3.75, 1.25, 0.0],
      abc: [0.75, 0.25, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [1.25, 3.75, 0.0],
      abc: [0.25, 0.75, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [3.75, 3.75, 0.0],
      abc: [0.75, 0.75, 0.0],
      label: `O`,
      properties: {},
    },
  ],
  lattice: {
    matrix: [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]],
    pbc: [true, true, true],
    ...{ a: 5.0, b: 5.0, c: 5.0, alpha: 90.0, beta: 90.0, gamma: 90.0 },
    volume: 125.0,
  },
}

import type { AnyStructure, ElementSymbol, Vec3 } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import * as math from '$lib/math'
import type { PymatgenStructure, Site } from '$lib/structure'
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
// Supports two modes:
// 1. Fractional coordinates: create_test_structure(lattice, elements, frac_coords)
// 2. Cartesian coordinates: create_test_structure(lattice, sites_data)
export function create_test_structure(
  lattice: Matrix3x3 | number,
  elements_or_sites:
    | ElementSymbol[]
    | {
      species: { element: string; occu: number; oxidation_state: number }[]
      xyz: number[]
    }[],
  frac_coords?: Vec3[],
): PymatgenStructure {
  const lattice_matrix: Matrix3x3 = typeof lattice === `number`
    ? [
      [lattice, 0.0, 0.0],
      [0.0, lattice, 0.0],
      [0.0, 0.0, lattice],
    ]
    : lattice

  // Calculate lattice parameters from matrix
  const [avec, bvec, cvec] = lattice_matrix
  const a_len = Math.hypot(...avec)
  const b_len = Math.hypot(...bvec)
  const c_len = Math.hypot(...cvec)

  // Calculate angles (in degrees)
  const dot = (v1: Vec3, v2: Vec3) => v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]
  const alpha = (Math.acos(dot(bvec, cvec) / (b_len * c_len)) * 180) / Math.PI
  const beta = (Math.acos(dot(avec, cvec) / (a_len * c_len)) * 180) / Math.PI
  const gamma = (Math.acos(dot(avec, bvec) / (a_len * b_len)) * 180) / Math.PI

  const volume = math.det_3x3(lattice_matrix)

  let sites: Site[]

  // Mode 1: Fractional coordinates (original behavior)
  if (frac_coords) {
    const elements = elements_or_sites as ElementSymbol[]
    sites = frac_coords.map((frac_coord, idx) => ({
      xyz: math.mat3x3_vec3_multiply(lattice_matrix, frac_coord),
      abc: frac_coord,
      species: [{ element: elements[idx], occu: 1, oxidation_state: 0 }],
      label: elements[idx],
      properties: {},
    }))
  } // Mode 2: Cartesian coordinates (new behavior for RDF tests)
  else {
    const sites_data = elements_or_sites as {
      species: { element: string; occu: number; oxidation_state: number }[]
      xyz: number[]
    }[]
    sites = sites_data.map((site, idx) => ({
      species: site.species.map((sp) => ({
        ...sp,
        element: sp.element as ElementSymbol,
      })),
      xyz: site.xyz as [number, number, number],
      // Calculate fractional coordinates: abc = inverse(lattice_matrix) · xyz
      abc: math.mat3x3_vec3_multiply(
        math.matrix_inverse_3x3(lattice_matrix),
        site.xyz as Vec3,
      ),
      label: `${site.species[0].element}${idx}`,
      properties: {},
    }))
  }

  return {
    lattice: {
      matrix: lattice_matrix,
      pbc: [true, true, true],
      volume,
      a: a_len,
      b: b_len,
      c: c_len,
      alpha,
      beta,
      gamma,
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

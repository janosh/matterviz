import type { AnyStructure, ElementSymbol, Vec3 } from '$lib'
import * as math from '$lib/math'
import type { Crystal, Pbc, Site } from '$lib/structure'
import init from '@spglib/moyo-wasm'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, vi } from 'vitest'

// Node 22+ has a built-in localStorage Proxy that lacks the standard Storage
// API (getItem/setItem/etc). Vitest's populateGlobal skips overriding globals
// already present unless explicitly allowlisted — localStorage isn't.
// Replace with happy-dom's spec-compliant Storage when methods are missing.
if (typeof localStorage.getItem !== `function`) {
  const { Storage } = await import(`happy-dom`)
  Object.defineProperty(globalThis, `localStorage`, {
    value: new Storage(),
    writable: true,
    configurable: true,
  })
}

// Resolve WASM path for Node.js environment (used by moyo-wasm integration tests)
const current_dir = dirname(fileURLToPath(import.meta.url))
const MOYO_WASM_PATH = resolve(
  current_dir,
  `../../node_modules/@spglib/moyo-wasm/moyo_wasm_bg.wasm`,
)

// Initialize moyo-wasm for Node.js environment by reading binary directly
let moyo_initialized = false
export async function init_moyo_for_tests(): Promise<void> {
  if (moyo_initialized) return
  const wasm_bytes = readFileSync(MOYO_WASM_PATH)
  await init({ module_or_path: wasm_bytes })
  moyo_initialized = true
}

// Suppress Three.js multiple instances warning in tests
const original_warn = console.warn
console.warn = (...args: unknown[]) => {
  const message = String(args[0])
  if (message.includes(`Multiple instances of Three.js`)) return
  original_warn(...args)
}

beforeEach(() => {
  document.body.innerHTML = ``
  localStorage.clear()
  // Mock clientWidth/clientHeight (happy-dom has no layout engine, returns 0 by default)
  Object.defineProperty(HTMLElement.prototype, `clientWidth`, {
    get: () => 800,
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, `clientHeight`, {
    get: () => 600,
    configurable: true,
  })
})

export function doc_query<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector(selector) satisfies T | null
  if (!node) throw new Error(`No element found for selector: ${selector}`)
  return node
}
export function svg_query<T extends SVGElement>(selector: string): T {
  const node = document.querySelector(selector) satisfies T | null
  if (!node) throw new Error(`No element found for selector: ${selector}`)
  return node
}

// Test data factory for creating mock structures
export const get_dummy_structure = (
  element: ElementSymbol = `H`,
  atoms = 3,
  with_lattice = false,
): Crystal => {
  const matrix: math.Matrix3x3 = [[5, 0, 0], [0, 5, 0], [0, 0, 5]]
  const pbc: Pbc = [false, false, false]
  const structure = {
    sites: Array.from({ length: atoms }, (_, idx) => ({
      species: [{ element, occu: 1, oxidation_state: 0 }],
      abc: [0, 0, 0] as Vec3,
      xyz: [idx, 0, 0] as Vec3,
      label: `${element}${idx + 1}`,
      properties: {},
    })),
    lattice: { matrix, pbc, volume: 0, a: 0, b: 0, c: 0, alpha: 0, beta: 0, gamma: 0 },
    charge: 0,
  }

  if (with_lattice) {
    const matrix: math.Matrix3x3 = [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]]
    const pbc: Pbc = [true, true, true]
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
  lattice: math.Matrix3x3 | number,
  elements_or_sites:
    | ElementSymbol[]
    | {
      species: { element: string; occu: number; oxidation_state: number }[]
      xyz: number[]
    }[],
  frac_coords?: Vec3[],
): Crystal {
  const lattice_matrix: math.Matrix3x3 = typeof lattice === `number`
    ? [
      [lattice, 0.0, 0.0],
      [0.0, lattice, 0.0],
      [0.0, 0.0, lattice],
    ]
    : lattice

  // Calculate lattice parameters from matrix
  const { a, b, c, alpha, beta, gamma, volume } = math.calc_lattice_params(lattice_matrix)

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
      xyz: site.xyz as Vec3,
      // Calculate fractional coordinates: abc = inverse(lattice_matrix) · xyz
      abc: math.mat3x3_vec3_multiply(
        math.matrix_inverse_3x3(lattice_matrix),
        site.xyz as Vec3,
      ),
      label: `${site.species[0].element}${idx}`,
      properties: {},
    }))
  }

  const lattice_params = { a, b, c, alpha, beta, gamma, pbc: [true, true, true] as Pbc }
  return {
    lattice: { matrix: lattice_matrix, ...lattice_params, volume },
    sites,
  }
}

// Simplified site input for make_crystal helper
// Object notation: { element: `Li`, abc: [0, 0, 0], oxidation_state: 1 }
export type SimpleSiteObject = {
  element: ElementSymbol | string
  abc?: Vec3
  xyz?: Vec3
  occu?: number
  oxidation_state?: number
  label?: string
  properties?: Record<string, unknown>
}

// Tuple shorthand: [`Li`, [0, 0, 0]] or [`Li`, [0, 0, 0], 1] (with oxidation state)
export type SimpleSite = SimpleSiteObject | [string, Vec3, number?]

// Normalize tuple or object site input to object form
const normalize_site_input = (input: SimpleSite): SimpleSiteObject => {
  if (Array.isArray(input)) {
    const [element, abc, oxidation_state] = input
    return { element, abc, oxidation_state }
  }
  return input
}

// Flexible helper to create test structures with minimal boilerplate
// Handles auto-calculation of abc↔xyz, lattice params, and site defaults
export function make_crystal(
  lattice_input: number | math.Matrix3x3,
  site_inputs: SimpleSite[],
  options: { pbc?: Pbc; charge?: number } = {},
): Crystal {
  const lattice_matrix: math.Matrix3x3 = typeof lattice_input === `number`
    ? [[lattice_input, 0, 0], [0, lattice_input, 0], [0, 0, lattice_input]]
    : lattice_input

  // Use standard pymatgen convention for frac↔cart conversion:
  // xyz = transpose(lattice) · abc, abc = inv(transpose(lattice)) · xyz
  const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
  const cart_to_frac = math.create_cart_to_frac(lattice_matrix)
  const { a, b, c, alpha, beta, gamma, volume } = math.calc_lattice_params(lattice_matrix)
  const pbc = options.pbc ?? [true, true, true]

  const sites: Site[] = site_inputs.map((raw_input, idx) => {
    const input = normalize_site_input(raw_input)
    const element = input.element as ElementSymbol
    // Calculate coordinates - abc takes precedence to ensure consistency
    let abc: Vec3
    let xyz: Vec3
    if (input.abc) {
      abc = input.abc
      xyz = frac_to_cart(abc)
    } else if (input.xyz) {
      xyz = input.xyz
      abc = cart_to_frac(xyz)
    } else {
      throw new Error(`Site ${idx} must have either abc or xyz coordinates`)
    }

    return {
      species: [{
        element,
        occu: input.occu ?? 1,
        oxidation_state: input.oxidation_state ?? 0,
      }],
      abc,
      xyz,
      label: input.label ?? `${element}${idx}`,
      properties: input.properties ?? {},
    }
  })

  return {
    lattice: { matrix: lattice_matrix, pbc, a, b, c, alpha, beta, gamma, volume },
    sites,
    ...(options.charge !== undefined && { charge: options.charge }),
  }
}

// ResizeObserver mock - triggers callback with dimensions on observe
globalThis.ResizeObserver = class ResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(el: Element) {
    queueMicrotask(() =>
      this.callback(
        [{ target: el, contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
        this,
      )
    )
  }
  unobserve() {}
  disconnect() {}
}

// Mock Web Animations API for Svelte transitions (not available in jsdom)
// The mock immediately triggers onfinish to complete transitions synchronously
Element.prototype.animate = vi.fn().mockImplementation(() => {
  const animation = {
    onfinish: null as (() => void) | null,
    cancel: vi.fn(),
    finish: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    reverse: vi.fn(),
    commitStyles: vi.fn(),
    persist: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
  // Call onfinish in next microtask to simulate animation completion
  queueMicrotask(() => animation.onfinish?.())
  return animation
})

// Mock getAnimations for Svelte's animate:flip directive (not available in happy-dom)
Element.prototype.getAnimations = vi.fn().mockReturnValue([])

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

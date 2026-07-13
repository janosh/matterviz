import type { AnyStructure, ElementSymbol, Vec3 } from '$lib'
import type { VolumetricData } from '$lib/isosurface/types'
import * as math from '$lib/math'
import type { Crystal, Pbc, Site } from '$lib/structure'
import type { TrajectoryFrame } from '$lib/trajectory'
import init, { type MoyoDataset } from '@spglib/moyo-wasm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { type Component, type ComponentProps, flushSync, mount, tick } from 'svelte'
import { beforeEach, expect, vi } from 'vitest'

// Node 22+ has a built-in localStorage Proxy that lacks the standard Storage
// API (getItem/setItem/etc). Vitest's populateGlobal skips overriding globals
// already present unless explicitly allowlisted — localStorage isn't.
// Replace with happy-dom's spec-compliant Storage when methods are missing.
if (typeof localStorage === `undefined` || typeof localStorage.getItem !== `function`) {
  const { Storage } = await import(`happy-dom`)
  Object.defineProperty(globalThis, `localStorage`, {
    value: new Storage(),
    writable: true,
    configurable: true,
  })
}

// Resolve WASM path for Node.js environment (used by moyo-wasm integration tests)
const current_dir = import.meta.dirname
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

type Element_constructor<T extends Element> = abstract new (...args: never[]) => T

export function doc_query<T extends Element = HTMLElement>(
  selector: string,
  element_constructor?: Element_constructor<T>,
): T {
  const node = document.querySelector(selector)
  if (!node) throw new Error(`No element found for selector: ${selector}`)
  if (element_constructor && !(node instanceof element_constructor)) {
    throw new Error(`Element found for selector ${selector} has the wrong type`)
  }
  return node as T
}

export const svg_query = (selector: string): SVGElement => doc_query<SVGElement>(selector)

// Extract the rotation pivot-y from an axis label's nearest rotated SVG ancestor.
// Used to assert y/y2 axis titles share a pivot.
export const axis_label_pivot_y = (root: ParentNode, selector: string): number => {
  let transform = ``
  for (
    let node = root.querySelector(selector)?.parentElement;
    node;
    node = node.parentElement
  ) {
    transform = node.getAttribute(`transform`) ?? ``
    if (transform) break
  }
  const match = /rotate\(-90,\s*[\d.-]+,\s*(?<pivot>[\d.-]+)\)/.exec(transform)
  if (!match) throw new Error(`no rotate transform on ${selector}: "${transform}"`)
  return Number(match[1])
}

// Walk up from `el` to the owning <svg>: true if any ancestor applies a clip-path.
// Used to assert reference-line annotations render unclipped at the plot edges.
export const inside_clip_path = (el: Element | null | undefined): boolean => {
  for (
    let node = el?.parentElement;
    node && node.tagName.toLowerCase() !== `svg`;
    node = node.parentElement
  )
    if (node.getAttribute(`clip-path`)) return true
  return false
}

function set_element_size(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, `clientWidth`, { value: width, configurable: true })
  Object.defineProperty(element, `clientHeight`, { value: height, configurable: true })
}

export const bind_props = <P extends object, S extends Record<string, unknown>>(
  props: P,
  state: S,
): P & S =>
  Object.defineProperties(
    props,
    Object.fromEntries(
      Object.keys(state).map((key) => [
        key,
        {
          get: () => state[key],
          set: (value: unknown) => ((state as Record<string, unknown>)[key] = value),
          enumerable: true,
        },
      ]),
    ),
  ) as P & S

// Dispatch a cancelable window-level keydown and flush Svelte effects
// synchronously. Returns the event so callers can assert `defaultPrevented`.
export const press_window_key = (event_init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent(`keydown`, { cancelable: true, ...event_init })
  window.dispatchEvent(event)
  flushSync()
  return event
}

// Assert a viewer forwards window keydown shortcuts only to the hovered viewer
// while focus is on <body>: ignored when not hovered, fires on hover, bails when
// an input is focused, resumes once focus returns to <body>, and stops on
// mouseleave. `fire` triggers the shortcut; `read_state` returns an observable
// value (a step counter, a toggle flag, ...) — the shortcut is deemed to have
// "fired" whenever that value changes between checks, so it works for both
// counters and toggles.
export async function assertHoverScopedShortcut(opts: {
  viewer: HTMLElement
  fire: () => void
  read_state: () => unknown
}): Promise<void> {
  const { viewer, fire, read_state } = opts
  let last = read_state()
  const took_effect = (): boolean => {
    const current = read_state()
    const changed = current !== last
    last = current
    return changed
  }

  fire()
  expect(took_effect(), `not hovered → ignored`).toBe(false)

  viewer.dispatchEvent(new MouseEvent(`mouseenter`))
  await tick()
  fire()
  expect(took_effect(), `hovered → fires without a prior click`).toBe(true)

  const input = document.createElement(`input`)
  document.body.append(input)
  input.focus()
  fire()
  expect(took_effect(), `input focused → bails`).toBe(false)
  // blur before removing so activeElement deterministically returns to <body> (happy-dom doesn't
  // reliably reset focus when a focused element is detached), making the "resumes" check stable
  input.blur()
  input.remove()

  fire()
  expect(took_effect(), `focus back on <body> → resumes`).toBe(true)

  viewer.dispatchEvent(new MouseEvent(`mouseleave`))
  await tick()
  fire()
  expect(took_effect(), `mouse left → stops firing`).toBe(false)
}

export async function resize_element(
  element: HTMLElement,
  width: number,
  height: number,
): Promise<void> {
  set_element_size(element, width, height)
  element.dispatchEvent(new Event(`resize`))
  await tick()
}

// Mount a component into a fresh container, find its root via `selector`, and
// resize it so width/height-dependent rendering (SVG plots, canvases) kicks in.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export async function mount_sized<Comp extends Component<any>>(
  component: Comp,
  props: Partial<ComponentProps<Comp>>,
  options: { selector: string; width?: number; height?: number },
): Promise<HTMLElement> {
  const { selector, width = 400, height = 300 } = options
  const target = document.createElement(`div`)
  document.body.append(target)
  const style = (props as { style?: string }).style ?? ``
  // Object.assign (not spread) keeps bind_props accessors intact
  mount(component, {
    target,
    props: Object.assign(props, {
      style: `width: ${width}px; height: ${height}px; ${style}`,
    }),
  })
  const root = target.querySelector<HTMLElement>(selector)
  if (!root) throw new Error(`No element found for selector: ${selector}`)
  await resize_element(root, width, height)
  return root
}

export const make_grid = (
  nx: number,
  ny: number,
  nz: number,
  fill: number | ((ix: number, iy: number, iz: number) => number) = 1,
): number[][][] =>
  Array.from({ length: nx }, (_x_row, ix) =>
    Array.from({ length: ny }, (_y_row, iy) =>
      Array.from({ length: nz }, (_z_row, iz) =>
        typeof fill === `function` ? fill(ix, iy, iz) : fill,
      ),
    ),
  )

// Minimal VolumetricData fixture with sensible defaults; grid_dims derive from grid shape
export const make_volume = (
  grid: number[][][],
  overrides: Partial<VolumetricData> = {},
): VolumetricData => ({
  grid,
  grid_dims: [grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0],
  lattice: [
    [5, 0, 0],
    [0, 5, 0],
    [0, 0, 5],
  ],
  origin: [0, 0, 0],
  data_range: { min: 0, max: 1, abs_max: 1, mean: 0.5 },
  periodic: true,
  ...overrides,
})

// Linear fractional field; trilinear interpolation reproduces it exactly.
export const make_linear_volume = (
  n_pts: number,
  lattice: math.Matrix3x3,
  periodic: boolean,
  origin: Vec3 = [0, 0, 0],
): VolumetricData => {
  const divisor = periodic ? n_pts : n_pts - 1
  const grid = make_grid(
    n_pts,
    n_pts,
    n_pts,
    (x_idx, y_idx, z_idx) => (x_idx + 2 * y_idx + 4 * z_idx) / divisor,
  )
  return make_volume(grid, { lattice, origin, periodic })
}

export function read_binary_test_file(
  filename: string,
  directory = `src/site/trajectories`,
): ArrayBuffer {
  const file_path = resolve(process.cwd(), directory, filename)
  const buffer = readFileSync(file_path)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

// Read a (possibly gzipped) text file as utf-8, decompressing when the path ends in `.gz`.
export function read_maybe_gz(file_path: string): string {
  const buffer = readFileSync(file_path)
  return file_path.endsWith(`.gz`)
    ? gunzipSync(buffer).toString(`utf8`)
    : buffer.toString(`utf8`)
}

// Read and JSON.parse a (possibly gzipped) JSON file. Cast the result at the call site.
// Generic param is a typed-load convenience for call sites (load_json<Foo>(path)),
// not used for inference, hence the single-use type parameter is intentional.
// oxlint-disable-next-line typescript-eslint/no-unnecessary-type-parameters
export const load_json = <T = unknown>(file_path: string): T =>
  JSON.parse(read_maybe_gz(file_path)) as T

// Factory for a trajectory frame with `site_count` hydrogen atoms along x.
// Pass `lattice_params` to attach a diagonal lattice (defaults: lengths 1, angles 90, volume 1).
export const make_trajectory_frame = (
  step: number,
  site_count = 3,
  metadata: Record<string, unknown> = {},
  lattice_params?: Record<string, number>,
): TrajectoryFrame => ({
  step,
  metadata,
  structure: {
    charge: 0,
    sites: Array.from({ length: site_count }, (_, idx) => ({
      species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
      xyz: [idx, 0, 0] as Vec3,
      abc: [idx / 10, 0, 0] as Vec3,
      label: `H${idx + 1}`,
      properties: {},
    })),
    ...(lattice_params && {
      lattice: {
        matrix: [
          [lattice_params.a || 1, 0, 0],
          [0, lattice_params.b || 1, 0],
          [0, 0, lattice_params.c || 1],
        ] as math.Matrix3x3,
        pbc: [true, true, true] as Pbc,
        a: lattice_params.a || 1,
        b: lattice_params.b || 1,
        c: lattice_params.c || 1,
        alpha: lattice_params.alpha || 90,
        beta: lattice_params.beta || 90,
        gamma: lattice_params.gamma || 90,
        volume: lattice_params.volume || 1,
      },
    }),
  },
})

// Test data factory for creating mock structures. Site coords are deliberately
// inconsistent (abc all-zero, xyz spaced along x) and the default lattice is
// degenerate (all params 0) — tests only need distinguishable dummy objects.
export const get_dummy_structure = (
  element: ElementSymbol = `H`,
  atoms = 3,
  with_lattice = false,
): Crystal => ({
  sites: Array.from({ length: atoms }, (_, idx) => ({
    species: [{ element, occu: 1, oxidation_state: 0 }],
    abc: [0, 0, 0] as Vec3,
    xyz: [idx, 0, 0] as Vec3,
    label: `${element}${idx + 1}`,
    properties: {},
  })),
  lattice: {
    matrix: cubic_matrix(5),
    ...(with_lattice
      ? {
          pbc: [true, true, true] as Pbc,
          a: 5,
          b: 5,
          c: 5,
          volume: 125,
          alpha: 90,
          beta: 90,
          gamma: 90,
        }
      : {
          pbc: [false, false, false] as Pbc,
          a: 0,
          b: 0,
          c: 0,
          volume: 0,
          alpha: 0,
          beta: 0,
          gamma: 0,
        }),
  },
  charge: 0,
})

// Thin wrapper over make_crystal supporting two legacy call shapes:
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
  const site_inputs: SimpleSite[] = frac_coords
    ? frac_coords.map((abc, idx) => {
        const element = (elements_or_sites as ElementSymbol[])[idx]
        return { element, abc, label: element }
      })
    : elements_or_sites.map((site) => {
        const { species, xyz } = site as {
          species: { element: string; occu: number; oxidation_state: number }[]
          xyz: number[]
        }
        return { ...species[0], xyz: xyz as Vec3 }
      })
  return make_crystal(lattice, site_inputs)
}

// Simplified site input for make_crystal helper
// Object notation: { element: `Li`, abc: [0, 0, 0], oxidation_state: 1 }
type SimpleSiteObject = {
  element: string // usually ElementSymbol but any string is allowed
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
  const lattice_matrix: math.Matrix3x3 =
    typeof lattice_input === `number` ? cubic_matrix(lattice_input) : lattice_input

  // Use standard pymatgen convention for frac↔cart conversion:
  // xyz = transpose(lattice) · abc, abc = inv(transpose(lattice)) · xyz
  // cart_to_frac inverts the matrix eagerly, so create it lazily to support
  // degenerate (singular) lattices as long as all sites pass abc coords
  const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
  let cart_to_frac: ((vec: Vec3) => Vec3) | undefined
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
      abc = (cart_to_frac ??= math.create_cart_to_frac(lattice_matrix))(xyz)
    } else {
      throw new Error(`Site ${idx} must have either abc or xyz coordinates`)
    }

    return {
      species: [
        {
          element,
          occu: input.occu ?? 1,
          oxidation_state: input.oxidation_state ?? 0,
        },
      ],
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

// Shared 3x3 matrix fixtures
export const IDENTITY_MATRIX3: math.Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

// Diagonal cubic lattice matrix with edge length `a`
export const cubic_matrix = (a: number): math.Matrix3x3 => [
  [a, 0, 0],
  [0, a, 0],
  [0, 0, a],
]

// Encode a 3x3 matrix as a flat 9-array in COLUMN-major order — how moyo/nalgebra serialize
// rotation matrices on the wire (inverse of mat3_from_flat_col_major in symmetry-elements).
export const col_major = (mat: math.Matrix3x3): number[] => {
  const [[a1, a2, a3], [a4, a5, a6], [a7, a8, a9]] = mat
  return [a1, a4, a7, a2, a5, a8, a3, a6, a9]
}

// Build an orbit-path SymmetryDataset mock from std-cell-aligned fields. The input cell is
// taken to equal the std cell (identity std_linear) and sites are grouped into orbits by
// shared Wyckoff letter + element — the same grouping the production orbit path applies, so
// these mocks exercise wyckoff_rows_from_input_orbits with hand-computed expectations.
export const make_wyckoff_dataset = (
  positions: number[][],
  numbers: number[],
  wyckoffs: (string | null)[],
  orig_site_indices_by_input_idx?: number[][],
): MoyoDataset => {
  const letter = (idx: number) => /[a-z]+$/.exec(wyckoffs[idx] ?? ``)?.[0] ?? null
  // Orbit representative = first site sharing this letter + element (null letter ⇒ own orbit)
  const orbits = wyckoffs.map((_w, idx) =>
    letter(idx) === null
      ? idx
      : wyckoffs.findIndex(
          (_v, jdx) => letter(jdx) === letter(idx) && numbers[jdx] === numbers[idx],
        ),
  )
  return {
    std_cell: { positions, numbers },
    input_cell: { positions, numbers },
    wyckoffs: wyckoffs.map((wyckoff) => wyckoff ?? ``),
    orbits,
    std_linear: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ...(orig_site_indices_by_input_idx ? { orig_site_indices_by_input_idx } : {}),
  } as unknown as MoyoDataset
}

// ResizeObserver mock - triggers callback with dimensions on observe
globalThis.ResizeObserver = class ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(el: Element) {
    queueMicrotask(() =>
      this.callback(
        [{ target: el, contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
        this,
      ),
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
    matrix: [
      [10.0, 0.0, 0.0],
      [0.0, 10.0, 0.0],
      [0.0, 0.0, 10.0],
    ],
    pbc: [true, true, true],
    a: 10.0,
    b: 10.0,
    c: 10.0,
    alpha: 90.0,
    beta: 90.0,
    gamma: 90.0,
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
    matrix: [
      [5.0, 0.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 5.0],
    ],
    pbc: [true, true, true],
    a: 5.0,
    b: 5.0,
    c: 5.0,
    alpha: 90.0,
    beta: 90.0,
    gamma: 90.0,
    volume: 125.0,
  },
}

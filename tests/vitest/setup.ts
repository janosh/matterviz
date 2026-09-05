import type { AnyStructure, ElementCategory, ElementSymbol, Vec3 } from '$lib'
import type { PhaseData } from '$lib/convex-hull/types'
import type { FermiIsosurface, FermiSurfaceData } from '$lib/fermi-surface/types'
import { flatten_grid } from '$lib/isosurface/grid'
import type { VolumetricData } from '$lib/isosurface/types'
import { make_volume as make_volume_from_values } from '$lib/isosurface/types'
import * as math from '$lib/math'
import type { Rect } from '$lib/plot/core/layout'
import type { Crystal, Molecule, Pbc, Site } from '$lib/structure'
import type {
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryPositionStream,
} from '$lib/trajectory'
import { TrajectoryProperties, type TrajectoryRun } from '$lib/trajectory/run'
import { type MemoryRunExtras, trajectory_from_frames } from '$lib/trajectory/runs/memory'
import { ensure_moyo_wasm_ready } from '$lib/symmetry/analyze'
import { to_error } from '$lib/utils'
import type { SymmetryDataset } from '$lib/symmetry'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { type Component, type ComponentProps, flushSync, mount, tick } from 'svelte'
import { expect, onTestFinished, vi } from 'vitest'

export {
  get_resize_observer_count,
  trigger_intersection,
  trigger_resize_observer,
} from './environment'

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
  await ensure_moyo_wasm_ready(readFileSync(MOYO_WASM_PATH))
  moyo_initialized = true
}

// Opt in only when a test exercises browser fullscreen transitions. Restore descriptors,
// including absent APIs in happy-dom, so later tests cannot inherit successful fullscreen.
export const mock_fullscreen = (): (() => void) => {
  const originals = (
    [
      [document, `fullscreenElement`],
      [document, `exitFullscreen`],
      [HTMLElement.prototype, `requestFullscreen`],
    ] satisfies [object, string][]
  ).map(([target, key]) => ({
    target,
    key,
    descriptor: Object.getOwnPropertyDescriptor(target, key),
  }))
  const restore = () => {
    for (const { target, key, descriptor } of originals) {
      if (descriptor) Object.defineProperty(target, key, descriptor)
      else Reflect.deleteProperty(target, key)
    }
  }
  onTestFinished(restore)
  const set_element = (element: Element | null) => {
    Object.defineProperty(document, `fullscreenElement`, {
      configurable: true,
      value: element,
    })
    document.dispatchEvent(new Event(`fullscreenchange`))
    return Promise.resolve()
  }
  Object.defineProperty(document, `fullscreenElement`, { configurable: true, value: null })
  document.exitFullscreen = () => set_element(null)
  HTMLElement.prototype.requestFullscreen = function () {
    return set_element(this)
  }
  return restore
}

type Element_constructor<T extends Element> = abstract new (...args: never[]) => T

// `tabindex` of every data mark, in DOM order. Marks used to be one tab stop each (a
// 10k-point scatter took 10k Tab presses), and BarPlot's line points had the mirror bug -
// the only stop sat on the *hovered* point, so with nothing hovered Tab could not enter
// the group at all. Pair with `one_tab_stop`.
export const roving_tabindexes = (root: ParentNode): string[] =>
  [...root.querySelectorAll(`[data-roving-key]`)].map(
    (el) => el.getAttribute(`tabindex`) ?? ``,
  )

// The expected shape: the first mark in DOM order holds the group's only tab stop. DOM
// order matters because Svelte re-evaluates marks in no guaranteed order, so a stop
// claimed by whoever rendered first would wander between renders.
export const one_tab_stop = (n_marks: number): string[] => [
  `0`,
  ...Array<string>(n_marks - 1).fill(`-1`),
]

// querySelector that throws instead of returning null, so a stale selector fails loudly
export function query<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
  element_constructor?: Element_constructor<T>,
): T {
  const node = root.querySelector(selector)
  if (!node) throw new Error(`No element found for selector: ${selector}`)
  if (element_constructor && !(node instanceof element_constructor)) {
    throw new Error(`Element found for selector ${selector} has the wrong type`)
  }
  return node as T
}
export const doc_query = <T extends Element = HTMLElement>(
  selector: string,
  element_constructor?: Element_constructor<T>,
): T => query(document, selector, element_constructor)

export const mouse = (type: string, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(type, { bubbles: true, ...init })
export const keydown = (key: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent(`keydown`, { key, bubbles: true, ...init })

// Dispatch a bubbling event on a node (defaults to a click) and flush the update. Throws on
// a missing target so a stale selector cannot pass as a no-op
export const fire = async (
  target: EventTarget | null | undefined,
  event: Event = mouse(`click`),
): Promise<void> => {
  if (!target) throw new Error(`event target for ${event.type} not found`)
  target.dispatchEvent(event)
  await tick()
}

// The interactive plot area: the frame's <svg role="application"> under `root`
export const plot_svg = (root: ParentNode = document): SVGSVGElement =>
  query(root, `svg[role="application"]`)

// x/y/width/height attributes of an SVG rect (or any element carrying them) as numbers
export const svg_rect = (el: Element): Rect => ({
  x: Number(el.getAttribute(`x`)),
  y: Number(el.getAttribute(`y`)),
  width: Number(el.getAttribute(`width`)),
  height: Number(el.getAttribute(`height`)),
})
// The plot-area clip rect of a Cartesian chart, i.e. where its data can be hit
export const clip_rect = (root: ParentNode = document): Rect =>
  svg_rect(query(root, `defs clipPath rect`))

// Pixel position an element is translate()d to
export const translate_of = (el: Element | null | undefined): { x: number; y: number } => {
  const transform = el?.getAttribute(`transform`) ?? ``
  const match = /translate\((?<x>[-\d.e]+)[ ,]+(?<y>[-\d.e]+)\)/.exec(transform)
  if (!match?.groups) throw new Error(`no translate in transform="${transform}"`)
  return { x: Number(match.groups.x), y: Number(match.groups.y) }
}

// Screen position of the nth `.marker`, read from its group's translate
export const marker_position = (
  root: ParentNode,
  marker_idx: number,
): { x: number; y: number } =>
  translate_of(root.querySelectorAll(`.marker`).item(marker_idx)?.parentElement)

export const hdf5_group_option = (
  target: ParentNode,
  group_path: string,
): HTMLButtonElement => {
  const option = [
    ...target.querySelectorAll<HTMLButtonElement>(`button[data-hdf5-group]`),
  ].find((button) => button.dataset.hdf5Group === group_path)
  if (!option) throw new Error(`HDF5 group option ${group_path} not found`)
  return option
}

export const make_ambiguous_hdf5 = async (): Promise<ArrayBuffer> => {
  const h5wasm = await import(`h5wasm`)
  const { FS } = await h5wasm.ready
  const filename = `ambiguous-${Math.random().toString(36).slice(2)}.h5`
  const file = new h5wasm.File(filename, `w`)
  const molecules = file.create_group(`molecules`)
  for (const [name, atomic_number, x_position] of [
    [`h2o`, 79, 1],
    [`nh3`, 1, 9],
  ] satisfies [string, number, number][]) {
    const replicas = molecules.create_group(name).create_group(`replicas`)
    for (const replica_idx of [0, 1, 2, 10]) {
      const group = replicas.create_group(`${replica_idx}`)
      group.create_dataset({ name: `positions`, data: [x_position, 0, 0], shape: [1, 1, 3] })
      group.create_dataset({ name: `atomic_numbers`, data: [atomic_number], shape: [1] })
    }
  }
  file.close()
  const bytes = FS.readFile(filename)
  FS.unlink(filename)
  return Uint8Array.from(bytes).buffer
}

export const deferred_fetch_responses = () => {
  const responses = new Map<
    string,
    { resolve: (response: Response) => void; reject: (error: Error) => void }[]
  >()
  const fetch_spy = vi.spyOn(globalThis, `fetch`).mockImplementation(
    (url: string | URL | Request) =>
      new Promise<Response>((resolve_response, reject_response) => {
        const request_url =
          typeof url === `string` ? url : url instanceof URL ? url.href : url.url
        const queue = responses.get(request_url) ?? []
        queue.push({ resolve: resolve_response, reject: reject_response })
        responses.set(request_url, queue)
      }),
  )
  onTestFinished(() => fetch_spy.mockRestore())
  return responses
}

// Stub URL.createObjectURL/revokeObjectURL for the current test (restored on finish), so
// download/export code paths run without happy-dom's blob URL handling.
export const mock_object_url = (url = `blob:test-url`) => {
  const create = vi.spyOn(URL, `createObjectURL`).mockReturnValue(url)
  const revoke = vi.spyOn(URL, `revokeObjectURL`).mockImplementation(() => {})
  onTestFinished(() => {
    create.mockRestore()
    revoke.mockRestore()
  })
  return { create, revoke }
}

export const flush_render = async (): Promise<void> => {
  flushSync()
  await tick()
}

// Ticks and microtasks enough for an $effect to run, an async compute it kicked off to
// settle and the result to render
export const settle = async (rounds = 3): Promise<void> => {
  for (let round = 0; round < rounds; round++) {
    await tick()
    await Promise.resolve()
    await tick()
  }
}

export const svg_query = (selector: string): SVGElement => doc_query<SVGElement>(selector)

// The <pattern> id a mark's `fill="url(#…)"` points at, scoped by `prefix`; throws when the
// mark is painted with a plain color instead
export const pattern_id_of = (mark: Element | null, prefix: string): string => {
  const fill = mark?.getAttribute(`fill`) ?? ``
  const match = new RegExp(`^url\\(#(?<id>${prefix}-.+-pat-[0-9a-z]+)\\)$`).exec(fill)
  if (!match?.groups) throw new Error(`mark fill is not a ${prefix} pattern url: ${fill}`)
  return match.groups.id
}

export function expect_transition_properties(
  element: Element,
  properties: readonly string[],
  duration = `0.2s`,
): void {
  const transition = getComputedStyle(element).transition
  const transitions = transition.split(`,`).map((value) => value.trim())
  for (const property of properties) {
    expect(transitions.some((value) => value.startsWith(`${property} ${duration}`))).toBe(true)
  }
  expect(transition).not.toContain(`all`)
  expect(transition).not.toMatch(/(?:^|,)\s*d\s/)
}

export const expect_labelled_settings_grid = (
  root: ParentNode = document,
  {
    section_selector = `section.settings-section`,
    row_selector = `:scope > label, :scope > .setting`,
  }: { section_selector?: string; row_selector?: string } = {},
): void => {
  const sections = [...root.querySelectorAll(section_selector)]
  expect(sections.length).toBeGreaterThan(0)
  expect(
    sections.every((section) => section.classList.contains(`grid`)),
    `All settings sections should use grid layout`,
  ).toBe(true)
  const rows = sections.flatMap((section) => [...section.querySelectorAll(row_selector)])
  expect(rows.length).toBeGreaterThan(0)
  expect(
    rows.every((row) => row.firstElementChild?.tagName === `SPAN`),
    `Every settings row should start with a span`,
  ).toBe(true)
}

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

// Assert forwarded control element props and a controls_open binding round-trip.
export async function expect_plot_controls(
  target: ParentNode,
  controls_state: { controls_open: boolean },
  test_id_prefix: string,
): Promise<void> {
  const toggle = target.querySelector<HTMLButtonElement>(
    `[data-testid="${test_id_prefix}-toggle"]`,
  )
  expect(toggle?.getAttribute(`aria-expanded`)).toBe(`true`)
  expect(target.querySelector(`[data-testid="${test_id_prefix}-pane"]`)).not.toBeNull()
  toggle?.click()
  await tick()
  expect(controls_state.controls_open).toBe(false)
}

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
  trigger: () => void
  read_state: () => unknown
}): Promise<void> {
  const { viewer, trigger, read_state } = opts
  let last = read_state()
  const took_effect = (): boolean => {
    const current = read_state()
    const changed = current !== last
    last = current
    return changed
  }

  trigger()
  expect(took_effect(), `not hovered → ignored`).toBe(false)

  viewer.dispatchEvent(new PointerEvent(`pointerenter`))
  await tick()
  trigger()
  expect(took_effect(), `hovered → fires without a prior click`).toBe(true)

  const input = document.createElement(`input`)
  document.body.append(input)
  input.focus()
  trigger()
  expect(took_effect(), `input focused → bails`).toBe(false)
  // blur before removing so activeElement deterministically returns to <body> (happy-dom doesn't
  // reliably reset focus when a focused element is detached), making the "resumes" check stable
  input.blur()
  input.remove()

  trigger()
  expect(took_effect(), `focus back on <body> → resumes`).toBe(true)

  viewer.dispatchEvent(new PointerEvent(`pointerleave`))
  await tick()
  trigger()
  expect(took_effect(), `pointer left → stops firing`).toBe(false)
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

// happy-dom has no canvas: stub a 2D context whose drawing calls are all spies (so charts that
// paint to canvas can mount and tests can count/inspect calls) and whose measureText reports
// `px_per_char` per character (0 = nothing is ever crowded). Installed on every canvas via
// getContext; vi.restoreAllMocks() or the returned spy's mockRestore() removes it.
export const CANVAS_NOOP_METHODS = [
  `setTransform`,
  `clearRect`,
  `save`,
  `restore`,
  `beginPath`,
  `closePath`,
  `rect`,
  `clip`,
  `fillRect`,
  `strokeRect`,
  `arc`,
  `moveTo`,
  `lineTo`,
  `fill`,
  `stroke`,
  `fillText`,
  `drawImage`,
  `scale`,
  `translate`,
] as const
export const mock_canvas_context = (
  overrides: Partial<Record<keyof CanvasRenderingContext2D, unknown>> = {},
  px_per_char = 0,
): CanvasRenderingContext2D => {
  const ctx = {
    font: ``,
    measureText: vi.fn((label: string) => ({ width: label.length * px_per_char })),
    ...Object.fromEntries(CANVAS_NOOP_METHODS.map((name) => [name, vi.fn()])),
    ...overrides,
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(ctx)
  return ctx
}

// jsdom has no text metrics, so canvas-measured tick labels all come out 0 wide and nothing
// ever looks crowded. Stand in a proportional-ish width per character. Caller restores.
export const mock_text_measurement = (px_per_char = 7) => {
  mock_canvas_context({}, px_per_char)
  return vi.mocked(HTMLCanvasElement.prototype.getContext)
}

export async function with_measured_text<T>(
  run: () => T | Promise<T>,
  px_per_char?: number,
): Promise<T> {
  const spy = mock_text_measurement(px_per_char)
  try {
    return await run()
  } finally {
    spy.mockRestore()
  }
}

// Mount a component into a fresh container, find its root via `selector`, and
// resize it so width/height-dependent rendering (SVG plots, canvases) kicks in.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export async function mount_sized<Comp extends Component<any>>(
  component: Comp,
  props: Partial<ComponentProps<Comp>>,
  options: {
    selector: string
    width?: number
    height?: number
    on_mount?: (mounted: ReturnType<typeof mount>) => void
  },
): Promise<HTMLElement> {
  const { selector, width = 400, height = 300 } = options
  const target = document.createElement(`div`)
  document.body.append(target)
  const style = (props as { style?: string }).style ?? ``
  // Object.assign (not spread) keeps bind_props accessors intact
  const mounted = mount(component, {
    target,
    props: Object.assign(props, {
      style: `width: ${width}px; height: ${height}px; ${style}`,
    }),
  })
  options.on_mount?.(mounted)
  const root = query(target, selector)
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

// Minimal VolumetricData fixture from a nested [x][y][z] grid; values are flattened
// z-fastest, data_range is computed from them, and overrides win over every default
export const make_volume = (
  grid: number[][][],
  overrides: Partial<VolumetricData> = {},
): VolumetricData => {
  const flat = flatten_grid(grid)
  return {
    ...make_volume_from_values(flat.values, flat.dims, {
      lattice: [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ],
      origin: [0, 0, 0],
      periodic: true,
    }),
    ...overrides,
  }
}

// Number of elements per category in element_data
export const CATEGORY_COUNTS: Record<ElementCategory, number> = {
  actinide: 15,
  'alkali metal': 6,
  'alkaline earth metal': 6,
  'diatomic nonmetal': 7,
  lanthanide: 15,
  metalloid: 8,
  'noble gas': 7,
  'polyatomic nonmetal': 4,
  'post-transition metal': 12,
  'transition metal': 38,
}

// Value at grid point (ix, iy, iz) of a flat volume
export const grid_value = (
  volume: Pick<VolumetricData, `values` | `dims`>,
  ix: number,
  iy: number,
  iz: number,
): number => volume.values[(ix * volume.dims[1] + iy) * volume.dims[2] + iz]

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

// Convex-hull/chempot PhaseData fixture: total `energy` derives from `energy_per_atom` ×
// atom count (so e_form, hull distances and chempot planes all agree); `overrides` wins.
export const make_phase = (
  composition: Record<string, number>,
  energy_per_atom = 0,
  overrides: Partial<PhaseData> = {},
): PhaseData => {
  const atoms = Object.values(composition).reduce((sum, amt) => sum + amt, 0)
  return { composition, energy_per_atom, energy: energy_per_atom * atoms, ...overrides }
}

// Read and JSON.parse a (possibly gzipped) JSON file. Cast the result at the call site.
// Generic param is a typed-load convenience for call sites (load_json<Foo>(path)),
// not used for inference, hence the single-use type parameter is intentional.
// oxlint-disable-next-line typescript-eslint/no-unnecessary-type-parameters
export const load_json = <T = unknown>(file_path: string): T =>
  JSON.parse(read_maybe_gz(file_path)) as T

// Gzip a string to the ArrayBuffer a File/fetch response would carry.
export const gzip_bytes = (content: string): Promise<ArrayBuffer> =>
  new Response(
    new Blob([content]).stream().pipeThrough(new CompressionStream(`gzip`)),
  ).arrayBuffer()

// Drop event carrying files, for the file-drop handlers of Structure, Trajectory,
// FermiSurface, XrdPlot and the phase diagrams. `dataTransfer` must go on via
// defineProperty: it is a getter on the DragEvent prototype, so assignment silently no-ops.
// Empty `items` means "no entry API", i.e. treat the drop as a flat file list. `text_plain`
// simulates the path payload an OS/IDE drag carries alongside the file itself.
export const create_drop_event = (
  files: File | File[],
  { text_plain = `` }: { text_plain?: string } = {},
): DragEvent => {
  const drag_event = new DragEvent(`drop`, { bubbles: true })
  Object.defineProperty(drag_event, `dataTransfer`, {
    value: {
      files: Array.isArray(files) ? files : [files],
      items: [],
      getData: (type: string) => (type === `text/plain` ? text_plain : ``),
    },
  })
  return drag_event
}

// Two-frame XYZ, the smallest input that exercises multi-frame parsing
export const MULTI_FRAME_XYZ = `2\nStep 1\nH 0.0 0.0 0.0\nH 0.0 0.0 0.74
2\nStep 2\nH 0.0 0.0 0.0\nH 0.0 0.0 0.78`

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

// In-memory TrajectoryRun over make_trajectory_frame frames: `steps` is a step list or a frame
// count (steps 0..n-1); `frame_metadata(frame_idx)` fills each frame's metadata; the remaining
// options are forwarded to trajectory_from_frames (provenance, time_step, warnings, ...).
export const make_run = (
  steps: number | readonly number[] = 3,
  {
    site_count = 2,
    lattice_params,
    frame_metadata = () => ({}),
    ...extras
  }: MemoryRunExtras & {
    site_count?: number
    lattice_params?: Record<string, number>
    frame_metadata?: (frame_idx: number) => Record<string, unknown>
  } = {},
): TrajectoryRun => {
  const step_list =
    typeof steps === `number` ? Array.from({ length: steps }, (_unused, idx) => idx) : steps
  return trajectory_from_frames(
    step_list.map((step, frame_idx) =>
      make_trajectory_frame(step, site_count, frame_metadata(frame_idx), lattice_params),
    ),
    extras,
  )
}

// The same run with its plot rows replaced (and optionally a different frame_count), for
// panes that read sampled/progressive property rows rather than the frames
export const with_property_rows = (
  run: TrajectoryRun,
  rows: TrajectoryMetadata[],
  frame_count = run.frame_count,
): TrajectoryRun => ({ ...run, frame_count, properties: new TrajectoryProperties(rows, true) })

// Resolve a rejection to its reason so the error class/fields can be inspected
export const rejection_of = (pending: Promise<unknown>): Promise<unknown> =>
  pending.then(
    () => undefined,
    (reason: unknown) => reason,
  )

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

// Cubic crystal from xyz-only sites (element defaults to C, label to the element symbol)
export const make_struct = (
  sites: { xyz: Vec3; element?: ElementSymbol }[],
  lattice_const = 10,
): Crystal =>
  make_crystal(
    lattice_const,
    sites.map(({ xyz, element = `C` }) => ({ element, xyz, label: element })),
  )

// Lattice-free structure from [element, xyz] pairs; abc is meaningless without a cell
export const make_molecule = (atoms: [string, Vec3][]): Molecule => ({
  sites: atoms.map(([element, xyz], idx) => ({
    species: [{ element: element as ElementSymbol, occu: 1, oxidation_state: 0 }],
    abc: [0, 0, 0] as Vec3,
    xyz,
    label: `${element}${idx}`,
    properties: {},
  })),
})

// Conventional rocksalt NaCl cell (4 Na + 4 Cl): every ion octahedrally coordinated by 6
// counter-ions, only 3 of which sit inside the box (the rest are periodic images)
export const make_rocksalt = (lattice_const = 5.64): Crystal =>
  make_crystal(lattice_const, [
    [`Na`, [0, 0, 0]],
    [`Na`, [0.5, 0.5, 0]],
    [`Na`, [0.5, 0, 0.5]],
    [`Na`, [0, 0.5, 0.5]],
    [`Cl`, [0.5, 0, 0]],
    [`Cl`, [0, 0.5, 0]],
    [`Cl`, [0, 0, 0.5]],
    [`Cl`, [0.5, 0.5, 0.5]],
  ])

// Trajectory frame with sites at explicit Cartesian coordinates. With `box_length` the
// structure is a cubic crystal (abc derived); without one it is a molecule, so there is no
// lattice to unwrap against. Per-site `velocities` land in site.properties.velocity.
export const make_frame = (
  step: number,
  xyz_list: number[][],
  options: {
    elements?: ElementSymbol[]
    box_length?: number
    coords_unwrapped?: boolean
    velocities?: (number[] | undefined)[]
  } = {},
): TrajectoryFrame => {
  const { box_length, coords_unwrapped, elements, velocities } = options
  const crystal = make_crystal(
    box_length ?? 1,
    xyz_list.map((xyz, idx) => ({
      element: elements?.[idx] ?? `H`,
      xyz: xyz as Vec3,
      ...(velocities?.[idx] && { properties: { velocity: velocities[idx] } }),
    })),
    { charge: 0 },
  )
  return {
    step,
    structure: box_length ? crystal : { charge: 0, sites: crystal.sites },
    ...(coords_unwrapped === undefined ? {} : { metadata: { coords_unwrapped } }),
  }
}

// Position stream laid out frame-major: positions[(frame * n_atoms + atom) * 3 + axis].
// Defaults to a 10 A cubic cell per frame with full pbc and wrapped coords.
export const make_position_stream = (
  frames: number[][][], // [frame][atom][axis]
  elements: ElementSymbol[],
  overrides: Partial<TrajectoryPositionStream> = {},
): TrajectoryPositionStream => {
  const n_frames = frames.length
  const n_atoms = elements.length
  const positions = new Float64Array(n_frames * n_atoms * 3)
  for (const [frame_idx, frame] of frames.entries()) {
    for (const [atom_idx, xyz] of frame.entries()) {
      positions.set(xyz, (frame_idx * n_atoms + atom_idx) * 3)
    }
  }
  return {
    positions,
    n_frames,
    n_atoms,
    elements,
    lattice_matrices: Array.from({ length: n_frames }, () => cubic_matrix(10)),
    pbc: [true, true, true],
    coords_unwrapped: false,
    frame_stride: 1,
    steps: Array.from({ length: n_frames }, (_, idx) => idx),
    ...overrides,
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

// Primitive fcc cell of the conventional cubic cell with edge `a` (the 1-atom Cu / 2-atom
// diamond input that moyo standardizes to the 4-/8-atom conventional cell)
export const fcc_primitive_matrix = (a: number): math.Matrix3x3 => [
  [0, a / 2, a / 2],
  [a / 2, 0, a / 2],
  [a / 2, a / 2, 0],
]

// === Fermi surface fixtures ===
// Typed-array FermiIsosurface from plain vertex rows and N-gon faces (fan-triangulated like
// the JSON parser); normals all point +z
export const make_fermi_isosurface = (
  vertices: Vec3[],
  faces: number[][],
  extra: Partial<FermiIsosurface> = {},
): FermiIsosurface => ({
  positions: Float32Array.from(vertices.flat()),
  indices: Uint32Array.from(
    faces.flatMap((face) =>
      Array.from({ length: Math.max(face.length - 2, 0) }, (_, fan) => [
        face[0],
        face[fan + 1],
        face[fan + 2],
      ]).flat(),
    ),
  ),
  normals: Float32Array.from(vertices.flatMap(() => [0, 0, 1])),
  band_index: 0,
  spin: null,
  ...extra,
})

// FermiSurfaceData around `isosurfaces` with an identity k-lattice
export const make_fermi_surface = (
  isosurfaces: FermiIsosurface[],
  extra: Partial<FermiSurfaceData> = {},
): FermiSurfaceData => ({
  isosurfaces,
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 0,
  reciprocal_cell: `wigner_seitz`,
  metadata: {
    n_bands: new Set(isosurfaces.map((iso) => iso.band_index)).size,
    n_surfaces: isosurfaces.length,
  },
  ...extra,
})

// Thin box: a unit square sheet at z=0 extruded to z=0.1, as 12 triangles
export const BOX_VERTICES: Vec3[] = [
  [-0.5, -0.5, 0],
  [0.5, -0.5, 0],
  [0.5, 0.5, 0],
  [-0.5, 0.5, 0],
  [-0.5, -0.5, 0.1],
  [0.5, -0.5, 0.1],
  [0.5, 0.5, 0.1],
  [-0.5, 0.5, 0.1],
]
// oxfmt-ignore
export const BOX_TRI_FACES = [
  [0, 1, 2], [0, 2, 3], // bottom
  [4, 6, 5], [4, 7, 6], // top
  [0, 4, 5], [0, 5, 1], // front
  [2, 6, 7], [2, 7, 3], // back
  [0, 3, 7], [0, 7, 4], // left
  [1, 5, 6], [1, 6, 2], // right
]

// 3×3×3 single-band BXSF grid on an identity reciprocal lattice; the centre point is the 8.0
// maximum and the `# Fermi energy` header comment carries `fermi_energy`
export const make_bxsf = (fermi_energy = 7) =>
  `# Sample BXSF file\n# Fermi energy: ${fermi_energy} eV\n\nBEGIN_BLOCK_BANDGRID_3D\n  band_energies\n  BEGIN_BANDGRID_3D\n    1\n    3 3 3\n    0.0 0.0 0.0\n    1.0 0.0 0.0\n    0.0 1.0 0.0\n    0.0 0.0 1.0\n    BAND:   1\n    5.0 6.0 5.0\n    6.0 7.0 6.0\n    5.0 6.0 5.0\n    6.0 7.0 6.0\n    7.0 8.0 7.0\n    6.0 7.0 6.0\n    5.0 6.0 5.0\n    6.0 7.0 6.0\n    5.0 6.0 5.0\n  END_BANDGRID_3D\nEND_BLOCK_BANDGRID_3D\n`

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
): SymmetryDataset => {
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
    orig_site_indices_by_input_idx:
      orig_site_indices_by_input_idx ?? positions.map((_pos, idx) => [idx]),
  } as unknown as SymmetryDataset
}

// Reset the shared writeText mock for one test (clears calls from earlier tests); pass an
// error to make the copy fail
export const mock_clipboard_write = (error?: Error) => {
  const write_text = vi.mocked(navigator.clipboard.writeText).mockReset()
  return error ? write_text.mockRejectedValue(error) : write_text.mockResolvedValue(undefined)
}

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

// Walk repo-local runtime imports and fail if an entry reaches Svelte or another forbidden
// browser-only module. Type-only imports are erased before traversal.
export function expect_worker_safe_import_graph(
  entry_paths: readonly string[],
  min_modules: number,
  forbidden_modules: readonly string[] = [],
): void {
  const repo_root = resolve(current_dir, `../..`)
  const entry_files = entry_paths.map((entry_path) => resolve(repo_root, entry_path))
  const source_extensions = [`.ts`, `.svelte`, `.js`, `.mjs`]
  const resolve_specifier = (specifier: string, from_file: string): string | null => {
    let base: string
    if (specifier.startsWith(`$lib`)) {
      base = resolve(repo_root, `src/lib`, specifier.slice(`$lib`.length).replace(/^\//, ``))
    } else if (specifier.startsWith(`.`)) base = resolve(dirname(from_file), specifier)
    else return null
    const candidates = source_extensions.some((extension) => base.endsWith(extension))
      ? [base]
      : source_extensions.flatMap((extension) => [
          `${base}${extension}`,
          resolve(base, `index${extension}`),
        ])
    return candidates.find(existsSync) ?? null
  }
  const queue = [...entry_files]
  const visited = new Set<string>()
  const violations: string[] = []
  while (queue.length) {
    const file = queue.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    const source = readFileSync(file, `utf-8`).replaceAll(
      /(?:import|export)\s+(?:\{\s*(?:type\s+[^,}]+,?\s*)+\}|type\s+[^;]*?)\s+from\s*['"`][^'"`]+['"`]\s*;?/g,
      ``,
    )
    for (const match of source.matchAll(
      /(?:from|import)\s*\(?\s*['"`](?<specifier>[^'"`]+)['"`]/g,
    )) {
      const specifier = match.groups?.specifier ?? ``
      if (
        specifier === `svelte` ||
        specifier.startsWith(`svelte/`) ||
        specifier.endsWith(`.svelte`) ||
        forbidden_modules.includes(specifier)
      ) {
        violations.push(`${file} imports "${specifier}"`)
        continue
      }
      const resolved = resolve_specifier(specifier, file)
      if (resolved) queue.push(resolved)
    }
  }
  expect(visited.size).toBeGreaterThan(min_modules)
  expect(entry_files.every((entry_file) => visited.has(entry_file))).toBe(true)
  expect(violations).toEqual([])
}

// === Worker stub ===
// happy-dom has no Worker, so the analysis modules only ever reach their synchronous
// fallback. Installing this stub before the async module is imported (create_worker_client
// keeps one worker per module) exercises the real postMessage plumbing: payloads are
// structured-cloned exactly as a browser would (a Svelte $state proxy or a function throws
// here too) and `compute` plays the worker script, replying `{ id, result, error }` on the
// next microtask. A throwing `compute` becomes an error reply, as the real worker scripts
// do; without `compute` the stub never replies and the test drives `emit` itself. Module
// isolation per test file makes the global stub self-cleaning.
export type StubWorkerMessage = { id: number; input: unknown; options?: unknown }
export type StubWorkerInstance<Message = StubWorkerMessage> = {
  url: string
  options: WorkerOptions | undefined
  posted: { message: Message; transfer: Transferable[] }[]
  terminated: number
  emit: (type: string, event: unknown) => void
}

// The one module worker a `create_worker_client` module constructs points at `worker_path`
// (e.g. `src/lib/msd/msd-worker.ts`) as an ES module. Vite only detects and rewrites the
// worker when the URL keeps the `./` prefix and the `.js` extension; detection turns the
// source `.js` spec into the real `.ts` module tagged `?worker_file`, and losing that means
// the app 404s on the worker at runtime and silently never enters the worker branch.
export const expect_module_worker = (
  instances: { url: string; options: WorkerOptions | undefined }[],
  worker_path: string,
): void => {
  expect(instances).toHaveLength(1)
  expect(instances[0].url).toMatch(new RegExp(`/${worker_path}\\?worker_file`))
  expect(instances[0].options).toEqual({ type: `module` })
}

export const install_stub_worker = <Message extends { id: number } = StubWorkerMessage>(
  compute?: (message: Message) => unknown,
) => {
  const instances: StubWorkerInstance<Message>[] = []
  const posted: { message: Message; transfer: Transferable[] }[] = []
  let next_error: string | null = null

  class StubWorker implements StubWorkerInstance<Message> {
    url: string
    options: WorkerOptions | undefined
    posted: { message: Message; transfer: Transferable[] }[] = []
    terminated = 0
    onmessage: ((event: unknown) => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

    constructor(url: URL | string, options?: WorkerOptions) {
      this.url = String(url)
      this.options = options
      instances.push(this)
    }
    addEventListener(type: string, handler: (event: unknown) => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
    }
    removeEventListener(type: string, handler: (event: unknown) => void): void {
      this.listeners.set(
        type,
        (this.listeners.get(type) ?? []).filter((fn) => fn !== handler),
      )
    }
    emit(type: string, event: unknown): void {
      for (const handler of this.listeners.get(type) ?? []) handler(event)
      if (type === `message`) this.onmessage?.(event)
      if (type === `error`) this.onerror?.(event)
    }
    terminate(): void {
      this.terminated++
    }
    postMessage(message: Message, transfer: Transferable[] = []): void {
      const cloned = structuredClone(message)
      this.posted.push({ message: cloned, transfer })
      posted.push({ message: cloned, transfer })
      if (!compute) return
      const error = next_error
      next_error = null
      queueMicrotask(() => {
        if (this.terminated) return // a terminated worker delivers nothing
        let data: { id: number; result: unknown; error: string | null }
        try {
          data = error
            ? { id: cloned.id, result: null, error }
            : { id: cloned.id, result: structuredClone(compute(cloned)), error: null }
        } catch (err) {
          data = { id: cloned.id, result: null, error: to_error(err).message }
        }
        this.emit(`message`, { data, preventDefault: () => {} })
      })
    }
  }

  vi.stubGlobal(`Worker`, StubWorker)
  return {
    // Every worker constructed so far, oldest first
    instances,
    // Every post across all instances
    posted,
    // The next post replies with this error instead of calling `compute`
    fail_next: (error: string) => {
      next_error = error
    },
    // Forget recorded posts and a pending one-shot error (for afterEach)
    reset: () => {
      posted.length = 0
      for (const instance of instances) instance.posted.length = 0
      next_error = null
    },
  }
}

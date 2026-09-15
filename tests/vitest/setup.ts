import type { Rect } from '$lib/plot/core/layout'
import { to_error } from '$lib/utils'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { type Component, type ComponentProps, flushSync, mount, tick } from 'svelte'
import { expect, onTestFinished, vi } from 'vitest'

export {
  get_resize_observer_count,
  trigger_intersection,
  trigger_resize_observer,
} from './environment'

// Exercise real parsers in happy-dom; worker transport has its own tests.
export async function mock_parse_worker(): Promise<void> {
  const [worker, { parse_file_content }] = await Promise.all([
    import(`$lib/file-viewer/parse-in-worker`),
    import(`$lib/file-viewer/parse`),
  ])
  vi.spyOn(worker, `parse_in_worker`).mockImplementation(
    // Node cannot mount Blobs through h5wasm's worker-only WORKERFS.
    async (data, filename, is_base64, options = {}) =>
      parse_file_content(
        data instanceof Blob ? await data.arrayBuffer() : data,
        filename,
        is_base64,
        options.load_options,
        options.on_progress,
      ),
  )
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
    (element) => element.getAttribute(`tabindex`) ?? ``,
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

export const set_select = (select: HTMLSelectElement, value: string): void => {
  // Svelte's select bind reads `option:checked`; happy-dom does not match that selector.
  type QueryableSelect = {
    querySelector: (selector: string) => Element | null
  }
  const queryable_select = select as unknown as QueryableSelect
  const original_query = queryable_select.querySelector
  queryable_select.querySelector = (selector: string) => {
    if (selector === `:checked`) {
      return [...select.options].find((option) => option.value === value) ?? null
    }
    return original_query.call(select, selector)
  }
  select.value = value
  select.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
  queryable_select.querySelector = original_query
}

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
export const svg_rect = (element: Element): Rect => ({
  x: Number(element.getAttribute(`x`)),
  y: Number(element.getAttribute(`y`)),
  width: Number(element.getAttribute(`width`)),
  height: Number(element.getAttribute(`height`)),
})
// The plot-area clip rect of a Cartesian chart, i.e. where its data can be hit
export const clip_rect = (root: ParentNode = document): Rect =>
  svg_rect(query(root, `defs clipPath rect`))

// Pixel position an element is translate()d to
export const translate_of = (
  element: Element | null | undefined,
): { x: number; y: number } => {
  const transform = element?.getAttribute(`transform`) ?? ``
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
export const inside_clip_path = (element: Element | null | undefined): boolean => {
  for (
    let node = element?.parentElement;
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

// Resolve a rejection to its reason so the error class/fields can be inspected
export const rejection_of = (pending: Promise<unknown>): Promise<unknown> =>
  pending.then(
    () => undefined,
    (reason: unknown) => reason,
  )

// Reset the shared writeText mock for one test (clears calls from earlier tests); pass an
// error to make the copy fail
export const mock_clipboard_write = (error?: Error) => {
  const write_text = vi.mocked(navigator.clipboard.writeText).mockReset()
  return error ? write_text.mockRejectedValue(error) : write_text.mockResolvedValue(undefined)
}

// Walk repo-local runtime imports and fail if an entry reaches Svelte or another forbidden
// browser-only module. Type-only imports are erased before traversal.
export function expect_worker_safe_import_graph(
  entry_paths: readonly string[],
  min_modules: number,
  forbidden_modules: readonly string[] = [],
): void {
  const repo_root = resolve(import.meta.dirname, `../..`)
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
        (this.listeners.get(type) ?? []).filter((callback) => callback !== handler),
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

import BrillouinZone from '$lib/brillouin/BrillouinZone.svelte'
import { compute_brillouin_zone } from '$lib/brillouin/compute'
import type { BrillouinZoneData } from '$lib/brillouin/types'
import { reciprocal_lattice } from '$lib/math'
import type * as symmetry from '$lib/symmetry'
import { type ComponentProps, createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import {
  create_drop_event,
  cubic_matrix,
  doc_query,
  make_crystal,
  mock_fullscreen,
  type SimpleSite,
} from '../setup'

// The IBZ needs moyo's point group; stand in for the WASM analysis so a test can make it fail
const analyze_structure_symmetry = vi.hoisted(() => vi.fn())
vi.mock(`$lib/symmetry`, async (original) => ({
  ...(await original<typeof symmetry>()),
  analyze_structure_symmetry,
}))

let mounted_component: ReturnType<typeof mount> | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  if (mounted_component) await unmount(mounted_component)
  mounted_component = undefined
})

const si_site: SimpleSite[] = [[`Si`, [0, 0, 0]]]
const poscar = `cubic
1.0
3 0 0
0 3 0
0 0 3
Si
1
Direct
0 0 0
`
const cubic = make_crystal(3, si_site)
// A coplanar lattice has no reciprocal lattice, so no zone can be derived from it
const coplanar = make_crystal(
  [
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
  si_site,
)
// A zone of a different lattice so it cannot be confused with one computed from `cubic`
const external = compute_brillouin_zone(
  reciprocal_lattice(cubic_matrix(5), { two_pi: true }),
  1,
)

test(`loads dropped structures and reports their provenance`, async () => {
  const on_file_load = vi.fn()
  const props = $state({
    structure: undefined as typeof cubic | undefined,
    on_file_load,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await tick()
  const file = new File([poscar], `cubic.poscar`)
  document.querySelector(`.brillouin-zone`)?.dispatchEvent(create_drop_event(file))
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
  expect(props.structure?.lattice.a).toBe(3)
  expect(on_file_load).toHaveBeenCalledWith(
    expect.objectContaining({
      filename: file.name,
      source_filename: file.name,
      file,
      bz_data: expect.objectContaining({ order: 1 }),
    }),
  )
})

test(`loads later data URLs after the first URL-owned structure`, async () => {
  vi.spyOn(globalThis, `fetch`).mockImplementation(() => Promise.resolve(new Response(poscar)))
  const on_file_load = vi.fn()
  const props = $state({ data_url: `http://x/a.poscar`, on_file_load })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))
  props.data_url = `http://x/b.poscar`
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2))
  expect(on_file_load.mock.calls.map(([payload]) => payload.filename)).toEqual([
    `a.poscar`,
    `b.poscar`,
  ])
})

test(`a stale URL response cannot overwrite a newer structure`, async () => {
  const responses = new Map<string, (response: Response) => void>()
  vi.spyOn(globalThis, `fetch`).mockImplementation((input) => {
    const url = input instanceof Request ? input.url : input.toString()
    return new Promise((resolve) => responses.set(url, resolve))
  })
  const on_file_load = vi.fn()
  const props = $state({ data_url: `http://x/a.poscar`, on_file_load })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(responses.has(`http://x/a.poscar`)).toBe(true))
  props.data_url = `http://x/b.poscar`
  await vi.waitFor(() => expect(responses.has(`http://x/b.poscar`)).toBe(true))
  responses.get(`http://x/b.poscar`)?.(new Response(poscar))
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
  responses.get(`http://x/a.poscar`)?.(new Response(poscar))
  await tick()
  expect(on_file_load.mock.calls.map(([payload]) => payload.filename)).toEqual([`b.poscar`])
})

test(`a failing load callback keeps the parsed value and URL ownership`, async () => {
  vi.spyOn(globalThis, `fetch`).mockImplementation(() => Promise.resolve(new Response(poscar)))
  const on_file_load = vi.fn((data: { filename?: string }) => {
    if (data.filename === `a.poscar`) throw new Error(`host exploded`)
  })
  const on_error = vi.fn()
  const props = $state({
    data_url: `http://x/a.poscar`,
    structure: undefined as typeof cubic | undefined,
    on_file_load,
    on_error,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() =>
    expect(on_error).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: `a.poscar`,
        error_msg: `on_file_load failed for a.poscar: host exploded`,
      }),
    ),
  )
  expect(props.structure?.sites).toHaveLength(1)
  props.data_url = `http://x/b.poscar`
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2))
  expect(on_file_load).toHaveBeenLastCalledWith(
    expect.objectContaining({ filename: `b.poscar` }),
  )
})

// A host on_file_drop owns whatever it stores in `structure`; that value must not read as a
// caller-supplied one that cancels the URL, or a second data_url would never be fetched
test(`loads a second data_url when a host on_file_drop set the structure`, async () => {
  vi.spyOn(globalThis, `fetch`).mockImplementation(() => Promise.resolve(new Response(poscar)))
  const on_file_drop = vi.fn((_content: string | ArrayBuffer, _filename: string) => {
    props.structure = cubic
  })
  const props = $state({
    data_url: `http://x/a.poscar`,
    structure: undefined as typeof cubic | undefined,
    on_file_drop,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledTimes(1))
  await tick()

  props.data_url = `http://x/b.poscar`
  await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledTimes(2))
  expect(on_file_drop.mock.calls.map((call) => call[1])).toEqual([`a.poscar`, `b.poscar`])
})

test(`reports loading while a structure_string is parsed`, async () => {
  const on_file_load = vi.fn()
  const props = $state({ structure_string: poscar, loading: false, on_file_load })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  flushSync()
  // Parsing is asynchronous, so the spinner covers at least one microtask
  expect(props.loading).toBe(true)
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))
  expect(props.loading).toBe(false)
  expect(on_file_load.mock.calls[0][0].bz_data?.order).toBe(1)
})

test(`ignores a stale async on_file_drop failure`, async () => {
  vi.spyOn(globalThis, `fetch`).mockImplementation(() => Promise.resolve(new Response(poscar)))
  const first_drop = Promise.withResolvers<undefined>()
  const second_drop = Promise.withResolvers<undefined>()
  const completed_filenames: string[] = []
  const on_file_drop = vi.fn(async (_content: string | ArrayBuffer, filename: string) => {
    await (filename === `a.poscar` ? first_drop.promise : second_drop.promise)
    completed_filenames.push(filename)
  })
  const on_error = vi.fn()
  const props = $state({ data_url: `http://x/a.poscar`, on_file_drop, on_error })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledTimes(1))

  props.data_url = `http://x/b.poscar`
  await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledTimes(2))
  first_drop.reject(new Error(`stale parse failure`))
  second_drop.resolve(undefined)
  await vi.waitFor(() => {
    expect(completed_filenames).toEqual([`b.poscar`])
    expect(on_error).not.toHaveBeenCalled()
  })
})

// The file viewer mounts the component with only {k_lattice, vertices, faces}: the zone renders
// on its own rather than asking for a structure file
test(`a caller-supplied bz_data without a structure renders the zone`, async () => {
  const { children, rendered } = zone_probe()
  mounted_component = mount(BrillouinZone, {
    target: document.body,
    props: { bz_data: external, children, info_pane_open: true },
  })
  await tick()
  await tick()
  expect(rendered()).toBe(external)
  const viewer = document.body.querySelector(`.brillouin-zone`)
  expect(viewer?.textContent).not.toContain(`Drop Structure File`)
  expect(viewer?.querySelector(`.control-buttons`)).not.toBeNull()
  // Zone-only info rows; the real lattice needs a structure
  expect(viewer?.textContent).toContain(`Vertices / Faces`)
  expect(viewer?.textContent).not.toContain(`Real Lattice`)
})

// A coplanar lattice has no reciprocal lattice: the viewer must report that (error_msg +
// on_error) rather than render NaN geometry or quietly show nothing
test(`reports a singular lattice instead of computing a zone`, async () => {
  const on_error = vi.fn()
  const props = $state({
    structure: coplanar,
    on_error,
    error_msg: undefined as string | undefined,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(1))
  expect(on_error.mock.calls[0][0].error_msg).toMatch(/BZ computation failed: .*singular/)
  expect(props.error_msg).toMatch(/singular/)
  expect(document.body.querySelector(`.brillouin-zone`)?.textContent).toMatch(/singular/)
})

// The zone the component renders, observed through its `children` snippet (the derived zone
// is never written back to the `bz_data` prop). The snippet type is intersected with
// HTMLAttributes' argument-less Snippet, hence the cast.
function zone_probe() {
  let rendered: BrillouinZoneData | undefined
  const children = createRawSnippet<[{ bz_data?: BrillouinZoneData }]>((get) => ({
    render: () => `<span></span>`,
    setup: () => {
      $effect(() => {
        rendered = get().bz_data
      })
    },
  })) as ComponentProps<typeof BrillouinZone>[`children`]
  return { children, rendered: () => rendered }
}

// Regression: the zone used to be computed once and then frozen (the effect early-returned
// whenever bz_data already had vertices), so bz_order and structure changes were ignored
test(`recomputes the zone when bz_order or the structure changes`, async () => {
  const { children, rendered } = zone_probe()
  const props = $state({ structure: cubic, bz_order: 1, children })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(rendered()?.order).toBe(1))
  const first_volume = rendered()?.volume ?? 0
  expect(first_volume).toBeCloseTo(((2 * Math.PI) / 3) ** 3, 8)

  props.bz_order = 2
  await vi.waitFor(() => expect(rendered()?.order).toBe(2))
  expect(rendered()?.volume).toBeGreaterThan(first_volume)

  props.bz_order = 1
  props.structure = make_crystal(6, si_site)
  // Doubling the cell halves every reciprocal vector: 1/8 of the first zone's volume
  await vi.waitFor(() => expect(rendered()?.volume).toBeCloseTo(first_volume / 8, 8))
})

// pymatviz's BrillouinZoneWidget(structure=..., bz_data=...) hands over both: the user's zone
// must be rendered as-is and never overwritten by (or replaced with) the structure-derived one
test(`a caller-supplied bz_data wins over the structure-derived zone and is never written back`, async () => {
  const { children, rendered } = zone_probe()
  // Getter/setter props stand in for a bound parent: the getter hands the zone over by
  // identity (a deep $state would proxy it) and any write-back would hit the setter
  const set_bz_data = vi.fn()
  const props = $state({ bz_order: 1, supplied: true })
  mounted_component = mount(BrillouinZone, {
    target: document.body,
    props: {
      structure: cubic,
      children,
      get bz_order() {
        return props.bz_order
      },
      set bz_order(value) {
        props.bz_order = value
      },
      get bz_data() {
        return props.supplied ? external : undefined
      },
      set bz_data(value) {
        set_bz_data(value)
      },
    },
  })
  await tick()
  await tick()
  expect(rendered()).toBe(external)

  // Order changes only affect the derived zone; the external one keeps rendering
  props.bz_order = 2
  await tick()
  await tick()
  expect(rendered()).toBe(external)

  // Clearing it falls back to the zone derived from the structure at the current order
  props.supplied = false
  await vi.waitFor(() => expect(rendered()?.order).toBe(2))
  expect(rendered()?.volume).toBeGreaterThan(((2 * Math.PI) / 3) ** 3)
  expect(set_bz_data).not.toHaveBeenCalled()
})

// The caller's zone is what renders, so a structure whose own zone cannot be derived must not
// raise the fatal error that blanks the viewer
test(`a caller-supplied bz_data keeps rendering when the structure's zone fails to compute`, async () => {
  const on_error = vi.fn()
  const props = $state({
    structure: coplanar,
    bz_data: external,
    on_error,
    error_msg: undefined as string | undefined,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await tick()
  await tick()
  expect(props.error_msg).toBeUndefined()
  expect(on_error).not.toHaveBeenCalled()
  // deep $state proxies the zone, so compare by value
  expect(props.bz_data.volume).toBe(external.volume)
  expect(document.body.querySelector(`.brillouin-zone`)?.textContent).not.toMatch(/singular/)
})

test(`a structure that derives again clears the previous BZ computation error`, async () => {
  const { children, rendered } = zone_probe()
  const props = $state({
    structure: coplanar,
    children,
    error_msg: undefined as string | undefined,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(props.error_msg).toMatch(/singular/))
  props.structure = cubic
  await vi.waitFor(() => expect(rendered()?.order).toBe(1))
  expect(props.error_msg).toBeUndefined()
})

// The IBZ is an optional overlay: a failure used to land in the fatal error_msg and blank the
// whole viewer (and stuck there after show_ibz was switched off)
test(`an IBZ failure keeps the zone rendered and clears once show_ibz is off`, async () => {
  analyze_structure_symmetry.mockRejectedValue(new Error(`degenerate point group`))
  const on_error = vi.fn()
  const { children, rendered } = zone_probe()
  const props = $state({
    structure: cubic,
    show_ibz: true,
    on_error,
    children,
    error_msg: undefined as string | undefined,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(1))
  expect(on_error.mock.calls[0][0].error_msg).toMatch(/IBZ computation failed: .*degenerate/)
  expect(props.error_msg).toBeUndefined()
  expect(rendered()?.vertices.length).toBeGreaterThan(0)
  const viewer = document.body.querySelector(`.brillouin-zone`)
  expect(viewer?.querySelector(`.status-message.warning`)?.textContent).toMatch(/degenerate/)
  expect(viewer?.querySelector(`.control-buttons`)).not.toBeNull() // zone chrome still up

  props.show_ibz = false
  await vi.waitFor(() => expect(viewer?.querySelector(`.status-message`)).toBeNull())
})

// Wiring check that a real viewer picks up the shared shortcut; the full key contract
// (chords, repeats, nesting) is covered in layout/FullscreenButton.test
test(`hovering the zone and pressing f fullscreens it`, async () => {
  mock_fullscreen()
  const props = $state({ structure: cubic, fullscreen: false })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await tick()
  const zone = doc_query(`.brillouin-zone`)
  zone.dispatchEvent(new PointerEvent(`pointerenter`))
  globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `f` }))
  await tick()
  expect(props.fullscreen).toBe(true)
})

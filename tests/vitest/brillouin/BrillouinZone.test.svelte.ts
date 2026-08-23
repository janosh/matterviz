import BrillouinZone from '$lib/brillouin/BrillouinZone.svelte'
import { compute_brillouin_zone } from '$lib/brillouin/compute'
import type { BrillouinZoneData } from '$lib/brillouin/types'
import { reciprocal_lattice } from '$lib/math'
import type * as symmetry from '$lib/symmetry'
import { type ComponentProps, createRawSnippet, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { make_crystal } from '../setup'

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

const poscar = `cubic\n1.0\n3 0 0\n0 3 0\n0 0 3\nSi\n1\nDirect\n0 0 0\n`

// Without mark_owned, the first parsed structure looks caller-supplied and prevents the
// loader from fetching a second URL.
test(`loads a second data_url after the first has produced a structure`, async () => {
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

// A coplanar lattice has no reciprocal lattice: the viewer must report that (error_msg +
// on_error) rather than render NaN geometry or quietly show nothing
test(`reports a singular lattice instead of computing a zone`, async () => {
  const on_error = vi.fn()
  const coplanar = make_crystal(
    [
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    [[`Si`, [0, 0, 0]]],
  )
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
  const props = $state({
    data_url: `http://x/a.poscar`,
    on_file_drop,
    on_error,
  })
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

// Regression: the zone used to be computed once and then frozen (the effect early-returned
// whenever bz_data already had vertices), so bz_order and structure changes were ignored
test(`recomputes the zone when bz_order or the structure changes`, async () => {
  const cubic = make_crystal(
    [
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
    ],
    [[`Si`, [0, 0, 0]]],
  )
  const props = $state({
    structure: cubic,
    bz_order: 1,
    bz_data: undefined as BrillouinZoneData | undefined,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(props.bz_data?.order).toBe(1))
  const first_volume = props.bz_data?.volume ?? 0
  expect(first_volume).toBeCloseTo(((2 * Math.PI) / 3) ** 3, 8)

  props.bz_order = 2
  await vi.waitFor(() => expect(props.bz_data?.order).toBe(2))
  expect(props.bz_data?.volume).toBeGreaterThan(first_volume)

  props.bz_order = 1
  props.structure = make_crystal(
    [
      [6, 0, 0],
      [0, 6, 0],
      [0, 0, 6],
    ],
    [[`Si`, [0, 0, 0]]],
  )
  // Doubling the cell halves every reciprocal vector: 1/8 of the first zone's volume
  await vi.waitFor(() => expect(props.bz_data?.volume).toBeCloseTo(first_volume / 8, 8))
})

// pymatviz's BrillouinZoneWidget(structure=..., bz_data=...) hands over both: the user's zone
// must be rendered as-is and never overwritten by (or replaced with) the structure-derived one
test(`keeps a caller-supplied bz_data alongside a structure and never writes it back`, async () => {
  const cubic = make_crystal(
    [
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
    ],
    [[`Si`, [0, 0, 0]]],
  )
  // A zone of a different lattice so it cannot be confused with the computed one
  const external = compute_brillouin_zone(
    reciprocal_lattice(
      [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ],
      { two_pi: true },
    ),
    1,
  )
  const external_volume = external.volume
  let rendered: BrillouinZoneData | undefined
  // The component's children type is intersected with HTMLAttributes' argument-less Snippet
  const children = createRawSnippet<[{ bz_data?: BrillouinZoneData }]>((get) => ({
    render: () => `<span></span>`,
    setup: () => {
      $effect(() => {
        rendered = get().bz_data
      })
    },
  })) as ComponentProps<typeof BrillouinZone>[`children`]
  // $state.raw box keeps the zone's identity (a deep $state would hand back a proxy), so a
  // write-back by the component is visible as a different object
  let zone_box = $state.raw<{ zone?: BrillouinZoneData }>({ zone: external })
  const props = $state({ bz_order: 1 })
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
        return zone_box.zone
      },
      set bz_data(value) {
        zone_box = { zone: value }
      },
    },
  })
  await tick()
  await tick()
  expect(zone_box.zone).toBe(external)
  expect(rendered?.volume).toBe(external_volume)

  // Order changes re-derive only zones the component owns; the external one is left alone
  props.bz_order = 2
  await tick()
  await tick()
  expect(zone_box.zone).toBe(external)
  expect(rendered?.volume).toBe(external_volume)

  // Clearing it hands ownership back: the zone is derived from the structure again
  zone_box = {}
  await vi.waitFor(() => expect(zone_box.zone?.order).toBe(2))
  expect(zone_box.zone?.volume).toBeGreaterThan(((2 * Math.PI) / 3) ** 3)
})

// The IBZ is an optional overlay: a failure used to land in the fatal error_msg and blank the
// whole viewer (and stuck there after show_ibz was switched off)
test(`an IBZ failure keeps the zone rendered and clears once show_ibz is off`, async () => {
  analyze_structure_symmetry.mockRejectedValue(new Error(`degenerate point group`))
  const on_error = vi.fn()
  const props = $state({
    structure: make_crystal(
      [
        [3, 0, 0],
        [0, 3, 0],
        [0, 0, 3],
      ],
      [[`Si`, [0, 0, 0]]],
    ),
    show_ibz: true,
    on_error,
    error_msg: undefined as string | undefined,
    bz_data: undefined as BrillouinZoneData | undefined,
  })
  mounted_component = mount(BrillouinZone, { target: document.body, props })
  await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(1))
  expect(on_error.mock.calls[0][0].error_msg).toMatch(/IBZ computation failed: .*degenerate/)
  expect(props.error_msg).toBeUndefined()
  expect(props.bz_data?.vertices.length).toBeGreaterThan(0)
  const viewer = document.body.querySelector(`.brillouin-zone`)
  expect(viewer?.querySelector(`.status-message.warning`)?.textContent).toMatch(/degenerate/)
  expect(viewer?.querySelector(`.control-buttons`)).not.toBeNull() // zone chrome still up

  props.show_ibz = false
  await vi.waitFor(() => expect(viewer?.querySelector(`.status-message`)).toBeNull())
})

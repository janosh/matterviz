// Linked hover (tooltip/hover-link): the channels of one host, a viewer's membership of one,
// and each viewer pair wired to it, where hovering either view highlights the same entity in
// the other
import BrillouinZone from '#lib/brillouin/BrillouinZone.svelte'
import ConvexHull from '#lib/convex-hull/ConvexHull.svelte'
import ConvexHullStats from '#lib/convex-hull/ConvexHullStats.svelte'
import { compute_hull_model } from '#lib/convex-hull/model.js'
import { reciprocal_lattice } from '#lib/math.js'
import Bands from '#lib/spectral/Bands.svelte'
import { band_k_path } from '#lib/spectral/helpers.js'
import type { BaseBandStructure } from '#lib/spectral/types.js'
import SiteTable from '#lib/structure/SiteTable.svelte'
import Structure from '#lib/structure/Structure.svelte'
import type { HoverKey, HoverLink } from '#lib/tooltip/hover-link.svelte.js'
import { HoverLinks, hover_links, join_hover_link } from '#lib/tooltip/hover-link.svelte.js'
import { type Component, flushSync, mount, unmount } from 'svelte'
import { OrthographicCamera } from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query, fire, marker_position, mouse, mount_sized, plot_svg } from '../setup'
import { cubic_matrix, make_crystal, make_phase } from '../test-fixtures'

// The 3D scenes' props as their viewers pass them (no renderer in happy-dom)
const scenes = vi.hoisted(() => ({
  structure: undefined as Record<string, unknown> | undefined,
  bz: undefined as Record<string, unknown> | undefined,
}))
vi.mock(`@threlte/core`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  Canvas: (anchor: Node, props: { children: (anchor: Node) => void }) =>
    props.children(anchor),
}))
vi.mock(`#lib/structure/StructureScene.svelte`, () => ({
  default: (_anchor: Node, props: Record<string, unknown>) => {
    scenes.structure = props
    props.camera = new OrthographicCamera()
    return {}
  },
}))
vi.mock(`#lib/brillouin/BrillouinZoneScene.svelte`, () => ({
  default: (_anchor: Node, props: Record<string, unknown>) => {
    scenes.bz = props
    return {}
  },
}))

const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => {
  // both viewers gate their scene on webgpu_available(); the stubs never touch a GPU
  Object.defineProperty(navigator, `gpu`, { value: {}, configurable: true })
})
afterEach(() => {
  for (const component of mounted.splice(0)) void unmount(component)
  Object.assign(scenes, { structure: undefined, bz: undefined })
  Reflect.deleteProperty(navigator, `gpu`)
})

describe(`HoverLinks`, () => {
  const members = { a: Symbol(`a`), b: Symbol(`b`), c: Symbol(`c`) }
  type Name = keyof typeof members
  // publishes in turn as [member, channel, key], then what each member reads on channels x, y
  // oxfmt-ignore
  test.each<[string, [Name, string, HoverKey | null][], Record<Name, (HoverKey | null)[]>]>([
    [`a hover reaches the other members, not its own`, [[`a`, `x`, 1]],
      { a: [null, null], b: [1, null], c: [1, null] }],
    [`a later hover takes over`, [[`a`, `x`, 1], [`b`, `x`, 2]],
      { a: [2, null], b: [null, null], c: [2, null] }],
    [`null ends a member's own hover`, [[`a`, `x`, 1], [`a`, `x`, null]],
      { a: [null, null], b: [null, null], c: [null, null] }],
    [`but never another member's`, [[`a`, `x`, 1], [`b`, `x`, null]],
      { a: [null, null], b: [1, null], c: [1, null] }],
    [`channels stay apart`, [[`a`, `x`, 1], [`b`, `y`, `id`]],
      { a: [null, `id`], b: [1, null], c: [1, `id`] }],
  ])(`%s`, (_label, publishes, reads) => {
    const links = new HoverLinks()
    for (const [name, channel, key] of publishes) links.publish(channel, members[name], key)
    for (const [name, member] of Object.entries(members) as [Name, symbol][]) {
      expect([`x`, `y`].map((channel) => links.linked(channel, member))).toEqual(reads[name])
    }
  })
})

// A viewer joining the channel its props name, mounted under `links` as its host's context
const Member: Component<{ channel?: string }, { link: HoverLink<number> }> = (
  _anchor,
  props,
) => ({
  link: join_hover_link(() => props.channel, `number`),
})
const join = (links: HoverLinks | undefined, channel?: string) => {
  const props = $state({ channel })
  const context = links && new Map([[HoverLinks, links]])
  const viewer = mount(Member, { target: document.body, props, context })
  mounted.push(viewer)
  flushSync()
  return { link: viewer.link, props, viewer }
}
type Joined = ReturnType<typeof join>

describe(`join_hover_link`, () => {
  // what member b reads after member a of the same host hovers 1 on channel x and then...
  test.each<[string, (member: Joined) => void, number | null]>([
    [`keeps hovering`, () => {}, 1],
    [
      `unmounts`,
      ({ viewer }) => void unmount(mounted.splice(mounted.indexOf(viewer), 1)[0]),
      null,
    ],
    [`leaves the channel`, ({ props }) => (props.channel = undefined), null],
    [`moves to another channel`, ({ props }) => (props.channel = `y`), null],
    [
      `publishes after leaving`,
      ({ props, link }) => {
        props.channel = undefined
        flushSync()
        link.publish(2)
      },
      null,
    ],
  ])(`a member that %s`, (_label, act, expected) => {
    const links = new HoverLinks()
    const [member_a, member_b] = [join(links, `x`), join(links, `x`)]
    member_a.link.publish(1)
    act(member_a)
    flushSync()
    expect(member_b.link.linked).toBe(expected)
  })

  test(`hosts don't cross-talk; no host or a key of the wrong kind throws`, () => {
    const [own_host, other_host] = [new HoverLinks(), new HoverLinks()]
    const member = join(own_host, `x`)
    const stranger = join(other_host, `x`)
    member.link.publish(1)
    expect(stranger.link.linked).toBeNull()
    // a channel-less viewer needs no host and reads nothing
    expect(join(undefined).link.linked).toBeNull()
    expect(() => join(undefined, `x`)).toThrow(`link_hover="x" needs hover_links()`)
    other_host.publish(`x`, Symbol(`entry view`), `mp-1`)
    expect(() => stranger.link.linked).toThrow(
      `link_hover="x" carries number keys, got "mp-1"`,
    )
  })
})

// === Wired viewer pairs ===
type Anchor = Parameters<Component>[0]
// A host mounting `views` side by side under one hover_links(), as a page would
const linked_views =
  (...views: ((anchor: Anchor) => unknown)[]): Component =>
  (anchor) => {
    hover_links()
    for (const view of views) view(anchor)
    return {}
  }
const mount_views = (...views: ((anchor: Anchor) => unknown)[]): void => {
  mounted.push(mount(linked_views(...views), { target: document.body }))
  flushSync()
}
const mount_plot_views = (...views: ((anchor: Anchor) => unknown)[]): Promise<HTMLElement> =>
  mount_sized(
    linked_views(...views),
    {},
    {
      selector: `.scatter`,
      on_mount: (viewer) => mounted.push(viewer),
    },
  )

// Hovering (or leaving) a plot's marker, as the pointer does
const hover_marker = async (plot: HTMLElement, marker_idx: number, on: boolean) => {
  const svg = plot_svg(plot)
  if (!on) return fire(svg, mouse(`mouseleave`))
  svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 400, height: 300 })
  const { x: clientX, y: clientY } = marker_position(plot, marker_idx)
  svg.dispatchEvent(mouse(`mousemove`, { clientX, clientY }))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  flushSync()
}
// Hovering (or leaving) the first row of the page's one table
const hover_row = async (on: boolean) =>
  on
    ? fire(
        doc_query(`tbody tr[data-row-idx]`),
        new PointerEvent(`pointerover`, { bubbles: true }),
      )
    : fire(doc_query(`tbody`), new PointerEvent(`pointerleave`))
const row_lit = (): boolean => document.querySelector(`tbody tr.hovered`) !== null

type Pair = {
  hover_a: (on: boolean) => Promise<unknown>
  hover_b: (on: boolean) => Promise<unknown>
  a_lit: () => boolean // A highlights what B hovers
  b_lit: () => boolean
}

const hull_entries = [
  make_phase({ Li: 1 }, 0, { entry_id: `li` }),
  make_phase({ O: 1 }, 0, { entry_id: `o` }),
  make_phase({ Li: 1, O: 1 }, -0.6, { entry_id: `lio` }),
  make_phase({ Li: 1, O: 2 }, -0.2, { entry_id: `lio2` }),
]
// Γ→X in 4 q-points, 2 bands
const band_struct: BaseBandStructure = {
  type: `phonon`,
  qpoints: [0, 0.25, 0.5, 0.75].map((coord, idx) => ({
    label: idx === 0 ? `GAMMA` : idx === 3 ? `X` : null,
    frac_coords: [coord, 0, 0],
  })),
  branches: [{ start_index: 0, end_index: 3, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.75, 0, 0] },
  distance: [0, 1, 2, 3],
  nb_bands: 2,
  bands: [
    [0, 0.5, 1, 1.5],
    [0.8, 1.3, 1.8, 2.3],
  ],
}
const k_lattice = reciprocal_lattice(cubic_matrix(3), { two_pi: true })
const crystal = make_crystal(3, [
  [`Na`, [0.25, 0.25, 0.25]],
  [`Cl`, [0.75, 0.75, 0.75]],
])

test.each<[string, () => Promise<Pair>]>([
  [
    `ConvexHull point <-> ConvexHullStats row by entry id`,
    async () => {
      const plot = await mount_plot_views(
        (anchor) => ConvexHull(anchor, { entries: hull_entries, link_hover: `entries` }),
        (anchor) =>
          ConvexHullStats(anchor, {
            model: compute_hull_model(hull_entries),
            link_hover: `entries`,
          }),
      )
      return {
        hover_a: (on) => hover_marker(plot, 2, on),
        b_lit: row_lit,
        hover_b: hover_row,
        a_lit: () => plot.querySelector(`.effect-ring`) !== null,
      }
    },
  ],
  [
    `Bands point <-> BrillouinZone k-path by q-point`,
    async () => {
      const plot = await mount_plot_views(
        (anchor) =>
          Bands(anchor, {
            band_structs: { '': band_struct },
            link_hover: `qpoints`,
            tooltip: false,
            on_point_click: () => {},
            point_tween: { duration: 0 },
          }),
        (anchor) =>
          BrillouinZone(anchor, {
            k_lattice,
            k_path: band_k_path(band_struct, k_lattice),
            link_hover: `qpoints`,
          }),
      )
      const bz = () => scenes.bz ?? {}
      return {
        hover_a: (on) => hover_marker(plot, 1, on),
        // the k-path marks the hovered q-point, its k-point and its branch
        b_lit: () =>
          [`hovered_qpoint_index`, `hovered_k_point`, `highlighted_qpoint_range`].every(
            (key) => bz()[key] != null,
          ),
        hover_b: async (on) => {
          const on_kpath_hover = bz().on_kpath_hover
          if (typeof on_kpath_hover !== `function`) throw new Error(`no k-path hover handler`)
          on_kpath_hover(on ? 2 : null)
          flushSync()
        },
        a_lit: () => plot.querySelector(`rect.highlighted-segment`) !== null,
      }
    },
  ],
  [
    `Structure atom <-> SiteTable row by site`,
    async () => {
      mount_views(
        (anchor) =>
          Structure(anchor, {
            structure: crystal,
            link_hover: `sites`,
            analyze_symmetry: false,
          }),
        (anchor) => SiteTable(anchor, { sites: crystal.sites, link_hover: `sites` }),
      )
      const scene = () => scenes.structure ?? {}
      return {
        // the 3D scene reports its hovered atom through its bound hovered_idx
        hover_a: async (on) => {
          scene().hovered_idx = on ? 0 : null
          flushSync()
        },
        b_lit: row_lit,
        hover_b: hover_row,
        a_lit: () => scene().hovered_idx != null,
      }
    },
  ],
])(`%s`, async (_label, mount_pair) => {
  const { hover_a, hover_b, a_lit, b_lit } = await mount_pair()
  expect([a_lit(), b_lit()]).toEqual([false, false])
  await hover_a(true)
  expect(b_lit()).toBe(true)
  await hover_a(false)
  expect(b_lit()).toBe(false)
  await hover_b(true)
  expect(a_lit()).toBe(true)
  await hover_b(false)
  expect(a_lit()).toBe(false)
})

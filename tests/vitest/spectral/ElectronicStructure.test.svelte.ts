// ElectronicStructure: one viewer fusing a crystal, its Fermi surface, bands and DOS, linked
import type * as backdrop from '#lib/colors/backdrop.svelte.js'
import { sheet_color } from '#lib/fermi-surface/constants.js'
import type FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
import type { BandGridData } from '#lib/fermi-surface/types.js'
import type Bands from '#lib/spectral/Bands.svelte'
import type BandsAndDos from '#lib/spectral/BandsAndDos.svelte'
import type Dos from '#lib/spectral/Dos.svelte'
import type { Matrix3x3, Vec2 } from '#lib/math.js'
import type Structure from '#lib/structure/Structure.svelte'
import ElectronicStructure from '#lib/spectral/ElectronicStructure.svelte'
import type { Sweep, SweepFrame } from '#lib/spectral/sweep.js'
import type SweepTrends from '#lib/spectral/SweepTrends.svelte'
import { BANDS_CSS_COLORS, compute_frequency_range } from '#lib/spectral/helpers.js'
import type {
  BaseBandStructure,
  ElectronicDos,
  ElectronicPane,
  PhononDos,
  PhononSpectra,
  SpectraRecords,
} from '#lib/spectral/types.js'
import type { Site } from '#lib/structure/index.js'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Vector3 } from 'three/webgpu'
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import {
  create_drop_event,
  fire,
  mock_parse_worker,
  mount_sized,
  mouse,
  option_texts,
  plot_svg,
} from '../setup'
import {
  IDENTITY_MATRIX3,
  make_bxsf,
  make_crystal,
  read_binary_test_file,
} from '../test-fixtures'

// The 3D scenes' props and orbit controls (no renderer in happy-dom): each stub joins the
// host's orbit link with real controls, as its SceneCamera would. `controls` holds the last
// mounted scene of each kind, `all` every mounted one's.
type SceneName = `structure` | `fermi`
const scenes = vi.hoisted(() => ({
  props: {} as Partial<Record<SceneName, Record<string, unknown>>>,
  controls: {} as Partial<Record<SceneName, OrbitControls>>,
  all: [] as OrbitControls[],
}))
const scene_stub = vi.hoisted(
  () => async (name: SceneName, position: [number, number, number]) => {
    const { join_orbit_link } = await import(`#lib/scene/orbit-link.svelte.js`)
    const { OrbitControls } = await import(`three/examples/jsm/controls/OrbitControls.js`)
    const { OrthographicCamera, PerspectiveCamera } = await import(`three/webgpu`)
    return {
      default: (_anchor: Node, props: Record<string, unknown>) => {
        scenes.props[name] = props
        if (name === `structure`) props.camera = new OrthographicCamera()
        const camera = new PerspectiveCamera()
        camera.position.set(...position)
        const controls = new OrbitControls(camera, document.createElement(`div`))
        controls.update()
        scenes.controls[name] = controls
        scenes.all.push(controls)
        join_orbit_link(() => controls)
        return {}
      },
    }
  },
)
vi.mock(`@threlte/core`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  Canvas: (anchor: Node, props: { children: (anchor: Node) => void }) =>
    props.children(anchor),
}))
vi.mock(`#lib/structure/StructureScene.svelte`, () => scene_stub(`structure`, [10, 3, 8]))
vi.mock(`#lib/fermi-surface/FermiSurfaceScene.svelte`, () => scene_stub(`fermi`, [0, 0, 2]))
// the live props of the Fermi viewer, bands and DOS, to drive and read the links between them
// (the last mounted of each; `instances` holds every mounted one's, e.g. both compared sides')
const viewers = vi.hoisted(() => ({
  fermi: null as Partial<ComponentProps<typeof FermiSurface>> | null,
  bands: null as Partial<ComponentProps<typeof Bands>> | null,
  dos: null as Partial<ComponentProps<typeof Dos>> | null,
  trends: null as Partial<ComponentProps<typeof SweepTrends>> | null,
  phonon: null as Partial<ComponentProps<typeof BandsAndDos>> | null,
}))
const instances = vi.hoisted(() => ({
  bands: [] as Partial<ComponentProps<typeof Bands>>[],
  dos: [] as Partial<ComponentProps<typeof Dos>>[],
  phonon: [] as Partial<ComponentProps<typeof BandsAndDos>>[],
}))
// a stub: its own Bands and DOS would overwrite the electronic ones' props above
vi.mock(`#lib/spectral/BandsAndDos.svelte`, () => ({
  default: (_anchor: Node, props: Partial<ComponentProps<typeof BandsAndDos>>) => {
    viewers.phonon = props
    instances.phonon.push(props)
    return {}
  },
}))
// renders the original component, recording its live props in `viewers` (and `on_mount`)
const record_props = vi.hoisted(
  () =>
    async <Key extends `fermi` | `bands` | `dos` | `trends`>(
      key: Key,
      original: <Module>() => Promise<Module>,
      on_mount?: (props: NonNullable<(typeof viewers)[Key]>) => void,
    ) => {
      type Props = NonNullable<(typeof viewers)[Key]>
      type Render = (anchor: Node, props: Props) => unknown
      const { default: Component } = await original<{ default: Render }>()
      return {
        default: (anchor: Node, props: Props) => {
          viewers[key] = props
          on_mount?.(props)
          return Component(anchor, props)
        },
      }
    },
)
vi.mock(`#lib/fermi-surface/FermiSurface.svelte`, (original) =>
  record_props(`fermi`, original),
)
vi.mock(`#lib/spectral/Bands.svelte`, (original) =>
  record_props(`bands`, original, (props) => instances.bands.push(props)),
)
vi.mock(`#lib/spectral/SweepTrends.svelte`, (original) => record_props(`trends`, original))
vi.mock(`#lib/spectral/Dos.svelte`, (original) =>
  record_props(`dos`, original, (props) => instances.dos.push(props)),
)
// the nodes CSS colour tokens are resolved on, for three.js (which parses no var())
const resolved = vi.hoisted(() => [] as { node: Element; value: string }[])
vi.mock(`#lib/colors/backdrop.svelte.js`, async (original) => {
  const actual = await original<typeof backdrop>()
  return {
    ...actual,
    resolve_color_token: (node: Element, value: string) => {
      resolved.push({ node, value })
      return actual.resolve_color_token(node, value)
    },
  }
})

// a_i · b_j = 2π δ_ij with the band grid's identity k_lattice: one Cartesian frame
const structure = make_crystal(2 * Math.PI, [[`Cu`, [0, 0, 0]]])
// one band on a 3³ grid peaking at its centre, above E_F = 7
const band_data: BandGridData = {
  energies: [
    [
      {
        values: Float64Array.from({ length: 27 }, (_, idx) => (idx === 13 ? 8 : 5)),
        dims: [3, 3, 3],
        order: `z_fastest`,
      },
    ],
  ],
  k_grid: [3, 3, 3],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 7,
  n_bands: 1,
  n_spins: 1,
}
// the grid's band 0 along Γ → X, crossing E_F = 7
const band_struct: BaseBandStructure = {
  type: `electronic`,
  efermi: 7,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0], distance: 0 },
    { label: null, frac_coords: [0.25, 0, 0], distance: 0.5 },
    { label: `X`, frac_coords: [0.5, 0, 0], distance: 1 },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
  distance: [0, 0.5, 1],
  nb_bands: 1,
  bands: [[6, 7, 8]],
}
const dos: ElectronicDos = {
  type: `electronic`,
  energies: [4, 6, 8, 10],
  densities: [0, 1, 1, 0],
  efermi: 7,
}
const mounted: ReturnType<typeof mount>[] = []
beforeEach(async () => {
  await mock_parse_worker()
  // both 3D viewers gate their scene on webgpu_available(); the stubs never touch a GPU
  Object.defineProperty(navigator, `gpu`, { value: {}, configurable: true })
})
afterEach(() => {
  for (const component of mounted.splice(0)) void unmount(component)
  for (const controls of Object.values(scenes.controls)) controls?.dispose()
  Object.assign(viewers, { fermi: null, bands: null, dos: null, trends: null, phonon: null })
  for (const list of Object.values(instances)) list.length = 0
  scenes.props = {}
  scenes.controls = {}
  scenes.all = []
  Reflect.deleteProperty(navigator, `gpu`)
})
const mount_host = (props: ComponentProps<typeof ElectronicStructure>) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  mounted.push(mount(ElectronicStructure, { target, props }))
  flushSync()
  const root = target.querySelector(`.electronic-structure`)
  if (!root) throw new Error(`no root`)
  return root
}
// mounts the host on live props, which tests change in place to drive it
const mount_live = (init: ComponentProps<typeof ElectronicStructure>) => {
  const props = $state(init)
  return { props, root: mount_host(props) }
}
const count = (root: Element, selector: string) => root.querySelectorAll(selector).length
const shown_panes = (root: Element) =>
  [...root.querySelectorAll<HTMLElement>(`.pane`)].map((pane) => pane.dataset.pane)
const view_dir = (controls?: OrbitControls): Vector3 => {
  if (!controls) throw new Error(`scene not mounted`)
  return controls.object.position.clone().sub(controls.target).normalize()
}
const orbit = (controls: OrbitControls | undefined, direction: Vector3): void => {
  if (!controls) throw new Error(`scene not mounted`)
  const radius = controls.object.position.distanceTo(controls.target)
  controls.object.position.copy(controls.target).addScaledVector(direction, radius)
  controls.update()
}
const all_data = {
  structure,
  band_data,
  band_structs: { Cu: band_struct },
  doses: { Cu: dos },
}
// phonon DOS and an α²F over one frequency axis (THz), and a dispersion along the same path
const phonon_dos: PhononDos = { type: `phonon`, frequencies: [0, 3, 6], densities: [0, 2, 0] }
const phonon: PhononSpectra = {
  band_structs: {
    Cu: { ...band_struct, type: `phonon`, efermi: undefined, bands: [[0, 2, 4]] },
  },
  doses: { 'phonon DOS': phonon_dos },
  a2f: { 'α²F': { ...phonon_dos, densities: [0, 0.3, 0] } },
}
test.each([800, 400])(
  `one viewer %dpx wide: one control row over scenes above spectra`,
  (width) => {
    vi.spyOn(HTMLElement.prototype, `clientWidth`, `get`).mockReturnValue(width)
    const side = width >= 520 // the DOS sits beside the bands from 520px, else below
    const stacked = width < 800 // narrower, the panes stack each at its own height
    const root = mount_host({ ...all_data, class: `caller`, layout: `vertical` })
    expect(root.getAttribute(`role`)).toBe(`group`)
    expect([...root.classList]).toEqual(expect.arrayContaining([`caller`, `two-rows`]))
    expect(root.classList.contains(`stacked`)).toBe(stacked)
    // the panes' own fullscreen toggles are off: the viewer's row holds the only one
    expect(count(root, `.fullscreen-btn`)).toBe(1)
    expect(
      root.querySelector(`:scope > .panes > .control-buttons .fullscreen-btn`),
    ).not.toBeNull()
    expect(
      root.querySelector(`:scope > .panes > .sides > .side > .row.scenes`)?.classList,
    ).toContain(`vertical`)
    expect(
      root.querySelector(`.row.lower > .sides > .side > .row.column > .row.spectra`)
        ?.classList,
    ).toContain(side ? `side` : `stacked`)
    // beside the bands, the DOS resizes at a divider of its own
    expect(count(root, `.spectra > .pane-divider`)).toBe(side ? 1 : 0)
    // a divider between the rows and one between the scenes, unless stacked
    expect(count(root, `:scope > .panes > .pane-divider`)).toBe(stacked ? 0 : 1)
    expect(count(root, `.scenes > .pane-divider`)).toBe(stacked ? 0 : 1)
    expect(count(root, `.pane`)).toBe(4)
    // the band structure's k-path runs through the Wigner-Seitz zone of the Fermi surface
    expect(viewers.fermi?.wigner_seitz).toBe(true)
    expect(viewers.fermi?.k_path).toMatchObject({ path: { points: expect.any(Array) } })
    // beside the DOS, the bands mirror its settled left padding on their right
    if (!viewers.dos || !viewers.bands) throw new Error(`no spectra`)
    viewers.dos.resolved_padding = { t: 20, r: 5, b: 50, l: 37 }
    flushSync()
    expect(viewers.bands.padding?.r).toBe(side ? 37 : 5)
  },
)

// oxfmt-ignore
test.each<[string, Partial<ComponentProps<typeof ElectronicStructure>>, ElectronicPane[]]>([
  [`all data`, all_data, [`structure`, `fermi`, `bands`, `dos`]],
  [`all data and phonons`, { ...all_data, phonon }, [`structure`, `fermi`, `bands`, `dos`, `phonon`]],
  [`phonons only`, { phonon }, [`phonon`]],
  [`an empty phonon record`, { structure, phonon: { doses: {} } }, [`structure`]],
  [`a structure`, { structure }, [`structure`]],
  [`a band grid`, { band_data }, [`fermi`]],
  [`bands and DOS`, { band_structs: all_data.band_structs, doses: all_data.doses }, [`bands`, `dos`]],
  [`nothing yet`, {}, [`structure`, `fermi`]],
])(`default panes for %s`, (_desc, data, expected) => {
  const root = mount_host(data)
  expect(shown_panes(root)).toEqual(expected)
  expect(count(root, `.sync-rotation-toggle`)).toBe(expected.includes(`fermi`) && expected.includes(`structure`) ? 1 : 0)
})

test(`phonon spectra sit below the electronic ones, resized at their own divider`, () => {
  const { props, root } = mount_live({ ...all_data, phonon, units: `THz` })
  const column = root.querySelector(
    `:scope > .panes > .row.lower > .sides > .side > .row.column`,
  )
  expect(column?.classList).toContain(`vertical`)
  expect(count(root, `.column > .pane-divider`)).toBe(1)
  expect([...(column?.children ?? [])].map((child) => child.className.split(` `)[0])).toEqual([
    `row`,
    `pane-divider`,
    `pane`,
  ])
  expect(viewers.phonon).toMatchObject({
    band_structs: phonon.band_structs,
    doses: phonon.doses,
    a2f: phonon.a2f,
    fullscreen_toggle: false,
  })
  expect(viewers.dos?.doses).toEqual(all_data.doses) // the electronic DOS keeps its own pane
  props.units = `meV`
  flushSync()
  expect(viewers.phonon?.units).toBe(`meV`)
  // `never` hides the phonon plots' own controls too, as every pane's
  props.show_controls = `never`
  flushSync()
  expect(viewers.phonon?.bands_props?.show_controls).toBe(false)
  expect(viewers.phonon?.dos_props?.show_controls).toBe(false)
})

test(`the pane menu shows any subset, never none`, () => {
  const { props, root } = mount_live({ ...all_data, panes: undefined })
  root.querySelector<HTMLButtonElement>(`.panes-menu .view-mode-button`)?.click()
  flushSync()
  const option = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(`.view-mode-option`)].find((button) =>
      button.textContent?.includes(label),
    )
  for (const label of [`Structure`, `Fermi surface`, `Density of states`]) {
    option(label)?.click()
    flushSync()
  }
  expect(props.panes).toEqual([`bands`])
  expect(shown_panes(root)).toEqual([`bands`])
  expect(root.classList).toContain(`one-row`)
  expect(option(`Band structure`)?.disabled).toBe(true) // the last pane stays
  option(`Fermi surface`)?.click()
  flushSync()
  expect(props.panes).toEqual([`fermi`, `bands`])
})

test(`orbiting either scene turns the other until the link button unlinks them`, () => {
  const { props, root } = mount_live({ structure, band_data, sync_rotation: true })
  const cases: [SceneName, SceneName, Vector3][] = [
    [`structure`, `fermi`, new Vector3(-2, 1, 3).normalize()],
    [`fermi`, `structure`, new Vector3(1, 2, -1).normalize()],
  ]
  for (const [leader, follower, direction] of cases) {
    orbit(scenes.controls[leader], direction)
    expect(view_dir(scenes.controls[follower]).distanceTo(direction)).toBeLessThan(1e-12)
  }
  const toggle = root.querySelector<HTMLButtonElement>(`.sync-rotation-toggle`)
  expect(toggle?.getAttribute(`aria-pressed`)).toBe(`true`)
  toggle?.click()
  flushSync()
  expect(props.sync_rotation).toBe(false)
  const before = view_dir(scenes.controls.fermi)
  orbit(scenes.controls.structure, new Vector3(0, 1, 1).normalize())
  expect(view_dir(scenes.controls.fermi).toArray()).toEqual(before.toArray())
  toggle?.click()
  flushSync()
  const direction = new Vector3(3, 1, 2).normalize()
  orbit(scenes.controls.structure, direction)
  expect(view_dir(scenes.controls.fermi).distanceTo(direction)).toBeLessThan(1e-12)
})

// without a band grid (none, or a meshed surface) there is no other energy's surface to show
test.each([true, false])(
  `hovering the DOS previews the Fermi surface and marks the bands (grid: %s)`,
  (grid) => {
    mount_host({
      ...all_data,
      band_data: grid ? band_data : undefined,
      panes: [`fermi`, `bands`, `dos`],
    })
    expect(viewers.fermi?.mu).toBe(0)
    if (!viewers.dos) throw new Error(`no DOS`)
    viewers.dos.hovered_frequency = 7.5 // the DOS writes its hovered energy through the binding
    flushSync()
    expect(viewers.fermi?.mu).toBe(grid ? 0.5 : 0)
    expect(viewers.fermi?.previewing).toBe(grid)
    expect(viewers.bands?.reference_frequency).toBe(7.5)
    viewers.dos.hovered_frequency = null
    flushSync()
    expect(viewers.fermi?.mu).toBe(0)
    expect(viewers.fermi?.previewing).toBe(false)
    expect(viewers.bands?.reference_frequency).toBeNull()
  },
)

// === bands ↔ Fermi surface ===
// Ten electronic bands of one run; the grid holds bands 8 and 9 (band_indices). Band 8 runs
// 0.1 → 0.5 eV through E_F = 0.3 like the grid's |k| sphere, the others lie far from it
const ten_bands: BaseBandStructure = {
  ...band_struct,
  efermi: 0.3,
  nb_bands: 10,
  bands: Array.from({ length: 10 }, (_, band_idx) =>
    band_idx === 8 ? [0.1, 0.3, 0.5] : [band_idx - 9, band_idx - 8.5, band_idx - 8],
  ),
}
// ε = |k − centre| on an endpoint-inclusive 5³ grid, crossing E_F = 0.3 in a sphere
const sphere = Float64Array.from({ length: 125 }, (_, idx) =>
  Math.hypot(
    ...[Math.floor(idx / 25), Math.floor(idx / 5) % 5, idx % 5].map((ii) => ii / 4 - 0.5),
  ),
)
const two_sheets: BandGridData = {
  energies: [
    [
      { values: sphere, dims: [5, 5, 5], order: `z_fastest` },
      { values: sphere.map((energy) => energy + 0.05), dims: [5, 5, 5], order: `z_fastest` },
    ],
  ],
  k_grid: [5, 5, 5],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 0.3,
  n_bands: 2,
  n_spins: 1,
  band_indices: [8, 9],
}

// Hover previews a band point's energy (the dashed E_F + mu line follows it, mu itself stays), a
// click pins that energy as mu and isolates the band, a second click ends the isolation; band
// lines take their sheet's colour and E_F crossings are dotted on the bands and the 3D path
test(`hover previews a band point's energy, a click pins it and isolates the band`, async () => {
  // extraction runs on animation frames: fake them to step it deterministically
  vi.useFakeTimers({
    toFake: [
      `setTimeout`,
      `clearTimeout`,
      `requestAnimationFrame`,
      `cancelAnimationFrame`,
      `performance`,
    ],
  })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  resolved.length = 0
  const on_plot_click = vi.fn()
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    band_data: two_sheets,
    band_structs: { Cu: ten_bands },
    panes: [`fermi`, `bands`],
    mu: 0,
    selected_bands: undefined,
    fermi_props: { controls_open: true }, // its band checkboxes show the sheets displayed
    bands_props: {
      point_tween: { duration: 0 },
      line_tween: { duration: 0 }, // paths jump to where the (untweened) dots are
      style: `width: 600px; height: 400px`,
      on_plot_click,
    },
  })
  const root = await mount_sized(ElectronicStructure, props, {
    selector: `.electronic-structure`,
    width: 1200,
    height: 900,
    on_mount: (component) => mounted.push(component),
  })
  await vi.advanceTimersByTimeAsync(200)
  const scatter = root.querySelector(`[data-pane="bands"] .scatter`)
  if (!scatter) throw new Error(`no band plot`)
  const svg = plot_svg(scatter)
  svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 600, height: 400 })
  // Bands draws plain lines (no markers): aim at a vertex (default Γ) of a band's path, whose
  // series id is JSON [label, segment, band_idx, spin]
  const band_path = (band: number) =>
    [...svg.querySelectorAll(`g[data-series-id]`)]
      .find((node) => JSON.parse(node.getAttribute(`data-series-id`) ?? `[]`)[2] === band)
      ?.querySelector(`path`)
  const band_vertex = (band: number, qpoint_idx = 0) => {
    const coords = (band_path(band)?.getAttribute(`d`) ?? ``).match(/[-\d.e]+/g)?.map(Number)
    if (!coords) throw new Error(`no path for band ${band}`)
    // M x,y then one cubic (C c1 c2 end) per step, straight with its controls on the chord
    const end_idx = 6 * qpoint_idx
    return { clientX: coords[end_idx], clientY: coords[end_idx + 1] }
  }
  const hover = async (band: number) => {
    svg.dispatchEvent(mouse(`mousemove`, band_vertex(band)))
    await vi.advanceTimersByTimeAsync(50) // hover frame, then the preview extraction
    flushSync()
  }
  const leave = async () => {
    await fire(svg, mouse(`mouseleave`))
    await vi.advanceTimersByTimeAsync(50) // re-extraction at the pinned mu
    flushSync()
  }
  const click = async (band: number) => {
    await hover(band) // a real click follows the pointer onto the band
    svg.dispatchEvent(mouse(`click`, band_vertex(band)))
    flushSync()
  }
  const reference_y = () =>
    root.querySelector(`line[stroke*="bands-reference-line-color"]`)?.getAttribute(`y1`)
  // the emphasised band keeps its sheet colour, so count it by its widened stroke
  const selected_strokes = () =>
    [...root.querySelectorAll(`svg path[fill="none"]`)].filter(
      (path) => Number(path.getAttribute(`stroke-width`)) >= 3,
    ).length
  expect(root.querySelectorAll(`.marker`)).toHaveLength(0) // lines only
  // the 3D crossing markers resolve the 2D dots' colours where the dots do, inside Bands
  // (whose bands_props.style may set them)
  const fermi_nodes = resolved.filter(({ value }) => value === BANDS_CSS_COLORS.fermi)
  const on_dots_svg = fermi_nodes.map(({ node }) => node.classList.contains(`band-crossings`))
  expect(new Set(on_dots_svg)).toEqual(new Set([true]))
  expect(reference_y()).toBeUndefined() // mu = 0: only the E_F line
  // band lines in their sheet's colour (FermiSurfaceScene's sheet_color), bands without a sheet
  // in the grid muted
  expect([8, 9, 3].map((band) => band_path(band)?.getAttribute(`stroke`))).toEqual([
    sheet_color(8, null, `band`),
    sheet_color(9, null, `band`),
    expect.stringContaining(`--bands-muted-color`),
  ])
  // E_F crossings dotted at the interpolated x: band 8 meets 0.3 eV at q-point 1, band 9
  // (0 → 0.5 eV) 60% of the way from Γ to it
  const fermi_y = Number(root.querySelector(`line.fermi-level-line`)?.getAttribute(`y1`))
  const lerp_x = (band: number, frac: number) =>
    band_vertex(band).clientX +
    frac * (band_vertex(band, 1).clientX - band_vertex(band).clientX)
  const expect_dots = (expected: [number, number, string][]) => {
    const dots = [...root.querySelectorAll(`.band-crossings circle`)].map((dot) => [
      Number(dot.getAttribute(`cx`)),
      Number(dot.getAttribute(`cy`)),
      dot.getAttribute(`fill`),
    ])
    // path d rounds to 1e-3 px
    const close = ([x_px, y_px, color]: [number, number, string]) => [
      expect.closeTo(x_px, 2),
      expect.closeTo(y_px, 2),
      color,
    ]
    expect(dots).toEqual(expected.map(close))
  }
  // dots in the colour of the line they sit on (Bands' E_F and reference line CSS)
  const { fermi: fermi_css, reference: ref_css } = BANDS_CSS_COLORS
  const fermi_dots = (): [number, number, string][] => [
    [band_vertex(8, 1).clientX, fermi_y, fermi_css],
    [lerp_x(9, 0.6), fermi_y, fermi_css],
  ]
  expect_dots(fermi_dots())
  // One k_path object per path: hovers update its markers and hovered q-point through getters,
  // so the 3D k-path's path-derived state (sym points, segment meshes) is not rebuilt per hover
  type ScenePath = ComponentProps<typeof FermiSurface>[`k_path`]
  const k_path_reads: { k_path: ScenePath; path?: object }[] = []
  const k_marker_counts: number[] = []
  const hover_qpoints: (number | null | undefined)[] = []
  onTestFinished(
    $effect.root(() => {
      $effect(() => {
        const k_path = viewers.fermi?.k_path
        k_path_reads.push({ k_path, path: k_path?.path })
      })
      $effect(() => {
        const k_path = viewers.fermi?.k_path
        k_marker_counts.push(k_path?.k_markers?.length ?? -1)
        hover_qpoints.push(k_path?.hovered_qpoint_index)
      })
    }),
  )
  flushSync()

  await hover(8) // band 8 at Γ: 0.1 eV, 0.2 below E_F
  expect(Number(reference_y())).toBeCloseTo(band_vertex(8).clientY, 2) // path d rounds to 1e-3 px
  expect([props.mu, selected_strokes()]).toEqual([0, 1])
  // the previewed energy's crossings join E_F's: band 8 meets 0.1 eV at Γ, band 9 20% of the
  // way to q 1
  expect_dots([
    ...fermi_dots(),
    [band_vertex(8).clientX, Number(reference_y()), ref_css],
    [lerp_x(9, 0.2), Number(reference_y()), ref_css],
  ])
  // the hovered q-point's whole branch (Γ→X, the only one) is shaded on the bands, as beside a BZ
  expect(root.querySelector(`rect.highlighted-segment`)).toBeInstanceOf(SVGRectElement)
  await leave()
  expect([reference_y(), selected_strokes()]).toEqual([undefined, 0])
  expect(root.querySelector(`rect.highlighted-segment`)).toBeNull()
  expect(k_path_reads).toHaveLength(1)
  expect(k_path_reads[0].path).toBe(k_path_reads[0].k_path?.path)
  expect([k_marker_counts, hover_qpoints]).toEqual([
    [2, 4, 2],
    [null, 0, null],
  ])

  // band 3 is not in the grid: no preview, and a click pins nothing
  await click(3)
  expect([viewers.fermi?.previewing, props.mu]).toEqual([false, 0])
  await leave()

  // the 3D controls list the sheets shown: both, then band 8 alone once isolated
  const shown_bands = () =>
    [...root.querySelectorAll<HTMLInputElement>(`.band-checkbox input`)].map(
      (input) => input.checked,
    )
  expect(shown_bands()).toEqual([true, true])
  await click(8)
  expect(props.mu).toBeCloseTo(-0.2, 12) // the clicked energy, pinned
  expect(on_plot_click).toHaveBeenCalledTimes(2)
  await leave()
  expect(shown_bands()).toEqual([true, false])
  expect(selected_strokes()).toBe(1) // isolated, still emphasised without hover
  // only the isolated band's crossings stay (E_F at q 1, the pinned 0.1 eV at Γ)
  expect_dots([fermi_dots()[0], [band_vertex(8).clientX, Number(reference_y()), ref_css]])
  expect(Number(reference_y())).toBeCloseTo(band_vertex(8).clientY, 2) // path d rounds to 1e-3 px
  // a mu change while isolated that drops band 9 (ε ≥ 0.05 eV) and restores it must not leak
  // the isolation into the bands the user hid
  for (const mu of [-0.28, -0.2]) {
    props.mu = mu
    await vi.advanceTimersByTimeAsync(50)
    flushSync()
  }
  expect(shown_bands()).toEqual([true, false])

  await click(8) // again: isolation ends, both sheets return
  await leave()
  expect(selected_strokes()).toBe(0)
  expect(shown_bands()).toEqual([true, true])
  // a band edit in the controls while isolated lands, starting from the band shown (unticking
  // band 8 leaves none), and ends the isolation: re-ticking band 9 shows it alone
  await click(8)
  await leave()
  expect([props.selected_bands, shown_bands()]).toEqual([
    [8, 9],
    [true, false],
  ])
  const checkbox = (idx: number) =>
    root.querySelectorAll<HTMLInputElement>(`.band-checkbox input`)[idx]
  checkbox(0).click()
  flushSync()
  expect([props.selected_bands, shown_bands(), selected_strokes()]).toEqual([
    [],
    [false, false],
    0,
  ])
  checkbox(1).click()
  flushSync()
  expect([props.selected_bands, shown_bands()]).toEqual([[9], [false, true]])
  props.selected_bands = [8, 9]
  props.mu = 0
  await vi.advanceTimersByTimeAsync(50)
  flushSync()
  expect_dots(fermi_dots())

  // these bands are unpolarized, so Bands draws them in every spin mode and so do the E_F
  // crossings: `down_only` used to drop the dots while the bands stayed drawn
  for (const band_spin_mode of [`down_only`, `up_only`] as const) {
    props.bands_props = { ...props.bands_props, band_spin_mode }
    await vi.advanceTimersByTimeAsync(50)
    flushSync()
    expect_dots(fermi_dots())
  }

  // the E_F line marks the grid's Fermi level (mu = 0), not the band structure's efermi
  const fermi_line_y = () => root.querySelector(`line.fermi-level-line`)?.getAttribute(`y1`)
  const grid_fermi_y = fermi_line_y()
  props.band_structs = { Cu: { ...ten_bands, efermi: 0.25 } }
  flushSync()
  expect(fermi_line_y()).toBe(grid_fermi_y)
})

// a POSCAR of lattice `rows` (Å), one Si atom
const poscar = (rows: number[][]) =>
  `Si\n1.0\n${rows.map((row) => row.join(` `)).join(`\n`)}\nSi\n1\nDirect\n0 0 0\n`
// a 2x2x2 supercell of the grid's cell: still its frame
const POSCAR = poscar([
  [4 * Math.PI, 0, 0],
  [0, 4 * Math.PI, 0],
  [0, 0, 4 * Math.PI],
])
test(`one drop zone fills the panes each file has data for and rejects the rest`, async () => {
  const on_file_load = vi.fn()
  const on_error = vi.fn()
  const { props, root } = mount_live({
    structure,
    band_data,
    band_structs: {},
    doses: {},
    phonon: undefined,
    panes: [`structure`],
    loading: false,
    error_msg: undefined,
    on_file_load,
    on_error,
  })
  const drop = async (content: string, filename: string) => {
    on_file_load.mockClear()
    on_error.mockClear()
    root.dispatchEvent(create_drop_event(new File([content], filename)))
    await vi.waitFor(() =>
      expect(on_file_load.mock.calls.length + on_error.mock.calls.length).toBe(1),
    )
    expect(props.loading).toBe(false)
  }
  await drop(POSCAR, `POSCAR`)
  expect(props.structure?.sites.map(({ species }: Site) => species[0].element)).toEqual([`Si`])
  expect(props.band_data).toStrictEqual(band_data) // the other panes keep their data
  expect(on_file_load).toHaveBeenCalledWith({ filename: `POSCAR`, panes: [`structure`] })

  await drop(make_bxsf(6.5), `grid.bxsf`)
  expect(props.band_data?.fermi_energy).toBe(6.5)
  expect(props.structure?.sites).toHaveLength(1)
  // a pane the file filled joins the caller's pane list
  expect(props.panes).toEqual([`structure`, `fermi`])

  await drop(JSON.stringify(band_struct), `bands.json`)
  expect(Object.keys(props.band_structs ?? {})).toEqual([`bands.json`])
  await drop(JSON.stringify(dos), `dos.json`)
  expect(Object.keys(props.doses ?? {})).toEqual([`dos.json`])
  expect(props.panes).toEqual([`structure`, `fermi`, `bands`, `dos`])
  expect(on_file_load).toHaveBeenCalledWith({ filename: `dos.json`, panes: [`dos`] })
  // a phonon DOS fills the phonon pane, beside (not into) the electronic DOS
  await drop(JSON.stringify({ frequencies: [0, 4, 8], densities: [0, 1, 0] }), `ph.json`)
  expect(on_file_load).toHaveBeenCalledWith({ filename: `ph.json`, panes: [`phonon`] })
  expect(props.phonon?.doses?.[`ph.json`]).toMatchObject({ type: `phonon` })
  expect(Object.keys(props.doses ?? {})).toEqual([`dos.json`])
  expect(shown_panes(root)).toEqual([`structure`, `fermi`, `bands`, `dos`, `phonon`])

  const si = props.structure
  await drop(`2\nH2\nH 0 0 0\nH 0 0 0.74\n`, `h2.xyz`)
  expect(props.structure).toBe(si)
  expect(props.error_msg).toBe(
    `h2.xyz holds no periodic structure: its Fermi surface needs a lattice`,
  )
  expect(on_error).toHaveBeenCalledWith({ error_msg: props.error_msg, filename: `h2.xyz` })

  await drop(JSON.stringify({ answer: 42 }), `other.json`)
  expect(props.error_msg).toBe(
    `other.json is json browser data, not a structure, Fermi surface, band structure or DOS`,
  )
})

// drops onto an empty viewer, resolving with what on_file_load or on_error received
const drop_into_empty = async (file: File) => {
  const [on_file_load, on_error] = [vi.fn(), vi.fn()]
  // every key the drop may fill is present, so the viewer's writes reach these props
  const { props, root } = mount_live({
    structure: undefined,
    band_structs: {},
    doses: {},
    on_file_load,
    on_error,
  })
  root.dispatchEvent(create_drop_event(file))
  await vi.waitFor(() =>
    expect(on_file_load.mock.calls.length + on_error.mock.calls.length).toBe(1),
  )
  expect(on_error).not.toHaveBeenCalled()
  return { props, loaded: on_file_load.mock.calls[0][0] }
}

test(`a { band_structure, dos } JSON (BandsAndDos' format) fills both spectra`, async () => {
  const json = JSON.stringify({ band_structure: band_struct, dos })
  const { props, loaded } = await drop_into_empty(new File([json], `bands_dos.json`))
  expect(loaded).toEqual({ filename: `bands_dos.json`, panes: [`bands`, `dos`] })
  expect(props.band_structs?.[`bands_dos.json`]?.bands).toEqual(band_struct.bands)
  expect(props.doses?.[`bands_dos.json`]?.densities).toEqual(dos.densities)
})

test(`a vaspout.h5 trajectory fills the structure from its final frame and its DOS`, async () => {
  const bytes = read_binary_test_file(
    `vaspout-si-static-scf.h5`,
    `tests/vitest/fixtures/vasp-hdf5`,
  )
  const { props, loaded } = await drop_into_empty(new File([bytes], `vaspout.h5`))
  expect(loaded).toEqual({ filename: `vaspout.h5`, panes: [`structure`, `dos`] })
  expect(
    new Set(props.structure?.sites.map(({ species }: Site) => species[0].element)),
  ).toEqual(new Set([`Si`]))
  expect(props.doses?.[`vaspout.h5`]?.densities).toHaveLength(25)
  expect(props.band_structs).toEqual({}) // trajectories carry no bands
})

// the grid's cell turned by `angle` about z
const turned = (angle: number): Matrix3x3 => {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)].map((val) => 2 * Math.PI * val)
  return [
    [cos, sin, 0],
    [-sin, cos, 0],
    [0, 0, 2 * Math.PI],
  ]
}
// oxfmt-ignore
test.each([
  [`the grid's cell`, true, make_crystal(2 * Math.PI, [[`Cu`, [0, 0, 0]]])],
  [`a supercell of it`, true, make_crystal(6 * Math.PI, [[`Cu`, [0, 0, 0]]])],
  [`a cell it is a supercell of`, true, make_crystal(Math.PI, [[`Cu`, [0, 0, 0]]])],
  [`its cell turned 30° about z`, false, make_crystal(turned(Math.PI / 6), [[`Cu`, [0, 0, 0]]])],
  [`its cell turned 0.1° about z`, false, make_crystal(turned(Math.PI / 1800), [[`Cu`, [0, 0, 0]]])],
])(`a structure of %s shares the band grid's frame: %s`, (_desc, shared, crystal) => {
  const on_error = vi.fn()
  const root = mount_host({ structure: crystal, band_data, on_error })
  expect(on_error).toHaveBeenCalledTimes(shared ? 0 : 1)
  if (!shared) expect(on_error.mock.calls[0][0].error_msg).toContain(`different Cartesian frames`)
  const toggle = root.querySelector<HTMLButtonElement>(`.sync-rotation-toggle`)
  expect([toggle?.disabled, toggle?.getAttribute(`aria-pressed`)]).toEqual([!shared, String(shared)])
  const before = view_dir(scenes.controls.fermi)
  const direction = new Vector3(-2, 1, 3).normalize()
  orbit(scenes.controls.structure, direction)
  const follower = view_dir(scenes.controls.fermi)
  if (shared) expect(follower.distanceTo(direction)).toBeLessThan(1e-12)
  else expect(follower.toArray()).toEqual(before.toArray())
})

test(`a dropped POSCAR turned out of the band grid's frame is reported`, async () => {
  const on_error = vi.fn()
  const root = mount_host({ structure, band_data, on_error })
  const file = new File([poscar(turned(Math.PI / 6))], `POSCAR`)
  root.dispatchEvent(create_drop_event(file))
  await vi.waitFor(() => expect(on_error).toHaveBeenCalledOnce())
  expect(on_error.mock.calls[0][0].error_msg).toContain(`different Cartesian frames`)
  expect(root.querySelector<HTMLButtonElement>(`.sync-rotation-toggle`)?.disabled).toBe(true)
})

// The structure's viewport scopes it out of the link: its rotation sliders turn the atoms out
// of the shared frame, multi-view panes look along fixed axes
test.each<[string, Partial<ComponentProps<typeof Structure>>]>([
  [`turned by the rotation sliders`, { scene_props: { rotation: [0.5, 0, 0] } }],
  [`in multi-view panes`, { multi_view: true }],
])(`a structure %s stays out of the rotation link`, (_desc, structure_props) => {
  mount_host({ structure, band_data, structure_props })
  const before = view_dir(scenes.controls.structure)
  orbit(scenes.controls.fermi, new Vector3(1, 2, -1).normalize())
  expect(view_dir(scenes.controls.structure).toArray()).toEqual(before.toArray())
})

// === sweeps ===
// Two series along pressure: each frame's own DOS (density 1 or 2 at E_F) tells them apart
const sweep_frame = (value: number, density: number): SweepFrame => ({
  value,
  structure,
  band_data,
  band_structs: { Cu: band_struct },
  doses: { total: { ...dos, densities: [0, density, density, 0] } },
  scalars: { tc: value / 10 },
})
const make_sweep = (): Sweep => ({
  axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
  series: [
    { id: `fcc`, frames: [sweep_frame(0, 1), sweep_frame(50, 2), sweep_frame(100, 3)] },
    { id: `bcc`, label: `bcc`, frames: [sweep_frame(100, 4), sweep_frame(150, 5)] },
  ],
  descriptors: [
    { key: `tc`, label: `Tc`, unit: `K` },
    { key: `n_ef`, label: `N(E_F)`, compute: `fermi_dos` },
  ],
})
const ALL_PANES: ElectronicPane[] = [`structure`, `fermi`, `trends`, `bands`, `dos`]
const shown_density = () => viewers.dos?.doses?.total?.densities[1]
const status = (root: Element) => root.querySelector(`.frame-status`)?.textContent?.trim()
const wide_dos: ElectronicDos = { ...dos, energies: [0, 2, 4, 20] }
// the union of the records' padded frequency extents, as the spectra span them (min/max
// computed here, not via union_ranges, which the component uses)
const spectra_span = (spectra: SpectraRecords[]): Vec2 => {
  const ranges = spectra
    .map(({ band_structs = {}, doses = {} }) => compute_frequency_range(band_structs, doses))
    .filter((range) => range !== undefined)
  return [Math.min(...ranges.map(([lo]) => lo)), Math.max(...ranges.map(([, hi]) => hi))]
}
const series_select = (root: Element, label: string) => {
  const control = [...root.querySelectorAll(`.series-control`)].find((node) =>
    node.textContent?.includes(label),
  )
  const select = control?.querySelector(`select`)
  if (!select) throw new Error(`no ${label} select`)
  return select
}
const choose = (select: HTMLSelectElement, value: string) => {
  select.value = value
  select.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
}
// a sweep whose frames hold only structures, values and the plotted tc (so no fill), their
// spectra from a loader labelling each frame `<series> <idx>` with density 10 + idx at E_F
const lazy_sweep = () => {
  const sweep = make_sweep()
  for (const series of sweep.series) {
    series.frames = series.frames.map(({ value, scalars }) => ({ value, structure, scalars }))
  }
  const load_frame = vi.fn(async (series_id: string, frame_idx: number) => ({
    doses: { total: { ...dos, densities: [0, 10 + frame_idx, 10 + frame_idx, 0] } },
    label: `${series_id} ${frame_idx}`,
  }))
  sweep.load_frame = load_frame
  const loads = () => load_frame.mock.calls.map(([series_id, idx]) => [series_id, idx])
  return { sweep, load_frame, loads }
}

test(`a sweep's frame feeds every pane, stepped by its control bar and keys`, () => {
  const { props, root } = mount_live({
    sweep: make_sweep(),
    frame_idx: 0,
    series_id: undefined,
    panes: ALL_PANES,
    // the props a sweep replaces: never shown while it is set
    doses: { total: { ...dos, densities: [9, 9, 9, 9] } },
  })
  expect(shown_panes(root)).toEqual([`structure`, `fermi`, `trends`, `bands`, `dos`])
  expect(status(root)).toBe(`0 GPa`)
  expect(shown_density()).toBe(1)
  expect(viewers.bands?.band_structs).toEqual({ Cu: band_struct })
  expect(viewers.fermi?.band_data).toEqual(band_data)
  expect(viewers.trends).toMatchObject({ series_id: `fcc`, frame_idx: 0 })

  root.dispatchEvent(new KeyboardEvent(`keydown`, { key: `ArrowRight`, bubbles: true }))
  flushSync()
  expect(props.frame_idx).toBe(1)
  expect(status(root)).toBe(`50 GPa`)
  expect(shown_density()).toBe(2)
  expect(viewers.trends?.frame_idx).toBe(1)

  // the series select opens the new series at the frame nearest the shown value (100 GPa)
  props.frame_idx = 2
  flushSync()
  choose(series_select(root, `Series`), `bcc`)
  expect([props.series_id, props.frame_idx]).toEqual([`bcc`, 0])
  expect(status(root)).toBe(`100 GPa`)
  expect(shown_density()).toBe(4)
  props.frame_idx = 9
  flushSync()
  expect(props.frame_idx).toBe(1) // clamped to the 2-frame series, back through the binding
  expect(status(root)).toBe(`150 GPa`)
})

// One frame has nothing to play and, as the only series, nothing to pick: the bar keeps what
// still applies (the series menus, the frame's status) and goes when that is nothing.
test.each([
  [`several frames`, [3, 2], [1, 1, `0 GPa`]],
  [`one frame beside another series`, [1, 2], [1, 0, `0 GPa`]],
  [`one frame, the only series`, [1], [0, 0, undefined]],
])(`a sweep with %s shows bar, playback and status %j`, (_label, frame_counts, expected) => {
  const sweep = make_sweep()
  sweep.series = frame_counts.map((n_frames, idx) => ({
    ...sweep.series[idx],
    frames: sweep.series[idx].frames.slice(0, n_frames),
  }))
  const root = mount_host({ sweep, panes: ALL_PANES })
  expect([
    count(root, `.sequence-control-bar`),
    count(root, `.sequence-control-bar input[type="range"]`),
    status(root),
  ]).toEqual(expected)
})

test(`clicking a trends point selects its series and frame`, () => {
  const { props, root } = mount_live({
    sweep: make_sweep(),
    frame_idx: 0,
    series_id: undefined,
    panes: ALL_PANES,
  })
  viewers.trends?.on_frame_select?.(`bcc`, 0)
  flushSync()
  expect([props.series_id, props.frame_idx]).toEqual([`bcc`, 0])
  expect(status(root)).toBe(`100 GPa`)
  // a new sweep without the series the viewer picked opens at its first series
  const other = make_sweep()
  other.series = [other.series[0]]
  props.sweep = other
  flushSync()
  expect([props.series_id, status(root)]).toEqual([`fcc`, `0 GPa`])
})

test(`load_frame fetches the shown frame and its neighbours, merged into the panes`, async () => {
  const { sweep, load_frame, loads } = lazy_sweep()
  const { props, root } = mount_live({
    sweep,
    series_id: undefined,
    frame_idx: 2,
    panes: ALL_PANES,
  })
  // the last frame's next is the first, where playback wraps
  expect(loads()).toEqual([
    [`fcc`, 2],
    [`fcc`, 0],
    [`fcc`, 1],
  ])
  await vi.waitFor(() => expect(shown_density()).toBe(12))
  expect(status(root)).toBe(`fcc 2`)
  props.frame_idx = 1
  flushSync()
  expect(load_frame).toHaveBeenCalledTimes(3) // all cached
  await vi.waitFor(() => expect(shown_density()).toBe(11))
  props.series_id = `bcc`
  props.frame_idx = 0
  flushSync()
  expect(loads().slice(3)).toEqual([
    [`bcc`, 0],
    [`bcc`, 1],
  ])
})

test(`a sweep frame's phonons merge its own α²F with the loaded dispersion`, async () => {
  const sweep = make_sweep()
  sweep.series[0].frames = sweep.series[0].frames.map(({ value }) => ({
    value,
    structure,
    phonon: { a2f: phonon.a2f },
  }))
  sweep.load_frame = async () => ({ phonon: { band_structs: phonon.band_structs } })
  mount_host({ sweep, frame_idx: 0 })
  await vi.waitFor(() => expect(viewers.phonon?.band_structs).toEqual(phonon.band_structs))
  expect(viewers.phonon?.a2f).toEqual(phonon.a2f)
})

// Stepping through a sweep, the spectra span every loaded frame of the series: the axes hold
// still instead of jumping to each frame's own extent
test(`a sweep's spectra axes span all its frames, unless the caller passes a range`, () => {
  const sweep = make_sweep()
  const [fcc] = sweep.series
  const fast_phonons: PhononSpectra = {
    doses: { ph: { ...phonon_dos, frequencies: [0, 5, 9] } },
  }
  fcc.frames[0].phonon = phonon
  fcc.frames[1] = { ...fcc.frames[1], doses: { total: wide_dos }, phonon: fast_phonons }
  const electronic = spectra_span(fcc.frames)
  const phonons = spectra_span([phonon, fast_phonons])
  expect(electronic[1]).toBeGreaterThan(19) // frame 1's DOS reaches 20 eV
  const { props } = mount_live({
    sweep,
    frame_idx: 0,
    panes: [`bands`, `dos`, `phonon`],
    bands_props: {},
  })
  for (const frame_idx of [0, 1, 2]) {
    props.frame_idx = frame_idx
    flushSync()
    expect(viewers.bands?.y_axis?.range).toEqual(electronic)
    expect(viewers.phonon?.frequency_range).toEqual(phonons)
  }
  props.bands_props = { y_axis: { range: [5, 9] } }
  flushSync()
  expect(viewers.bands?.y_axis?.range).toEqual([5, 9])
})

// Frames the window and recent list have left drop their data (sweep-frames' eviction): the
// spectra's span and the default panes are those of every frame each shown series loaded so
// far: kept while another series is compared, cleared or swapped in, gone with the series
test.each([
  {
    kept: `the spectra's span`, // only fcc's frame 1 reaches 20 eV
    frame_1: { doses: { total: wide_dos } },
    panes: [`dos`] satisfies ElectronicPane[],
    read: () => instances.dos[0]?.x_axis?.range, // the shown side's; energy on x without bands
    loaded: compute_frequency_range({}, { wide_dos }),
    reset: compute_frequency_range({}, { dos }),
  },
  {
    kept: `the bands pane`, // only fcc's frame 1 has a band structure
    frame_1: { doses: { total: dos }, band_structs: { cu: band_struct } },
    panes: undefined,
    read: (root: Element) => shown_panes(root).includes(`bands`),
    loaded: true,
    reset: false,
  },
])(
  `evicting the only frame with data keeps $kept`,
  async ({ frame_1, panes, read, ...want }) => {
    const sweep: Sweep = {
      axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
      series: [
        { id: `fcc`, frames: Array.from({ length: 7 }, (_, idx) => ({ value: 10 * idx })) },
        { id: `bcc`, frames: [{ value: 0 }] },
      ],
      load_frame: async (series_id: string, frame_idx: number) =>
        series_id === `fcc` && frame_idx === 1 ? frame_1 : { doses: { total: dos } },
    }
    const { props, root } = mount_live({
      sweep,
      series_id: `fcc`,
      frame_idx: 0,
      compare_series: undefined,
      panes,
    })
    await vi.waitFor(() => expect(read(root)).toEqual(want.loaded)) // frame 1 prefetched
    // frame 6 shows frames 5 to 2 recently and prefetches 0 and 5: frame 1 is evicted
    for (const frame_idx of [1, 2, 3, 4, 5, 6]) {
      props.frame_idx = frame_idx
      flushSync()
      await vi.waitFor(() => expect(viewers.dos?.doses?.total).toBeDefined())
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(read(root)).toEqual(want.loaded)
    for (const compare_series of [`bcc`, undefined, `bcc`]) {
      props.compare_series = compare_series
      flushSync()
      expect(read(root)).toEqual(want.loaded)
    }
    // the series select swaps the shown and compared series: fcc's stays beside bcc
    choose(series_select(root, `Series`), `bcc`)
    expect([props.series_id, props.compare_series]).toEqual([`bcc`, `fcc`])
    expect(read(root)).toEqual(want.loaded)
    props.compare_series = undefined // bcc alone: its own
    flushSync()
    await vi.waitFor(() => expect(read(root)).toEqual(want.reset))
  },
)

// A bound descriptor carries over to a new sweep only when it has that key
test(`replacing the sweep resets a descriptor it does not have`, () => {
  const { props } = mount_live({ sweep: make_sweep(), descriptor: `n_ef`, panes: ALL_PANES })
  expect(viewers.trends?.descriptor).toBe(`n_ef`)
  props.sweep = make_sweep() // has n_ef: kept
  flushSync()
  expect(props.descriptor).toBe(`n_ef`)
  props.sweep = { ...make_sweep(), descriptors: [{ key: `tc`, label: `Tc`, unit: `K` }] }
  flushSync()
  expect([props.descriptor, viewers.trends?.descriptor]).toEqual([undefined, undefined])
})

// Lazily, a frame whose band grid is still loading has no zone to compare, which must not
// count as a new mismatch once it arrives
test.each([false, true])(
  `frames out of the band grid's frame are reported once per series (lazy: %s)`,
  async (lazy) => {
    const on_error = vi.fn()
    // each frame its own (equally turned) structure, as a sweep's scaled cells are
    const off_frame = () => make_crystal(turned(Math.PI / 6), [[`Cu`, [0, 0, 0]]])
    const sweep = make_sweep()
    for (const series of sweep.series) {
      series.frames = series.frames.map((frame) =>
        lazy
          ? { value: frame.value, structure: off_frame() }
          : { ...frame, structure: off_frame() },
      )
    }
    const load_frame = lazy ? vi.fn(async () => ({ band_data })) : undefined
    if (load_frame) sweep.load_frame = load_frame
    const { props } = mount_live({ sweep, series_id: undefined, frame_idx: 0, on_error })
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledOnce())
    // frame 2 is not prefetched from frame 0: its grid loads after the jump
    props.frame_idx = 2
    flushSync()
    if (load_frame)
      await vi.waitFor(() =>
        expect(load_frame).toHaveBeenCalledWith(`fcc`, 2, { signal: expect.any(AbortSignal) }),
      )
    props.frame_idx = 1
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(on_error).toHaveBeenCalledOnce()
    props.series_id = `bcc`
    flushSync()
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(2))
    // back to a series already reported: not again
    props.series_id = `fcc`
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(on_error).toHaveBeenCalledTimes(2)
  },
)

test(`a lazy sweep's default panes are those any frame has, so loads only add panes`, async () => {
  const sweep = make_sweep()
  sweep.series[0].frames = sweep.series[0].frames.map(({ value }) => ({ value, structure }))
  // only frame 0 brings a DOS
  const load_frame = vi.fn(async (_series_id: string, frame_idx: number) =>
    frame_idx === 0 ? { doses: { total: dos } } : {},
  )
  sweep.load_frame = load_frame
  const { props, root } = mount_live({ sweep, frame_idx: 0 })
  expect(shown_panes(root)).toEqual([`structure`, `trends`])
  await vi.waitFor(() => expect(shown_panes(root)).toEqual([`structure`, `trends`, `dos`]))
  props.frame_idx = 1 // a frame without DOS keeps the pane (empty) instead of collapsing it
  flushSync()
  await vi.waitFor(() =>
    expect(load_frame).toHaveBeenCalledWith(`fcc`, 2, { signal: expect.any(AbortSignal) }),
  )
  expect(shown_panes(root)).toEqual([`structure`, `trends`, `dos`])
})

// The old sweep's panes read their props as they unmount, which re-runs the viewer's frame
// deriveds against the old sweep: its loads must still reach the panes afterwards
test(`a replaced lazy sweep draws the frames its own loader returns`, async () => {
  // frames holding only their value, so swapping sweeps unmounts the loaded panes
  const bare_sweep = () => {
    const load_frame = vi.fn(async () => ({ structure, doses: { total: dos } }))
    const sweep = make_sweep()
    for (const series of sweep.series)
      series.frames = series.frames.map(({ value }) => ({ value }))
    return { sweep: { ...sweep, load_frame }, load_frame }
  }
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    sweep: bare_sweep().sweep,
    frame_idx: 0,
  })
  const root = mount_host(props)
  // a DOS pane without its empty state (undefined while there is no pane)
  const dos_drawn = () =>
    root.querySelector(`[data-pane="dos"]`)?.querySelector(`.empty-state`) === null
  await vi.waitFor(() => expect(dos_drawn()).toBe(true))
  const { sweep, load_frame } = bare_sweep()
  props.sweep = sweep
  flushSync()
  expect(dos_drawn()).toBe(false) // the old DOS unmounted, the path this test is about
  await vi.waitFor(() =>
    expect(load_frame).toHaveBeenCalledWith(`fcc`, 0, { signal: expect.any(AbortSignal) }),
  )
  await vi.waitFor(() => expect(dos_drawn()).toBe(true))
})

test(`a dropped sweep JSON replaces the viewer's data, which then takes only sweeps`, async () => {
  const on_error = vi.fn()
  const on_file_load = vi.fn()
  const { props, root } = mount_live({
    structure,
    sweep: undefined,
    frame_idx: 0,
    error_msg: undefined,
    on_error,
    on_file_load,
  })
  const sweep_json = {
    axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
    series: [{ id: `fcc`, frames: [{ value: 0 }, { value: 20, doses: { total: dos } }] }],
    descriptors: [{ key: `n_ef`, label: `N(E_F)`, compute: `fermi_dos` }],
  }
  const sweep_file = new File([JSON.stringify(sweep_json)], `sweep.json`)
  root.dispatchEvent(create_drop_event(sweep_file))
  await vi.waitFor(() => expect(props.sweep?.series[0].frames).toHaveLength(2))
  flushSync()
  expect(status(root)).toBe(`0 GPa`)
  expect(shown_panes(root)).toContain(`trends`)
  // the panes its frames fill, plus trends as it has descriptors
  expect(on_file_load).toHaveBeenLastCalledWith({
    filename: `sweep.json`,
    panes: [`dos`, `trends`],
  })
  // without descriptors no trends: the panes are only those its frames fill
  const plain_sweep = {
    axis: sweep_json.axis,
    series: [{ id: `fcc`, frames: [{ value: 0, structure }] }],
  }
  const plain_file = new File([JSON.stringify(plain_sweep)], `plain.json`)
  root.dispatchEvent(create_drop_event(plain_file))
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2))
  expect(on_file_load).toHaveBeenLastCalledWith({
    filename: `plain.json`,
    panes: [`structure`],
  })

  root.dispatchEvent(create_drop_event(new File([POSCAR], `POSCAR`)))
  await vi.waitFor(() => expect(on_error).toHaveBeenCalledOnce())
  expect(props.error_msg).toBe(
    `POSCAR is no sweep JSON: while a sweep is shown the viewer takes only sweeps`,
  )
  // an invalid sweep JSON is reported with its filename
  const bad_file = new File([JSON.stringify({ ...plain_sweep, extra: 1 })], `bad.json`)
  root.dispatchEvent(create_drop_event(bad_file))
  await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(2))
  expect(on_error).toHaveBeenLastCalledWith({
    error_msg: `Invalid sweep at root.extra: unknown field`,
    filename: `bad.json`,
  })
  // a caller's sweep after the dropped one loads through its own loader
  const load_frame = vi.fn(async () => ({}))
  props.sweep = { ...make_sweep(), load_frame }
  flushSync()
  await vi.waitFor(() =>
    expect(load_frame).toHaveBeenCalledWith(`fcc`, 0, { signal: expect.any(AbortSignal) }),
  )
})

// === compare ===
const side_labels = (root: Element) =>
  [...root.querySelectorAll(`.side-label`)].map((label) =>
    label.textContent?.replaceAll(/\s+/g, ` `).trim(),
  )

// Default panes open for data on either side and close with its side: only the compared
// series has phonons here
test(`default panes follow the compared series' data`, () => {
  const sweep = make_sweep()
  for (const entry of sweep.series[1].frames) entry.phonon = phonon
  const { props, root } = mount_live({ sweep, compare_series: undefined, frame_idx: 0 })
  const has_phonon = () => shown_panes(root).includes(`phonon`)
  expect(has_phonon()).toBe(false)
  props.compare_series = `bcc`
  flushSync()
  expect(has_phonon()).toBe(true)
  props.compare_series = undefined
  flushSync()
  expect(has_phonon()).toBe(false)
})

// A caller's density range beats the sides' shared one, with or without a compared series
test.each([undefined, `bcc`])(
  `explicit DOS density ranges win (compare_series %s)`,
  (compare_series) => {
    const sweep = make_sweep()
    for (const entry of sweep.series.flatMap(({ frames }) => frames)) entry.phonon = phonon
    mount_host({
      sweep,
      compare_series,
      frame_idx: 0,
      panes: [...ALL_PANES, `phonon`],
      dos_props: { density_range: [0, 9] },
      phonon_props: { density_range: [0, 7] },
    })
    // every side's plots, the shown one's as well as a compared one's
    expect([
      new Set(instances.dos.map(({ density_range }) => JSON.stringify(density_range))),
      new Set(instances.phonon.map(({ density_range }) => JSON.stringify(density_range))),
    ]).toEqual([new Set([`[0,9]`]), new Set([`[0,7]`])])
  },
)

// Narrow, the panes stack in one column, each its own height, rather than share the viewer's:
// no dividers between them, the scenes one above the other, and every compared side labelled
test.each([
  [700, true],
  [1200, false],
])(`at %ipx wide the panes stack: %s`, async (width, stacked) => {
  // every pane row measures 700x320, where the scenes would split side by side unstacked
  for (const [key, size] of [
    [`clientWidth`, 700],
    [`clientHeight`, 320],
  ] as const) {
    const spy = vi.spyOn(HTMLElement.prototype, key, `get`).mockReturnValue(size)
    onTestFinished(() => spy.mockRestore())
  }
  const root = await mount_sized(
    ElectronicStructure,
    { sweep: make_sweep(), compare_series: `bcc`, panes: ALL_PANES },
    {
      selector: `.electronic-structure`,
      width,
      height: 400,
      on_mount: (comp) => mounted.push(comp),
    },
  )
  flushSync()
  const divider = (label: string) => Boolean(root.querySelector(`[aria-label="${label}"]`))
  expect({
    stacked: root.classList.contains(`stacked`),
    rows_divider: divider(`Resize 3D scenes and the plots below`),
    trends_divider: divider(`Resize sweep descriptors and spectra`),
    side_labels: side_labels(root).length,
  }).toEqual({
    stacked,
    rows_divider: !stacked,
    trends_divider: !stacked,
    side_labels: stacked ? 4 : 2,
  })
  const scenes_row = root.querySelector(`.row.scenes`)
  expect(scenes_row?.classList.contains(`vertical`)).toBe(stacked)
})

test(`compare_series splits the frame panes into two labelled sides on shared axes`, () => {
  const sweep = make_sweep()
  const [fcc, bcc] = sweep.series
  // HTML labels (the trends legend and axis render it) read as plain text in options, side
  // labels and the slider's aria-label
  bcc.label = `b<i>c</i>c`
  sweep.axis.label = `P<sub>ext</sub>`
  // bcc's DOS reaches 20 eV and density 4, beyond every fcc frame
  for (const entry of bcc.frames) {
    entry.doses = { total: { ...wide_dos, densities: [0, 4, 4, 0] } }
    entry.phonon = phonon
  }
  const { props, root } = mount_live({
    sweep,
    series_id: undefined,
    frame_idx: 2,
    compare_series: undefined,
    panes: [...ALL_PANES, `phonon`],
  })
  // the mounted scenes and spectra: comparing adds the compared side's, never remounts
  const mounted_views = () => [scenes.all.length, instances.bands.length, instances.dos.length]
  expect(mounted_views()).toEqual([2, 1, 1])
  // off: one side, as without a compared series
  expect([count(root, `.sides.compare`), count(root, `.side-label`)]).toEqual([0, 0])
  expect(shown_panes(root)).toEqual([`structure`, `fermi`, `trends`, `bands`, `dos`, `phonon`])
  expect(viewers.bands?.y_axis?.range).toEqual(spectra_span(fcc.frames))
  expect(viewers.trends?.compare).toBeUndefined()
  const compare_select = series_select(root, `Compare with`)
  expect([...compare_select.options].map(({ value }) => value)).toEqual([``, `bcc`])
  expect(option_texts(compare_select)).toEqual([`none`, `bcc`])
  expect(option_texts(series_select(root, `Series`))).toEqual([`fcc`, `bcc`])
  expect(root.querySelector(`[aria-label="Pext frame"]`)).not.toBeNull()

  choose(compare_select, `bcc`)
  expect(props.compare_series).toBe(`bcc`)
  // the scenes' row and the spectra's column split, the trends pane stays single
  expect(count(root, `.sides.compare`)).toBe(2)
  expect(mounted_views()).toEqual([4, 2, 2])
  // oxfmt-ignore
  expect(shown_panes(root)).toEqual([`structure`, `fermi`, `structure`, `fermi`, `trends`, `bands`, `dos`, `phonon`, `bands`, `dos`, `phonon`])
  expect(side_labels(root)).toEqual([`fcc · 100 GPa`, `bcc · 100 GPa`])
  expect(viewers.trends?.compare).toEqual({ series_id: `bcc`, frame_idx: 0 })
  // both sides span both series' energies, their DOS one density range, their phonons one
  // frequency range
  const both = spectra_span([...fcc.frames, ...bcc.frames])
  expect(both[1]).toBeGreaterThan(19)
  const [main_bands, compared_bands] = instances.bands.slice(-2)
  expect([main_bands.y_axis?.range, compared_bands.y_axis?.range]).toEqual([both, both])
  const [main_dos, compared_dos] = instances.dos.slice(-2)
  expect([main_dos.doses, compared_dos.doses]).toEqual([
    fcc.frames[2].doses,
    bcc.frames[0].doses,
  ])
  expect([main_dos.density_range, compared_dos.density_range]).toEqual([
    [0, 4],
    [0, 4],
  ])
  const phonon_span = compute_frequency_range({}, phonon.doses ?? {})
  const sides_phonons = instances.phonon.slice(-2)
  expect(sides_phonons.map(({ frequency_range }) => frequency_range)).toEqual([
    phonon_span,
    phonon_span,
  ])
  expect(sides_phonons.map(({ doses }) => doses)).toEqual([{}, phonon.doses])

  // the series select picking the compared series trades places with the shown one
  choose(series_select(root, `Series`), `bcc`)
  expect([props.series_id, props.frame_idx, props.compare_series]).toEqual([`bcc`, 0, `fcc`])
  expect(side_labels(root)).toEqual([`bcc · 100 GPa`, `fcc · 100 GPa`])
  // both selects show the swapped series among their re-rendered options
  expect([series_select(root, `Series`).value, compare_select.value]).toEqual([`bcc`, `fcc`])
  // so does a click on the compared series' point in the trends plot
  viewers.trends?.on_frame_select?.(`fcc`, 1)
  flushSync()
  expect([props.series_id, props.frame_idx, props.compare_series]).toEqual([`fcc`, 1, `bcc`])
  choose(series_select(root, `Series`), `bcc`)

  // clearing the compare restores the single side, on the shown series' own span again
  choose(series_select(root, `Compare with`), ``)
  expect(props.compare_series).toBeUndefined()
  expect([count(root, `.sides.compare`), count(root, `.side-label`)]).toEqual([0, 0])
  expect(mounted_views()).toEqual([4, 2, 2])
  expect(shown_panes(root)).toEqual([`structure`, `fermi`, `trends`, `bands`, `dos`, `phonon`])
  // the shown side's plots, mounted before comparing
  expect(instances.bands[0].y_axis?.range).toEqual(spectra_span(bcc.frames))
  expect(instances.dos[0].density_range).toBeUndefined()
  expect(viewers.trends?.compare).toBeUndefined()

  // a replaced sweep without the compared series drops it
  props.compare_series = `fcc`
  flushSync()
  const other = make_sweep()
  other.series = [other.series[1]]
  props.sweep = other
  flushSync()
  expect([props.series_id, props.compare_series]).toEqual([`bcc`, undefined])
  // so does the same sweep losing it in place
  props.sweep?.series.push(make_sweep().series[0])
  props.compare_series = `fcc`
  flushSync()
  expect(side_labels(root)).toHaveLength(2)
  props.sweep?.series.pop()
  flushSync()
  expect([props.compare_series, side_labels(root)]).toEqual([undefined, []])
})

// a's frames bunch at 0 to 8 GPa while b's lie at 10, 50, 90: b's own spacing, its median gap of
// 40 GPa, sets how far its frame may lie off (a's gaps would make 20 off far). A one-frame b
// has no spacing of its own, so a's median gap (2 GPa) sets it.
const spread = [10, 50, 90]
test.each([
  [0, spread, `b · 10 GPa`, 0, ``],
  [5, spread, `b · 10 GPa`, 0, ``], // 30 GPa: a tie goes to the lower frame
  [6, spread, `b · 90 GPa`, 2, ``], // 130 GPa: exactly one step off is not far
  [7, spread, `b · 90 GPa`, 2, `no frame within 40 GPa of 140 GPa`],
  [0, [60], `b · 60 GPa`, 0, `no frame within 2 GPa of 0 GPa`],
])(
  `frame %d of a is compared with b at %j: %s`,
  (frame_idx, b_values, label, compare_idx, notice) => {
    const sweep: Sweep = {
      ...make_sweep(),
      series: [
        {
          id: `a`,
          frames: [0, 2, 4, 6, 8, 30, 130, 140].map((value) => sweep_frame(value, 1)),
        },
        { id: `b`, frames: b_values.map((value) => sweep_frame(value, 2)) },
      ],
    }
    const root = mount_host({ sweep, frame_idx, compare_series: `b`, panes: ALL_PANES })
    const [main_label, compare_label] = side_labels(root)
    expect(main_label).toBe(`a · ${sweep.series[0].frames[frame_idx].value} GPa`)
    expect(compare_label).toBe(notice ? `${label} ${notice}` : label)
    expect(root.querySelector(`.side-label .far`)?.textContent?.trim() ?? ``).toBe(notice)
    expect(viewers.trends?.compare).toEqual({ series_id: `b`, frame_idx: compare_idx })
  },
)

test(`a compared series loads through the same frame cache, window and aborts`, async () => {
  const { sweep, load_frame, loads } = lazy_sweep()
  const { props, root } = mount_live({
    sweep,
    frame_idx: 2,
    compare_series: `bcc`,
    panes: ALL_PANES,
  })
  // the shown frames first: fcc's 100 GPa and bcc's nearest, then fcc's neighbours (bcc's
  // frame nearest the next one, 0 GPa, is the same frame)
  expect(loads()).toEqual([
    [`fcc`, 2],
    [`bcc`, 0],
    [`fcc`, 0],
    [`fcc`, 1],
  ])
  await vi.waitFor(() => expect(side_labels(root)).toEqual([`fcc · fcc 2`, `bcc · bcc 0`]))
  expect(instances.dos.at(-1)?.doses?.total?.densities[1]).toBe(10)
  // cleared and compared again: the recently shown bcc frame needs no reload
  props.compare_series = undefined
  flushSync()
  props.frame_idx = 1
  flushSync()
  props.compare_series = `bcc`
  flushSync()
  expect(load_frame).toHaveBeenCalledTimes(4)
  expect(side_labels(root)).toEqual([`fcc · fcc 1`, `bcc · bcc 0`])
})

test(`compared scenes share one rotation link, all four turning together`, () => {
  const { props, root } = mount_live({
    sweep: make_sweep(),
    frame_idx: 2,
    compare_series: `bcc`,
    panes: [`structure`, `fermi`],
    sync_rotation: true,
    selected_bands: undefined,
  })
  expect(scenes.all).toHaveLength(4)
  // the compared side keeps its own sheet selection, apart from the bound one
  const shown_selection = props.selected_bands
  if (!viewers.fermi) throw new Error(`no compared Fermi surface`)
  viewers.fermi.selected_bands = [9]
  flushSync()
  expect([props.selected_bands, viewers.fermi.selected_bands]).toEqual([shown_selection, [9]])
  const direction = new Vector3(-2, 1, 3).normalize()
  orbit(scenes.all[3], direction) // the compared Fermi surface leads
  for (const controls of scenes.all) {
    expect(view_dir(controls).distanceTo(direction)).toBeLessThan(1e-12)
  }
  const toggle = root.querySelector<HTMLButtonElement>(`.sync-rotation-toggle`)
  toggle?.click()
  flushSync()
  expect(props.sync_rotation).toBe(false)
  const before = scenes.all.map((controls) => view_dir(controls).toArray())
  orbit(scenes.all[0], new Vector3(0, 1, 1).normalize())
  expect(scenes.all.slice(1).map((controls) => view_dir(controls).toArray())).toEqual(
    before.slice(1),
  )
  // compare off: the shown side's scenes stay mounted and linked, the compared ones leave
  Object.assign(props, { sync_rotation: true, compare_series: undefined })
  flushSync()
  const left = scenes.all.slice(2).map((controls) => view_dir(controls).toArray())
  const turn = new Vector3(1, 2, 2).normalize()
  orbit(scenes.all[0], turn)
  expect(view_dir(scenes.all[1]).distanceTo(turn)).toBeLessThan(1e-12)
  expect(scenes.all.slice(2).map((controls) => view_dir(controls).toArray())).toEqual(left)
  expect(scenes.all).toHaveLength(4)
  // one scene per side still makes two to link
  props.compare_series = `bcc`
  props.panes = [`structure`]
  flushSync()
  expect(count(root, `.sync-rotation-toggle`)).toBe(1)
})

// === background fill of the trends plot ===
// Six frames with only structures and their supplied tc up front, their DOS (thus the
// computed N(E_F)) from a loader whose loads settle when the test says
function fill_setup(
  props: Partial<ComponentProps<typeof ElectronicStructure>> = {},
  series_ids = [`fcc`],
  n_frames = 6,
) {
  const calls: {
    id: string
    idx: number
    signal: AbortSignal
    resolve: () => void
    reject: () => void
  }[] = []
  const load_frame = vi.fn(
    (id: string, frame_idx: number, { signal }: { signal: AbortSignal }) =>
      new Promise<Partial<SweepFrame>>((resolve, reject) => {
        const density = frame_idx + 1
        const data = { doses: { total: { ...dos, densities: [0, density, density, 0] } } }
        const fail = () => reject(new Error(`down`))
        calls.push({ id, idx: frame_idx, signal, resolve: () => resolve(data), reject: fail })
      }),
  )
  const series = series_ids.map((id) => ({
    id,
    frames: Array.from({ length: n_frames }, (_, idx) => ({
      value: 50 * idx,
      structure,
      scalars: { tc: idx },
    })),
  }))
  const { props: state, root } = mount_live({
    sweep: { ...make_sweep(), series, load_frame },
    frame_idx: 0,
    descriptor: `n_ef`,
    panes: ALL_PANES,
    ...props,
  })
  const settle = async (...indices: number[]) => {
    for (const call of calls) if (indices.includes(call.idx)) call.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
  }
  const note = () => root.querySelector(`.trends-fill`)?.textContent?.trim() ?? null
  const loaded = () => calls.map(({ idx }) => idx)
  return { state, root, calls, settle, note, loaded }
}

test(`the trends pane fills a computed descriptor's unloaded frames one by one, after the shown window`, async () => {
  const { state, calls, settle, note, loaded } = fill_setup()
  // the window first (the first frame has no previous one), nothing else
  expect([loaded(), note()]).toEqual([[0, 1], `0/6`])
  await settle(0, 1)
  expect([loaded(), note()]).toEqual([[0, 1, 2], `2/6`]) // then one frame, in index order
  // stepping starts the new window's loads at once, the fill keeps running
  state.frame_idx = 4
  flushSync()
  expect([loaded(), calls[2].signal.aborted]).toEqual([[0, 1, 2, 4, 5, 3], false])
  await settle(2)
  expect([loaded(), note()]).toEqual([[0, 1, 2, 4, 5, 3], `3/6`]) // no fill while 4, 5, 3 load
  // the filled frame was evicted (no DOS kept) with its value
  const [series, frame_of] = [state.sweep?.series[0], viewers.trends?.frame_of]
  if (!series || !frame_of) throw new Error(`no trends`)
  const filled = frame_of(series, 2)
  expect([filled.doses, filled.scalars?.n_ef]).toEqual([undefined, 3])
  await settle(4, 5, 3)
  expect([loaded(), note()]).toEqual([[0, 1, 2, 4, 5, 3], null]) // all six filled: done
})

test(`a frame failing to fill counts as missing in the note and isn't loaded again`, async () => {
  const { calls, settle, note, loaded } = fill_setup()
  await settle(0, 1)
  calls[2].reject()
  await settle()
  expect([loaded(), note()]).toEqual([[0, 1, 2, 3], `2/6`]) // the fill moves on to frame 3
  await settle(3)
  expect([loaded(), note()]).toEqual([[0, 1, 2, 3, 4], `3/6`])
  await settle(4)
  await settle(5)
  expect([loaded(), note()]).toEqual([[0, 1, 2, 3, 4, 5], null]) // nothing left to load
})

// A new sweep (or loader) starts a fresh cache: the old one's fill is aborted with its loads
// and the new one loads its window again before any fill
// oxfmt-ignore
test.each<[string, (props: ComponentProps<typeof ElectronicStructure>) => void, number[]]>([
  [`the trends pane hides`, (props) => (props.panes = [`structure`, `dos`]), []],
  [`the descriptor turns to a supplied one`, (props) => (props.descriptor = `tc`), []],
  [`the sweep changes`, (props) => (props.sweep = props.sweep && { ...props.sweep }), [0, 1]],
])(`the fill stops when %s`, async (_desc, change, reloads) => {
  const { state, calls, settle, note, loaded } = fill_setup()
  await settle(0, 1)
  expect(loaded()).toEqual([0, 1, 2])
  change(state)
  flushSync()
  expect([calls[2].signal.aborted, loaded()]).toEqual([true, [0, 1, 2, ...reloads]])
  if (reloads.length > 0) return
  await settle(2)
  expect([loaded(), note()]).toEqual([[0, 1, 2], null])
})

// the trends plot draws every series: the fill covers them all, the shown and compared first
test(`the fill covers every series, after the shown and compared windows`, async () => {
  const { calls, settle, note } = fill_setup(
    { compare_series: `hcp` },
    [`fcc`, `bcc`, `hcp`],
    3,
  )
  const loads = () => calls.map(({ id, idx }) => `${id} ${idx}`)
  expect([loads(), note()]).toEqual([[`fcc 0`, `hcp 0`, `fcc 1`, `hcp 1`], `0/9`])
  const notes = []
  for (let step = 0; step < 6; step++) {
    await settle(0, 1, 2)
    notes.push(note())
  }
  expect(loads().slice(4)).toEqual([`fcc 2`, `hcp 2`, `bcc 0`, `bcc 1`, `bcc 2`])
  expect(notes).toEqual([`4/9`, `5/9`, `6/9`, `7/9`, `8/9`, null])
})

// A load the shown frames don't need (here the fill's, of a series not shown) leaves every
// prop of the shown spectra as it was, so nothing downstream of the frame cache re-renders
test(`a background load leaves the shown spectra's props untouched`, async () => {
  const { calls, settle } = fill_setup({}, [`fcc`, `bcc`], 2)
  await settle(0, 1)
  const fill = calls.find(({ id }) => id === `bcc`)
  const spectra = { bands: viewers.bands, dos: viewers.dos }
  if (!fill || !spectra.bands || !spectra.dos) throw new Error(`no fill or spectra`)
  const props_now = () =>
    Object.entries(spectra).flatMap(([name, props]) =>
      Object.entries(props ?? {}).map(([key, value]) => [`${name}.${key}`, value] as const),
    )
  const before = new Map(props_now())
  fill.resolve()
  await settle()
  const changed = props_now().filter(([key, value]) => !Object.is(value, before.get(key)))
  expect(changed.map(([key]) => key)).toEqual([])
})

test(`a supplied descriptor's frames need no fill`, async () => {
  const { settle, note, loaded } = fill_setup({ descriptor: `tc` })
  expect(note()).toBeNull()
  await settle(0, 1)
  expect(loaded()).toEqual([0, 1])
})

const TRENDS_PANES: ElectronicPane[] = [`structure`, `trends`]
// oxfmt-ignore
test.each<[string, Partial<ComponentProps<typeof ElectronicStructure>>, string]>([
  [`no panes`, { ...all_data, panes: [] }, `needs at least one pane`],
  [`a trends pane without sweep`, { ...all_data, panes: TRENDS_PANES }, `trends pane needs a sweep with descriptors`],
  [`a trends pane for a sweep without descriptors`, { sweep: { ...make_sweep(), descriptors: undefined }, panes: TRENDS_PANES }, `trends pane needs a sweep with descriptors`],
  [`a sweep with descending frames`, { sweep: { ...make_sweep(), series: [{ id: `a`, frames: [{ value: 2 }, { value: 1 }] }] } }, `strictly ascending`],
  [`a sweep with an unknown series_id`, { sweep: make_sweep(), series_id: `hcp` }, `"hcp" is not a series of the sweep (fcc, bcc)`],
  [`a sweep with a NaN frame_idx`, { sweep: make_sweep(), frame_idx: Number.NaN }, `frame_idx must be finite, got NaN`],
  [`an unknown descriptor`, { sweep: make_sweep(), descriptor: `tc_typo`, panes: TRENDS_PANES }, `descriptor "tc_typo" is not a descriptor of the sweep (tc, n_ef)`],
  [`an unknown compare_series`, { sweep: make_sweep(), compare_series: `hcp` }, `compare_series "hcp" is not a series of the sweep (fcc, bcc)`],
])(`%s throws, naming what is wrong`, (_desc, props, message) => {
  expect(() => mount_host(props)).toThrow(message)
})

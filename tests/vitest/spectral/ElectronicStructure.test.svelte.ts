// ElectronicStructure: one viewer fusing a crystal, its Fermi surface, bands and DOS, linked
import type FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
import type { BandGridData } from '#lib/fermi-surface/types.js'
import type Bands from '#lib/spectral/Bands.svelte'
import type Dos from '#lib/spectral/Dos.svelte'
import ElectronicStructure from '#lib/spectral/ElectronicStructure.svelte'
import type { BaseBandStructure, ElectronicDos, ElectronicPane } from '#lib/spectral/types.js'
import type { Site } from '#lib/structure/index.js'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Vector3 } from 'three/webgpu'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { create_drop_event, mock_parse_worker } from '../setup'
import { IDENTITY_MATRIX3, make_bxsf, make_crystal } from '../test-fixtures'

// The 3D scenes' props and orbit controls (no renderer in happy-dom): each stub joins the
// host's orbit link with real controls, as its SceneCamera would
type SceneName = `structure` | `fermi`
const scenes = vi.hoisted(() => ({
  props: {} as Partial<Record<SceneName, Record<string, unknown>>>,
  controls: {} as Partial<Record<SceneName, OrbitControls>>,
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
const viewers = vi.hoisted(() => ({
  fermi: null as Partial<ComponentProps<typeof FermiSurface>> | null,
  bands: null as Partial<ComponentProps<typeof Bands>> | null,
  dos: null as Partial<ComponentProps<typeof Dos>> | null,
}))
vi.mock(`#lib/fermi-surface/FermiSurface.svelte`, async (original) => {
  const { default: Component } = await original<{ default: typeof FermiSurface }>()
  return {
    default: (...[anchor, props]: Parameters<typeof FermiSurface>) => {
      viewers.fermi = props
      return Component(anchor, props)
    },
  }
})
vi.mock(`#lib/spectral/Bands.svelte`, async (original) => {
  const { default: Component } = await original<{ default: typeof Bands }>()
  return {
    default: (...[anchor, props]: Parameters<typeof Bands>) => {
      viewers.bands = props
      return Component(anchor, props)
    },
  }
})
vi.mock(`#lib/spectral/Dos.svelte`, async (original) => {
  const { default: Component } = await original<{ default: typeof Dos }>()
  return {
    default: (...[anchor, props]: Parameters<typeof Dos>) => {
      viewers.dos = props
      return Component(anchor, props)
    },
  }
})

const structure = make_crystal(3.6, [[`Cu`, [0, 0, 0]]])
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
  Object.assign(viewers, { fermi: null, bands: null, dos: null })
  scenes.props = {}
  scenes.controls = {}
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

test(`one viewer: one control row and fullscreen button over 3D scenes above spectra`, () => {
  const root = mount_host({ ...all_data, class: `caller`, layout: `vertical` })
  expect(root.getAttribute(`role`)).toBe(`group`)
  expect([...root.classList]).toEqual(expect.arrayContaining([`caller`, `two-rows`]))
  // the panes' own fullscreen toggles are off: the viewer's row holds the only one
  expect(count(root, `.fullscreen-btn`)).toBe(1)
  expect(root.querySelector(`:scope > .control-buttons .fullscreen-btn`)).not.toBeNull()
  expect(root.querySelector(`:scope > .row.scenes`)?.classList).toContain(`vertical`)
  // the DOS sits beside the bands from 520px of row width, else below
  const spectra = root.querySelector<HTMLElement>(`:scope > .row.spectra`)
  const side = (spectra?.clientWidth ?? 0) >= 520
  expect(spectra?.classList).toContain(side ? `side` : `stacked`)
  // beside the bands, the DOS resizes at a divider of its own
  expect(count(root, `.spectra > .pane-divider`)).toBe(side ? 1 : 0)
  // a divider between the rows and one between the scenes
  expect(count(root, `:scope > .pane-divider`)).toBe(1)
  expect(count(root, `.scenes > .pane-divider`)).toBe(1)
  expect(count(root, `.pane`)).toBe(4)
  // the band structure's k-path runs through the Wigner-Seitz zone of the Fermi surface
  expect(viewers.fermi?.wigner_seitz).toBe(true)
  expect(viewers.fermi?.k_path).toMatchObject({ path: { points: expect.any(Array) } })
})

// oxfmt-ignore
test.each<[string, Partial<typeof all_data>, ElectronicPane[]]>([
  [`all data`, all_data, [`structure`, `fermi`, `bands`, `dos`]],
  [`a structure`, { structure }, [`structure`]],
  [`a band grid`, { band_data }, [`fermi`]],
  [`bands and DOS`, { band_structs: all_data.band_structs, doses: all_data.doses }, [`bands`, `dos`]],
  [`nothing yet`, {}, [`structure`, `fermi`]],
])(`default panes for %s`, (_desc, data, expected) => {
  const root = mount_host(data)
  expect(shown_panes(root)).toEqual(expected)
  expect(count(root, `.sync-rotation-toggle`)).toBe(expected.includes(`fermi`) && expected.includes(`structure`) ? 1 : 0)
})

test(`the pane menu shows any subset, never none`, () => {
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    ...all_data,
    panes: undefined,
  })
  const root = mount_host(props)
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
  const props = $state({ structure, band_data, sync_rotation: true })
  const root = mount_host(props)
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

test(`hovering the DOS previews the Fermi surface at that energy`, () => {
  mount_host(all_data)
  expect(viewers.fermi?.mu).toBe(0)
  if (!viewers.dos) throw new Error(`no DOS`)
  viewers.dos.hovered_frequency = 7.5 // the DOS writes its hovered energy through the binding
  flushSync()
  expect(viewers.fermi?.mu).toBe(0.5)
  expect(viewers.fermi?.previewing).toBe(true)
  viewers.dos.hovered_frequency = null
  flushSync()
  expect(viewers.fermi?.mu).toBe(0)
})

test(`beside the DOS, the bands mirror its left padding, centring the divider in the gap`, () => {
  const root = mount_host(all_data)
  // side by side needs a 520px row; happy-dom's measured width decides which layout this is
  const side = root.querySelector(`.spectra`)?.classList.contains(`side`)
  if (!viewers.dos || !viewers.bands) throw new Error(`no spectra`)
  viewers.dos.resolved_padding = { t: 20, r: 5, b: 50, l: 37 } // the DOS's settled padding
  flushSync()
  expect(viewers.bands.padding?.r).toBe(side ? 37 : 5)
})

const POSCAR = `Si\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43\nSi\n1\nDirect\n0 0 0\n`
test(`one drop zone fills the panes each file has data for and rejects the rest`, async () => {
  const on_file_load = vi.fn()
  const on_error = vi.fn()
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    structure,
    band_data,
    band_structs: {},
    doses: {},
    panes: [`structure`],
    loading: false,
    error_msg: undefined,
    on_file_load,
    on_error,
  })
  const root = mount_host(props)
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

// ElectronicStructure: one viewer fusing a crystal, its Fermi surface, bands and DOS, linked
import type FermiSurface from '#lib/fermi-surface/FermiSurface.svelte'
import type { BandGridData } from '#lib/fermi-surface/types.js'
import type Bands from '#lib/spectral/Bands.svelte'
import type BandsAndDos from '#lib/spectral/BandsAndDos.svelte'
import type Dos from '#lib/spectral/Dos.svelte'
import type { Matrix3x3 } from '#lib/math.js'
import type Structure from '#lib/structure/Structure.svelte'
import ElectronicStructure from '#lib/spectral/ElectronicStructure.svelte'
import type { Sweep, SweepFrame } from '#lib/spectral/sweep.js'
import type SweepTrends from '#lib/spectral/SweepTrends.svelte'
import type {
  BaseBandStructure,
  ElectronicDos,
  ElectronicPane,
  PhononDos,
  PhononSpectra,
} from '#lib/spectral/types.js'
import type { Site } from '#lib/structure/index.js'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Vector3 } from 'three/webgpu'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { create_drop_event, mock_parse_worker } from '../setup'
import {
  IDENTITY_MATRIX3,
  make_bxsf,
  make_crystal,
  read_binary_test_file,
} from '../test-fixtures'

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
  trends: null as Partial<ComponentProps<typeof SweepTrends>> | null,
  phonon: null as Partial<ComponentProps<typeof BandsAndDos>> | null,
}))
// a stub: its own Bands and DOS would overwrite the electronic ones' props above
vi.mock(`#lib/spectral/BandsAndDos.svelte`, () => ({
  default: (_anchor: Node, props: Partial<ComponentProps<typeof BandsAndDos>>) => {
    viewers.phonon = props
    return {}
  },
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
vi.mock(`#lib/spectral/SweepTrends.svelte`, async (original) => {
  const { default: Component } = await original<{ default: typeof SweepTrends }>()
  return {
    default: (...[anchor, props]: Parameters<typeof SweepTrends>) => {
      viewers.trends = props
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
// phonon DOS and an α²F on one frequency axis (THz), and a dispersion along the same path
const phonon_dos: PhononDos = { type: `phonon`, frequencies: [0, 3, 6], densities: [0, 2, 0] }
const phonon: PhononSpectra = {
  band_structs: {
    Cu: { ...band_struct, type: `phonon`, efermi: undefined, bands: [[0, 2, 4]] },
  },
  doses: { 'phonon DOS': phonon_dos, 'α²F': { ...phonon_dos, densities: [0, 0.3, 0] } },
}
// the viewer's measured width: the DOS sits beside the bands from 520px, else below
const set_width = (width: number) =>
  vi.spyOn(HTMLElement.prototype, `clientWidth`, `get`).mockReturnValue(width)
const WIDTHS = [
  [800, true],
  [400, false],
] as const

test.each(WIDTHS)(
  `one viewer %dpx wide: one control row over scenes above spectra`,
  (width, side) => {
    set_width(width)
    const root = mount_host({ ...all_data, class: `caller`, layout: `vertical` })
    expect(root.getAttribute(`role`)).toBe(`group`)
    expect([...root.classList]).toEqual(expect.arrayContaining([`caller`, `two-rows`]))
    // the panes' own fullscreen toggles are off: the viewer's row holds the only one
    expect(count(root, `.fullscreen-btn`)).toBe(1)
    expect(
      root.querySelector(`:scope > .panes > .control-buttons .fullscreen-btn`),
    ).not.toBeNull()
    expect(root.querySelector(`:scope > .panes > .row.scenes`)?.classList).toContain(
      `vertical`,
    )
    expect(
      root.querySelector(`:scope > .panes > .row.lower > .row.column > .row.spectra`)
        ?.classList,
    ).toContain(side ? `side` : `stacked`)
    // beside the bands, the DOS resizes at a divider of its own
    expect(count(root, `.spectra > .pane-divider`)).toBe(side ? 1 : 0)
    // a divider between the rows and one between the scenes
    expect(count(root, `:scope > .panes > .pane-divider`)).toBe(1)
    expect(count(root, `.scenes > .pane-divider`)).toBe(1)
    expect(count(root, `.pane`)).toBe(4)
    // the band structure's k-path runs through the Wigner-Seitz zone of the Fermi surface
    expect(viewers.fermi?.wigner_seitz).toBe(true)
    expect(viewers.fermi?.k_path).toMatchObject({ path: { points: expect.any(Array) } })
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
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    ...all_data,
    phonon,
    units: `THz`,
  })
  const root = mount_host(props)
  const column = root.querySelector(`:scope > .panes > .row.lower > .row.column`)
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
    fullscreen_toggle: false,
  })
  expect(viewers.dos?.doses).toEqual(all_data.doses) // the electronic DOS keeps its own pane
  props.units = `meV`
  flushSync()
  expect(viewers.phonon?.units).toBe(`meV`)
})

test(`a dropped phonon DOS fills the phonon pane, keeping the electronic spectra`, async () => {
  const on_file_load = vi.fn()
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    ...all_data,
    phonon: undefined,
    on_file_load,
  })
  const root = mount_host(props)
  const file = new File(
    [JSON.stringify({ frequencies: [0, 4, 8], densities: [0, 1, 0] })],
    `phonon_dos.json`,
  )
  root.dispatchEvent(create_drop_event(file))
  await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
  expect(on_file_load).toHaveBeenCalledWith({ filename: `phonon_dos.json`, panes: [`phonon`] })
  expect(props.phonon?.doses?.[`phonon_dos.json`]).toMatchObject({ type: `phonon` })
  expect(props.doses).toEqual(all_data.doses)
  expect(shown_panes(root)).toContain(`phonon`)
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

// without a band grid (none, or a meshed surface) there is no other energy's surface to show
test.each([true, false])(`hovering the DOS previews the Fermi surface (grid: %s)`, (grid) => {
  mount_host({ ...all_data, band_data: grid ? band_data : undefined, panes: [`fermi`, `dos`] })
  expect(viewers.fermi?.mu).toBe(0)
  if (!viewers.dos) throw new Error(`no DOS`)
  viewers.dos.hovered_frequency = 7.5 // the DOS writes its hovered energy through the binding
  flushSync()
  expect(viewers.fermi?.mu).toBe(grid ? 0.5 : 0)
  expect(viewers.fermi?.previewing).toBe(grid)
  viewers.dos.hovered_frequency = null
  flushSync()
  expect(viewers.fermi?.mu).toBe(0)
  expect(viewers.fermi?.previewing).toBe(false)
})

test.each(WIDTHS)(
  `%dpx wide, the bands mirror the DOS's left padding beside it`,
  (width, side) => {
    set_width(width)
    mount_host(all_data)
    if (!viewers.dos || !viewers.bands) throw new Error(`no spectra`)
    viewers.dos.resolved_padding = { t: 20, r: 5, b: 50, l: 37 } // the DOS's settled padding
    flushSync()
    expect(viewers.bands.padding?.r).toBe(side ? 37 : 5)
  },
)

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

// drops onto an empty viewer, resolving with what on_file_load or on_error received
const drop_into_empty = async (file: File) => {
  const [on_file_load, on_error] = [vi.fn(), vi.fn()]
  // every key the drop may fill is present, so the viewer's writes reach these props
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    structure: undefined,
    band_structs: {},
    doses: {},
    on_file_load,
    on_error,
  })
  mount_host(props).dispatchEvent(create_drop_event(file))
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

test.each<[ElectronicPane[], string]>([
  [[], `at least one pane`],
  [[`structure`, `trends`], `trends pane needs a sweep`],
])(`the pane list %j throws without its data`, (panes, message) => {
  expect(() => mount_host({ ...all_data, panes })).toThrow(message)
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

test(`a sweep's frame feeds every pane, stepped by its control bar and keys`, () => {
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    sweep: make_sweep(),
    frame_idx: 0,
    series_id: undefined,
    panes: ALL_PANES,
    // the props a sweep replaces: never shown while it is set
    doses: { total: { ...dos, densities: [9, 9, 9, 9] } },
  })
  const root = mount_host(props)
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
  const select = root.querySelector<HTMLSelectElement>(`.series-control select`)
  if (!select) throw new Error(`no series select`)
  select.value = `bcc`
  select.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
  expect([props.series_id, props.frame_idx]).toEqual([`bcc`, 0])
  expect(status(root)).toBe(`100 GPa`)
  expect(shown_density()).toBe(4)
  props.frame_idx = 9
  flushSync()
  expect(props.frame_idx).toBe(1) // clamped to the 2-frame series, back through the binding
  expect(status(root)).toBe(`150 GPa`)
})

test(`clicking a trends point selects its series and frame`, () => {
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    sweep: make_sweep(),
    frame_idx: 0,
    series_id: undefined,
    panes: ALL_PANES,
  })
  const root = mount_host(props)
  viewers.trends?.on_frame_select?.(`bcc`, 0)
  flushSync()
  expect([props.series_id, props.frame_idx]).toEqual([`bcc`, 0])
  expect(status(root)).toBe(`100 GPa`)
})

test(`load_frame fetches the shown frame and its neighbours, merged into the panes`, async () => {
  const sweep = make_sweep()
  // only structures and values up front, the spectra come from the loader
  for (const series of sweep.series) {
    series.frames = series.frames.map(({ value, structure: crystal }) => ({
      value,
      structure: crystal,
    }))
  }
  const load_frame = vi.fn(async (series_id: string, frame_idx: number) => ({
    doses: { total: { ...dos, densities: [0, 10 + frame_idx, 10 + frame_idx, 0] } },
    label: `${series_id} ${frame_idx}`,
  }))
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    sweep,
    load_frame,
    series_id: undefined,
    frame_idx: 2,
    panes: ALL_PANES,
  })
  const root = mount_host(props)
  // the last frame's next is the first, where playback wraps
  expect(load_frame.mock.calls).toEqual([
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
  expect(load_frame.mock.calls.slice(3)).toEqual([
    [`bcc`, 0],
    [`bcc`, 1],
  ])
})

test(`a sweep frame's phonons merge its own α²F with the loaded dispersion`, async () => {
  const sweep = make_sweep()
  const alpha2f = { 'α²F': phonon.doses?.[`α²F`] ?? phonon_dos }
  sweep.series[0].frames = sweep.series[0].frames.map(({ value }) => ({
    value,
    structure,
    phonon: { doses: alpha2f },
  }))
  const load_frame = vi.fn(async () => ({ phonon: { band_structs: phonon.band_structs } }))
  mount_host({ sweep, load_frame, frame_idx: 0 })
  await vi.waitFor(() => expect(viewers.phonon?.band_structs).toEqual(phonon.band_structs))
  expect(viewers.phonon?.doses).toEqual(alpha2f)
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
    const props = $state<ComponentProps<typeof ElectronicStructure>>({
      sweep,
      load_frame,
      series_id: undefined,
      frame_idx: 0,
      on_error,
    })
    mount_host(props)
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledOnce())
    // frame 2 is not prefetched from frame 0: its grid loads after the jump
    props.frame_idx = 2
    flushSync()
    if (load_frame) await vi.waitFor(() => expect(load_frame).toHaveBeenCalledWith(`fcc`, 2))
    props.frame_idx = 1
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(on_error).toHaveBeenCalledOnce()
    props.series_id = `bcc`
    flushSync()
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(2))
  },
)

test(`a lazy sweep's default panes are those any frame has, so loads only add panes`, async () => {
  const sweep = make_sweep()
  sweep.series[0].frames = sweep.series[0].frames.map(({ value }) => ({ value, structure }))
  // only frame 0 brings a DOS
  const load_frame = vi.fn(async (_series_id: string, frame_idx: number) =>
    frame_idx === 0 ? { doses: { total: dos } } : {},
  )
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    sweep,
    load_frame,
    frame_idx: 0,
  })
  const root = mount_host(props)
  expect(shown_panes(root)).toEqual([`structure`, `trends`])
  await vi.waitFor(() => expect(shown_panes(root)).toEqual([`structure`, `trends`, `dos`]))
  props.frame_idx = 1 // a frame without DOS keeps the pane (empty) instead of collapsing it
  flushSync()
  await vi.waitFor(() => expect(load_frame).toHaveBeenCalledWith(`fcc`, 2))
  expect(shown_panes(root)).toEqual([`structure`, `trends`, `dos`])
})

test(`a dropped sweep JSON replaces the viewer's data, which then takes only sweeps`, async () => {
  const on_error = vi.fn()
  const on_file_load = vi.fn()
  // the caller's loader belongs to the caller's sweep, never to a dropped one
  const load_frame = vi.fn(async () => ({}))
  const props = $state<ComponentProps<typeof ElectronicStructure>>({
    structure,
    sweep: undefined,
    load_frame,
    frame_idx: 0,
    error_msg: undefined,
    on_error,
    on_file_load,
  })
  const root = mount_host(props)
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
  expect(load_frame).not.toHaveBeenCalled()
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
})

test.each<[string, Partial<ComponentProps<typeof ElectronicStructure>>, string]>([
  [
    `descending frames`,
    {
      sweep: { ...make_sweep(), series: [{ id: `a`, frames: [{ value: 2 }, { value: 1 }] }] },
    },
    `strictly ascending`,
  ],
  [
    `an unknown series_id`,
    { sweep: make_sweep(), series_id: `hcp` },
    `"hcp" is not a series of the sweep (fcc, bcc)`,
  ],
  [
    `a NaN frame_idx`,
    { sweep: make_sweep(), frame_idx: Number.NaN },
    `frame_idx must be finite, got NaN`,
  ],
])(`a sweep with %s throws, naming what is wrong`, (_desc, props, message) => {
  expect(() => mount_host(props)).toThrow(message)
})

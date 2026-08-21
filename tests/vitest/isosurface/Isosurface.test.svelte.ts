// Mounts Isosurface.svelte against a recording Threlte stub: layer resolution, geometry
// rebuild/reuse, lobe signs, render ordering and cross-volume vertex coloring.
import Isosurface from '$lib/isosurface/Isosurface.svelte'
import type { IsosurfaceSettings, VolumetricData } from '$lib/isosurface/types'
import { DEFAULT_ISOSURFACE_SETTINGS } from '$lib/isosurface/types'
import { flushSync, mount, unmount } from 'svelte'
import type { BufferGeometry } from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { make_grid, make_volume } from '../setup'
import { threlte_stub } from './threlte-stub'

vi.mock(`@threlte/core`, async () => ({
  T: (await import(`./threlte-stub`)).threlte_stub.T,
}))

const SIZE = 10
// Gaussian blob centred in the cell (positive field) and a signed variant with a negative
// blob in the opposite corner so the -isovalue lobe has somewhere to live
const blob = (ix: number, iy: number, iz: number, cx: number, cy: number, cz: number) =>
  Math.exp(-((ix - cx) ** 2 + (iy - cy) ** 2 + (iz - cz) ** 2) / 4)
const positive_volume = () =>
  make_volume(
    make_grid(SIZE, SIZE, SIZE, (ix, iy, iz) => blob(ix, iy, iz, 5, 5, 5)),
    {
      label: `density`,
    },
  )
const signed_volume = () =>
  make_volume(
    make_grid(
      SIZE,
      SIZE,
      SIZE,
      (ix, iy, iz) => blob(ix, iy, iz, 3, 3, 3) - blob(ix, iy, iz, 7, 7, 7),
    ),
    { label: `spin` },
  )

type Props = {
  volumes: VolumetricData[]
  settings: IsosurfaceSettings
  active_volume_idx: number
}
let teardown: (() => void) | undefined

const mount_isosurface = (overrides: Partial<Props> = {}) => {
  const props = $state<Props>({
    volumes: [positive_volume()],
    settings: { ...DEFAULT_ISOSURFACE_SETTINGS },
    active_volume_idx: 0,
    ...overrides,
  })
  const component = mount(Isosurface, { target: document.body, props })
  teardown = () => void unmount(component)
  return props
}
// Geometry rebuilds are debounced 50 ms then scheduled on the next animation frame
const settle = async () => {
  await vi.advanceTimersByTimeAsync(100)
  flushSync()
}
const meshes = () => threlte_stub.nodes.filter((node) => node.tag === `Mesh`)
const materials = () => threlte_stub.nodes.filter((node) => node.tag.endsWith(`Material`))
const geometry_of = (node: { props: Record<string, unknown> }) =>
  node.props.geometry as BufferGeometry

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `requestAnimationFrame`, `cancelAnimationFrame`],
  })
  threlte_stub.reset()
})
afterEach(() => {
  teardown?.()
  teardown = undefined
  vi.useRealTimers()
})

describe(`Isosurface`, () => {
  test(`implicit single layer renders a two-pass transparent surface`, async () => {
    mount_isosurface({ settings: { ...DEFAULT_ISOSURFACE_SETTINGS, isovalue: 0.3 } })
    expect(meshes()).toHaveLength(0) // nothing before the debounce elapses
    await settle()

    const mesh_nodes = meshes()
    expect(mesh_nodes).toHaveLength(2)
    expect(mesh_nodes.map((node) => node.props.renderOrder)).toEqual([0, 1])
    const geometry = geometry_of(mesh_nodes[0])
    expect(geometry_of(mesh_nodes[1])).toBe(geometry) // both passes share one geometry
    expect(geometry.getAttribute(`position`).count).toBeGreaterThan(0)
    expect(geometry.getAttribute(`normal`).count).toBe(geometry.getAttribute(`position`).count)
    expect(geometry.getAttribute(`color`)).toBeUndefined()
    expect(materials().map((node) => node.tag)).toEqual([
      `MeshStandardMaterial`,
      `MeshStandardMaterial`,
    ])
    expect(materials()[0].props).toMatchObject({
      color: DEFAULT_ISOSURFACE_SETTINGS.positive_color,
      opacity: 0.6,
      transparent: true,
      depthWrite: false,
      vertexColors: false,
    })
  })

  test.each([
    {
      desc: `opaque surfaces use one double-sided pass`,
      settings: { opacity: 1 },
      n_meshes: 1,
    },
    { desc: `wireframe uses a basic material`, settings: { wireframe: true }, n_meshes: 1 },
    { desc: `isovalue 0 renders nothing`, settings: { isovalue: 0 }, n_meshes: 0 },
    { desc: `explicit empty layers render nothing`, settings: { layers: [] }, n_meshes: 0 },
  ])(`$desc`, async ({ settings, n_meshes }) => {
    mount_isosurface({
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, isovalue: 0.3, ...settings },
    })
    await settle()
    expect(meshes()).toHaveLength(n_meshes)
    if (settings.wireframe) {
      expect(materials()[0].tag).toBe(`MeshBasicMaterial`)
      expect(materials()[0].props).toMatchObject({ wireframe: true })
    }
    if (settings.opacity === 1) {
      expect(materials()[0].props).toMatchObject({ transparent: false, depthWrite: true })
    }
  })

  test(`negative lobe adds a second surface in negative_color`, async () => {
    mount_isosurface({
      volumes: [signed_volume()],
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, isovalue: 0.3, show_negative: true },
    })
    await settle()
    expect(meshes()).toHaveLength(4)
    const colors = materials().map((node) => node.props.color)
    expect(colors).toEqual([
      DEFAULT_ISOSURFACE_SETTINGS.positive_color,
      DEFAULT_ISOSURFACE_SETTINGS.positive_color,
      DEFAULT_ISOSURFACE_SETTINGS.negative_color,
      DEFAULT_ISOSURFACE_SETTINGS.negative_color,
    ])
    expect(geometry_of(meshes()[0])).not.toBe(geometry_of(meshes()[2]))
  })

  test(`explicit layers skip out-of-range volumes and default to the active volume`, async () => {
    const layer = {
      isovalue: 0.3,
      color: `#112233`,
      opacity: 1,
      visible: true,
      show_negative: false,
      negative_color: `#000000`,
    }
    mount_isosurface({
      volumes: [signed_volume(), positive_volume()],
      active_volume_idx: 1,
      settings: {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: [
          layer,
          { ...layer, color: `#445566`, volume_idx: 7 }, // out of range: skipped, not clamped
          { ...layer, color: `#778899`, visible: false },
        ],
      },
    })
    await settle()
    expect(meshes()).toHaveLength(1)
    expect(materials()[0].props.color).toBe(`#112233`)
  })

  test(`outer shells render before inner shells`, async () => {
    const layer = {
      color: `#000000`,
      opacity: 1,
      visible: true,
      show_negative: false,
      negative_color: `#000000`,
    }
    mount_isosurface({
      settings: {
        ...DEFAULT_ISOSURFACE_SETTINGS,
        layers: [
          { ...layer, isovalue: 0.6 },
          { ...layer, isovalue: 0.2 },
        ],
      },
    })
    await settle()
    // entries sort by isovalue / abs_max ascending, render_order = 2 * rank
    expect(meshes().map((node) => node.props.renderOrder)).toEqual([0, 2])
    const [outer, inner] = meshes().map(
      (node) => geometry_of(node).getAttribute(`position`).count,
    )
    expect(outer).toBeGreaterThan(inner)
  })

  test(`color-only changes reuse geometry; isovalue changes rebuild it`, async () => {
    const props = mount_isosurface({
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, isovalue: 0.3, opacity: 1 },
    })
    await settle()
    const geometry = geometry_of(meshes()[0])
    const dispose = vi.spyOn(geometry, `dispose`)

    props.settings.positive_color = `#abcdef`
    props.settings.opacity = 0.5
    await settle()
    expect(geometry_of(meshes()[0])).toBe(geometry)
    expect(materials()[0].props).toMatchObject({ color: `#abcdef`, opacity: 0.5 })
    expect(dispose).not.toHaveBeenCalled()

    props.settings.isovalue = 0.5
    await settle()
    expect(geometry_of(meshes()[0])).not.toBe(geometry)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test(`color source volume drives vertex colors and a white base color`, async () => {
    const layer = {
      isovalue: 0.3,
      color: `#112233`,
      opacity: 1,
      visible: true,
      show_negative: false,
      negative_color: `#000000`,
      volume_idx: 0,
      color_volume_idx: 1,
    }
    const props = mount_isosurface({
      volumes: [positive_volume(), signed_volume()],
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers: [layer] },
    })
    await settle()
    const geometry = geometry_of(meshes()[0])
    const color_attr = geometry.getAttribute(`color`)
    expect(color_attr.count).toBe(geometry.getAttribute(`position`).count)
    expect(materials()[0].props).toMatchObject({ vertexColors: true, color: `#ffffff` })
    const before = Float32Array.from(color_attr.array)

    // Remapping through a different colormap reuses the color buffer in place
    props.settings.layers = [{ ...layer, colormap: `interpolateRdBu` }]
    await settle()
    expect(geometry_of(meshes()[0])).toBe(geometry)
    expect(geometry.getAttribute(`color`).array).toBe(color_attr.array)
    expect(Float32Array.from(color_attr.array)).not.toEqual(before)

    // Clearing the color source drops the attribute and restores the solid color
    props.settings.layers = [{ ...layer, color_volume_idx: undefined }]
    await settle()
    expect(geometry.getAttribute(`color`)).toBeUndefined()
    expect(materials()[0].props).toMatchObject({ vertexColors: false, color: `#112233` })
  })

  test(`removing all volumes disposes every geometry`, async () => {
    const props = mount_isosurface({
      settings: { ...DEFAULT_ISOSURFACE_SETTINGS, isovalue: 0.3 },
    })
    await settle()
    const dispose = vi.spyOn(geometry_of(meshes()[0]), `dispose`)
    props.volumes = []
    flushSync()
    expect(meshes()).toHaveLength(0)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

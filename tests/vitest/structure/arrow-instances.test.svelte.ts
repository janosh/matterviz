import type { Vec3 } from '$lib/math'
import type { VectorColorMode } from '$lib/settings'
import type { AnyStructure } from '$lib/structure'
import ArrowInstances from '$lib/structure/ArrowInstances.svelte'
import {
  build_vector_layers,
  type VectorLayer,
  type VectorLayerOptions,
} from '$lib/structure/arrow-instances'
import { make_site } from '$lib/structure/site'
import { flushSync, mount, unmount } from 'svelte'
import { InstancedMesh } from 'three/webgpu'
import { expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'

vi.mock(`@threlte/core`, async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  T: (await import(`../isosurface/threlte-stub`)).threlte_stub.T,
  useThrelte: () => ({ invalidate: () => {} }),
}))

const vector_structure = (): AnyStructure => ({
  sites: [
    make_site(`Si`, [0, 0, 0], [0, 0, 0], `Si`, {
      force: [1, 0, 0],
      magmom: [0, 0, -2],
    }),
    make_site(`O`, [0, 0, 0], [2, 0, 0], `O`, {
      force: [0, 3, 0],
      magmom: 0,
    }),
    make_site(`C`, [0, 0, 0], [0, 2, 0], `C`, {
      force: [0, 0, 0],
      magmom: [Number.NaN, 0, 0],
    }),
  ],
})

const vector_options = (): VectorLayerOptions => ({
  vector_configs: {},
  nothing_hidden: true,
  is_site_visible: () => true,
  vector_color_mode: `auto`,
  vector_color: `#ffaa00`,
  vector_normalize: false,
  palette: { Si: `#aaaaaa`, O: `#ff0000`, C: `#000000` },
  char_atom_spacing: 2,
  vector_scale: 0.5,
  vector_origin_gap: 0,
  get_site_radius: (_site, site_idx) => 0.5 + site_idx,
  vector_color_scale: `interpolateViridis`,
  eff_shaft_radius: -0.03,
  eff_head_radius: -0.09,
  eff_head_length: -0.2,
})

test.each([
  [`auto`, false, 0],
  [`element`, true, 0.5],
  [`magnitude`, false, 0.7],
  [`spin_direction`, true, 0],
  [`uniform`, false, 1],
] as [VectorColorMode, boolean, number][])(
  `reused vector records track visibility, key order and composition in %s mode`,
  (vector_color_mode, vector_normalize, vector_origin_gap) => {
    const options = {
      ...vector_options(),
      vector_color_mode,
      vector_normalize,
      vector_origin_gap,
    }
    let structure = vector_structure()
    let layers: VectorLayer[] = []
    const check = (keys: string[]) => {
      const previous = layers
      layers = build_vector_layers(structure, options, previous)
      expect(layers.map(({ key }) => key)).toEqual(keys)
      expect(layers).toEqual(build_vector_layers(structure, options, []))
      for (const layer of layers) {
        const old_layer = previous.find(({ key }) => key === layer.key)
        expect(layer.arrows).not.toBe(old_layer?.arrows)
        for (
          let idx = 0;
          idx < Math.min(layer.arrows.length, old_layer?.arrows.length ?? 0);
          idx++
        ) {
          expect(layer.arrows[idx]).toBe(old_layer?.arrows[idx])
        }
      }
    }
    check([`force`, `magmom`])
    const first_force = layers[0].arrows[0]
    structure.sites[0].xyz = [4, 5, 6]
    structure.sites[0].properties.force = [-3, -2, -1]
    structure.sites[0].species[0].element = `O`
    options.palette.O = `#00ff00`
    options.vector_scale = 2
    options.vector_configs = { force: { scale: 3, color: `#112233` } }
    check([`force`, `magmom`])
    expect(layers[0].arrows[0]).toBe(first_force)
    expect(first_force.color).toBe(`#112233`)

    options.nothing_hidden = false
    options.is_site_visible = (site_idx) => site_idx !== 0
    check([`force`, `magmom`])
    expect(layers[0].arrows.map(({ site_idx }) => site_idx)).toEqual([1, 2])
    expect(layers[0].arrows[0]).toBe(first_force)
    options.nothing_hidden = true
    options.vector_configs = { force: { visible: false } }
    check([`magmom`]) // Changes palette slot and switches to single-key coloring.

    structure = {
      sites: structure.sites.toReversed().map((site) => ({
        ...site,
        properties: { velocity: [4, 0, 0], ...site.properties },
      })),
    }
    options.vector_configs = {}
    check([`force`, `magmom`, `velocity`])
    expect(layers[0].arrows.map(({ site_idx }) => site_idx)).toEqual([0, 1, 2])
    options.vector_configs = { magmom: { visible: false }, velocity: { visible: false } }
    check([`force`])

    // Inactive layers and all their records are released, including a zero-site replacement.
    options.vector_configs.force = { visible: false }
    check([])
    options.vector_configs = {}
    check([`force`, `magmom`, `velocity`])
    expect(layers[0].arrows[0]).not.toBe(first_force)
    structure = { sites: [] }
    check([])
    expect(build_vector_layers(null, options, layers)).toEqual([])
  },
)

test(`fresh layer arrays upload reused arrow positions, vectors, scales and colors`, async () => {
  const options = vector_options()
  options.vector_configs.magmom = { visible: false }
  let structure = vector_structure()
  let layers = build_vector_layers(structure, options, [])
  let reused_arrows = $state.raw(layers[0].arrows)
  let fresh_arrows = $state.raw(build_vector_layers(structure, options, [])[0].arrows)
  const { shaft_radius, arrow_head_radius, arrow_head_length } = layers[0]
  const mounts = [
    mount(ArrowInstances, {
      target: document.body,
      props: {
        get arrows() {
          return reused_arrows
        },
        shaft_radius,
        arrow_head_radius,
        arrow_head_length,
      },
    }),
    mount(ArrowInstances, {
      target: document.body,
      props: {
        get arrows() {
          return fresh_arrows
        },
        shaft_radius,
        arrow_head_radius,
        arrow_head_length,
      },
    }),
  ]
  try {
    flushSync()
    const meshes = threlte_stub.nodes.map(({ props }) => props.is)
    if (!meshes.every((mesh): mesh is InstancedMesh => mesh instanceof InstancedMesh)) {
      throw new Error(`Expected four arrow instance meshes, received ${meshes.length}`)
    }
    expect(meshes).toHaveLength(4)
    const initial_version = meshes[0].instanceMatrix.version
    for (let frame_idx = 1; frame_idx <= 4; frame_idx++) {
      structure = {
        sites: structure.sites.toReversed().map((site, site_idx) => ({
          ...site,
          xyz: [frame_idx, site_idx, -frame_idx] as Vec3,
          species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
          properties: { force: [site_idx - 1, frame_idx, -2] },
        })),
      }
      options.vector_scale = frame_idx / 3
      options.palette.O = frame_idx % 2 ? `#00ff00` : `#0000ff`
      options.nothing_hidden = false
      options.is_site_visible = (site_idx) => frame_idx % 2 === 0 || site_idx !== 0
      const previous = layers[0].arrows[0]
      layers = build_vector_layers(structure, options, layers)
      reused_arrows = layers[0].arrows
      fresh_arrows = build_vector_layers(structure, options, [])[0].arrows
      expect(layers[0].arrows[0]).toBe(previous)
      flushSync()
      for (const [actual, expected] of [
        [meshes[0], meshes[2]],
        [meshes[1], meshes[3]],
      ]) {
        expect(actual.count).toBe(expected.count)
        expect(actual.instanceMatrix.array).toEqual(expected.instanceMatrix.array)
        expect(actual.instanceColor?.array).toEqual(expected.instanceColor?.array)
        expect(actual.instanceMatrix.version).toBeGreaterThan(initial_version)
      }
    }
  } finally {
    for (const component of mounts) await unmount(component)
    threlte_stub.reset()
  }
})

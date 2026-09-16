import type { Vec3 } from '$lib/math'
import type { VectorColorMode } from '$lib/settings'
import type { AnyStructure } from '$lib/structure'
import ArrowInstances from '$lib/structure/ArrowInstances.svelte'
import { ArrowMesh } from '$lib/structure/arrow-mesh'
import {
  build_vector_layers,
  pack_arrows,
  type ArrowColumns,
  type VectorLayer,
  type VectorLayerOptions,
} from '$lib/structure/arrow-instances'
import { make_site, numeric_sites } from '$lib/structure/site'
import { characteristic_atom_spacing } from '$lib/structure/density'
import {
  compute_display_metrics,
  prepare_vector_geometry,
  register_structure_vectors,
} from '$lib/structure/vectors'
import { create_numeric_md_frame, FrameView, materialize_frame } from '$lib/trajectory/frame'
import { flushSync, mount, unmount } from 'svelte'
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu'
import { expect, test, vi } from 'vitest'
import { threlte_stub } from '../isosurface/threlte-stub'
import { EPS } from '$lib/math'

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

const arrow_origins = ({ placements }: ArrowColumns) =>
  Array.from({ length: placements.count }, (_unused, idx) =>
    Array.from(placements.origins.subarray(idx * 3, idx * 3 + 3)),
  )
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
  vector_uniform_thickness: false,
  vector_shaft_radius: -0.03,
  vector_arrow_head_radius: -0.09,
  vector_arrow_head_length: -0.2,
})

test.each([
  [`auto`, false, 0],
  [`element`, true, 0.5],
  [`magnitude`, false, 0.7],
  [`spin_direction`, true, 0],
  [`uniform`, false, 1],
] as [VectorColorMode, boolean, number][])(
  `numeric vector layers preserve values and snapshots in %s mode`,
  (vector_color_mode, vector_normalize, vector_origin_gap) => {
    const options = {
      ...vector_options(),
      vector_color_mode,
      vector_normalize,
      vector_origin_gap,
    }
    const view = new FrameView()
    let previous: VectorLayer[] = []
    for (let frame_idx = 0; frame_idx < 3; frame_idx++) {
      const frame = create_numeric_md_frame(
        Float64Array.from({ length: 96 }, (_unused, idx) => idx / 7 + frame_idx),
        Uint8Array.from({ length: 32 }, (_unused, idx) => [14, 8, 6][idx % 3]),
        undefined,
        undefined,
        frame_idx,
        {},
        [`force`, `magmom`],
      )
      for (let idx = 0; idx < 32; idx++) {
        frame.coordinates.set([Math.sin(idx + frame_idx), 0, idx / 7], idx * 12 + 6)
        frame.coordinates.set([0, idx % 3 === 0 ? NaN : -idx, frame_idx], idx * 12 + 9)
      }
      for (const [idx, vector] of [
        [0, -0, 0],
        [Number.MIN_VALUE, -Number.MIN_VALUE, 0],
        [Infinity, 1, 0],
        [1, -Infinity, 0],
        [NaN, 0, 0],
      ].entries())
        frame.coordinates.set(vector, idx * 12 + 6)
      if (frame_idx === 1)
        frame.scalar_columns = {
          force: Float64Array.from({ length: 32 }, (_unused, idx) => (idx % 2 ? -idx : NaN)),
          magmom: new Float64Array(32).fill(NaN),
        }
      const before = frame.coordinates.slice()
      const structure = view.update(frame).structure
      const columns = numeric_sites.get(structure)
      if (!columns) throw new Error(`Expected numeric vector columns`)
      const materialize = vi.spyOn(columns, `materialize`)
      const reference = materialize_frame(frame).structure
      const metrics = compute_display_metrics(structure)
      expect(metrics).toEqual(compute_display_metrics(reference))
      const retained_metrics = structuredClone(metrics)
      columns.display_metrics = metrics
      const cbrt = vi.spyOn(Math, `cbrt`)
      expect(characteristic_atom_spacing(structure)).toBe(metrics.characteristic_atom_spacing)
      expect(cbrt).not.toHaveBeenCalled()
      cbrt.mockRestore()
      if (frame_idx === 2) options.vector_configs = { magmom: { visible: false } }
      const scratch_allocations = vi.spyOn(globalThis, `Float64Array`)
      try {
        columns.vector_geometry = prepare_vector_geometry(
          structure,
          options,
          undefined,
          options.char_atom_spacing,
        )
        expect(scratch_allocations).not.toHaveBeenCalled()
      } finally {
        scratch_allocations.mockRestore()
      }
      const retained_geometry = structuredClone(columns.vector_geometry)
      const base_options = { ...options, nothing_hidden: true, vector_origin_gap: 0 }
      const color_options = {
        ...base_options,
        vector_configs: {
          ...base_options.vector_configs,
          force: { ...base_options.vector_configs.force, color: `purple` },
        },
      }
      const recolored = build_vector_layers(structure, color_options, [])
      expect(recolored[0].arrows.placements).toBe(columns.vector_geometry.layers[0].placements)
      expect(recolored[0].arrows.colors).toBe(`purple`)
      for (const changes of [
        {},
        { nothing_hidden: false, is_site_visible: (idx: number) => idx < 16 },
        { vector_origin_gap },
        { vector_configs: { magmom: { visible: false }, force: { scale: 7 } } },
        { vector_normalize: !vector_normalize },
        { vector_scale: 3 },
        { vector_uniform_thickness: true },
        { vector_shaft_radius: 0.123 },
        { vector_arrow_head_radius: 0.123 },
        { vector_arrow_head_length: 0.123 },
        { char_atom_spacing: 7 },
      ]) {
        const changed = { ...base_options, ...changes }
        previous = build_vector_layers(structure, changed, previous)
        expect(previous).toEqual(build_vector_layers(reference, changed, []))
      }
      expect(frame.coordinates).toEqual(before)
      expect(metrics).toEqual(retained_metrics)
      expect(columns.vector_geometry).toEqual(retained_geometry)
      expect(materialize).not.toHaveBeenCalled()
      register_structure_vectors(structure, [`velocity`])
      expect(compute_display_metrics(structure).vector_magnitudes).toEqual(
        metrics.vector_magnitudes,
      )
      const with_unloaded = prepare_vector_geometry(structure, options)
      expect(
        with_unloaded.layers.find(({ key }) => key === `velocity`)?.placements.count,
      ).toBe(0)
    }
  },
)

test.each([
  [-0.03, -0.09, -0.2],
  [0.1, 0.2, 0.8],
  [0, 0, 0],
  [-0.03, -0.09, -3],
  [0.1, 0.2, 0.019999999999],
  [0.1, 0.2, 0.020000000001],
])(
  `arrow matrices match Three.js composition with sizes %j`,
  async (shaft_size, head_size, head_length) => {
    const vectors: Vec3[] = [
      [0, 0, 0],
      [0, -1, 0],
      [1e-9, -1, 0],
      [1e-7, -1, 0],
      [0, 0.01 / 0.9, 0],
      [NaN, 0, 0],
      [Infinity, 0, 0],
    ]
    for (let idx = 0; idx < 128; idx++)
      vectors.push([Math.sin(idx), Math.cos(idx), idx / 128 - 0.5])
    const arrows = vectors.flatMap((vector) =>
      [0, -1, 1e-9, 0.1, 2].map((scale) => ({
        position: [12345.6789, -0, -0.125] as Vec3,
        vector,
        magnitude: Math.hypot(...vector),
        scale,
        color: `red`,
      })),
    )
    const component = mount(ArrowInstances, {
      target: document.body,
      props: {
        arrows: pack_arrows(arrows, shaft_size, head_size, head_length),
      },
    })
    try {
      flushSync()
      const meshes = threlte_stub.nodes.map(({ props }) => props.is)
      if (!meshes.every((mesh): mesh is ArrowMesh => mesh instanceof ArrowMesh))
        throw new Error(`Expected arrow meshes`)
      expect(meshes).toHaveLength(2)
      for (const key of [`origins`, `rotations`, `lengths`, `colors`] as const)
        expect(meshes[0][key]).toBe(meshes[1][key])
      const expected = [
        new Float32Array(arrows.length * 16),
        new Float32Array(arrows.length * 16),
      ]
      const matrix = new Matrix4()
      const up = new Vector3(0, 1, 0)
      for (const [idx, { position, vector, scale }] of arrows.entries()) {
        const magnitude = Math.hypot(...vector)
        const length = magnitude * scale
        if (!Number.isFinite(length) || length <= EPS) {
          matrix.makeScale(0, 0, 0).setPosition(...position)
          for (const buffer of expected) matrix.toArray(buffer, idx * 16)
          continue
        }
        const direction = new Vector3(
          vector[0] / magnitude,
          vector[1] / magnitude,
          vector[2] / magnitude,
        )
        const rotation = new Quaternion().setFromUnitVectors(up, direction)
        const head = head_length < 0 ? length * -head_length : head_length
        const shaft = Math.max(0, length - head * 0.5)
        const shaft_radius = shaft_size < 0 ? shaft * -shaft_size : shaft_size
        const head_radius = head_size < 0 ? shaft * -head_size : head_size
        const origin = new Vector3(...position).addScaledVector(direction, shaft * 0.5)
        const size =
          shaft > 0.01 ? new Vector3(shaft_radius, shaft, shaft_radius) : new Vector3()
        matrix.compose(origin, rotation, size).toArray(expected[0], idx * 16)
        origin.fromArray(position).addScaledVector(direction, shaft + head * 0.5)
        size.set(head > 0 ? head_radius : 0, head, head > 0 ? head_radius : 0)
        matrix.compose(origin, rotation, size).toArray(expected[1], idx * 16)
      }
      let max_error = 0
      for (const [part_idx, mesh] of meshes.entries()) {
        for (const hook of [`instanceMatrix`, `instanceColor`, `isInstancedMesh`])
          expect(hook in mesh).toBe(false)
        for (let idx = 0; idx < mesh.count; idx++) {
          mesh.getMatrixAt(idx, matrix)
          const target = expected[part_idx].subarray(idx * 16, idx * 16 + 16)
          // Origins, rotations and lengths each round once to f32. Bound composition
          // error by their input scale, including cancellation in translated components.
          for (let component_idx = 0; component_idx < 16; component_idx++) {
            const error = Math.abs(matrix.elements[component_idx] - target[component_idx])
            const scale =
              component_idx >= 12 && component_idx < 15
                ? Math.max(
                    1,
                    Math.abs(arrows[idx].position[component_idx - 12]),
                    Math.abs(target[component_idx]),
                  )
                : Math.max(1, ...target.slice(0, 12).map(Math.abs))
            max_error = Math.max(max_error, error / scale)
            expect(error).toBeLessThanOrEqual(8 * 2 ** -23 * scale)
          }
        }
      }
      expect(max_error).toBeLessThanOrEqual(8 * 2 ** -23)
    } finally {
      await unmount(component)
      threlte_stub.reset()
    }
  },
)

test.each([
  [`auto`, false, 0],
  [`element`, true, 0.5],
  [`magnitude`, false, 0.7],
  [`spin_direction`, true, 0],
  [`uniform`, false, 1],
] as [VectorColorMode, boolean, number][])(
  `vector placements track visibility, key order and composition in %s mode`,
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
        expect(layer.arrows.placements).not.toBe(old_layer?.arrows.placements)
      }
    }
    check([`force`, `magmom`])
    // The two origins straddle the first atom at the requested fraction of its visual radius.
    const origin_radius =
      (vector_origin_gap * options.get_site_radius(structure.sites[0], 0)) / 2
    const origins = layers.map(({ arrows }) => arrow_origins(arrows)[0])
    for (const origin of origins) {
      expect(Math.abs(Math.hypot(...origin) - origin_radius)).toBeLessThanOrEqual(
        8 * 2 ** -23 * Math.max(1, origin_radius),
      )
    }
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(origins[0][axis] + origins[1][axis])).toBeLessThanOrEqual(
        8 * 2 ** -23 * Math.max(1, origin_radius),
      )
    }
    const first_force = layers[0].arrows.placements
    const retained_force = structuredClone(first_force)
    structure.sites[0].xyz = [4, 5, 6]
    structure.sites[0].properties.force = [-3, -2, -1]
    structure.sites[0].species[0].element = `O`
    options.palette.O = `#00ff00`
    options.vector_scale = 2
    options.vector_configs = { force: { scale: 3, color: `#112233` } }
    check([`force`, `magmom`])
    expect(first_force).toEqual(retained_force)
    expect(layers[0].arrows.colors).toBe(`#112233`)

    options.nothing_hidden = false
    options.is_site_visible = (site_idx) => site_idx !== 0
    const visible_positions = arrow_origins(layers[0].arrows).slice(1)
    check([`force`, `magmom`])
    expect(arrow_origins(layers[0].arrows)).toEqual(visible_positions)
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
    options.vector_configs = { magmom: { visible: false }, velocity: { visible: false } }
    check([`force`])
    expect(arrow_origins(layers[0].arrows)).toEqual([
      [0, 2, 0],
      [2, 0, 0],
      [4, 5, 6],
    ])

    // Inactive layers and all their records are released, including a zero-site replacement.
    options.vector_configs.force = { visible: false }
    check([])
    options.vector_configs = {}
    check([`force`, `magmom`, `velocity`])
    expect(layers[0].arrows.placements).not.toBe(first_force)
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
  const mounts = [() => reused_arrows, () => fresh_arrows].map((get_arrows) =>
    mount(ArrowInstances, {
      target: document.body,
      props: {
        get arrows() {
          return get_arrows()
        },
      },
    }),
  )
  try {
    flushSync()
    const meshes = threlte_stub.nodes.map(({ props }) => props.is)
    if (!meshes.every((mesh): mesh is ArrowMesh => mesh instanceof ArrowMesh)) {
      throw new Error(`Expected four arrow instance meshes, received ${meshes.length}`)
    }
    expect(meshes).toHaveLength(4)
    const initial_version = meshes[0].origins.version
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
      layers = build_vector_layers(structure, options, layers)
      reused_arrows = layers[0].arrows
      fresh_arrows = build_vector_layers(structure, options, [])[0].arrows
      flushSync()
      for (const [actual, expected] of [
        [meshes[0], meshes[2]],
        [meshes[1], meshes[3]],
      ]) {
        expect(actual.count).toBe(expected.count)
        expect(actual.origins.array).toEqual(expected.origins.array)
        expect(actual.lengths.array).toEqual(expected.lengths.array)
        expect(actual.rotations.array).toEqual(expected.rotations.array)
        expect(actual.colors?.array).toEqual(expected.colors?.array)
        expect(actual.origins.version).toBeGreaterThan(initial_version)
      }
    }

    // Moving reused records must leave colors untouched; repaint only changed slots.
    const rendered_meshes = meshes.slice(0, 2)
    const color_versions = rendered_meshes.map((mesh) => mesh.colors?.version)
    for (const mesh of rendered_meshes) mesh.colors?.clearUpdateRanges()
    const moved_arrows = structure.sites.map((site) => ({
      position: [2, 3, 4] as Vec3,
      vector: site.properties.force as Vec3,
      magnitude: Math.hypot(...(site.properties.force as Vec3)),
      scale: 1,
      color: `#0000ff`,
    }))
    reused_arrows = pack_arrows(moved_arrows, -0.03, -0.09, -0.2)
    flushSync()
    expect(rendered_meshes.map((mesh) => mesh.colors?.version)).toEqual(color_versions)
    for (const mesh of rendered_meshes) {
      expect(mesh.colors?.updateRanges).toEqual([])
      expect(mesh.origins.updateRanges).toEqual([{ start: 0, count: moved_arrows.length * 3 }])
    }
    // Two flushes before a GPU upload must retain both pending color changes.
    for (const idx of [0, 2]) {
      moved_arrows[idx].color = `red`
      reused_arrows = pack_arrows(moved_arrows, -0.03, -0.09, -0.2)
      flushSync()
    }
    for (const mesh of rendered_meshes) {
      expect(mesh.colors?.updateRanges).toEqual([
        { start: 0, count: 3 },
        { start: 6, count: 3 },
      ])
      expect(mesh.colors?.array.slice(0, 9)).toEqual(
        new Float32Array([1, 0, 0, 0, 0, 1, 1, 0, 0]),
      )
    }
  } finally {
    for (const component of mounts) await unmount(component)
    threlte_stub.reset()
  }
})

import type { Vec3 } from '$lib/math'
import type { BondPair } from '$lib/structure'
import type { AtomPropertyColors } from '$lib/structure/atom-properties'
import { AtomInstances } from '$lib/structure/atom-instances'
import * as camera_fit from '$lib/structure/camera-fit'
import { make_site, numeric_sites } from '$lib/structure/site'
import StructureScene from '$lib/structure/StructureScene.svelte'
import ArrowInstances from '$lib/structure/ArrowInstances.svelte'
import { pack_arrows } from '$lib/structure/arrow-instances'
import { ArrowMesh } from '$lib/structure/arrow-mesh'
import Bond from '$lib/structure/Bond.svelte'
import * as bond_component from '$lib/structure/Bond.svelte'
import { BondMesh } from '$lib/structure/bond-mesh'
import { BondFrame, pack_bonds, prepare_bond_placements } from '$lib/structure/bond-rendering'
import {
  cache_prepared_polyhedra,
  merge_polyhedra_buffers,
  type Polyhedron,
  type PolyhedraColorMode,
} from '$lib/structure/polyhedra'
import { css_to_linear_rgb } from '$lib/scene/colors'
import { colors } from '$lib/state.svelte'
import { create_numeric_md_frame, FrameView } from '$lib/trajectory/frame'
import { cache_prepared_bonds } from '$lib/structure/bonding'
import InstancedAtoms from '$lib/structure/InstancedAtoms.svelte'
import { mount_scene } from '../scene/mount'
import { type Component, type ComponentProps, flushSync, untrack } from 'svelte'
import { InstancedBufferAttribute, Matrix4, Mesh } from 'three/webgpu'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { expect, onTestFinished, test, vi } from 'vitest'

test(`Scene reuses bond colors only for an explicit matching topology and appearance`, () => {
  // Vitest's TS loader sees the legacy *.svelte declaration; this is a Svelte 5 component.
  const component_module = bond_component as unknown as {
    default: Component<ComponentProps<typeof Bond>>
  }
  const original_bond = component_module.default
  const received_colors: string[][] = []
  const capture = vi.spyOn(component_module, `default`).mockImplementation((anchor, props) => {
    $effect(() => {
      received_colors.push(props.site_colors)
    })
    return original_bond(anchor, props)
  })
  const oxygen_color = colors.element.O
  onTestFinished(() => {
    capture.mockRestore()
    colors.element.O = oxygen_color
  })
  const view = new FrameView()
  const make_structure = (revision = 0) => {
    const frame = create_numeric_md_frame(
      new Float64Array([0, 0, 0, 1, 0, 0]),
      new Uint8Array([6, 8]),
      undefined,
      undefined,
      0,
      {},
      [],
    )
    frame.topology = { kind: `fixed-order`, revision }
    const next = view.update(frame).structure
    const columns = pack_bonds([
      { pos_1: [0, 0, 0], pos_2: [1, 0, 0], site_idx_1: 0, site_idx_2: 1, bond_length: 1 },
    ])
    const placements = prepare_bond_placements(new BondFrame(next, columns))
    cache_prepared_bonds(
      next,
      `electroneg_ratio`,
      {},
      new BondFrame(next, columns, placements),
    )
    return next
  }
  let structure = $state.raw(make_structure())
  let bond_color = $state(`gray`)
  const { unmount_scene } = mount_scene((anchor) =>
    StructureScene(anchor, {
      get structure() {
        return structure
      },
      get bond_color() {
        return bond_color
      },
      show_atoms: false,
      show_bonds: `always`,
      show_polyhedra: `never`,
      bonding_options: {},
      gizmo: false,
      interactive: false,
    }),
  )
  onTestFinished(unmount_scene)
  flushSync()
  expect(received_colors).toHaveLength(1)
  structure = make_structure()
  flushSync()
  expect(received_colors).toHaveLength(1)
  colors.element.O = `#123456`
  flushSync()
  expect(received_colors).toHaveLength(2)
  expect(received_colors[1][1]).toBe(`#123456`)
  bond_color = `white`
  flushSync()
  expect(received_colors).toHaveLength(3)
  structure = make_structure(1)
  flushSync()
  expect(received_colors).toHaveLength(4)
  expect(received_colors[3]).not.toBe(received_colors[2])
})

test(`prepared bonds reuse placements and uniform colors across topology and appearance changes`, () => {
  const structure = {
    sites: Array.from({ length: 6 }, (_unused, idx) =>
      make_site(`C`, [0, 0, 0], [idx, 0, 0], `C`),
    ),
  }
  const make_frame = (count: number, separate_endpoints = false) => {
    const columns = pack_bonds(
      Array.from({ length: count }, (_unused, idx): BondPair => ({
        pos_1: [0, 0, 0],
        pos_2: [1, 0, 0],
        site_idx_1: separate_endpoints ? idx * 2 : 0,
        site_idx_2: separate_endpoints ? idx * 2 + 1 : 1,
        bond_length: 1,
      })),
    )
    const placements = prepare_bond_placements(new BondFrame(structure, columns))
    return new BondFrame(structure, columns, placements)
  }
  let bonds = $state.raw(make_frame(3))
  let site_colors = $state([`red`, `red`])
  let thickness = $state(0.1)
  const { scene, unmount_scene } = mount_scene((anchor) =>
    Bond(anchor, {
      get bonds() {
        return bonds
      },
      get site_colors() {
        return site_colors
      },
      get thickness() {
        return thickness
      },
      ambient_light: 0.7,
      directional_light: 0.3,
    }),
  )
  onTestFinished(unmount_scene)
  flushSync()
  const mesh = scene.children.find((child): child is BondMesh => child instanceof BondMesh)
  if (!mesh) throw new Error(`Expected a bond mesh`)
  const update = vi.spyOn(mesh, `update`)
  onTestFinished(() => update.mockRestore())
  const colors_start = mesh.geometry.getAttribute(`instanceColorStart`)
  const colors_end = mesh.geometry.getAttribute(`instanceColorEnd`)
  if (!(colors_start instanceof InstancedBufferAttribute))
    throw new Error(`Expected an instanced color attribute`)
  for (const count of [1, 2, 3]) {
    bonds = make_frame(count)
    const order = vi.spyOn(
      untrack(() => bonds),
      `order`,
    )
    flushSync()
    expect(mesh.count).toBe(count)
    expect(order).not.toHaveBeenCalled()
    expect(mesh.geometry.getAttribute(`instanceColorStart`)).toBe(colors_start)
  }
  for (const palette of [
    [`red`, `blue`],
    [`green`, `green`],
    [`blue`, `red`],
    [`red`, `red`],
  ]) {
    site_colors = palette
    flushSync()
    for (const [buffer, color] of [
      [colors_start, palette[0]],
      [colors_end, palette[1]],
    ] as const)
      expect(Array.from(buffer.array)).toEqual(
        Array.from({ length: 3 }, () => css_to_linear_rgb(color).map(Math.fround)).flat(),
      )
  }
  // Simulate GPU uploads: the CPU array alone cannot expose lost pending ranges.
  const uploaded = colors_start.array.slice()
  let uploaded_version = colors_start.version
  colors_start.clearUpdateRanges()
  const upload_colors = () => {
    if (colors_start.version === uploaded_version) return
    if (!colors_start.updateRanges.length) uploaded.set(colors_start.array)
    for (const { start, count } of colors_start.updateRanges)
      uploaded.set(colors_start.array.slice(start, start + count), start)
    uploaded_version = colors_start.version
    colors_start.clearUpdateRanges()
  }
  bonds = make_frame(1)
  site_colors = [`lime`, `lime`]
  flushSync()
  upload_colors()
  bonds = make_frame(3)
  flushSync()
  upload_colors()
  expect(uploaded).toEqual(colors_start.array)

  bonds = make_frame(2, true)
  site_colors = [`red`, `red`, `red`, `red`]
  flushSync()
  upload_colors()
  flushSync(() => {
    site_colors[0] = `lime`
  })
  flushSync(() => {
    site_colors[2] = `blue`
  })
  upload_colors()
  expect(uploaded).toEqual(colors_start.array)
  const uploads = update.mock.calls.length
  const centers = mesh.centers.array.slice()
  for (const value of [-0.2, 0, 0.2]) {
    thickness = value
    flushSync()
    expect(mesh.thickness).toBe(value)
    expect(update).toHaveBeenCalledTimes(uploads)
    expect(mesh.centers.array).toEqual(centers)
  }
  // A uniform but incomplete palette must still report the absent endpoint color.
  site_colors = [`red`]
  expect(() => flushSync()).toThrow(`Missing bond endpoint color for site indices 0, 1`)
})

test(`property-colored Scene frames refresh reused atoms and restore element colors`, () => {
  const sites = [
    make_site(`C`, [0, 0, 0], [0, 0, 0], `C`),
    make_site(`O`, [0, 0, 0], [2, 0, 0], `O`),
    make_site(`H`, [0, 0, 0], [3, 0, 0], `H`),
  ]
  let structure = $state.raw({ sites })
  let carbon_radius = $state(1)
  let property_colors = $state.raw<AtomPropertyColors | null>(null)
  const update_atoms = vi.spyOn(AtomInstances.prototype, `update_atoms`)
  const on_rendered = vi.fn()
  const fit_bounds = vi.spyOn(camera_fit, `structure_fit_frame`)
  let get_reset_target: (() => Vec3) | undefined
  onTestFinished(() => update_atoms.mockRestore())
  onTestFinished(() => fit_bounds.mockRestore())
  const { scene, render_frame, unmount_scene } = mount_scene((anchor) =>
    StructureScene(anchor, {
      get structure() {
        return structure
      },
      get render_token() {
        return structure
      },
      on_rendered,
      get get_reset_target() {
        return get_reset_target
      },
      set get_reset_target(value) {
        get_reset_target = value
      },
      get property_colors() {
        return property_colors
      },
      measure_mode: `edit-atoms`,
      atom_opacity: 0.6,
      get element_radius_overrides() {
        // Function bindings supply fresh, value-equal options on coordinate updates.
        void structure
        return { C: carbon_radius }
      },
      show_bonds: `never`,
      show_polyhedra: `never`,
      polyhedra_hide_center_atoms: true,
      gizmo: false,
      interactive: false,
    }),
  )
  onTestFinished(unmount_scene)
  flushSync()
  expect(on_rendered).not.toHaveBeenCalled()
  render_frame()
  expect(on_rendered).toHaveBeenCalledExactlyOnceWith(untrack(() => structure))
  render_frame()
  expect(on_rendered).toHaveBeenCalledOnce()
  const atoms = scene
    .getObjectsByProperty(`type`, `Mesh`)
    .find((object) => object instanceof AtomInstances)
  if (!atoms) throw new Error(`Expected an instanced atom mesh`)
  const element_colors = atoms.colors.array.slice()
  property_colors = { colors: [`red`, `blue`, `green`], values: [0, 1, 2] }
  flushSync()
  const previous_atoms = update_atoms.mock.lastCall?.[0].slice()
  expect(previous_atoms).toHaveLength(sites.length)
  const initial_fits = fit_bounds.mock.calls.length
  for (const frame_idx of [1, 2]) {
    structure = {
      sites: sites.map((site) => ({ ...site, xyz: [site.xyz[0], frame_idx, 0] as Vec3 })),
    }
    // The missing property color must use the element palette, even after a colored frame.
    property_colors = {
      colors: frame_idx === 1 ? [`blue`, `red`] : [`red`, `blue`],
      values: [0, 1, 2],
    }
    flushSync()
    render_frame()
    expect(on_rendered).toHaveBeenLastCalledWith(untrack(() => structure))
    expect(on_rendered).toHaveBeenCalledTimes(frame_idx + 1)
    const current_atoms = update_atoms.mock.lastCall?.[0]
    for (let idx = 0; idx < sites.length; idx++)
      expect(current_atoms?.[idx]).toBe(previous_atoms?.[idx])
    expect(Array.from(atoms.colors.array.slice(0, 6))).toEqual(
      frame_idx === 1 ? [0, 0, 1, 1, 0, 0] : [1, 0, 0, 0, 0, 1],
    )
    expect(atoms.colors.array.slice(6, 9)).toEqual(element_colors.slice(6, 9))
    for (let site_idx = 0; site_idx < sites.length; site_idx++) {
      expect(atoms.positions.array[site_idx * 4 + 1]).toBe(frame_idx)
    }
  }
  expect(fit_bounds).toHaveBeenCalledTimes(initial_fits)
  expect(get_reset_target?.()[1]).toBe(2)
  expect(fit_bounds).toHaveBeenCalledTimes(initial_fits + 1)
  property_colors = null
  flushSync()
  expect(atoms.colors.array).toEqual(element_colors)
  const original_radius = atoms.positions.array[3]
  carbon_radius = 2
  flushSync()
  expect(atoms.positions.array[3]).toBe(original_radius * 2)
  property_colors = { colors: [`red`], values: [0, 1, 2] }
  flushSync()
  // JavaScript callers can supply a property-color record without its color array.
  property_colors = { values: [0, 1, 2] } as AtomPropertyColors
  flushSync()
  expect(atoms.colors.array).toEqual(element_colors)

  // Fixed row identities do not make per-frame image/completion flags immutable.
  const view = new FrameView()
  property_colors = null
  carbon_radius = 3 // Start a numeric render group with its own topology identity.
  const cases: {
    scalar_columns?: Record<string, Float64Array>
    shown: number[]
    image: boolean
    generic?: boolean
  }[] = [
    { scalar_columns: undefined, shown: [0, 1, 2], image: false },
    { scalar_columns: undefined, shown: [0, 1, 2], image: false },
    {
      scalar_columns: { completion_image: new Float64Array([1, 0, 0]) },
      shown: [1, 2],
      image: false,
    },
    {
      scalar_columns: { completion_image: new Float64Array([1, 0, 0]) },
      shown: [1, 2],
      image: false,
    },
    { scalar_columns: undefined, shown: [0, 1, 2], image: false },
    {
      scalar_columns: { orig_site_idx: new Float64Array([0, 1, 2]) },
      shown: [0, 1, 2],
      image: true,
    },
    { scalar_columns: undefined, shown: [0, 1, 2], image: false },
    { shown: [0, 1, 2], image: false, generic: true },
    { shown: [0, 1, 2], image: false },
    { shown: [0, 1, 2], image: false },
  ]
  for (const [frame_idx, { scalar_columns, shown, image, generic }] of cases.entries()) {
    const frame = create_numeric_md_frame(
      new Float64Array([0, frame_idx, 0, 2, frame_idx, 0, 3, frame_idx, 0]),
      new Uint8Array([6, 8, 1]),
      undefined,
      undefined,
      frame_idx,
      {},
      [],
    )
    frame.scalar_columns = scalar_columns
    const snapshot = frame.coordinates.slice()
    const next = view.update(frame).structure
    // An editable copy drops snapshot identity; the next validated frame adopts it again.
    structure = generic ? { ...next, sites: next.sites } : next
    const columns = numeric_sites.get(next)
    if (!columns) throw new Error(`Expected numeric sites`)
    const materialize = vi.spyOn(columns, `materialize`)
    flushSync()
    if (frame_idx === 1 || frame_idx === cases.length - 1)
      expect(materialize).not.toHaveBeenCalled()
    materialize.mockRestore()
    const rendered = update_atoms.mock.lastCall?.[0]
    expect(rendered).toHaveLength(shown.length)
    expect(rendered).toMatchObject(
      shown.map((site_idx) => ({
        site_idx,
        is_image_atom: image,
        position: [sites[site_idx].xyz[0], frame_idx, 0],
      })),
    )
    expect(frame.coordinates).toEqual(snapshot)
    expect(update_atoms.mock.contexts.at(-1)).toMatchObject({
      material: { opacity: image ? 0.3 : 0.6 },
    })
  }
})

test(`numeric polyhedra reuse outlines and resolve colors without decoding atom records`, async () => {
  const vertices: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [-1, -1, -1],
  ]
  const poly: Polyhedron = {
    center_site_idx: 0,
    center_orig_idx: 0,
    center_element: `Mg`,
    volume: 1,
    vertices,
    vertex_site_idxs: [1, 2, 3, 4],
    faces: [
      [0, 1, 2],
      [0, 3, 1],
      [0, 2, 3],
      [1, 3, 2],
    ],
  }
  const frame = create_numeric_md_frame(
    new Float64Array([0, 0, 0, ...vertices.flat()]),
    new Uint8Array([12, 8, 1, 8, 1]),
    undefined,
    undefined,
    0,
    {},
    [],
  )
  const structure = new FrameView().update(frame).structure
  const bonds = new BondFrame(
    structure,
    pack_bonds([
      { pos_1: [0, 0, 0], pos_2: vertices[0], site_idx_1: 0, site_idx_2: 1, bond_length: 1 },
    ]),
  )
  cache_prepared_bonds(structure, `electroneg_ratio`, {}, bonds)
  cache_prepared_polyhedra(bonds, {}, [poly])
  const columns = numeric_sites.get(structure)
  if (!columns) throw new Error(`Expected numeric sites`)
  const get_site = vi.spyOn(columns, `get`)
  onTestFinished(() => get_site.mockRestore())
  let mode = $state<PolyhedraColorMode>(`uniform`)
  let show_edges = $state(false)
  let show_polyhedra = $state(true)
  const property_colors = {
    colors: [`red`, `blue`],
    values: [0, 1, 2, 1, 2],
  }
  const { scene, unmount_scene } = mount_scene((anchor) =>
    StructureScene(anchor, {
      structure,
      property_colors,
      show_atoms: false,
      show_bonds: `never`,
      get show_polyhedra() {
        return show_polyhedra ? `always` : `never`
      },
      gizmo: false,
      interactive: false,
      polyhedra_color: `yellow`,
      get polyhedra_color_mode() {
        return mode
      },
      get polyhedra_show_edges() {
        return show_edges
      },
    }),
  )
  const disposal = vi.fn()
  try {
    flushSync() // Initial camera fitting may inspect sites; subsequent colors must not.
    get_site.mockClear()
    expect(scene.getObjectByProperty(`isLineSegments2`, true)).toBeUndefined()
    show_edges = true
    flushSync()
    const edges = scene.getObjectByProperty(`isLineSegments2`, true)
    const faces = scene
      .getObjectsByProperty(`type`, `Mesh`)
      .find((mesh) => mesh instanceof Mesh && mesh.geometry.getAttribute(`normal`))
    if (!(edges instanceof LineSegments2) || !(faces instanceof Mesh))
      throw new Error(`Expected polyhedra faces and outlines`)
    edges.material.addEventListener(`dispose`, disposal)
    for (const value of [`vertex`, `center`, `uniform`] as const) {
      mode = value
      flushSync()
      expect(scene.getObjectById(edges.id)).toBe(edges)
      const expected = merge_polyhedra_buffers([poly], (_poly, idx) =>
        value === `uniform`
          ? `yellow`
          : (property_colors.colors[value === `center` ? 0 : poly.vertex_site_idxs[idx]] ??
            colors.element?.[idx % 2 === 0 ? `O` : `H`] ??
            `#808080`),
      )
      expect(faces.geometry.getAttribute(`color`).array).toEqual(expected.colors)
      expect(get_site).not.toHaveBeenCalled()
    }
    for (const visible of [false, true]) {
      show_edges = visible
      flushSync()
      expect(edges.visible).toBe(visible)
      show_polyhedra = false
      flushSync()
      expect(scene.getObjectById(edges.id)).toBeUndefined()
      show_polyhedra = true
      flushSync()
      expect(scene.getObjectById(edges.id)).toBe(edges)
      expect(edges.visible).toBe(visible)
      expect(disposal).not.toHaveBeenCalled()
    }
  } finally {
    await unmount_scene()
  }
  expect(disposal).toHaveBeenCalledOnce()
})

test.each([`atoms`, `arrows`, `bonds`] as const)(
  `%s releases retired meshes during growth and disposes each resource once`,
  async (kind) => {
    const inputs = $state({ count: 2, offset: 0 })
    const positions = $derived(
      Array.from({ length: inputs.count }, (_unused, idx): Vec3 => [idx, inputs.offset, 0]),
    )
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    const { scene, disposable_objects, unmount_scene } = mount_scene((anchor) => {
      if (kind === `atoms`)
        return InstancedAtoms(anchor, {
          get atoms() {
            return positions.map((position) => ({ position, radius: 0.5, color: `red` }))
          },
        })
      if (kind === `arrows`)
        return ArrowInstances(anchor, {
          get arrows() {
            return pack_arrows(
              positions.map((position) => ({
                position,
                vector: [0, 1, 0] satisfies Vec3,
                magnitude: 1,
                scale: 1,
                color: `red`,
              })),
              0.1,
              0.2,
              0.3,
            )
          },
        })
      return Bond(anchor, {
        get bonds() {
          return positions.map((position): BondPair => ({
            pos_1: position,
            pos_2: [position[0], position[1] + 1, 0],
            site_idx_1: 0,
            site_idx_2: 1,
            bond_order: 1,
            bond_length: 1,
          }))
        },
        site_colors: [`red`, `blue`],
        thickness: 0.1,
        ambient_light: 0.7,
        directional_light: 0.3,
      })
    })
    type InstanceMesh = AtomInstances | ArrowMesh | BondMesh
    const capacity = (mesh: InstanceMesh) =>
      mesh instanceof AtomInstances
        ? mesh.positions.count
        : mesh instanceof ArrowMesh
          ? mesh.origins.count
          : mesh.centers.count
    const meshes = new Map<InstanceMesh, ReturnType<typeof vi.spyOn>>()
    const resources = new Map<{ dispose: () => void }, ReturnType<typeof vi.spyOn>>()
    let previous_active: InstanceMesh[] = []
    try {
      for (const count of [2, 3, 4, 5, 6, 2, 0, 2]) {
        inputs.count = count
        inputs.offset += 1
        flushSync()
        const active = scene.children.filter(
          (child): child is InstanceMesh =>
            child instanceof AtomInstances ||
            child instanceof ArrowMesh ||
            child instanceof BondMesh,
        )
        expect(active).toHaveLength(kind === `arrows` ? 2 : 1)
        if (kind === `arrows`) {
          const [shafts, heads] = active
          if (!(shafts instanceof ArrowMesh) || !(heads instanceof ArrowMesh))
            throw new Error(`Expected shaft and head meshes`)
          expect(shafts.colors).toBe(heads.colors)
        }
        if (previous_active.length && count <= capacity(previous_active[0])) {
          expect(active).toEqual(previous_active)
        }
        for (const mesh of active) {
          expect(mesh.count).toBe(count)
          const color_attributes =
            kind === `bonds`
              ? [`instanceColorStart`, `instanceColorEnd`]
              : [kind === `atoms` ? `atomColor` : `arrowColor`]
          for (const [buffer_idx, name] of color_attributes.entries()) {
            const buffer = mesh.geometry.getAttribute(name)
            const expected = buffer_idx === 0 ? [1, 0, 0] : [0, 0, 1]
            expect(Array.from(buffer.array.slice(0, count * 3))).toEqual(
              Array.from({ length: count }, () => expected).flat(),
            )
          }
          const buffers = Object.entries(mesh.geometry.attributes).filter(
            (entry): entry is [string, InstancedBufferAttribute] =>
              entry[1] instanceof InstancedBufferAttribute,
          )
          const clone_buffer = vi.spyOn(InstancedBufferAttribute.prototype, `clone`)
          const captured = mesh.clone()
          expect(clone_buffer).toHaveBeenCalledTimes(buffers.length)
          for (const [idx, [name, buffer]] of buffers.entries()) {
            const copied = captured.geometry.getAttribute(name)
            // Reuse the buffers cloned with the geometry instead of copying them again.
            expect(copied).toBe(clone_buffer.mock.results[idx].value)
            expect(copied.array).toEqual(buffer.array)
            expect(copied.array).not.toBe(buffer.array)
            expect(copied).toMatchObject({ usage: buffer.usage })
          }
          clone_buffer.mockRestore()
          captured.geometry.dispose()
          if (count === 4) expect(capacity(mesh)).toBe(5)
          if (count > 0) {
            const center_offset =
              kind === `atoms`
                ? 0
                : kind === `bonds`
                  ? 0.5
                  : mesh.geometry.type === `ConeGeometry`
                    ? 1
                    : 0.425
            const matrix = new Matrix4()
            mesh.getMatrixAt(0, matrix)
            const expected = Math.fround(inputs.offset + center_offset)
            // Arrow offsets now combine rounded origins, lengths and size uniforms.
            const tolerance =
              mesh instanceof ArrowMesh ? 2 * 2 ** -23 * Math.max(1, Math.abs(expected)) : 0
            expect(Math.abs(matrix.elements[13] - expected)).toBeLessThanOrEqual(tolerance)
          }
          if (!meshes.has(mesh)) meshes.set(mesh, vi.spyOn(mesh, `dispose`))
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const resource of [mesh.geometry, ...materials]) {
            if (!resources.has(resource))
              resources.set(resource, vi.spyOn(resource, `dispose`))
            expect(resources.get(resource)).not.toHaveBeenCalled()
          }
        }
        for (const [mesh, dispose] of meshes) {
          expect(dispose).toHaveBeenCalledTimes(active.includes(mesh) ? 0 : 1)
          // Threlte must not retain already-disposed matrices or dispose them a second time.
          if (!active.includes(mesh)) expect(disposable_objects.has(mesh)).toBe(false)
        }
        previous_active = active
      }
    } finally {
      await unmount_scene()
    }
    for (const dispose of [...meshes.values(), ...resources.values()]) {
      expect(dispose).toHaveBeenCalledTimes(1)
    }
  },
)

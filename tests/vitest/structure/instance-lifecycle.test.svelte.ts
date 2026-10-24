import { format_num } from '#lib/labels.js'
import type { Vec3 } from '#lib/math.js'
import { dihedral_angle } from '#lib/structure/measure.js'
import { AXIS_COLORS, default_element_colors } from '#lib/colors/index.js'
import type { ElementSymbol } from '#lib/element/index.js'
import { camera_flight_registry } from '#lib/scene/camera-flight.js'
import { HOVER_SHELL_SCALE } from '#lib/scene/geometry.svelte.js'
import { type CameraProjection, DEFAULTS } from '#lib/settings.js'
import type {
  AnyStructure,
  BondOrder,
  BondPair,
  MeasureMode,
  Site,
  StructureBond,
} from '#lib/structure/index.js'
import type { AtomPropertyColors } from '#lib/structure/atom-properties.js'
import type { StructureCutaway } from '#lib/structure/cutaway.js'
import { cutaway_planes, StructureCutawayGroup } from '#lib/structure/cutaway.js'
import * as extras from '@threlte/extras'
import { AtomInstances } from '#lib/structure/atom-instances.js'
import * as camera_fit from '#lib/structure/camera-fit.js'
import { make_site, numeric_sites } from '#lib/structure/site.js'
import { get_center_of_mass } from '#lib/structure/index.js'
import StructureScene from '#lib/structure/StructureScene.svelte'
import ArrowInstances from '#lib/structure/ArrowInstances.svelte'
import { pack_arrows } from '#lib/structure/arrow-instances.js'
import { ArrowMesh } from '#lib/structure/arrow-mesh.js'
import { PartialAtoms } from '#lib/structure/partial-atoms.js'
import Bond from '#lib/structure/Bond.svelte'
import * as bond_component from '#lib/structure/Bond.svelte'
import { BondMesh } from '#lib/structure/bond-mesh.js'
import {
  BondFrame,
  pack_bonds,
  prepare_bond_placements,
} from '#lib/structure/bond-rendering.js'
import type { Polyhedron } from '#lib/structure/polyhedra.js'
import { cache_prepared_polyhedra } from '#lib/structure/polyhedra.js'
import { merge_polyhedra_buffers } from '#lib/structure/polyhedra-render.js'
import { css_to_linear_rgb } from '#lib/scene/colors.js'
import { colors } from '#lib/state.svelte.js'
import { create_numeric_md_frame, FrameView } from '#lib/trajectory/frame.js'
import { cache_prepared_bonds } from '#lib/structure/bonding.js'
import InstancedAtoms from '#lib/structure/InstancedAtoms.svelte'
import { mount_scene } from '../scene/mount'
import { bind_props, doc_query } from '../setup'
import { image_options, make_crystal, make_srtio3 } from '../test-fixtures'
import { get_pbc_image_sites } from '#lib/structure/pbc.js'
import type { Component, ComponentProps } from 'svelte'
import { createRawSnippet, flushSync, untrack } from 'svelte'
import {
  type Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  type Object3D,
  OrthographicCamera,
  Raycaster,
  TubeGeometry,
  Vector3,
} from 'three/webgpu'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { SvelteSet } from 'svelte/reactivity'
import { expect, onTestFinished, test, vi } from 'vitest'

// Spy on Threlte's interactivity() and return a getter for the scene's interactivity state
const spy_interactivity = () => {
  const capture = vi.spyOn(extras, `interactivity`)
  onTestFinished(() => capture.mockRestore())
  return () => {
    const captured = capture.mock.results[0]
    if (captured?.type !== `return`) throw new Error(`Missing scene interactivity`)
    return captured.value
  }
}
// happy-dom has no layout to turn client coordinates into a ray: cast one straight down (-z)
// through world (x, y), dispatch `events` on the scene's target there and flush
const pointer_at = (
  scene_interactivity: ReturnType<typeof extras.interactivity>,
  x_coord: number,
  y_coord = 0,
  events = [`pointerdown`, `click`],
  init: MouseEventInit = {},
): void => {
  scene_interactivity.compute = (_event, { raycaster }) =>
    raycaster.set(new Vector3(x_coord, y_coord, 10), new Vector3(0, 0, -1))
  for (const type of events)
    scene_interactivity.target.current?.dispatchEvent(
      type.startsWith(`pointer`) ? new PointerEvent(type, init) : new MouseEvent(type, init),
    )
  flushSync()
}
const right_click = [`pointerdown`, `contextmenu`]
const menu_button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>(`.bond-context-menu button`)].find(
    (button) => button.textContent?.trim() === label,
  )
// Carbon atoms along the x axis
const carbons_at = (...x_coords: number[]): Site[] =>
  x_coords.map((x_coord) => make_site(`C`, [0, 0, 0], [x_coord, 0, 0], `C`))
const lone_c = { sites: carbons_at(0) }
// A cubic cell of carbons at the given fractional coordinates
const carbon_crystal = (edge: number, ...abcs: Vec3[]) =>
  make_crystal(
    edge,
    abcs.map((abc): [string, Vec3] => [`C`, abc]),
  )
// Rock salt Na at the corner and Cl at the center of a 6 Å cube
const nacl = () =>
  make_crystal(6, [
    [`Na`, [0, 0, 0]],
    [`Cl`, [0.5, 0.5, 0.5]],
  ])
const md_frame = (coords: ArrayLike<number>, numbers: number[], frame_idx = 0) =>
  create_numeric_md_frame(
    new Float64Array(coords),
    new Uint8Array(numbers),
    undefined,
    undefined,
    frame_idx,
    {},
    [],
  )

// Measurement lines and bond tints: the plain cylinder meshes (lattice edges are instanced)
const measure_cylinders = (scene: Object3D): Mesh[] =>
  scene
    .getObjectsByProperty(`type`, `Mesh`)
    .filter(
      (mesh): mesh is Mesh =>
        mesh instanceof Mesh &&
        !(mesh instanceof InstancedMesh) &&
        mesh.geometry.type === `CylinderGeometry`,
    )

// Whole-atom slab through z = 0 of an identity cell
const whole_atom_cutaway = (): StructureCutaway => ({
  mode: `slab`,
  axis: 2,
  position: 0,
  thickness: 0.2,
  whole_atoms: true,
  cartesian_to_fractional: new Matrix4(),
})
const meshes_of = <Kind extends Object3D>(
  scene: Object3D,
  kind: new (...args: never[]) => Kind,
): Kind[] =>
  scene
    .getObjectsByProperty(`type`, `Mesh`)
    .filter((mesh): mesh is Kind => mesh instanceof kind)
const sphere_count = (scene: Object3D): number =>
  meshes_of(scene, AtomInstances).reduce((sum, mesh) => sum + mesh.count, 0)
// The merged polyhedra faces: the one plain vertex-colored mesh
const polyhedra_faces = (scene: Object3D): Mesh | undefined =>
  scene
    .getObjectsByProperty(`type`, `Mesh`)
    .find(
      (mesh): mesh is Mesh =>
        mesh instanceof Mesh &&
        ![AtomInstances, BondMesh, ArrowMesh].some((kind) => mesh instanceof kind) &&
        Boolean(mesh.geometry.getAttribute(`color`)),
    )
type SceneProps = Partial<ComponentProps<typeof StructureScene>>
// Mount a gizmo-free StructureScene (getters in props stay live, state keys bind two-way),
// flushed and unmounted after the test
const mount_structure = (props: SceneProps, state: SceneProps = {}) => {
  const mounted = mount_scene((anchor) =>
    StructureScene(anchor, bind_props(Object.assign(props, { gizmo: false }), state)),
  )
  onTestFinished(mounted.unmount_scene)
  flushSync()
  return mounted
}
// A lone carbon atom with its other props bound to `state`
const mount_carbon = (state: SceneProps) =>
  mount_structure({ structure: lone_c, show_bonds: `never`, show_polyhedra: `never` }, state)
// Both ends of every instanced bond cylinder
const bond_endpoints = (bond: BondMesh): number[][][] =>
  Array.from({ length: bond.count }, (_unused, bond_idx) =>
    [-1, 1].map((direction) =>
      [0, 1, 2].map(
        (axis) =>
          bond.centers.array[bond_idx * 3 + axis] +
          (direction * bond.deltas.array[bond_idx * 3 + axis]) / 2,
      ),
    ),
  )
// SiO4 tetrahedron: Si-O 1.62 A along the cube diagonals
const SIO4_ARM = 1.62 / Math.sqrt(3)
const SIO4_CORNERS: Vec3[] = [
  [SIO4_ARM, SIO4_ARM, SIO4_ARM],
  [SIO4_ARM, -SIO4_ARM, -SIO4_ARM],
  [-SIO4_ARM, SIO4_ARM, -SIO4_ARM],
  [-SIO4_ARM, -SIO4_ARM, SIO4_ARM],
]
const sio4 = (properties: Site[`properties`] = {}) => ({
  sites: [
    make_site(`Si`, [0, 0, 0], [0, 0, 0], `Si0`, properties),
    ...SIO4_CORNERS.map((xyz, idx) => make_site(`O`, [0, 0, 0], xyz, `O${idx}`, properties)),
  ],
})

test.each(
  ([`plane`, `slab`] as const).flatMap((mode) =>
    [false, true].flatMap((whole_atoms) =>
      [0.5, 1].map((occupancy) => ({ mode, whole_atoms, occupancy })),
    ),
  ),
)(
  `$mode cutaway selects whole atoms=$whole_atoms at occupancy=$occupancy while keeping visible surfaces pickable`,
  ({ mode, whole_atoms, occupancy }) => {
    const interactivity = spy_interactivity()
    const position = mode === `plane` ? 0.1 : 0
    const settings = { ...whole_atom_cutaway(), mode, position, whole_atoms }
    const carbon = (z_coord: number) =>
      make_site(`C`, [0, 0, 0], [0, 0, z_coord], `C`, {}, occupancy)
    const state = $state<SceneProps>({ structure: { sites: [carbon(0)] }, cutaway: undefined })
    mount_structure({ show_bonds: `never`, show_polyhedra: `never` }, state)
    const { interactiveObjects: targets } = interactivity()
    const ray = new Raycaster(new Vector3(-0.1, 0, 2), new Vector3(0, 0, -1))
    const hits = () => ray.intersectObjects(targets, true)
    expect(hits()[0]?.distance).toBeLessThan(2)
    state.cutaway = settings
    flushSync()
    // Center selection preserves the near sphere surface across the slab boundary.
    // Surface clipping instead exposes the vacancy cap at z=0 for partial occupancy.
    if (whole_atoms) expect(hits()[0]?.distance).toBeLessThan(2)
    else if (occupancy === 0.5) expect(hits()[0]?.distance).toBe(2)
    else expect(hits()).toEqual([])
    if (whole_atoms) {
      // Moving atoms must leave and reenter a fixed slice instead of reusing its old selection.
      for (const z_coord of [0.3, 0]) {
        state.structure = { sites: [carbon(z_coord)] }
        flushSync()
        if (z_coord) expect(hits()).toEqual([])
        else expect(hits()[0]?.distance).toBeLessThan(2)
      }
    }
    state.cutaway = { ...settings, position: -0.3 }
    flushSync()
    expect(hits()).toEqual([])
    // Disabling clipping restores the full-sphere target, including its pole-safe hover.
    state.cutaway = undefined
    flushSync()
    expect(hits()[0]?.distance).toBeLessThan(2)
  },
)

test.each(
  [false, true].flatMap((numeric) =>
    [false, true].flatMap((periodic) =>
      ([`always`, `never`] as const).map((show_bonds) => ({ numeric, periodic, show_bonds })),
    ),
  ),
)(
  `whole-atom cutaway completes moving coordination shells (numeric=$numeric, periodic=$periodic, bonds=$show_bonds)`,
  ({ numeric, periodic, show_bonds }) => {
    // oxfmt-ignore
    const vertices: Vec3[] = [[1, 0, 0.5], [-1, 0, 0.5], [0, 1, -0.5], [0, -1, -0.5]]
    const make_structure = (center_z: number, vertex_z = 0.5) => {
      const positions: Vec3[] = [
        [0, 0, center_z],
        ...vertices.map((position, idx) =>
          idx === 0 ? ([position[0], position[1], vertex_z] as Vec3) : position,
        ),
        [10, 0, 2],
        [11, 0, 2],
      ]
      if (periodic) positions[1] = [-3, 0, vertex_z]
      const next = numeric
        ? new FrameView().update(md_frame(positions.flat(), [32, 14, 14, 14, 14, 14, 14]))
            .structure
        : {
            sites: positions.map((position, idx) => {
              const element = idx ? `Si` : `Ge`
              return make_site(element, [0, 0, 0], position, `${element}${idx}`)
            }),
          }
      const pairs: BondPair[] = [1, 2, 3, 4].map((site_idx) => ({
        site_idx_1: 0,
        site_idx_2: site_idx,
        pos_1: positions[0],
        pos_2: positions[site_idx],
        bond_length: Math.hypot(
          ...positions[site_idx].map((value, axis) => value - positions[0][axis]),
        ),
      }))
      if (periodic) pairs[0] = { ...pairs[0], pos_2: [1, 0, vertex_z], cell_shift: [1, 0, 0] }
      pairs.push({
        site_idx_1: 5,
        site_idx_2: 6,
        pos_1: positions[5],
        pos_2: positions[6],
        bond_length: 1,
      })
      cache_prepared_bonds(
        next,
        `electroneg_ratio`,
        {},
        numeric ? new BondFrame(next, pack_bonds(pairs)) : pairs,
      )
      return next
    }
    let structure = $state.raw(make_structure(0))
    const { scene } = mount_structure({
      get structure() {
        return structure
      },
      cutaway: whole_atom_cutaway(),
      show_bonds,
      show_polyhedra: `always`,
      polyhedra_neighbor_mode: `bonded`,
      polyhedra_excluded_elements: [`Si`],
    })
    for (const [center_z, vertex_z] of [
      [0, 0.5],
      [0, 0.75],
      [0.25, 0.75],
      [0, 0.5],
    ]) {
      structure = make_structure(center_z, vertex_z)
      flushSync()
      const atoms = meshes_of(scene, AtomInstances)
      const [bond] = meshes_of(scene, BondMesh)
      const faces = polyhedra_faces(scene)
      if (center_z) {
        expect(atoms).toHaveLength(0)
        expect(bond).toBeUndefined()
        expect(faces).toBeUndefined()
        continue
      }
      const positions = atoms.flatMap((mesh) =>
        Array.from({ length: mesh.count }, (_unused, idx) => [
          mesh.positions.getX(idx),
          mesh.positions.getY(idx),
          mesh.positions.getZ(idx),
        ]),
      )
      expect(positions).toHaveLength(5)
      expect(positions).toEqual(
        expect.arrayContaining([[0, 0, 0], [1, 0, vertex_z], ...vertices.slice(1)]),
      )
      for (const mesh of atoms) expect(cutaway_planes(mesh)).toEqual([])
      if (!faces) throw new Error(`Missing complete polyhedron`)
      expect(cutaway_planes(faces)).toEqual([])
      expect(faces.geometry.getAttribute(`position`).count).toBe(12)
      if (show_bonds === `never`) expect(bond).toBeUndefined()
      else {
        if (!bond) throw new Error(`Missing complete bonds`)
        expect(bond.count).toBe(4)
        expect(cutaway_planes(bond)).toEqual([])
        for (const endpoint of bond_endpoints(bond).flat()) {
          expect(positions).toContainEqual(endpoint)
        }
      }
    }
  },
)

// Hover raycasts stay off while the camera moves or atoms are dragged, so tooltips don't flicker
test(`Scene disables hover raycasts while orbiting or dragging atoms`, () => {
  const interactivity = spy_interactivity()
  const state = $state({ camera_is_moving: false, dragging_atoms: false })
  mount_carbon(state)
  const { enabled } = interactivity()
  for (const [camera_is_moving, dragging_atoms, hover] of [
    [false, false, true],
    [false, true, false],
    [true, false, false],
    [false, false, true],
  ]) {
    Object.assign(state, { camera_is_moving, dragging_atoms })
    flushSync()
    expect(enabled.current, JSON.stringify(state)).toBe(hover)
  }
})

// Threlte hands the pointer event to every atom on the ray, nearest first: the atom behind
// used to take over the hover and tooltip. A partial-occupancy site 0 resolves through the
// wedge group's instanceId and must also win over, or yield to, an ordered atom. Touch has no
// hover, so a tap (press, then click) on the atom shows its tooltip instead.
test.each([
  [10, 0, 1, [`pointermove`]],
  [-10, 1, 1, [`pointermove`]], // same ray from behind
  [10, 0, 0.5, [`pointermove`]],
  [-10, 1, 0.5, [`pointermove`]],
  [10, 0, 1, [`pointerdown`, `click`]],
  [-10, 1, 0.5, [`pointerdown`, `click`]],
])(
  `hover picks the front atom from z=%i (site %i, occu %s, %j)`,
  (origin_z, front_idx, occu, types) => {
    const interactivity = spy_interactivity()
    const hover = $state<SceneProps>({ hovered_idx: null })
    const sites = [0, -3].map((z_coord, idx) =>
      make_site(`C`, [0, 0, 0], [0, 0, z_coord], `C`, {}, idx ? 1 : occu),
    )
    mount_structure({ structure: { sites }, show_bonds: `never` }, hover)
    // happy-dom has no layout to turn client coordinates into a ray, so cast a fixed one
    const scene_interactivity = interactivity()
    scene_interactivity.compute = (_event, state) =>
      state.raycaster.set(
        new Vector3(0, 0, origin_z),
        new Vector3(0, 0, -origin_z).normalize(),
      )
    const pointerType = types.length > 1 ? `touch` : `mouse`
    for (const type of types)
      scene_interactivity.target.current?.dispatchEvent(
        new PointerEvent(type, { pointerType }),
      )
    flushSync()
    expect(hover.hovered_idx).toBe(front_idx)
    expect(document.querySelectorAll(`[role="tooltip"]`)).toHaveLength(1)
  },
)

// From the focused viewer root, arrows walk the atoms in site order (KeyWalk), starting from a
// hovered atom, with the hover tooltip a pointer would show, and Enter selects like a click
test(`keyboard walks the atoms in site order and Enter selects`, () => {
  const state = $state<SceneProps>({ hovered_idx: null, selected_sites: [] })
  const sites = ([`C`, `N`] as const).map((element, idx) =>
    make_site(element, [0, 0, 0], [2 * idx, 0, 0], element),
  )
  const { keys } = mount_structure({ structure: { sites }, show_bonds: `never` }, state)
  expect([`ArrowRight`, `ArrowRight`].map((key) => keys.press(key))).toEqual([true, true])
  expect([state.hovered_idx, keys.message]).toEqual([1, `Site 2: N`])
  expect(document.querySelectorAll(`[role="tooltip"]`)).toHaveLength(1)
  keys.press(`Enter`)
  expect(state.selected_sites).toEqual([1])
  keys.press(`Escape`)
  expect(state.hovered_idx).toBeNull()
  expect(document.querySelector(`[role="tooltip"]`)).toBeNull()
  state.hovered_idx = 0 // the pointer's hover is where the walk picks up
  keys.press(`ArrowRight`)
  expect([state.hovered_idx, keys.message]).toEqual([1, `Site 2: N`])
})

// Lattice arrows start at (-1, -1, -1) of this 4 Å cube and span half their vector. Their
// hover stops at the nearest arrow: a ray across A's shaft also crosses B's farther along,
// and one onto A's shaft crosses the atom behind it, either of which used to take over. Coming
// from B alone, B's pointerleave fires after A took the hover, which must not clear it.
type Ray = [Vec3, Vec3] // origin, direction
// oxfmt-ignore
const [across_a_then_b, onto_a_past_atom, b_only]: Ray[] = [
  [[6.5, -5, -1], [-1.5, 1, 0]],
  [[0, -1, 10], [0, 0, -1]],
  [[10, 0, -1], [-1, 0, 0]],
]
test.each<[string, Ray[]]>([
  [`across A then B`, [across_a_then_b]],
  [`onto A past an atom`, [onto_a_past_atom]],
  [`from B onto A in front`, [b_only, across_a_then_b]],
])(`lattice arrow hover picks the front arrow (%s)`, async (_label, rays) => {
  const interactivity = spy_interactivity()
  const hover = $state<SceneProps>({ hovered_idx: null })
  const structure = make_crystal(4, [[`C`, [0, -0.25, -0.75]]])
  mount_structure({ structure, show_bonds: `never` }, hover).scene.updateMatrixWorld()
  const scene_interactivity = interactivity()
  for (const [move_idx, [origin, direction]] of rays.entries()) {
    scene_interactivity.compute = (_event, state) =>
      state.raycaster.set(new Vector3(...origin), new Vector3(...direction).normalize())
    // threlte drops moves under a quarter pixel and handles one per animation frame
    const move = new PointerEvent(`pointermove`)
    Object.defineProperty(move, `offsetX`, { value: move_idx })
    scene_interactivity.target.current?.dispatchEvent(move)
    await new Promise(requestAnimationFrame)
  }
  flushSync()
  expect(hover.hovered_idx).toBeNull()
  const tooltips = document.querySelectorAll(`[role="tooltip"]`)
  expect([...tooltips].map((tip) => tip.textContent?.replaceAll(/\s+/g, ` `).trim())).toEqual([
    `A = (4, 0, 0) Å`,
  ])
})

// The tooltip wears the hovered mark's one flat fill (translucent ones flattened, per
// tooltip_paint), text contrasted: an atom's colour or a lattice arrow's tint. Colour fields
// and a site drawn as several visible elements' wedges (unless a property colour paints the
// whole site) stay neutral.
const c_n_site: Site = {
  ...make_site(`C`, [0, 0, 0], [0, 0, 0], `C`),
  species: ([`C`, `N`] as const).map((element) => ({
    element,
    occu: 0.5,
    oxidation_state: 0,
  })),
}
// pymatgen mixed valence: one element listed per oxidation state
const fe_mixed_site: Site = {
  ...make_site(`Fe`, [0, 0, 0], [0, 0, 0], `Fe`),
  species: [2, 3].map((oxidation_state) => ({ element: `Fe`, occu: 0.5, oxidation_state })),
}
// Bi/Zr disorder stored as two half-occupied sites at one position: drawn as one wedged atom
const split_bi_zr = {
  sites: ([`Bi`, `Zr`] as const).map((element) =>
    make_site(element, [0, 0, 0], [0, 0, 0], element, {}, 0.5),
  ),
}
// oxfmt-ignore
test.each<[string, SceneProps, string?, string?, [number, number]?]>([
  [`ordered site`, { structure: lone_c }, default_element_colors.C, `white`],
  [`disordered site`, { structure: { sites: [c_n_site] } }],
  [`mixed-valence site`, { structure: { sites: [fe_mixed_site] } }, default_element_colors.Fe, `black`],
  [`split two-site disorder`, { structure: split_bi_zr }],
  // hiding N leaves a lone C wedge, drawn (and so painted) in C's colour
  [`disordered site with one element hidden`, { structure: { sites: [c_n_site] }, hidden_elements: new Set([`N`]) }, default_element_colors.C, `white`],
  [`property-coloured disordered site`, { structure: { sites: [c_n_site] }, property_colors: { colors: [`#fedcba`], values: [1] } }, `#fedcba`, `black`],
  // property colours that don't reach this site leave its element wedges
  [`disordered site past the property colours`, { structure: { sites: [make_site(`C`, [0, 0, 0], [0, 0, -5], `C`), c_n_site] }, property_colors: { colors: [`#123456`], values: [1] } }],
  [`atom colour field`, { structure: lone_c, atom_color_field: { dims: [1, 1, 1], colors: new Float32Array([1, 0, 0, 1]), pbc: [true, true, true], cartesian_to_fractional: new Matrix4() } }],
  [`translucent property colour`, { structure: lone_c, property_colors: { colors: [`rgba(18, 52, 86, 0.5)`], values: [1] } }, `rgb(18, 52, 86)`, `white`],
  [`translucent atoms`, { structure: lone_c, atom_opacity: 0.5 }, default_element_colors.C, `white`],
  // the half-length A arrow's shaft spans x in [-1, 0.9] at y = z = -1, clear of the atom at (2, 2, 2)
  [`lattice vector A`, { structure: make_crystal(4, [[`C`, [0.5, 0.5, 0.5]]]) }, AXIS_COLORS[0][2], `black`, [0, -1]],
])(`%s tooltip background`, (_label, props, bg = ``, text_color = ``, ray_xy = [0, 0]) => {
  const interactivity = spy_interactivity()
  // nothing renders in happy-dom, so the arrow meshes' world matrices need a manual update
  mount_structure({ show_bonds: `never`, ...props }).scene.updateMatrixWorld()
  pointer_at(interactivity(), ...ray_xy, [`pointermove`])
  const { style } = doc_query(`[role="tooltip"]`)
  expect([style.backgroundColor, style.color]).toEqual([bg, text_color])
})

// The hover shell hugs the atom: HOVER_SHELL_SCALE (a hair outside), not a bulkier sphere
test(`hover shell wraps the hovered atom at HOVER_SHELL_SCALE of its radius`, () => {
  const interactivity = spy_interactivity()
  const { scene } = mount_structure({ show_bonds: `never`, structure: lone_c })
  scene.updateMatrixWorld()
  pointer_at(interactivity(), 0, 0, [`pointermove`])
  const atoms = scene
    .getObjectsByProperty(`type`, `Mesh`)
    .find((mesh) => mesh instanceof AtomInstances)
  if (!(atoms instanceof AtomInstances)) throw new Error(`no atom instances`)
  const atom_matrix = new Matrix4()
  atoms.getMatrixAt(0, atom_matrix)
  const atom_scale = new Vector3().setFromMatrixScale(atom_matrix).x
  // the shell: a plain mesh on the shared 0.5-radius sphere, centred on the atom
  const shell = scene
    .getObjectsByProperty(`type`, `Mesh`)
    .find(
      (mesh) =>
        !(mesh instanceof AtomInstances) &&
        mesh.position.length() < 1e-9 &&
        mesh.scale.x > atom_scale,
    )
  // instance matrices are Float32 (eps 1.2e-7): the atom scale reads back to ~2e-8 relative
  expect(shell?.scale.x).toBeCloseTo(HOVER_SHELL_SCALE * atom_scale, 6)
})

// Clicks on atoms (and on bonds in edit-bonds delete mode) drive every selection path
test(`clicks drive measurement, edit-atoms and edit-bonds selections`, () => {
  const interactivity = spy_interactivity()
  const state = $state<SceneProps>({
    measure_mode: `distance`,
    bond_edit_mode: `add`,
    selected_sites: [],
    measured_sites: [],
    added_bonds: [],
  })
  const sites = carbons_at(0, 3, 6)
  // thin bonds, so an atom's cap rises above a delete-mode bond's (5x) hit cylinder
  mount_structure({ structure: { sites }, show_bonds: `never`, bond_thickness: 0.02 }, state)
  const scene_interactivity = interactivity()
  const click = (x_coord: number, init: MouseEventInit = {}) =>
    pointer_at(scene_interactivity, x_coord, 0, undefined, init)
  const shift = { shiftKey: true }
  for (const [mode, clicks, expected] of [
    [`distance`, [[0], [3], [0]], [[0], [0, 1], [1]]],
    [`edit-atoms`, [[0], [3], [6, shift], [3, shift], [6]], [[0], [1], [1, 2], [2], []]],
  ] as const) {
    Object.assign(state, { measure_mode: mode, selected_sites: [], measured_sites: [] })
    flushSync()
    for (const [idx, [x_coord, init]] of clicks.entries()) {
      click(x_coord, init)
      expect(state.selected_sites, `${mode} click ${idx}`).toEqual(expected[idx])
      expect(state.measured_sites).toEqual(expected[idx])
    }
  }
  // A picked pair becomes a bond and the picks clear; a delete-mode click removes it again
  state.measure_mode = `edit-bonds`
  flushSync()
  click(0)
  expect(state.selected_sites).toEqual([0])
  click(3)
  expect(state.added_bonds).toMatchObject([{ site_idx_1: 0, site_idx_2: 1, order: 1 }])
  expect([state.selected_sites, state.measured_sites]).toEqual([[], []])
  // Right-clicking the bond opens its order menu
  pointer_at(scene_interactivity, 1.5, 0, right_click, { button: 2 })
  menu_button(`Double`)?.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
  flushSync()
  expect(state.added_bonds).toMatchObject([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
  expect(document.querySelector(`.bond-context-menu`)).toBeNull()
  // keyboard and screen-reader activation is a bare click (detail 0), no pointer press
  pointer_at(scene_interactivity, 1.5, 0, right_click, { button: 2 })
  menu_button(`Triple`)?.click()
  flushSync()
  expect(state.added_bonds).toMatchObject([{ site_idx_1: 0, site_idx_2: 1, order: 3 }])
  state.bond_edit_mode = `delete`
  flushSync()
  click(1.5)
  expect(state.added_bonds).toEqual([])
  // in delete mode a bond outranks the atom in front of it, which ignores the click
  state.bond_edit_mode = `add`
  flushSync()
  click(0)
  click(3)
  state.bond_edit_mode = `delete`
  flushSync()
  click(0.2) // straight down through atom 0's cap before the bond's hit cylinder
  expect(state.added_bonds).toEqual([])
})

// The add-atom plane sits inside the manual-rotation groups: its hit point is in world space
// and must be mapped back into the structure frame, or a rotated view places atoms elsewhere
test(`add-atom click places the atom in the structure frame of a rotated scene`, () => {
  const interactivity = spy_interactivity()
  const on_add_atom = vi.fn()
  // two carbons along x: the rotation pivot (center of mass) is [1, 0, 0]
  mount_structure({
    structure: { sites: carbons_at(0, 2) },
    show_bonds: `never`,
    measure_mode: `edit-atoms`,
    add_atom_mode: true,
    rotation: [0, 0, Math.PI / 2],
    on_add_atom,
  })
  // world [1, 3] is 3 A along +y of the pivot, i.e. 3 A along +x before the 90 deg z rotation
  pointer_at(interactivity(), 1, 3)
  expect(on_add_atom.mock.calls).toEqual([
    [[4, 0, 0].map((coord) => expect.closeTo(coord, 9)), `C`],
  ])
})

// Reset aims at the content's center as drawn: the scene turns content by `rotation` about
// its pivot (the center of mass), so an off-pivot center moves with it. A heavy I at x = 10
// pulls the pivot to x = 8.49, away from the bounding-box center at x = 5: turned 180 deg about
// y, the drawn center is 8.49 + (8.49 - 5) = 11.98, where an unrotated target left it at 5.
test(`reset target follows a manual rotation of an off-pivot molecule`, () => {
  const bound = $state<SceneProps>({ get_reset_target: undefined, rotation: [0, 0, 0] })
  const structure = {
    sites: [...carbons_at(0, 1), make_site(`I`, [0, 0, 0], [10, 0, 0], `I`)],
  }
  mount_structure({ structure, show_atoms: false }, bound)
  const pivot = get_center_of_mass(structure)?.[0] ?? NaN
  expect(bound.get_reset_target?.()[0]).toBeCloseTo(5, 9)
  bound.rotation = [0, Math.PI, 0]
  flushSync()
  expect(bound.get_reset_target?.()[0]).toBeCloseTo(2 * pivot - 5, 9)
})

// The fit zoom measures content along the camera's view of it as drawn: a 20 A rod along x,
// turned 90 deg about z, stands upright on screen, so a 800x200 viewport fits it by its height
test(`fit zoom measures a rotated rod as drawn`, () => {
  const fit_zoom = (rotation: Vec3): number => {
    const bound = $state<SceneProps>({ initial_computed_zoom: undefined })
    mount_structure(
      {
        structure: { sites: carbons_at(0, 20) },
        rotation,
        width: 800,
        height: 200,
        camera_direction: [0, 0, 1],
      },
      bound,
    )
    return bound.initial_computed_zoom ?? NaN
  }
  const [flat, upright] = [fit_zoom([0, 0, 0]), fit_zoom([0, 0, Math.PI / 2])]
  // the rod spans 4x the viewport's height-limited share once upright
  expect(upright).toBeLessThan(flat / 3)
})

// The bonds binding addresses base sites: a bond picked to an image atom is stored as its base
// site plus a cell shift, never under the image's display index (out of range for the input,
// and another atom once the image set renumbers)
test(`edit-bonds stores a bond to an image atom by base site and cell shift`, () => {
  const interactivity = spy_interactivity()
  const state = $state<{ added_bonds: StructureBond[] }>({ added_bonds: [] })
  // 5.2 A apart: too far for a calculated bond, so the pick adds one
  const { scene } = mount_structure(
    {
      structure: get_pbc_image_sites(nacl(), image_options(`none`)),
      show_bonds: `never`,
      measure_mode: `edit-bonds`,
    },
    state,
  )
  pointer_at(interactivity(), 3, 3) // Cl
  pointer_at(interactivity(), 6, 0) // topmost Na copy on this column, the image at abc [1, 0, 1]
  expect(state.added_bonds).toEqual([
    { site_idx_1: 0, site_idx_2: 1, order: 1, cell_shift: [-1, 0, -1] },
  ])
  // ...yet drawn where it was picked: between Cl and that Na image (and every other copy pair
  // on screen), not from the base Na toward an empty spot outside the cell
  const [bond_mesh] = meshes_of(scene, BondMesh)
  const ends = bond_endpoints(bond_mesh).map((pair) =>
    pair
      .map((point) => point.map((coord) => Math.round(coord)))
      .toSorted((point_a, point_b) => point_a[0] - point_b[0]),
  )
  expect(ends).toContainEqual([
    [3, 3, 3],
    [6, 0, 6],
  ])
  expect(ends.flat().every((point) => point.every((coord) => coord >= 0 && coord <= 6))).toBe(
    true,
  )
})

// An added periodic bond is drawn only between copies on screen: with images off there is none
// (a base-Na copy would end on an empty spot outside the cell), and an image hidden by its
// property value takes its bond with it
test.each([
  [`images shown`, true, false, 1],
  [`images off`, false, false, 0],
  [`the image copy hidden`, true, true, 0],
])(
  `an added periodic bond with %s draws only on-screen copies`,
  (_label, images, hide_image, n_drawn) => {
    const structure = images ? get_pbc_image_sites(nacl(), image_options(`none`)) : nacl()
    // the one Na copy bonded to Cl: the image at abc [1, 0, 1]
    const image_idx = structure.sites.findIndex(
      ({ abc, provenance }) => provenance?.image_of === 0 && abc.join(`,`) === `1,0,1`,
    )
    const values = structure.sites.map((_site, idx) => (idx === image_idx ? 1 : 0))
    const { scene } = mount_structure({
      structure,
      show_bonds: `never`,
      added_bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1, cell_shift: [-1, 0, -1] }],
      property_colors: { colors: values.map(() => `red`), values },
      hidden_prop_vals: new SvelteSet(hide_image ? [1] : []),
    })
    expect(meshes_of(scene, BondMesh)[0]?.count ?? 0).toBe(n_drawn)
  },
)

// The bonds binding hands an added bond back on the structure, so perception reports it as an
// explicit bond. Deleting it must undo the addition alone: read as "also calculated", it was
// recorded as a removal too, leaving an empty override where add + delete should cancel out
test(`deleting an added bond echoed back as an explicit bond leaves no edits`, () => {
  const interactivity = spy_interactivity()
  const added: StructureBond = {
    site_idx_1: 0,
    site_idx_2: 1,
    order: 1,
    cell_shift: [-1, 0, -1],
  }
  const crystal = nacl()
  crystal.properties = { bonds: [added] } // as the session emits it
  const state = $state<SceneProps>({
    added_bonds: [added],
    removed_bonds: [],
    bond_order_overrides: [],
  })
  mount_structure(
    {
      structure: get_pbc_image_sites(crystal, image_options(`none`)),
      show_bonds: `always`,
      measure_mode: `edit-bonds`,
      bond_edit_mode: `delete`,
    },
    state,
  )
  const scene_interactivity = interactivity()
  // mid-bond between Cl at [3, 3, 3] and the Na image at [6, 0, 6]; reordering it edits the
  // addition too, rather than turning it into an override
  pointer_at(scene_interactivity, 4.5, 1.5, right_click, { button: 2 })
  menu_button(`Double`)?.click()
  flushSync()
  expect(state.added_bonds).toEqual([{ ...added, order: 2 }])
  expect(state.bond_order_overrides).toEqual([])
  pointer_at(scene_interactivity, 4.5, 1.5)
  expect([state.added_bonds, state.removed_bonds]).toEqual([[], []])
})

// A site label button selects its atom on a pointer press, and on the bare click (detail 0)
// keyboard and screen-reader activation send; a pointer's own click must not toggle it back
test(`site label buttons select on press and on keyboard or assistive activation`, () => {
  const state = $state<{ selected_sites: number[] }>({ selected_sites: [] })
  mount_structure(
    { structure: { sites: carbons_at(0, 3) }, show_bonds: `never`, show_site_labels: true },
    state,
  )
  const [first, second] = document.querySelectorAll<HTMLButtonElement>(`.atom-label`)
  first.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
  first.dispatchEvent(new MouseEvent(`click`, { bubbles: true, detail: 1 }))
  flushSync()
  expect(state.selected_sites).toEqual([0])
  second.click()
  flushSync()
  expect(state.selected_sites).toEqual([0, 1])
})

// The order menu of a bond drawn to an image atom reads the bond's order by its canonical key
// (base sites + cell shift, as edits store it): the rendered key (image index, no shift)
// matched no edit, so a perceived bond set to triple still said order 1
test(`bond order menu on an image atom's bond shows that bond's edited order`, () => {
  const interactivity = spy_interactivity()
  // O on the x = 0 face gets an image at x = 10, 1.6 A from Si: the perceived bond ends there
  const crystal = make_crystal(10, [
    [`Si`, [0.84, 0.5, 0.5]],
    [`O`, [0, 0.5, 0.5]],
  ])
  mount_structure({
    structure: get_pbc_image_sites(crystal, image_options(`none`)),
    show_bonds: `always`,
    measure_mode: `edit-bonds`,
    bond_order_overrides: [{ site_idx_1: 0, site_idx_2: 1, order: 3, cell_shift: [1, 0, 0] }],
  })
  // mid-bond between Si at x = 8.4 and the O image at x = 10
  pointer_at(interactivity(), 9.2, 5, right_click, { button: 2 })
  expect(doc_query(`.bond-context-menu strong`).textContent).toBe(`Bond Order (3)`)
})

// A delete-mode bond is hit anywhere in its 5x wide invisible cylinder, also under a cutaway,
// where picking raycasts the bond's own strands to skip clipped-away parts. A bond the cutaway
// removes entirely stays unpickable, even where its wide cylinder reaches the kept slab.
const surface_slab = (axis: 0 | 1, position: number, thickness: number): StructureCutaway => ({
  mode: `slab`,
  axis,
  position,
  thickness,
  whole_atoms: false,
  cartesian_to_fractional: new Matrix4(),
})
// oxfmt-ignore
test.each<[string, number, StructureCutaway | undefined, Site[]?, number?]>([
  [`no cutaway`, 0, undefined],
  [`a cutaway keeping its middle`, 0, surface_slab(0, 1.5, 1)],
  [`a cutaway clipping it entirely`, 1, surface_slab(1, 0.3, 0.1)],
  // A whole-atom cutaway draws a center's complete shell, bonds past the slab included, so
  // those stay editable: their hit cylinders used to sit under the slab's clipping. Cl inside
  // the slab (|z| < 0.1) is the center, its Na neighbor 2 A above it, and the click lands
  // straight down onto the bond's midpoint at z ~ 1, outside the slab.
  [`a whole-atom slab past its shell bond`, 0, whole_atom_cutaway(),
    [make_site(`Na`, [0, 0, 0], [3, 0, 2], `Na`), make_site(`Cl`, [0, 0, 0], [0, 0, 0.05], `Cl`)], 0],
])(
  `delete-mode click by a bond with %s leaves %i bonds`,
  (_label, n_bonds, cutaway, sites = carbons_at(0, 3), y_coord = 0.3) => {
    const interactivity = spy_interactivity()
    const state = $state<{ added_bonds: StructureBond[] }>({
      added_bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
    })
    mount_structure(
      {
        structure: { sites },
        show_bonds: `never`,
        bond_thickness: 0.1,
        measure_mode: `edit-bonds`,
        bond_edit_mode: `delete`,
        cutaway,
      },
      state,
    )
    // 0.3 Å beside the bond axis: outside its 0.1 Å radius, inside the 0.5 Å hit radius
    pointer_at(interactivity(), 1.5, y_coord)
    expect(state.added_bonds).toHaveLength(n_bonds)
  },
)

// A keyed hit cylinder outlives thickness changes and bond moves, so its transform must follow
// them: created at 0.02 Å (0.1 Å hit radius) it missed a click 0.3 Å off the axis after the
// slider went to 0.1 Å, and a moved bond stayed pickable only where it was first drawn
test(`delete-mode hit cylinders follow bond thickness and bond moves`, () => {
  const interactivity = spy_interactivity()
  const state = $state<SceneProps>({
    added_bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
    bond_thickness: 0.02,
    structure: { sites: carbons_at(0, 3) },
  })
  mount_structure(
    { show_bonds: `never`, measure_mode: `edit-bonds`, bond_edit_mode: `delete` },
    state,
  )
  const click_at = (x_coord: number) => pointer_at(interactivity(), x_coord, 0.3)
  click_at(1.5)
  expect(state.added_bonds).toHaveLength(1) // 0.3 Å is outside the 0.1 Å hit radius
  state.structure = { sites: carbons_at(10, 13) } // same sites and bond key, new place
  state.bond_thickness = 0.1
  flushSync()
  click_at(1.5)
  expect(state.added_bonds).toHaveLength(1) // nothing is drawn there anymore
  click_at(11.5)
  expect(state.added_bonds).toEqual([])
})

// The hover highlight is a keyed cylinder too: it must follow the bond thickness (a new
// structure, the other way its bond could move, clears the hover)
test(`edit-bonds hover highlight follows bond thickness`, () => {
  const interactivity = spy_interactivity()
  let bond_thickness = $state(0.1)
  const { scene } = mount_structure({
    structure: { sites: carbons_at(0, 3) },
    get bond_thickness() {
      return bond_thickness
    },
    show_bonds: `never`,
    measure_mode: `edit-bonds`,
    bond_edit_mode: `delete`,
    added_bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
  })
  scene.updateMatrixWorld()
  pointer_at(interactivity(), 1.5, 0, [`pointermove`])
  // the translucent highlight: the one raycast-disabled cylinder with an opacity-0.25 material
  const highlight = () => {
    const found: Mesh[] = []
    scene.traverse((object) => {
      const material = object instanceof Mesh ? object.material : undefined
      if (material && `opacity` in material && material.opacity === 0.25)
        found.push(object as Mesh)
    })
    if (found.length !== 1)
      throw new Error(`expected one hover highlight, got ${found.length}`)
    return found[0]
  }
  const radius = () => new Vector3().setFromMatrixColumn(highlight().matrix, 0).length()
  const center_x = () => new Vector3().setFromMatrixPosition(highlight().matrix).x
  expect([radius(), center_x()]).toEqual([expect.closeTo(0.11, 6), expect.closeTo(1.5, 6)])
  bond_thickness = 0.2
  flushSync()
  expect([radius(), center_x()]).toEqual([expect.closeTo(0.22, 6), expect.closeTo(1.5, 6)])
})

// Open cylinders halve the bond triangles; scene bonds close their ends only where one could
// show: hidden, translucent or tiny atoms. A polyhedron center hidden by
// polyhedra_hide_center_atoms drops its sphere but keeps its (thin, so otherwise covered)
// bonds, with or without a whole-atom cutaway (which otherwise renders complete atoms).
test.each<[string, number, SceneProps]>([
  [`default atoms`, 16, {}],
  [`hidden atoms`, 32, { show_atoms: false }],
  [`translucent atoms`, 32, { atom_opacity: 0.5 }],
  [`atoms thinner than the bonds`, 32, { atom_radius: 0.1 }],
  ...[false, true].flatMap((hide_centers) =>
    [false, true].map((slab): [string, number, SceneProps] => [
      `SiO4 centers hidden=${hide_centers} in whole-atom slab=${slab}`,
      hide_centers ? 32 : 16,
      {
        structure: sio4(),
        show_polyhedra: `always`,
        polyhedra_hide_center_atoms: hide_centers,
        bond_thickness: 0.05,
        cutaway: slab ? whole_atom_cutaway() : undefined,
      },
    ]),
  ),
])(`Scene bonds with %s draw %i triangles per cylinder`, (_label, triangles, props) => {
  const { scene } = mount_structure({
    structure: {
      sites: carbons_at(0, 1.4),
    },
    show_bonds: `always`,
    show_polyhedra: `never`,
    ...props,
  })
  const [mesh] = meshes_of(scene, BondMesh)
  expect(mesh?.count).toBe(props.structure ? 4 : 1)
  expect(mesh?.geometry.index?.count).toBe(triangles * 3)
})

// Two C 1.4 Å apart through the x face of a 10 Å cell, bonded only via site 1's image
const periodic_pair = () => {
  const structure = carbon_crystal(10, [0.07, 0.5, 0.5], [0.93, 0.5, 0.5])
  const bond: BondPair = {
    site_idx_1: 0,
    site_idx_2: 1,
    pos_1: [0.7, 5, 5],
    pos_2: [-0.7, 5, 5],
    bond_length: 1.4,
    cell_shift: [-1, 0, 0],
  }
  cache_prepared_bonds(structure, `electroneg_ratio`, {}, [bond])
  return structure
}

// A distance line as thick as the bond hid a bonded pair's double or triple bond: a measured
// drawn bond is tinted strand by strand instead (side by side, at its own thickness); an unbonded
// pair, or one whose bond is computed (for polyhedra) but not drawn, gets a single thin line, as
// does a pair whose only bond runs through a cell face to the other's image
test.each<[string, number[], BondOrder, SceneProps, number]>([
  [`single bond`, [0, 1], 1, {}, 1],
  [`double bond`, [0, 1], 2, {}, 2],
  [`triple bond`, [0, 1], 3, {}, 3],
  [`unbonded pair`, [0, 2], 1, {}, 0],
  [`hidden bond`, [0, 1], 2, { show_bonds: `never`, show_polyhedra: `always` }, 0],
  [
    `pair bonded via an image`,
    [0, 1],
    1,
    { structure: periodic_pair(), show_cell_vectors: false },
    0,
  ],
])(
  `distance measurement of a %s tints %i bond strands (0: one line)`,
  (_label, measured_sites, order, props, strands) => {
    const { scene } = mount_structure({
      structure: {
        sites: carbons_at(0, 1.3, 6),
        properties: { bonds: [{ site_idx_1: 0, site_idx_2: 1, order }] },
      },
      show_bonds: `always`,
      show_polyhedra: `never`,
      measure_mode: `distance`,
      measured_sites,
      ...props,
    })
    scene.updateMatrixWorld()
    const measure_lines = measure_cylinders(scene)
    const bonded = strands > 0
    expect(measure_lines).toHaveLength(bonded ? strands : 1)
    // strands sit side by side across the bond axis (x), not stacked on one line
    const strand_offsets = new Set(measure_lines.map(({ position }) => position.z.toFixed(3)))
    expect(strand_offsets.size).toBe(measure_lines.length)
    // a bond's tint pulses with the selected atoms (twice their 10-20% opacity), a line is solid
    for (const material of measure_lines.flatMap((mesh) => [mesh.material].flat())) {
      expect(material.transparent).toBe(bonded)
      expect(material.opacity).toBeGreaterThanOrEqual(bonded ? 0.2 : 1)
      expect(material.opacity).toBeLessThanOrEqual(bonded ? 0.4 : 1)
    }
    // an unbonded pair's line is thinner than any bond
    if (!bonded) expect(measure_lines[0]?.scale.x).toBe(0.035)
    expect(document.querySelector(`.measure-label`)?.textContent?.trim()).toMatch(/\d.*Å$/)
  },
)

// Angle mode labels every angle of the picked triangle, not just the second pick's, and marks
// each with an arc between its two edges so the number can't be read against the wrong pair. A
// triangle straddling a cell face is unwrapped once, so its edges and arcs meet at its corners.
test.each<[string, SceneProps, number[], number]>([
  [
    `molecule`,
    {
      structure: {
        sites: [...carbons_at(0, 1.3), make_site(`C`, [0, 0, 0], [0, 2, 0], `C`)],
        properties: { bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2 }] },
      },
    },
    [90, 57, 33], // at the right-angle corner, site 0, then the others (one decimal)
    4, // edges: the double bond's two tinted strands plus two thin lines to the third pick
  ],
  [
    `triangle across a cell face`,
    {
      structure: carbon_crystal(10, [0.1, 0.5, 0.5], [0.9, 0.5, 0.5], [0.95, 0.7, 0.5]),
      show_bonds: `never`,
      show_cell_vectors: false,
    },
    [53.1, 76, 50.9],
    3,
  ],
  // the two 0° end corners of a collinear triangle get no label, and the 180° one no arc
  [
    `collinear triangle`,
    {
      structure: {
        sites: carbons_at(0, 1.3, 2.6),
      },
      show_bonds: `never`,
    },
    [180],
    3,
  ],
])(
  `angle measurement of a %s labels its angles, arcing every bent one`,
  (_label, props, expected, n_edges) => {
    const { scene } = mount_structure({
      show_bonds: `always`,
      show_polyhedra: `never`,
      measure_mode: `angle`,
      measured_sites: [0, 1, 2],
      ...props,
    })
    const angles = [...document.querySelectorAll(`.measure-label`)].map((label) =>
      Number(label.textContent?.replace(`°`, ``)),
    )
    expect(angles).toEqual(expected)
    const meshes = scene.getObjectsByProperty(`type`, `Mesh`) as Mesh[]
    const arcs = meshes.filter(({ geometry }) => geometry instanceof TubeGeometry)
    expect(arcs).toHaveLength(expected.filter((angle) => angle !== 180).length)
    const edges = measure_cylinders(scene)
    expect(edges).toHaveLength(n_edges)
    // one closed triangle: no edge drawn at a corner's in-cell copy on the far side of the box
    const edge_xs = edges.map(({ position }) => position.x)
    expect(Math.max(...edge_xs) - Math.min(...edge_xs)).toBeLessThan(3)
  },
)

// A torsion straddling a cell face draws its three bonds as short nearest-image hops, labelled
// with the torsion measured from those same hops
test(`dihedral measurement across a cell face`, () => {
  const structure = carbon_crystal(
    10,
    [0.95, 0.6, 0.5],
    [0.95, 0.5, 0.5],
    [0.05, 0.5, 0.5],
    [0.05, 0.5, 0.6],
  )
  const { scene } = mount_structure({
    structure,
    show_bonds: `never`,
    show_cell_vectors: false,
    measure_mode: `dihedral`,
    measured_sites: [0, 1, 2, 3],
  })
  const edges = measure_cylinders(scene)
  expect(edges.map(({ scale }) => scale.y)).toEqual(
    [1, 1, 1].map((len) => expect.closeTo(len, 9)),
  )
  // signed like the raw picks measure under PBC (here a clockwise quarter turn)
  const [pos_1, pos_2, pos_3, pos_4] = structure.sites.map(({ xyz }) => xyz)
  const torsion = dihedral_angle(pos_1, pos_2, pos_3, pos_4, structure.lattice.matrix)
  expect(Math.abs(torsion)).toBeCloseTo(90, 9)
  expect(document.querySelector(`.measure-label`)?.textContent?.trim()).toBe(
    `${format_num(torsion, `.1~f`)}°`,
  )
})

// A site and its own image are a lattice vector apart, not 0 Å (the minimum image of a lattice
// translation); a pair across a cell face reports its nearest image beside the drawn distance
test.each([
  [`a site and its own image`, carbon_crystal(3, [0, 0, 0], [1, 0, 0]), /^3 Å$/],
  [
    `a pair across a cell face`,
    carbon_crystal(10, [0.05, 0.5, 0.5], [0.95, 0.5, 0.5]),
    /^PBC: 1 Å\s*Direct: 9 Å$/,
  ],
])(`distance label of %s`, (_label, structure, expected) => {
  mount_structure({
    structure,
    show_bonds: `never`,
    measure_mode: `distance`,
    measured_sites: [0, 1],
  })
  expect(document.querySelector(`.measure-label`)?.textContent?.trim()).toMatch(expected)
})

// Depth-tested arcs inside a big vertex atom would be hidden: each clears its own atom's surface
test(`angle arcs clear their vertex atoms`, () => {
  // drawn radius (half the atomic radius x atom_radius) plus 0.2 Å, past 31% of the 1.6 Å edge
  // oxfmt-ignore
  const corners: [ElementSymbol, Vec3, number][] = [
    [`Si`, [1.6, 0, 0], 1.1], [`O`, [0, 0, 0], 0.6], [`Si`, [0, 1.6, 0], 1.1],
  ]
  const { scene } = mount_structure({
    structure: { sites: corners.map(([elem, xyz]) => make_site(elem, [0, 0, 0], xyz, elem)) },
    show_bonds: `never`,
    atom_radius: 2,
    measure_mode: `angle`,
    measured_sites: [0, 1, 2],
  })
  const arc_starts = (scene.getObjectsByProperty(`type`, `Mesh`) as Mesh[]).flatMap(
    ({ geometry }) =>
      geometry instanceof TubeGeometry ? [geometry.parameters.path.getPoint(0)] : [],
  )
  expect(
    arc_starts.map((start, idx) => start.distanceTo(new Vector3(...corners[idx][1]))),
  ).toEqual(corners.map(([, , atomic_radius]) => expect.closeTo(atomic_radius + 0.2, 6)))
})

// Mixed-valence sites (pymatgen Fe2+/Fe3+) list one element twice at partial occupancy: drawn as
// one full atom like plain Fe (no seamed half wedges)
test(`Scene draws a mixed-valence site as one full atom`, () => {
  const { scene } = mount_structure({
    structure: { sites: [fe_mixed_site] },
    show_bonds: `never`,
  })
  const wedge_groups: PartialAtoms[] = []
  scene.traverse((object) => {
    if (object instanceof PartialAtoms) wedge_groups.push(object)
  })
  expect([sphere_count(scene), wedge_groups]).toEqual([1, []])
})

// A completion copy draws only while it ends a drawn bond or corners a drawn polyhedron: the 6
// Ti copies completing the face O bonds of body-centered SrTiO3 hide with the bonds, though
// polyhedra still draw (the Ti octahedron sits inside the cell)
test.each([
  [`always`, `crystals`, 21],
  [`never`, `crystals`, 15],
  [`never`, `never`, 15],
] as const)(
  `Scene with bonds %s, polyhedra %s draws %i atoms`,
  (show_bonds, show_polyhedra, n_atoms) => {
    const structure = get_pbc_image_sites(make_srtio3(`body`), image_options(`boundary`))
    expect(structure.sites.filter((site) => site.provenance?.completion)).toHaveLength(6)
    const { scene } = mount_structure({ structure, show_bonds, show_polyhedra })
    expect(sphere_count(scene)).toBe(n_atoms)
  },
)

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
    const frame = md_frame([0, 0, 0, 1, 0, 0], [6, 8])
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
  const state = $state({ bond_color: `gray` })
  mount_structure(
    {
      get structure() {
        return structure
      },
      show_atoms: false,
      show_bonds: `always`,
      show_polyhedra: `never`,
      bonding_options: {},
      interactive: false,
    },
    state,
  )
  expect(received_colors).toHaveLength(1)
  structure = make_structure()
  flushSync()
  expect(received_colors).toHaveLength(1)
  colors.element.O = `#123456`
  flushSync()
  expect(received_colors).toHaveLength(2)
  expect(received_colors[1][1]).toBe(`#123456`)
  state.bond_color = `white`
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
  const state = $state({ site_colors: [`red`, `red`], thickness: 0.1 })
  const props = {
    get bonds() {
      return bonds
    },
    ambient_light: 0.7,
    directional_light: 0.3,
  }
  const { scene, unmount_scene } = mount_scene((anchor) =>
    Bond(anchor, bind_props(props, state)),
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
    const order = vi.spyOn(bonds, `order`)
    flushSync()
    expect(mesh.count).toBe(count)
    expect(order).not.toHaveBeenCalled()
    expect(mesh.geometry.getAttribute(`instanceColorStart`)).toBe(colors_start)
  }
  const rgb = (color: string) => css_to_linear_rgb(color).map(Math.fround)
  for (const palette of [
    [`red`, `blue`],
    [`green`, `green`],
    [`blue`, `red`],
    [`red`, `red`],
  ]) {
    state.site_colors = palette
    flushSync()
    for (const [buffer, color] of [
      [colors_start, palette[0]],
      [colors_end, palette[1]],
    ] as const)
      expect(Array.from(buffer.array)).toEqual(Array(3).fill(rgb(color)).flat())
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
  state.site_colors = [`lime`, `lime`]
  flushSync()
  upload_colors()
  bonds = make_frame(3)
  flushSync()
  upload_colors()
  expect(uploaded).toEqual(colors_start.array)

  bonds = make_frame(2, true)
  state.site_colors = [`red`, `red`, `red`, `red`]
  flushSync()
  upload_colors()
  flushSync(() => {
    state.site_colors[0] = `lime`
  })
  flushSync(() => {
    state.site_colors[2] = `blue`
  })
  upload_colors()
  expect(uploaded).toEqual(colors_start.array)
  // In-place palette edits recolor even though the bonds and palette array are unchanged
  const recolored = Array.from(colors_start.array.subarray(0, 6))
  expect(recolored).toEqual([`lime`, `blue`].flatMap(rgb))
  // An identical bond topology with an identical palette skips the per-cylinder loop
  bonds = make_frame(2, true)
  const order = vi.spyOn(bonds, `order`)
  flushSync()
  expect(order).not.toHaveBeenCalled()
  const uploads = update.mock.calls.length
  const centers = mesh.centers.array.slice()
  for (const value of [-0.2, 0, 0.2]) {
    state.thickness = value
    flushSync()
    expect(mesh.thickness).toBe(value)
    expect(update).toHaveBeenCalledTimes(uploads)
    expect(mesh.centers.array).toEqual(centers)
  }
  // A uniform but incomplete palette must still report the absent endpoint color.
  state.site_colors = [`red`]
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
  const bound = $state<SceneProps>({ get_reset_target: undefined })
  onTestFinished(() => update_atoms.mockRestore())
  onTestFinished(() => fit_bounds.mockRestore())
  const props: SceneProps = {
    get structure() {
      return structure
    },
    get render_token() {
      return structure
    },
    on_rendered,
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
    interactive: false,
  }
  const { scene, render_frame } = mount_structure(props, bound)
  expect(on_rendered).not.toHaveBeenCalled()
  render_frame()
  expect(on_rendered).toHaveBeenCalledExactlyOnceWith(untrack(() => structure))
  render_frame()
  expect(on_rendered).toHaveBeenCalledOnce()
  const [atoms] = meshes_of(scene, AtomInstances)
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
  expect(bound.get_reset_target?.()[1]).toBe(2)
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

  // Source properties with image/completion names must not change rendered atom identity.
  const view = new FrameView()
  property_colors = null
  carbon_radius = 3 // Start a numeric render group with its own topology identity.
  const cases: {
    scalar_columns?: Record<string, Float64Array>
    shown?: number[]
    image?: boolean
    generic?: boolean
    provenance?: Site[`provenance`]
  }[] = [
    {},
    {},
    { scalar_columns: { completion_image: new Float64Array([1, 0, 0]) } },
    { scalar_columns: { completion_image: new Float64Array([1, 0, 0]) } },
    {},
    { scalar_columns: { orig_site_idx: new Float64Array([0, 1, 2]) } },
    {},
    { provenance: { image_of: 0, completion: true }, shown: [1, 2] },
    { provenance: { image_of: 0 }, image: true },
    { generic: true },
    {},
    {},
  ]
  for (const [
    frame_idx,
    { scalar_columns, shown = [0, 1, 2], image = false, generic, provenance },
  ] of cases.entries()) {
    const frame = md_frame(
      [0, frame_idx, 0, 2, frame_idx, 0, 3, frame_idx, 0],
      [6, 8, 1],
      frame_idx,
    )
    frame.scalar_columns = scalar_columns
    const snapshot = frame.coordinates.slice()
    const next = view.update(frame).structure
    // An editable copy drops snapshot identity; the next validated frame adopts it again.
    structure = generic ? { ...next, sites: next.sites } : next
    if (provenance) {
      structure = { ...next, sites: next.sites.map((site) => ({ ...site })) }
      if (provenance.completion) structure.sites[0].provenance = provenance
      else for (const site of structure.sites) site.provenance = provenance
    }
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
  // oxfmt-ignore
  const vertices: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, -1, -1]]
  const poly: Polyhedron = {
    center_site_idx: 0,
    center_orig_idx: 0,
    center_element: `Mg`,
    volume: 1,
    vertices,
    vertex_site_idxs: [1, 2, 3, 4],
    // oxfmt-ignore
    faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
  }
  const frame = md_frame([0, 0, 0, ...vertices.flat()], [12, 8, 1, 8, 1])
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
  const state = $state<SceneProps>({
    polyhedra_color_mode: `uniform`,
    polyhedra_show_edges: false,
    show_polyhedra: `always`,
    defer_expensive_geometry: false,
  })
  const property_colors = { colors: [`red`, `blue`], values: [0, 1, 2, 1, 2] }
  const props: SceneProps = {
    structure,
    property_colors,
    show_atoms: false,
    show_bonds: `never`,
    gizmo: false,
    interactive: false,
    polyhedra_color: `yellow`,
  }
  const { scene, unmount_scene } = mount_scene((anchor) =>
    StructureScene(anchor, bind_props(props, state)),
  )
  const disposal = vi.fn()
  const face_disposal = vi.fn()
  try {
    flushSync() // Initial camera fitting may inspect sites; subsequent colors must not.
    get_site.mockClear()
    expect(scene.getObjectByProperty(`isLineSegments2`, true)).toBeUndefined()
    state.polyhedra_show_edges = true
    flushSync()
    const edges = scene.getObjectByProperty(`isLineSegments2`, true)
    const faces = polyhedra_faces(scene)
    if (!(edges instanceof LineSegments2) || !faces)
      throw new Error(`Expected polyhedra faces and outlines`)
    edges.material.addEventListener(`dispose`, disposal)
    const face_geometry = faces.geometry
    face_geometry.addEventListener(`dispose`, face_disposal)
    for (const value of [`vertex`, `center`, `uniform`] as const) {
      state.polyhedra_color_mode = value
      flushSync()
      expect(scene.getObjectById(edges.id)).toBe(edges)
      // vertex sites 1-4 alternate O (odd) / H (even), see the atomic numbers above
      const site_color = (site_idx: number) =>
        property_colors.colors[site_idx] ??
        colors.element?.[site_idx % 2 === 1 ? `O` : `H`] ??
        `#808080`
      const expected = merge_polyhedra_buffers(
        [poly],
        value === `uniform` ? { mode: value, color: `yellow` } : { mode: value, site_color },
      )
      // recoloring rewrites the same face geometry in place rather than rebuilding it
      expect(faces.geometry).toBe(face_geometry)
      expect(face_geometry.drawRange.count).toBe(expected.triangle_count * 3)
      expect(face_geometry.getAttribute(`color`).array).toEqual(expected.colors)
      expect(face_geometry.getAttribute(`normal`).array).toEqual(expected.normals)
      expect(get_site).not.toHaveBeenCalled()
    }
    for (const visible of [false, true]) {
      state.polyhedra_show_edges = visible
      flushSync()
      expect(edges.visible).toBe(visible)
      state.show_polyhedra = `never`
      flushSync()
      expect(scene.getObjectById(edges.id)).toBeUndefined()
      state.show_polyhedra = `always`
      flushSync()
      expect(scene.getObjectById(edges.id)).toBe(edges)
      expect(edges.visible).toBe(visible)
      expect(disposal).not.toHaveBeenCalled()
      expect(face_disposal).not.toHaveBeenCalled()
    }
    // Deferred geometry keeps the last hulls while their inputs change
    Object.assign(state, { defer_expensive_geometry: true, show_polyhedra: `never` })
    flushSync()
    expect(scene.getObjectById(edges.id)).toBe(edges)
    state.defer_expensive_geometry = false
    flushSync()
    expect(scene.getObjectById(edges.id)).toBeUndefined()
  } finally {
    await unmount_scene()
  }
  expect(disposal).toHaveBeenCalledOnce()
  expect(face_disposal).toHaveBeenCalledOnce()
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

// Whole-atom mode selects sites instead of clipping their atoms, bonds and polyhedra, but
// per-site overlays (force arrows here) must keep the slice's surface clip, and every kept
// atom keeps its label, including the shell endpoints outside the slice
test(`whole-atom cutaway unclips shells but keeps overlays clipped and endpoint labels`, () => {
  const { scene } = mount_structure({
    structure: sio4({ force: [0.5, 0, 0] }),
    show_bonds: `always`,
    show_polyhedra: `always`,
    show_site_labels: true,
    cutaway: whole_atom_cutaway(),
  })
  const clipped = (object: Object3D): boolean => {
    for (let node = object.parent; node; node = node.parent) {
      if (node instanceof StructureCutawayGroup) return node.enabled
    }
    throw new Error(`${object.type} has no cutaway group`)
  }
  const [atoms, bonds, arrows] = [
    meshes_of(scene, AtomInstances),
    meshes_of(scene, BondMesh),
    meshes_of(scene, ArrowMesh),
  ]
  const polyhedra = polyhedra_faces(scene)
  expect([atoms.length, bonds.length]).toEqual([1, 1])
  expect(arrows.length).toBeGreaterThan(0) // shafts and heads
  expect(polyhedra).toBeDefined()
  expect([...atoms, ...bonds].map(clipped)).toEqual([false, false])
  if (polyhedra) expect(clipped(polyhedra)).toBe(false)
  expect(arrows.every(clipped)).toBe(true)
  // Si center plus its 4 O shell endpoints, all outside the 0.2 thick slab but Si
  expect(document.querySelectorAll(`.site-label`)).toHaveLength(5)
})

// A periodic bond is stored once, from site_idx_1's own position to an image of site_idx_2.
// When only site_idx_2 is a selected center, the shell bond must start at the center itself
// (drawing the stored copy put a stray atom and a ghost center across the cell instead).
// oxfmt-ignore
test.each([
  { case: `center at site_idx_2 only`, z_1: 3, bonds_z: [[0.05, -1]] },
  { case: `both ends are centers`, z_1: -0.05, bonds_z: [[-0.05, 4.05], [0.05, -4.05]] },
])(`whole-atom shell bonds with a periodic bond: $case`, ({ z_1, bonds_z }) => {
  // Cl image one 4 A cell up from its own position at z = 0.05
  const pos_2: Vec3 = [0, 0, 4.05]
  const structure = {
    sites: [
      make_site(`Na`, [0, 0, 0], [0, 0, z_1], `Na0`),
      make_site(`Cl`, [0, 0, 0], [0, 0, 0.05], `Cl1`),
    ],
  }
  const bond: BondPair = {
    site_idx_1: 0,
    site_idx_2: 1,
    pos_1: [0, 0, z_1],
    pos_2,
    bond_length: pos_2[2] - z_1,
    cell_shift: [0, 0, 1],
  }
  cache_prepared_bonds(structure, `electroneg_ratio`, {}, [bond])
  const { scene } = mount_structure({
    structure,
    show_bonds: `always`,
    show_polyhedra: `never`,
    cutaway: whole_atom_cutaway(),
    // both drawn copies of one periodic bond get a hit cylinder (they once shared its key)
    measure_mode: `edit-bonds`,
  })
  const [bond_mesh] = meshes_of(scene, BondMesh)
  if (!bond_mesh) throw new Error(`no bond mesh rendered`)
  // Each bond's two ends on the z axis, in either order
  const on_axis = (z_coord: number) => [0, 0, z_coord].map((val) => expect.closeTo(val, 6))
  const drawn = bond_endpoints(bond_mesh)
  expect(drawn).toHaveLength(bonds_z.length)
  expect(drawn).toEqual(
    expect.arrayContaining(bonds_z.map((ends) => expect.arrayContaining(ends.map(on_axis)))),
  )
})

// A shell neighbor reached through a periodic bond is placed twice: at the bond's stored
// endpoint and at the polyhedron vertex center + (pos_2 - pos_1). Those differ by an ulp
// (0.2 + (0.9 - 0.2) = 0.8999999999999999), which must not draw a second coincident sphere.
test.each([`center first`, `center second`])(
  `whole-atom shells draw one sphere per neighbor despite ulp-different positions (%s)`,
  (order) => {
    const center: Vec3 = [0.2, 0.2, 0]
    // Literal coordinates: built as center + offset they would round-trip exactly
    // oxfmt-ignore
    const images: Vec3[] = [[0.9, 0.9, 0.7], [0.9, -0.5, -0.7], [-0.5, 0.9, -0.7], [-0.5, -0.5, 0.7]]
    const below = ([x_coord, y_coord, z_coord]: Vec3): Vec3 => [x_coord, y_coord, z_coord - 4]
    // Real O positions one 4 A cell down, far outside the slab: reached only via the bonds
    const structure = {
      sites: [
        make_site(`Ti`, [0, 0, 0], center, `Ti0`),
        ...images.map((image, idx) => make_site(`O`, [0, 0, 0], below(image), `O${idx}`)),
      ],
    }
    const bonds = images.map((image, idx): BondPair => {
      const [site_idx_1, site_idx_2, pos_1, pos_2, shift] =
        order === `center first`
          ? ([0, idx + 1, center, image, 1] as const)
          : ([idx + 1, 0, below(image), below(center), -1] as const)
      return {
        site_idx_1,
        site_idx_2,
        pos_1,
        pos_2,
        bond_length: 1.21,
        cell_shift: [0, 0, shift],
      }
    })
    cache_prepared_bonds(structure, `electroneg_ratio`, {}, bonds)
    const { scene } = mount_structure({
      structure,
      show_bonds: `always`,
      show_polyhedra: `always`,
      cutaway: whole_atom_cutaway(),
    })
    expect(sphere_count(scene)).toBe(5) // Ti plus its 4 O images
  },
)

// Movie configs set visuals.cutaway as plain JSON, without a transform: the scene slices the
// structure's own cell instead of crashing on the missing cartesian_to_fractional
test.each([false, true])(
  `a JSON cutaway (whole_atoms=%s) slices the structure's cell`,
  (whole_atoms) => {
    const structure = make_crystal(4, [
      [`Fe`, [0, 0, 0.5]],
      [`Fe`, [0, 0, 0.1]],
    ])
    const { scene } = mount_structure({
      structure,
      show_bonds: `never`,
      show_polyhedra: `never`,
      cutaway: { mode: `slab`, axis: 2, position: 0.5, thickness: 0.2, whole_atoms },
    })
    // Whole-atom mode keeps only the selected z = 0.5 atom; surface mode clips the cell's atoms
    if (whole_atoms) expect(sphere_count(scene)).toBe(1)
    else
      expect(
        meshes_of(scene, AtomInstances).flatMap((mesh) => cutaway_planes(mesh)),
      ).toHaveLength(2)
  },
)

test(`Scene marks a volumetric slice plane with a translucent fan fill and a closed outline`, () => {
  // oxfmt-ignore
  const square: Vec3[] = [[0, 0, 1], [2, 0, 1], [2, 2, 1], [0, 2, 1]]
  const state = $state({ slice_polygon: square })
  const { scene } = mount_carbon(state)
  const plane_meshes = () => ({
    outlines: scene.getObjectsByProperty(`type`, `Line`) as Mesh[],
    fill: (scene.getObjectsByProperty(`type`, `Mesh`) as Mesh[]).find(
      (mesh) => mesh.renderOrder === 1000,
    ),
  })
  const { outlines, fill } = plane_meshes()
  // the corners plus the first again, closing the outline by hand
  const closed = [...square, square[0]].flat()
  expect([...outlines[0].geometry.getAttribute(`position`).array]).toEqual(closed)
  expect([...(fill?.geometry.index?.array ?? [])]).toEqual([0, 1, 2, 0, 2, 3])
  expect(fill?.material).toMatchObject({ transparent: true, opacity: 0.4, depthWrite: false })

  // a new polygon rebuilds and releases the old buffers; fewer than 3 corners draw nothing
  const dispose = fill && vi.spyOn(fill.geometry, `dispose`)
  state.slice_polygon = square.slice(0, 3)
  flushSync()
  expect(dispose).toHaveBeenCalledOnce()
  state.slice_polygon = square.slice(0, 2)
  flushSync()
  expect(plane_meshes()).toEqual({ outlines: [], fill: undefined })
})

// The hovered-atom tooltip is on by default, a snippet appends rows below the site info and
// false hides it
const extra_row = createRawSnippet(() => ({ render: () => `<div class="extra-row">x</div>` }))
test.each([
  [`default`, undefined, true, false],
  [`snippet`, extra_row, true, true],
  [`false`, false, false, false],
] as const)(`%s atom tooltip: site info %s, extra row %s`, (_label, tooltip, info, extra) => {
  mount_carbon({ active_sites: [0], hovered_idx: 0, tooltip })
  expect(document.querySelector(`.coordinates`) !== null).toBe(info)
  expect(document.querySelector(`.extra-row`) !== null).toBe(extra)
})

// THREE.Color cannot parse the default CSS-variable color: it warned and kept the old color
test(`active-site highlights resolve the CSS color token where the canvas sits`, () => {
  const warn = vi.spyOn(console, `warn`)
  const state = $state({ active_sites: [] as number[] })
  const { canvas, scene } = mount_carbon(state)
  const host = document.createElement(`div`)
  host.style.setProperty(`--struct-active-highlight-color`, `rgb(255, 0, 0)`)
  host.append(canvas)
  document.body.append(host)
  state.active_sites = [0]
  flushSync()
  const highlight_colors: string[] = []
  scene.traverse((object) => {
    const { material } = object as { material?: { depthTest?: boolean; color?: Color } }
    if (material?.depthTest === false && material.color) {
      highlight_colors.push(material.color.getHexString())
    }
  })
  expect(highlight_colors).toContain(`ff0000`)
  expect(warn.mock.calls.flat().join(` `)).not.toContain(`Unknown color model`)
})

// Stepping a series carries the camera by the offset its orbit pivot moved: a 4 Å → 5 Å cell
// moves the cell center +0.5 Å on each axis, H2 → O2 moves the center of mass +5 Å along x.
// A new series, a fixed-cell MD frame, the user's own edits and a camera flight leave the
// camera; an active orbit holds the follow until it ends. It follows from the live camera,
// which auto-rotate moves without syncing the props. A cell that grew out of the view (a
// supercell) is framed afresh on its own center, seen along the live view direction; a few
// percent (an NPT step) keeps the zoom, also the user's own, and a hidden viewer only follows.
type FollowStep = {
  from?: AnyStructure
  to: AnyStructure
  series?: string
  measure_mode?: MeasureMode
  orbiting?: boolean
  live?: Vec3
  clear_target?: boolean
  flight?: boolean
  zoom?: number // scales the live orthographic zoom first (< 1: the user zoomed out)
  projection?: CameraProjection
  hidden?: boolean // the viewer shrinks to 0x0 before the step
  direction?: Vec3 // the camera_direction prop, the view the initial zoom was fitted along
}
const follow_crystal = (edge: number, moved = false): AnyStructure =>
  make_crystal(edge, [[`Fe`, [moved ? 0.3 : 0, 0, 0]]])
// the 4 Å cell doubled along one axis
const doubled_along = (axis: number): AnyStructure =>
  make_crystal(
    [0, 1, 2].map((row) =>
      [0, 1, 2].map((col) => (row !== col ? 0 : row === axis ? 8 : 4)),
    ) as [Vec3, Vec3, Vec3],
    [[`Fe`, [0, 0, 0]]],
  )
const oxygen_dimer = (x_coord: number): AnyStructure => ({
  sites: [x_coord, x_coord + 1].map((x_pos) => make_site(`O`, [0, 0, 0], [x_pos, 0, 0], `O`)),
})
// oxfmt-ignore
test.each<[string, FollowStep, Vec3 | `reframe`]>([
  [`a new cell in the series`, { to: follow_crystal(4.2) }, [0.1, 0.1, 0.1]],
  [`a fixed-cell MD frame`, { to: follow_crystal(4, true) }, [0, 0, 0]],
  [`a new series`, { to: follow_crystal(4.2), series: `other` }, [0, 0, 0]],
  [`an atom edit`, { to: follow_crystal(4.2), measure_mode: `edit-atoms` }, [0, 0, 0]],
  [`a new cell mid-orbit`, { to: follow_crystal(4.2), orbiting: true }, [0.1, 0.1, 0.1]],
  [`a new cell while auto-rotating`, { to: follow_crystal(4.2), live: [2, 2, 14] }, [0.1, 0.1, 0.1]],
  [`a new cell after the target was cleared`, { to: follow_crystal(4.2), clear_target: true }, [0.1, 0.1, 0.1]],
  [`a new cell during a camera flight`, { to: follow_crystal(4.2), flight: true }, [0, 0, 0]],
  [`a molecule of the same size`, { from: oxygen_dimer(0), to: oxygen_dimer(5) }, [5, 0, 0]],
  [`a cell far larger than the fit`, { to: follow_crystal(12), live: [2, 14, 2] }, `reframe`],
  // a 2x2x2 supercell overflows the fitted view, unless the user had zoomed out to fit it; an
  // NPT-sized step keeps a zoomed-in view, and a hidden (0x0) viewer only follows
  [`a doubled cell`, { to: follow_crystal(8), live: [2, 14, 2] }, `reframe`],
  [`a doubled cell in perspective`, { to: follow_crystal(8), live: [2, 14, 2], projection: `perspective` }, `reframe`],
  [`a doubled cell in a zoomed-out view`, { to: follow_crystal(8), zoom: 0.3 }, [2, 2, 2]],
  [`a 5% larger cell in a zoomed-in view`, { to: follow_crystal(4.2), zoom: 2 }, [0.1, 0.1, 0.1]],
  [`a doubled cell in a hidden viewer`, { to: follow_crystal(8), hidden: true }, [2, 2, 2]],
  // measured along the live view: doubling the axis looked down (c, or the up axis b) grows
  // nothing on screen; doubling c seen from the side, after a fit looking down c, overflows
  [`a cell doubled along the line of sight`, { to: doubled_along(2), live: [2, 2, 14] }, [0, 0, 2]],
  [`a cell doubled along the up axis seen down it`, { to: doubled_along(1), live: [2, 14, 2] }, [0, 2, 0]],
  [`a cell doubled across an orbited view`,
    { to: doubled_along(2), live: [14, 2, 2], direction: [0, 0, 1] }, `reframe`],
])(`camera follow on %s`, (_label, step, offset) => {
  const pose: { target: Vec3; position: Vec3 } = { target: [2, 2, 2], position: [12, 7, 9] }
  const state = $state<{
    structure: AnyStructure
    series_key: string
    measure_mode: MeasureMode
    camera_is_moving: boolean
    camera_target?: Vec3
    camera_position: Vec3
    camera?: SceneProps[`camera`]
    width: number
    height: number
  }>({
    structure: step.from ?? follow_crystal(4),
    series_key: `series`,
    measure_mode: `distance`,
    camera_is_moving: false,
    camera_target: pose.target,
    camera_position: pose.position,
    camera: undefined,
    width: 800,
    height: 600,
  })
  const { canvas } = mount_structure(
    {
      show_bonds: `never`,
      camera_projection: step.projection ?? `orthographic`,
      camera_direction: step.direction,
    },
    state,
  )
  expect(state.camera_target).toEqual(pose.target)
  if (step.live) state.camera?.position.set(...step.live)
  if (step.zoom && state.camera instanceof OrthographicCamera) state.camera.zoom *= step.zoom
  // Å per pixel at the target: an orthographic zoom's inverse, a perspective camera's distance
  const view_scale = () =>
    state.camera instanceof OrthographicCamera
      ? 1 / state.camera.zoom
      : (state.camera?.position.distanceTo(
          new Vector3(...(state.camera_target ?? pose.target)),
        ) ?? Number.NaN)
  const scale_before = view_scale()
  if (step.hidden) Object.assign(state, { width: 0, height: 0 })
  if (step.clear_target) {
    state.camera_target = undefined
    flushSync()
  }
  if (step.flight) {
    const lease = camera_flight_registry.get(canvas)?.begin()
    onTestFinished(() => lease?.restore())
  }
  Object.assign(state, {
    structure: step.to,
    series_key: step.series ?? state.series_key,
    measure_mode: step.measure_mode ?? state.measure_mode,
    camera_is_moving: step.orbiting ?? false,
  })
  flushSync()
  if (step.orbiting) {
    expect(state.camera_target).toEqual(pose.target)
    state.camera_is_moving = false
    flushSync()
  }
  const { camera_target, camera_position } = state
  if (!camera_target) throw new Error(`Missing camera target`)
  if (offset === `reframe`) {
    const { center } = camera_fit.structure_fit_frame(step.to, {
      atom_radius_scale: DEFAULTS.structure.atom_radius,
    })
    const view = camera_position.map((coord, axis) => coord - camera_target[axis])
    expect(camera_target).toEqual(center.map((coord) => expect.closeTo(coord, 9)))
    // along the live view, not the prop one, backed off past the new cell
    const live = (step.live ?? pose.position).map((coord, axis) => coord - pose.target[axis])
    const unit = (vec: number[]) => vec.map((coord) => coord / Math.hypot(...vec))
    expect(unit(view)).toEqual(unit(live).map((coord) => expect.closeTo(coord, 9)))
    expect(Math.hypot(...view)).toBeGreaterThan(8)
    expect(view_scale()).toBeGreaterThan(scale_before) // zoomed out to fit
    return
  }
  const shifted = (vec: Vec3) => vec.map((coord, axis) => coord + offset[axis])
  expect(camera_target).toEqual(shifted(pose.target).map((coord) => expect.closeTo(coord, 9)))
  expect(camera_position).toEqual(
    shifted(step.live ?? pose.position).map((coord) => expect.closeTo(coord, 9)),
  )
})

// An external supercell's unit_cell_idx points into a cell the scene never sees, while
// displacements index base_structure: following it drew no arrow for the moved atom
test.each([
  [`following unit_cell_idx`, undefined, 0],
  [`the host's base-index rule`, (_site: Site, site_idx: number) => site_idx, 1],
])(
  `displacement arrows of an external supercell with %s`,
  (_name, to_base_site_idx, n_arrows) => {
    const reference = carbon_crystal(10, [0, 0, 0], [0.5, 0, 0])
    const sites = reference.sites.map((site, idx) => ({
      ...site,
      xyz: [site.xyz[0] + idx * 0.3, site.xyz[1], site.xyz[2]] as Vec3,
      provenance: { unit_cell_idx: 0 },
    }))
    const tiled = { ...reference, sites }
    const { scene } = mount_structure({
      structure: tiled,
      base_structure: tiled,
      reference_structure: reference,
      show_displacement_arrows: true,
      to_base_site_idx,
    })
    const arrow_counts = meshes_of(scene, ArrowMesh).map((mesh) => mesh.count)
    expect(Math.max(0, ...arrow_counts)).toBe(n_arrows)
  },
)

// The far plane is sized from the cell edges (15 A for a 10 A cube -> far 1500). A lattice
// passed without a/b/c made it NaN, clipping every vertex to a blank canvas.
test.each([`full lattice params`, `matrix only`])(`camera far plane from a %s`, (label) => {
  const { lattice, ...crystal } = make_crystal(10, [[`C`, [0, 0, 0]]])
  const { matrix, pbc } = lattice
  const structure = {
    ...crystal,
    lattice: label === `matrix only` ? { matrix, pbc } : lattice,
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the malformed input under test
  const { camera } = mount_structure({ structure: structure as AnyStructure })
  if (!(camera.current instanceof OrthographicCamera))
    throw new Error(`expected the default orthographic camera`)
  expect(camera.current.far).toBe(1500)
})

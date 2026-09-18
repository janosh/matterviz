import {
  AtomInstances,
  atom_sphere_segments,
  enable_atom_sphere_picking,
  update_atom_coordinates,
  update_ordered_atom_positions,
} from '$lib/structure/atom-instances'
import { make_site } from '$lib/structure/site'
import { raycast_bond } from '$lib/structure/bond-mesh'
import { write_bond_transform } from '$lib/structure/bond-rendering'
import type { BondPair } from '$lib/structure'
import {
  cutaway_bounds,
  cutaway_contains,
  enable_cutaway_picking,
  StructureCutawayGroup,
  type StructureCutaway,
} from '$lib/structure/cutaway'
import {
  DoubleSide,
  CylinderGeometry,
  Euler,
  OrthographicCamera,
  PerspectiveCamera,
  InstancedMesh,
  type Intersection,
  Matrix4,
  MeshBasicMaterial,
  Mesh,
  Raycaster,
  SphereGeometry,
  Vector3,
  Vector2,
} from 'three/webgpu'
import { expect, test, vi } from 'vitest'

test.each([1, 2, 3] as const)(
  `enlarged edit targets cannot pick fully clipped atoms or order-%i bonds`,
  (bond_order) => {
    const group = new StructureCutawayGroup()
    const cutaway: StructureCutaway = {
      mode: `plane`,
      axis: 2,
      position: 0.5,
      thickness: 0.25,
      cartesian_to_fractional: new Matrix4(),
    }
    const raycaster = new Raycaster(new Vector3(0, 0, 0), new Vector3(0, 0, 1))
    const atom = new Mesh(new SphereGeometry(0.5), new MeshBasicMaterial())
    atom.position.set(0, 0, 0.5105)
    atom.scale.setScalar(0.02 * 1.15)
    enable_atom_sphere_picking(atom, 1 / 1.15)
    group.add(atom)
    group.set_cutaway(cutaway)
    expect(raycaster.intersectObject(atom)).toEqual([])
    group.set_cutaway(undefined)
    expect(raycaster.intersectObject(atom).length).toBeGreaterThan(0)
    const bond: BondPair = {
      pos_1: [-0.2, 0, 0.53],
      pos_2: [0.2, 0, 0.53],
      site_idx_1: 0,
      site_idx_2: 1,
      bond_length: 0.4,
      bond_order,
    }
    const target = new Mesh(new CylinderGeometry(1, 1, 1, 6), new MeshBasicMaterial())
    const matrix = new Float32Array(16)
    write_bond_transform(matrix, 0, bond.pos_1, bond.pos_2, 0.05)
    target.matrix.fromArray(matrix)
    target.matrixAutoUpdate = false
    group.add(target)
    // The expanded cylinder overlaps the retained half-space even though every actual
    // cylinder, including triple-bond offsets, lies beyond the clipping plane.
    group.set_cutaway(cutaway)
    group.updateMatrixWorld(true)
    expect(raycaster.intersectObject(target).length).toBeGreaterThan(0)
    enable_cutaway_picking(target, (ray, hits) => raycast_bond(target, bond, 0.01, ray, hits))
    expect(raycaster.intersectObject(target)).toEqual([])
    group.set_cutaway(undefined)
    expect(raycaster.intersectObject(target).length).toBeGreaterThan(0)
    group.set_cutaway({ ...cutaway, position: 0.6 })
    expect(raycaster.intersectObject(target).length).toBeGreaterThan(0)
    // From the discarded side, the expanded target surface is clipped but the actual
    // cylinders remain visible. Picking must return their surface distances, not the shell.
    bond.pos_1[2] = 0.47
    bond.pos_2[2] = 0.47
    write_bond_transform(matrix, 0, bond.pos_1, bond.pos_2, 0.05)
    target.matrix.fromArray(matrix)
    raycaster.set(new Vector3(0, 0, 1), new Vector3(0, 0, -1))
    group.set_cutaway(cutaway)
    const visible_hits = raycaster.intersectObject(target)
    expect(visible_hits.length).toBeGreaterThan(0)
    const nearest_surface = [0.48, 0.4855, 0.4935][bond_order - 1]
    // Placement buffers use f32; keep the surface-distance error below one f32 epsilon.
    expect(Math.abs(visible_hits[0].distance - (1 - nearest_surface))).toBeLessThan(1e-7)
    expect(visible_hits.every((hit) => hit.object === target)).toBe(true)
    atom.geometry.dispose()
    atom.material.dispose()
    target.geometry.dispose()
    target.material.dispose()
  },
)

test.each(
  ([`orthographic`, `perspective`] as const).flatMap((projection) =>
    ([0, 1, 2] as const).map((axis) => [projection, axis] as const),
  ),
)(
  `%s cutaway axis %i preserves atom buffers and rejects hidden surface hits in a rotated triclinic cell`,
  (projection, axis) => {
    const cell = new Matrix4().set(8, 2, 1, 11, 0, 7, 2, -4, 0, 0, 9, 3, 0, 0, 0, 1)
    const cutaway: StructureCutaway = {
      mode: `slab`,
      axis,
      position: 0.5,
      thickness: 0.3,
      cartesian_to_fractional: cell.clone().invert(),
    }
    const geometry = new SphereGeometry(0.5, 20, 20)
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const atoms = [0.15, 0.5, 0.85].map((depth) => ({
      position: new Vector3(0.5, 0.5, 0.5)
        .setComponent(axis, depth)
        .applyMatrix4(cell)
        .toArray(),
      radius: 0.7,
    }))
    const mesh = new AtomInstances(geometry, material, atoms.length)
    mesh.update_atoms(atoms)
    const original_buffer = mesh.positions.array.slice()
    const original_version = mesh.positions.version
    const group = new StructureCutawayGroup()
    group.add(mesh)
    group.rotation.set(0.3, -0.4, 0.7)
    group.position.set(-7, 5, 2)
    group.scale.set(1.2, 0.8, 1.1)
    group.set_cutaway(cutaway)
    group.updateMatrixWorld(true)
    const world_point = (depth: number) =>
      new Vector3(0.5, 0.5, 0.5)
        .setComponent(axis, depth)
        .applyMatrix4(cell)
        .applyMatrix4(group.matrixWorld)
    const camera =
      projection === `orthographic`
        ? new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
        : new PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.copy(world_point(2))
    camera.lookAt(world_point(0.5))
    camera.updateMatrixWorld(true)
    const raycaster = new Raycaster()
    raycaster.setFromCamera(new Vector2(), camera)
    const hits = () => raycaster.intersectObject(mesh)
    const triangles = vi.spyOn(Mesh.prototype, `raycast`)
    const middle_hits = hits()
    const triangle_calls = triangles.mock.calls.length
    triangles.mockRestore()
    expect(middle_hits.length).toBeGreaterThan(0)
    expect(new Set(middle_hits.map(({ instanceId }) => instanceId))).toEqual(new Set([1]))
    expect(triangle_calls).toBe(1)
    raycaster.far = middle_hits[0].distance - 0.01
    expect(hits()).toEqual([])
    raycaster.far = 100
    raycaster.near = middle_hits.at(-1)?.distance ?? 0
    raycaster.near += 0.01
    expect(hits()).toEqual([])
    raycaster.near = 0
    for (const [position, expected_idx] of [
      [0.15, 0],
      [0.85, 2],
    ] as const) {
      cutaway.position = position
      group.set_cutaway(cutaway)
      expect(new Set(hits().map(({ instanceId }) => instanceId))).toEqual(
        new Set([expected_idx]),
      )
    }
    group.set_cutaway(undefined)
    expect(new Set(hits().map(({ instanceId }) => instanceId))).toEqual(new Set([0, 1, 2]))
    expect(mesh.positions.array).toEqual(original_buffer)
    expect(mesh.positions.version).toBe(original_version)
    expect(mesh.count).toBe(3)
    // The same clipping also applies to native mesh hit targets (editable bonds).
    const target = new Mesh(geometry, material)
    target.position.fromArray(atoms[2].position)
    enable_cutaway_picking(target)
    group.add(target)
    group.set_cutaway({ ...cutaway, mode: `plane`, position: 0.5 })
    expect(raycaster.intersectObject(target)).toEqual([])
    group.set_cutaway(undefined)
    expect(raycaster.intersectObject(target).length).toBeGreaterThan(0)
    // Partial-occupancy atoms use an invisible analytic sphere target.
    enable_atom_sphere_picking(target)
    group.set_cutaway({ ...cutaway, mode: `plane`, position: 0.5 })
    expect(raycaster.intersectObject(target)).toEqual([])
    group.set_cutaway(undefined)
    expect(raycaster.intersectObject(target).length).toBeGreaterThan(0)
    mesh.dispose()
    geometry.dispose()
    material.dispose()
  },
)

test.each([0, 1, 2] as const)(
  `cutaway axis %i retains the requested fractional interval including a shifted cell origin`,
  (axis) => {
    const cell = new Matrix4().set(8, 2, 1, 11, 0, 7, 2, -4, 0, 0, 9, 3, 0, 0, 0, 1)
    const cutaway: StructureCutaway = {
      mode: `slab`,
      axis,
      position: 0.5,
      thickness: 0.2,
      cartesian_to_fractional: cell.clone().invert(),
    }
    expect(cutaway_bounds(cutaway)).toEqual([0.4, 0.6])
    for (const [coordinate, visible] of [
      [0.1, false],
      [0.41, true],
      [0.59, true],
      [0.9, false],
    ] as const) {
      const position = new Vector3(0.5, 0.5, 0.5)
        .setComponent(axis, coordinate)
        .applyMatrix4(cell)
      expect(cutaway_contains(cutaway, position.toArray())).toBe(visible)
    }
    const lower = new Vector3(0.5, 0.5, 0.5)
      .setComponent(axis, -0.1)
      .applyMatrix4(cell)
      .toArray()
    expect(cutaway_contains({ ...cutaway, mode: `plane` }, lower)).toBe(true)
    expect(cutaway_contains({ ...cutaway, mode: `off` }, lower)).toBe(true)
    expect(cutaway_contains(undefined, lower)).toBe(true)
  },
)

test(`coordinate-only frames reuse atom records, but appearance topology changes rebuild them`, () => {
  const sites = [
    make_site(`Si`, [0, 0, 0], [0, 0, 0], `Si0`),
    make_site(`Si`, [0.5, 0, 0], [1, 0, 0], `Si1`),
  ]
  const atoms = sites.map((site, site_idx) => ({
    site_idx,
    element: site.species[0].element,
    species: site.species,
    occupancy: 1,
    position: site.xyz,
    radius: 0.7,
    color: `blue`,
    is_image_atom: false,
  }))
  const moved = sites.map((site) => ({
    ...site,
    xyz: [site.xyz[0] + 0.25, 0, 0] as [number, number, number],
  }))
  const updated = update_ordered_atom_positions(atoms, moved)
  expect(updated).not.toBe(atoms)
  expect(updated?.[0]).toBe(atoms[0])
  expect(updated?.map(({ position }) => position)).toEqual([
    [0.25, 0, 0],
    [1.25, 0, 0],
  ])
  expect(sites[0].xyz).toEqual([0, 0, 0])
  expect(atoms[0].position).not.toBe(moved[0].xyz)
  const [first, last] = moved
  for (const changed of [
    { ...last, species: [{ element: `C` as const, occu: 1, oxidation_state: 0 }] },
    { ...last, species: [{ ...last.species[0], occu: 0.5 }] },
    { ...last, provenance: { image_of: 1 } },
    { ...last, provenance: { completion: true } },
  ]) {
    expect(
      update_ordered_atom_positions(atoms, [{ ...first, xyz: [9, 0, 0] }, changed]),
    ).toBeNull()
    // Rejecting a later slot cannot partially update earlier render records.
    expect(atoms[0].position).toEqual([0.25, 0, 0])
  }
  expect(update_ordered_atom_positions(atoms, moved.slice(0, 1))).toBeNull()
  moved[0].species[0].element = `C`
  expect(update_ordered_atom_positions(atoms, moved)).toBeNull()
  moved[0].species[0].element = `Si`
  const partial_site = { ...last, species: [{ ...last.species[0], occu: 0.5 }] }
  const partial_atom = {
    ...atoms[1],
    species: partial_site.species,
    occupancy: 0.5,
  }
  partial_site.species[0].occu = 1
  expect(
    update_ordered_atom_positions(
      [atoms[0], partial_atom],
      [{ ...first, xyz: [9, 0, 0] }, partial_site],
    ),
  ).toBeNull()
  expect(atoms[0].position).toEqual([0.25, 0, 0])
  const coordinates = Float64Array.of(1e12 + 0.25, -0, 1e-12, 99, -1e12 - 0.5, 2, -3, 99)
  const original_coordinates = coordinates.slice()
  const previous_positions = atoms.map(({ position }) => position)
  const numeric_updated = update_atom_coordinates(atoms, coordinates, 4)
  expect(numeric_updated).not.toBe(atoms)
  for (const [idx, atom] of numeric_updated.entries()) {
    expect(atom).toBe(atoms[idx])
    expect(atom.position).toBe(previous_positions[idx])
    expect(atom.position).toEqual(Array.from(coordinates.slice(idx * 4, idx * 4 + 3)))
  }
  expect(coordinates).toEqual(original_coordinates)
})

test.each([8, 15, 20])(
  `atom buffers and picking match native instancing at %i segments`,
  (segments) => {
    const geometry = new SphereGeometry(0.5, segments, segments)
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const atoms = Array.from({ length: 120 }, (_unused, idx) => ({
      position: [
        (idx % 6) * 2.3,
        (Math.floor(idx / 6) % 5) * 2.7,
        Math.floor(idx / 30) * 3.1,
      ] as [number, number, number],
      radius: 0.7 + (idx % 3) * 0.3,
    }))
    const actual = new AtomInstances(geometry, material, atoms.length)
    const native = new InstancedMesh(geometry, material, atoms.length)
    const matrix = new Matrix4()
    for (const count of [120, 41, 0, 120]) {
      actual.update_atoms(atoms.slice(0, count))
      native.count = count
      for (let idx = 0; idx < count; idx++) {
        const { position, radius } = atoms[idx]
        native.setMatrixAt(
          idx,
          matrix.makeScale(radius, radius, radius).setPosition(...position),
        )
      }
      expect(`instanceMatrix` in actual).toBe(false)
      expect(actual.positions.array.byteLength).toBe(
        native.instanceMatrix.array.byteLength / 4,
      )
      for (let idx = 0; idx < count; idx++) {
        actual.getMatrixAt(idx, matrix)
        expect(matrix.elements).toEqual(
          Array.from(native.instanceMatrix.array.slice(idx * 16, (idx + 1) * 16)),
        )
      }
      native.computeBoundingSphere()
      for (const scale of [
        [1, 1, 1],
        [0.5, 2, 1.5],
      ]) {
        for (const mesh of [actual, native]) {
          mesh.scale.set(...(scale as [number, number, number]))
          mesh.rotation.set(0.2, 0.7, -0.3)
          mesh.position.set(-4, 3, 5)
          mesh.updateMatrixWorld(true)
        }
        for (let ray_idx = 0; ray_idx < 40; ray_idx++) {
          const target = new Vector3(...atoms[ray_idx * 3].position).applyMatrix4(
            native.matrixWorld,
          )
          const origin = target
            .clone()
            .add(new Vector3(ray_idx % 2 ? 0 : 0.2, 0.1, ray_idx % 4 ? 40 : 0))
          const ray = new Raycaster(
            origin,
            target.clone().sub(origin).normalize(),
            ray_idx % 3 ? 0 : 1,
            ray_idx % 5 ? Infinity : 10,
          )
          const reference: Intersection[] = [],
            optimized: Intersection[] = []
          native.raycast(ray, reference)
          actual.raycast(ray, optimized)
          const values = (hits: Intersection[]) =>
            hits.map(({ object: _object, ...hit }) => hit)
          expect(values(optimized)).toEqual(values(reference))
        }
      }
    }
    // Tessellation/geometry edits must update bounds without rewriting atom transforms.
    const uploaded = actual.positions.array.slice()
    const translated = geometry.clone().translate(0.2, -0.3, 0.1)
    actual.set_geometry(translated)
    const bounds = actual.boundingSphere?.clone()
    expect(actual.positions.array).toEqual(uploaded)
    actual.update_atoms(atoms)
    expect(actual.boundingSphere).toEqual(bounds)
    actual.dispose()
    translated.dispose()
    native.dispose()
    geometry.dispose()
    material.dispose()
  },
)

test.each([6.562, 14.659, 25.996])(
  `projected sphere silhouette stays within half a pixel at radius %s`,
  (radius_px) => {
    const segments = atom_sphere_segments(radius_px, 64)
    const geometry = new SphereGeometry(radius_px, segments, segments)
    const camera = new OrthographicCamera(
      -radius_px,
      radius_px,
      radius_px,
      -radius_px,
      -100,
      100,
    )
    const rotation = new Matrix4()
    const point = new Vector3()
    for (let yaw_idx = 0; yaw_idx < 32; yaw_idx++) {
      rotation.makeRotationFromEuler(new Euler(0, (yaw_idx * Math.PI) / 64, Math.PI / 32))
      let edge = -Infinity
      for (let idx = 0; idx < geometry.attributes.position.count; idx++) {
        point
          .fromBufferAttribute(geometry.attributes.position, idx)
          .applyMatrix4(rotation)
          .project(camera)
        edge = Math.max(edge, point.x * radius_px)
      }
      expect(radius_px - edge).toBeLessThanOrEqual(0.5)
    }
    geometry.dispose()
  },
)

test(`invisible sphere targets remain pickable exactly at a rotated pole`, () => {
  const mesh = new Mesh(new SphereGeometry(0.5, 12, 12), new MeshBasicMaterial())
  mesh.visible = false
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.setScalar(2.5)
  enable_atom_sphere_picking(mesh)
  // OrbitControls represents an equatorial camera using cos(pi/2), not exact zero.
  const origin = new Vector3(0, Math.cos(Math.PI / 2) * 8, 8)
  const ray = new Raycaster(origin, origin.clone().normalize().negate())
  // No render or world-matrix update: picking must use the latest transform itself.
  const [hit] = ray.intersectObject(mesh)
  expect(hit?.distance).toBe(6.75)
  if (!hit) throw new Error(`Missing sphere hit`)
  const expected = origin.clone().multiplyScalar(1.25 / 8)
  // Eight f64 ulps cover the inverse/forward matrix transforms at this coordinate scale.
  expect(hit.point.distanceTo(expected)).toBeLessThanOrEqual(8 * Number.EPSILON)
  ray.far = 6
  expect(ray.intersectObject(mesh)).toEqual([])
  ray.far = Infinity
  ray.near = 7
  expect(ray.intersectObject(mesh)).toEqual([])
  mesh.geometry.dispose()
  mesh.material.dispose()
})

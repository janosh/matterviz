import {
  AtomInstances,
  atom_sphere_segments,
  enable_atom_sphere_picking,
  update_ordered_atom_positions,
} from '$lib/structure/atom-instances'
import { make_site } from '$lib/structure/site'
import {
  DoubleSide,
  Euler,
  OrthographicCamera,
  InstancedMesh,
  type Intersection,
  Matrix4,
  MeshBasicMaterial,
  Mesh,
  Raycaster,
  SphereGeometry,
  Vector3,
} from 'three/webgpu'
import { expect, test } from 'vitest'

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
    has_partial_occupancy: false,
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
  const [first, last] = moved
  for (const changed of [
    { ...last, species: [{ element: `C` as const, occu: 1, oxidation_state: 0 }] },
    { ...last, species: [{ ...last.species[0], occu: 0.5 }] },
    { ...last, properties: { orig_site_idx: 1 } },
    { ...last, properties: { completion_image: true } },
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
    has_partial_occupancy: true,
  }
  partial_site.species[0].occu = 1
  expect(
    update_ordered_atom_positions(
      [atoms[0], partial_atom],
      [{ ...first, xyz: [9, 0, 0] }, partial_site],
    ),
  ).toBeNull()
  expect(atoms[0].position).toEqual([0.25, 0, 0])
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
      expect(actual.instanceMatrix.array).toEqual(native.instanceMatrix.array)
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
    actual.dispose()
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

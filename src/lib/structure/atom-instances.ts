import type { Vec3 } from '$lib/math'
import type { Site } from './index'
import { is_image_site } from './site'
import { InstanceColors } from './instance-colors'
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Material,
  type Intersection,
  Matrix4,
  Mesh,
  Ray,
  type Raycaster,
  Sphere,
  SphereGeometry,
  Vector3,
} from 'three/webgpu'

export type InstancedAtom = { position: Vec3; radius: number; color?: string }

// The caller has verified fixed row identity. Keep the large coordinate loop outside
// Svelte's per-expression dev instrumentation; positions remain viewer-owned float64.
export function update_atom_coordinates<Atom extends InstancedAtom>(
  atoms: readonly Atom[],
  coordinates: Float64Array,
  stride: number,
): Atom[] {
  for (let idx = 0; idx < atoms.length; idx++) {
    const offset = idx * stride
    const { position } = atoms[idx]
    position[0] = coordinates[offset]
    position[1] = coordinates[offset + 1]
    position[2] = coordinates[offset + 2]
  }
  return atoms.slice()
}

// Reuse viewer-owned render records for coordinate-only updates of ordered atoms. Validate
// every slot before changing any record; composition, occupancy or image changes rebuild it.
export function update_ordered_atom_positions<
  Atom extends InstancedAtom & {
    site_idx: number
    element: string
    species: Site[`species`]
    is_image_atom: boolean
    occupancy: number
  },
>(atoms: readonly Atom[], sites: readonly Site[]): Atom[] | null {
  if (atoms.length !== sites.length) return null
  for (let idx = 0; idx < sites.length; idx++) {
    const site = sites[idx]
    const atom = atoms[idx]
    if (
      atom.site_idx !== idx ||
      atom.is_image_atom ||
      atom.occupancy !== 1 ||
      is_image_site(site) ||
      site.properties?.completion_image ||
      site.species.length !== 1 ||
      site.species[0].occu !== 1 ||
      atom.element !== site.species[0].element
    )
      return null
  }
  for (let idx = 0; idx < sites.length; idx++) {
    atoms[idx].position = [...sites[idx].xyz]
    atoms[idx].species = sites[idx].species
  }
  // A fresh array invalidates instance buffers while the per-atom records and lookup survive.
  return atoms.slice()
}

// Scratch is shared across synchronous raycasts, like Three’s native mesh picking.
const hit_sphere = new Sphere(new Vector3(), 0.5)
const local_ray = new Ray()
const scratch_matrix = new Matrix4()
const candidate = new Mesh()
const candidate_hits: Intersection[] = []
const hit_point = new Vector3()

// Invisible full-sphere targets need no triangle test (which can miss exactly at a pole).
export function enable_atom_sphere_picking(mesh: Mesh): void {
  mesh.raycast = (raycaster, hits) => {
    // Invisible objects may not have been visited by the renderer since their transform changed.
    mesh.updateWorldMatrix(true, false)
    local_ray.copy(raycaster.ray).applyMatrix4(scratch_matrix.copy(mesh.matrixWorld).invert())
    if (!local_ray.intersectSphere(hit_sphere, hit_point)) return
    hit_point.applyMatrix4(mesh.matrixWorld)
    const distance = raycaster.ray.origin.distanceTo(hit_point)
    if (distance < raycaster.near || distance > raycaster.far) return
    hits.push({ distance, point: hit_point.clone(), object: mesh })
  }
}

// Full spheres with four floats per atom, without Three's instance-matrix machinery.
// The uploaded coordinates are authoritative for bounds, picking and captured exports.
export class AtomInstances extends Mesh<InstancedBufferGeometry> {
  positions: InstancedBufferAttribute
  // Do not name this instanceColor: Three multiplies that uninitialized varying into
  // custom materials even without the InstancedMesh machinery that populates it.
  colors: InstanceColors
  boundingSphere = new Sphere()
  max_radius = 0
  override count = 0
  private ghost = false
  private readonly detail_geometries = new Map<SphereGeometry, InstancedBufferGeometry>()

  constructor(geometry = new SphereGeometry(0.5, 20, 20), material?: Material, capacity = 0) {
    super(new InstancedBufferGeometry(), material)
    // xyz, uniform radius: a naturally aligned vec4 in both WebGL and WebGPU.
    this.positions = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
      DynamicDrawUsage,
    )
    this.colors = new InstanceColors(new Float32Array(capacity * 3), 3)
    this.count = 0
    this.set_geometry(geometry)
  }

  set_geometry(source: SphereGeometry): void {
    const count = this.count
    let geometry = this.detail_geometries.get(source)
    if (!geometry) {
      geometry = new InstancedBufferGeometry()
      geometry.index = source.index
      geometry.attributes = { ...source.attributes }
      geometry.setAttribute(`atomPositionRadius`, this.positions)
      geometry.setAttribute(`atomColor`, this.colors)
      geometry.boundingSphere = source.boundingSphere?.clone() ?? null
      this.detail_geometries.set(source, geometry)
    }
    if (this.geometry === geometry) return
    this.geometry = geometry
    this.geometry.instanceCount = count
    this.update_bounds()
  }

  getMatrixAt(idx: number, target: Matrix4): void {
    const offset = idx * 4
    const values = this.positions.array
    const radius = values[offset + 3]
    target
      .makeScale(radius, radius, radius)
      .setPosition(values[offset], values[offset + 1], values[offset + 2])
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive)
    this.geometry = source.geometry.clone()
    this.positions = this.geometry.getAttribute(
      `atomPositionRadius`,
    ) as InstancedBufferAttribute
    this.colors = this.geometry.getAttribute(`atomColor`) as InstanceColors
    this.count = source.count
    this.boundingSphere.copy(source.boundingSphere)
    this.max_radius = source.max_radius
    this.detail_geometries.clear()
    return this
  }

  dispose(): void {
    const geometries = new Set([this.geometry, ...this.detail_geometries.values()])
    for (const geometry of geometries) geometry.dispose()
    this.detail_geometries.clear()
  }

  update_atoms(atoms: readonly InstancedAtom[]): void {
    this.count = Math.min(atoms.length, this.positions.count)
    this.geometry.instanceCount = this.count
    this.update_bounds(atoms)
    this.positions.clearUpdateRanges()
    this.positions.addUpdateRange(0, this.count * 4)
    this.positions.needsUpdate = true
  }

  // Color loops run on plain data, outside Svelte's per-expression dev instrumentation.
  update_colors(atoms: readonly InstancedAtom[], ghost = false): boolean {
    const force = ghost !== this.ghost
    for (let idx = 0; idx < atoms.length; idx++) {
      this.colors.write_color(idx, atoms[idx].color ?? `#999999`, ghost, force)
    }
    this.ghost = ghost
    return this.colors.flush(atoms.length)
  }

  // Atom updates write transforms and read their bounds in one pass. Tessellation-only
  // changes reuse the uploaded transforms.
  update_bounds(atoms?: readonly InstancedAtom[]): void {
    if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere()
    const sphere = this.geometry.boundingSphere
    if (!sphere) return
    const values = this.positions.array
    let min_x = Infinity,
      min_y = Infinity,
      min_z = Infinity
    let max_x = -Infinity,
      max_y = -Infinity,
      max_z = -Infinity
    this.max_radius = 0
    for (let idx = 0; idx < this.count; idx++) {
      const offset = idx * 4
      if (atoms) {
        const { position, radius } = atoms[idx]
        values[offset] = position[0]
        values[offset + 1] = position[1]
        values[offset + 2] = position[2]
        values[offset + 3] = radius
      }
      // Read back the uploaded f32 values so bounds also enclose rounded coordinates.
      const scale = values[offset + 3]
      const extent = Math.abs(scale) * sphere.radius
      const pos_x = values[offset] + scale * sphere.center.x
      const pos_y = values[offset + 1] + scale * sphere.center.y
      const pos_z = values[offset + 2] + scale * sphere.center.z
      this.max_radius = Math.max(this.max_radius, extent)
      min_x = Math.min(min_x, pos_x - extent)
      min_y = Math.min(min_y, pos_y - extent)
      min_z = Math.min(min_z, pos_z - extent)
      max_x = Math.max(max_x, pos_x + extent)
      max_y = Math.max(max_y, pos_y + extent)
      max_z = Math.max(max_z, pos_z + extent)
    }
    this.boundingSphere ??= new Sphere()
    const bounds = this.boundingSphere
    if (this.count === 0) bounds.makeEmpty()
    else {
      bounds.center.set((min_x + max_x) / 2, (min_y + max_y) / 2, (min_z + max_z) / 2)
      bounds.radius = Math.hypot(max_x - min_x, max_y - min_y, max_z - min_z) / 2
    }
  }

  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere()
    const sphere = this.geometry.boundingSphere
    if (!sphere || this.count === 0) return
    local_ray.copy(raycaster.ray).applyMatrix4(scratch_matrix.copy(this.matrixWorld).invert())
    if (this.boundingSphere && !local_ray.intersectsSphere(this.boundingSphere)) return
    const { origin, direction } = local_ray
    const values = this.positions.array
    candidate.geometry = this.geometry
    candidate.material = this.material
    for (let idx = 0; idx < this.count; idx++) {
      const offset = idx * 4
      const scale = values[offset + 3]
      const delta_x = values[offset] + scale * sphere.center.x - origin.x
      const delta_y = values[offset + 1] + scale * sphere.center.y - origin.y
      const delta_z = values[offset + 2] + scale * sphere.center.z - origin.z
      const radius = Math.abs(scale) * sphere.radius
      const along = delta_x * direction.x + delta_y * direction.y + delta_z * direction.z
      // Residual components avoid cancellation in distance² - along² for far-away rays.
      const perp_x = delta_x - along * direction.x
      const perp_y = delta_y - along * direction.y
      const perp_z = delta_z - along * direction.z
      if (along < -radius || perp_x ** 2 + perp_y ** 2 + perp_z ** 2 > radius ** 2) continue
      this.getMatrixAt(idx, scratch_matrix)
      candidate.matrixWorld.multiplyMatrices(this.matrixWorld, scratch_matrix)
      // Preserve triangle-accurate hits, face/UV data, near/far clipping and instance IDs.
      candidate.raycast(raycaster, candidate_hits)
      for (const hit of candidate_hits) {
        hit.instanceId = idx
        hit.object = this
        intersects.push(hit)
      }
      candidate_hits.length = 0
    }
  }
}

// Bound the silhouette error to half a CSS pixel, with the user's detail as a ceiling.
// A latitude/longitude cell has angular half-diagonal sqrt((pi/n)^2 + (pi/2n)^2).
export const atom_sphere_segments = (radius_px: number, requested: number): number => {
  if (!(radius_px > 0) || !Number.isFinite(radius_px)) return requested
  const needed = (Math.PI * Math.sqrt(1.25)) / Math.acos(Math.max(-1, 1 - 0.5 / radius_px))
  return Math.min(requested, Math.max(8, Math.ceil(needed / 4) * 4))
}

import type { Vec3 } from '$lib/math'
import type { Site } from './index'
import { is_image_site } from './site'
import {
  InstancedMesh,
  type Intersection,
  Matrix4,
  Mesh,
  Ray,
  type Raycaster,
  Sphere,
  type SphereGeometry,
  Vector3,
} from 'three/webgpu'

export type InstancedAtom = { position: Vec3; radius: number; color?: string }

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
    atoms[idx].position = sites[idx].xyz
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

// Full spheres with uniform scale: keep the GPU buffer authoritative for bounds and picking.
export class AtomInstances extends InstancedMesh<SphereGeometry> {
  max_radius = 0

  update_atoms(atoms: readonly InstancedAtom[]): void {
    const matrices = this.instanceMatrix.array
    this.count = Math.min(atoms.length, this.instanceMatrix.count)
    for (let idx = 0; idx < this.count; idx++) {
      const { position, radius } = atoms[idx]
      const offset = idx * 16
      // InstancedMesh initializes identity matrices; the other ten entries never change.
      matrices[offset] = radius
      matrices[offset + 5] = radius
      matrices[offset + 10] = radius
      matrices[offset + 12] = position[0]
      matrices[offset + 13] = position[1]
      matrices[offset + 14] = position[2]
    }
    this.update_bounds()
    this.instanceMatrix.clearUpdateRanges()
    this.instanceMatrix.addUpdateRange(0, this.count * 16)
    this.instanceMatrix.needsUpdate = true
  }

  // Changing tessellation updates picking bounds without re-uploading atom transforms.
  update_bounds(): void {
    if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere()
    const sphere = this.geometry.boundingSphere
    if (!sphere) return
    const matrices = this.instanceMatrix.array
    let min_x = Infinity,
      min_y = Infinity,
      min_z = Infinity
    let max_x = -Infinity,
      max_y = -Infinity,
      max_z = -Infinity
    this.max_radius = 0
    for (let idx = 0; idx < this.count; idx++) {
      const offset = idx * 16
      const scale = matrices[offset]
      const extent = Math.abs(scale) * sphere.radius
      const pos_x = matrices[offset + 12] + scale * sphere.center.x
      const pos_y = matrices[offset + 13] + scale * sphere.center.y
      const pos_z = matrices[offset + 14] + scale * sphere.center.z
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
    const matrices = this.instanceMatrix.array
    candidate.geometry = this.geometry
    candidate.material = this.material
    for (let idx = 0; idx < this.count; idx++) {
      const offset = idx * 16
      const scale = matrices[offset]
      const delta_x = matrices[offset + 12] + scale * sphere.center.x - origin.x
      const delta_y = matrices[offset + 13] + scale * sphere.center.y - origin.y
      const delta_z = matrices[offset + 14] + scale * sphere.center.z - origin.z
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

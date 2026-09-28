import { grow_capacity } from '$lib/math'
import { css_to_linear_rgb } from '$lib/scene/colors'
import type { InstancedAtom } from './atom-instances'
import { atom_field_color, type AtomColorField } from './atom-color-field'
import { cutaway_excludes, cutaway_planes } from './cutaway'
import type { SliceGeometry } from './partial-occupancy'
import {
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Plane,
  Ray,
  Sphere,
  SphereGeometry,
  Vector3,
} from 'three/webgpu'
import type { Intersection, Raycaster } from 'three/webgpu'

export type PartialAtom = InstancedAtom &
  SliceGeometry & { site_idx: number; is_image_atom: boolean }

// Wedge lengths that differ only by accumulated rounding (~1e-15 rad) share a mesh. Keys are
// numeric for a cheap per-frame lookup: odd keys are ghosted, negative ones hold the caps.
const mesh_key = (phi_length: number | null, ghost: boolean): number =>
  (phi_length === null ? -1 : Math.round(phi_length * 1e9)) * 2 + Number(ghost)

type Bucket = { phi_length: number | null; ghost: boolean; atoms: number[]; phis: number[] }

const gray = new Color(0x999999)
const color = new Color()
const matrix = new Matrix4()
const scale = new Vector3()
const local_ray = new Ray()
const sphere = new Sphere()
const cap_plane = new Plane()
const local_hit = new Vector3()

// Disordered sites as rotated copies of a few shared wedges: the wedge of length L starting at
// azimuth phi is the one starting at 0 turned about Y by phi. One InstancedMesh per distinct
// length (real structures have few occupancy fractions) plus one for all caps, per material.
// The group picks whole sites analytically, like the full spheres they replace, and reports
// the index of the site's first wedge in `atoms` as instanceId.
export class PartialAtoms extends Group {
  private atoms: readonly PartialAtom[] = []
  private ghost_images = false
  private segments = 0
  private readonly meshes = new Map<number, InstancedMesh>()
  // [wedge, ghosted wedge, cap, ghosted cap]: white bases tinted by per-instance colors
  private readonly materials = [FrontSide, FrontSide, DoubleSide, DoubleSide].map(
    (side) => new MeshStandardNodeMaterial({ side }),
  )

  // Wedges of one site must be consecutive. Buffers are rewritten in place while each mesh's
  // capacity suffices, so trajectory frames only re-upload instance data.
  update(
    atoms: readonly PartialAtom[],
    ghost_images: boolean,
    segments: number,
    color_field?: AtomColorField,
  ): void {
    this.atoms = atoms
    this.ghost_images = ghost_images
    const retessellate = segments !== this.segments
    this.segments = segments
    const buckets = new Map<number, Bucket>()
    const add = (phi_length: number | null, ghost: boolean, atom_idx: number, phi: number) => {
      const key = mesh_key(phi_length, ghost)
      let bucket = buckets.get(key)
      if (!bucket) buckets.set(key, (bucket = { phi_length, ghost, atoms: [], phis: [] }))
      bucket.atoms.push(atom_idx)
      bucket.phis.push(phi)
    }
    for (let atom_idx = 0; atom_idx < atoms.length; atom_idx++) {
      const atom = atoms[atom_idx]
      const ghost = ghost_images && atom.is_image_atom
      add(atom.phi_length, ghost, atom_idx, atom.start_phi)
      if (atom.render_start_cap) add(null, ghost, atom_idx, atom.start_phi)
      if (atom.render_end_cap) add(null, ghost, atom_idx, atom.end_phi)
    }
    for (const [key, mesh] of this.meshes) {
      if (buckets.has(key) && !retessellate) continue
      this.retire(mesh)
      this.meshes.delete(key)
    }
    for (const [key, bucket] of buckets) {
      let mesh = this.meshes.get(key)
      const capacity = mesh?.instanceMatrix.count ?? 0
      if (!mesh || bucket.atoms.length > capacity) {
        if (mesh) this.retire(mesh)
        mesh = this.create_mesh(bucket, grow_capacity(capacity, bucket.atoms.length))
        this.meshes.set(key, mesh)
      }
      for (let slot = 0; slot < bucket.atoms.length; slot++) {
        const { position, radius, color: css } = atoms[bucket.atoms[slot]]
        scale.setScalar(radius)
        matrix
          .makeRotationY(bucket.phis[slot])
          .scale(scale)
          .setPosition(...position)
        mesh.setMatrixAt(slot, matrix)
        color.setRGB(...css_to_linear_rgb(css ?? `#999999`))
        if (bucket.ghost) color.lerp(gray, 0.4)
        if (color_field) atom_field_color(color_field, position, color)
        mesh.setColorAt(slot, color) // allocates instanceColor before the first render
      }
      mesh.count = bucket.atoms.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  set_opacity(opacity: number): void {
    for (const [idx, material] of this.materials.entries()) {
      const alpha = opacity * (idx % 2 ? 0.5 : 1)
      if (material.transparent !== alpha < 1) material.needsUpdate = true
      material.transparent = alpha < 1
      material.opacity = alpha
      material.visible = alpha > 0
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) this.retire(mesh)
    this.meshes.clear()
    for (const material of this.materials) material.dispose()
  }

  // Invisible full-sphere hit test per site, which a pointer at a pole cannot slip through.
  // Where a cutaway removed the sphere's front, the vacancy caps behind it stay pickable.
  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const { atoms } = this
    this.updateWorldMatrix(true, false)
    local_ray.copy(raycaster.ray).applyMatrix4(matrix.copy(this.matrixWorld).invert())
    const planes = cutaway_planes(this)
    for (let first = 0, last = 0; first < atoms.length; first = ++last) {
      const { site_idx, position, radius, is_image_atom, render_start_cap, start_phi } =
        atoms[first]
      while (atoms[last + 1]?.site_idx === site_idx) last++
      if (this.ghost_images && is_image_atom) continue
      sphere.center.fromArray(position)
      sphere.radius = radius / 2
      if (!local_ray.intersectSphere(sphere, local_hit)) continue
      // Caps lie inside the sphere, so they can only be nearest once its front is clipped
      let hit = this.world_hit(raycaster, planes)
      if (!hit && planes.length) {
        const { render_end_cap, end_phi } = atoms[last]
        for (const phi of [render_start_cap && start_phi, render_end_cap && end_phi]) {
          if (phi === false || !hit_cap(phi)) continue
          const cap_hit = this.world_hit(raycaster, planes)
          if (cap_hit && (!hit || cap_hit.distance < hit.distance)) hit = cap_hit
        }
      }
      if (hit) intersects.push({ ...hit, object: this, instanceId: first })
    }
  }

  private world_hit(raycaster: Raycaster, planes: Plane[]) {
    const point = local_hit.clone().applyMatrix4(this.matrixWorld)
    if (cutaway_excludes(planes, point)) return null
    const distance = raycaster.ray.origin.distanceTo(point)
    return distance < raycaster.near || distance > raycaster.far ? null : { distance, point }
  }

  private create_mesh({ phi_length, ghost }: Bucket, capacity: number): InstancedMesh {
    // Caps close a vacancy: a half-disc facing azimuth 0, turned to a wedge's start or end
    const geometry =
      phi_length === null
        ? new CircleGeometry(0.5, this.segments, Math.PI / 2, Math.PI)
        : new SphereGeometry(0.5, this.segments, this.segments, 0, phi_length)
    const material = this.materials[(phi_length === null ? 2 : 0) + Number(ghost)]
    const mesh = new InstancedMesh(geometry, material, capacity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.raycast = () => undefined // the group picks whole sites
    this.add(mesh)
    return mesh
  }

  private retire(mesh: InstancedMesh): void {
    this.remove(mesh)
    mesh.geometry.dispose()
    mesh.dispose()
  }
}

// Half-disc through the Y axis on the side of azimuth phi, i.e. (-cos phi, 0, sin phi), of the
// current sphere; leaves the crossing in local_hit
function hit_cap(phi: number): boolean {
  cap_plane.normal.set(Math.sin(phi), 0, Math.cos(phi))
  cap_plane.constant = -sphere.center.dot(cap_plane.normal)
  if (!local_ray.intersectPlane(cap_plane, local_hit)) return false
  const offset_x = local_hit.x - sphere.center.x
  const offset_z = local_hit.z - sphere.center.z
  return (
    sphere.containsPoint(local_hit) && offset_z * Math.sin(phi) >= offset_x * Math.cos(phi)
  )
}

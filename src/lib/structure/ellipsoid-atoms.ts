// Thermal ellipsoids: one InstancedMesh of unit spheres, each instance stretched by its site's
// ellipsoid transform (axes · diag(semi_axes), see thermal_ellipsoid). Three's instance node
// transforms normals by the inverse transpose, so the stretched spheres shade correctly.
import type { Matrix3x3 } from '#lib/math.js'
import { grow_capacity } from '#lib/math.js'
import { atom_field_color, type AtomColorField } from './atom-color-field'
import type { InstancedAtom } from './atom-instances'
import { cutaway_excludes, cutaway_planes } from './cutaway'
import { set_instance_color, set_material_opacity } from './instance-colors'
import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  SphereGeometry,
} from 'three/webgpu'
import type { Intersection, Raycaster } from 'three/webgpu'

export type EllipsoidAtom = InstancedAtom & { ellipsoid: Matrix3x3 }

const color = new Color()
const matrix = new Matrix4()

// Picks and reports instanceId as the index into the atoms passed to update, like the sphere
// meshes, so the scene's per-mesh pointer handlers resolve sites the same way. A `ghost` group
// draws edit-atoms mode's image atoms faded and at half opacity, like the image spheres.
export class EllipsoidAtoms extends Group {
  constructor(private readonly ghost = false) {
    super()
  }
  private mesh: InstancedMesh | null = null
  private segments = 0
  private readonly material = new MeshStandardNodeMaterial()

  // Buffers are rewritten in place while capacity suffices; a new tessellation or a larger
  // atom count replaces the mesh
  update(
    atoms: readonly EllipsoidAtom[],
    segments: number,
    color_field?: AtomColorField,
  ): void {
    const capacity = this.mesh?.instanceMatrix.count ?? 0
    if (!this.mesh || atoms.length > capacity || segments !== this.segments) {
      this.retire()
      this.segments = segments
      const geometry = new SphereGeometry(1, segments, segments)
      const mesh = new InstancedMesh(
        geometry,
        this.material,
        grow_capacity(capacity, atoms.length),
      )
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.raycast = () => undefined // the group picks, see raycast below
      this.add(mesh)
      this.mesh = mesh
    }
    const { mesh } = this
    for (const [slot, { position, ellipsoid, color: css }] of atoms.entries()) {
      const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = ellipsoid
      // oxfmt-ignore
      matrix.set(
        xx, xy, xz, position[0],
        yx, yy, yz, position[1],
        zx, zy, zz, position[2],
        0, 0, 0, 1,
      )
      mesh.setMatrixAt(slot, matrix)
      set_instance_color(color, css ?? `#999999`, this.ghost)
      if (color_field) atom_field_color(color_field, position, color)
      mesh.setColorAt(slot, color) // allocates instanceColor before the first render
    }
    mesh.count = atoms.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  set_opacity(opacity: number): void {
    set_material_opacity(this.material, opacity, this.ghost)
  }

  dispose(): void {
    this.retire()
    this.material.dispose()
  }

  // Triangle hits on the stretched spheres, minus those a cutaway clipped away
  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    if (!this.mesh) return
    const hits: Intersection[] = []
    InstancedMesh.prototype.raycast.call(this.mesh, raycaster, hits)
    const planes = cutaway_planes(this)
    for (const hit of hits)
      if (!cutaway_excludes(planes, hit.point)) intersects.push({ ...hit, object: this })
  }

  private retire(): void {
    if (!this.mesh) return
    this.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.dispose()
    this.mesh = null
  }
}

import type { Matrix3x3, Vec3 } from '#lib/math.js'
import type { Intersection, Mesh, Object3D, Raycaster } from 'three/webgpu'
import { ClippingGroup, Matrix4, Plane, Vector3 } from 'three/webgpu'

export interface CutawaySettings {
  mode: 'off' | 'plane' | 'slab'
  axis: 0 | 1 | 2
  position: number
  thickness: number
  // Select centers and complete their visible bonds/polyhedra with intact endpoint atoms.
  whole_atoms?: boolean
}

export const DEFAULT_CUTAWAY: CutawaySettings = {
  mode: `off`,
  axis: 2,
  position: 0.5,
  thickness: 0.25,
}

export interface StructureCutaway extends CutawaySettings {
  cartesian_to_fractional: Matrix4
}

// A cutaway as hosts pass it: JSON settings (e.g. movie configs) carry no transform
export type CutawayInput = CutawaySettings & { cartesian_to_fractional?: Matrix4 }

// Cartesian -> fractional transform of a cell whose rows are the lattice vectors (columns
// for Three's column-vector multiplication), with fractional 0 at `origin`
export const cell_to_fractional = (cell: Matrix3x3, origin: Vec3 = [0, 0, 0]): Matrix4 =>
  new Matrix4().fromArray([...cell[0], 0, ...cell[1], 0, ...cell[2], 0, ...origin, 1]).invert()

// Slices without a transform cut the displayed structure's own cell. An active one needs
// that cell: a lattice-free structure has no fractional coordinates to slice in.
export function resolve_cutaway(
  cutaway: CutawayInput | undefined,
  cell: Matrix3x3 | undefined,
): StructureCutaway | undefined {
  if (!cutaway) return undefined
  const { cartesian_to_fractional } = cutaway
  if (cartesian_to_fractional) return { ...cutaway, cartesian_to_fractional }
  if (cutaway.mode === `off`) return undefined
  if (!cell) {
    throw new Error(
      `A ${cutaway.mode} cutaway needs cartesian_to_fractional or a structure with a lattice`,
    )
  }
  return { ...cutaway, cartesian_to_fractional: cell_to_fractional(cell) }
}

// Plane retains the lower side; slab retains a centered interval in fractional cell space.
export const cutaway_bounds = ({
  mode,
  position,
  thickness,
}: CutawaySettings): [number, number] =>
  mode === `plane`
    ? [-Infinity, position]
    : [position - thickness / 2, position + thickness / 2]

export function cutaway_contains(
  cutaway: StructureCutaway | undefined,
  position: Vec3,
): boolean {
  if (!cutaway || cutaway.mode === `off`) return true
  const { axis, cartesian_to_fractional } = cutaway
  const values = cartesian_to_fractional.elements
  const coordinate =
    values[axis] * position[0] +
    values[axis + 4] * position[1] +
    values[axis + 8] * position[2] +
    values[axis + 12]
  const [lower, upper] = cutaway_bounds(cutaway)
  return coordinate >= lower && coordinate <= upper
}

// WebGPU clipping planes are world-space. Keep their transforms attached to the same
// group as atoms/bonds, including manual rotation, without changing any atom arrays.
export class StructureCutawayGroup extends ClippingGroup {
  override enabled = false
  private local_planes: Plane[] = []

  set_cutaway(cutaway?: StructureCutaway): void {
    this.enabled = Boolean(cutaway && cutaway.mode !== `off`)
    this.local_planes = []
    if (cutaway && this.enabled) {
      // An inverse-cell row gives a fractional coordinate, including the cell origin.
      const { axis, cartesian_to_fractional } = cutaway
      const values = cartesian_to_fractional.elements
      const coordinate = new Plane(
        new Vector3(values[axis], values[axis + 4], values[axis + 8]),
        values[axis + 12],
      )
      const [lower, upper] = cutaway_bounds(cutaway)
      if (Number.isFinite(lower)) {
        const plane = coordinate.clone()
        plane.constant -= lower
        this.local_planes.push(plane.normalize())
      }
      const plane = coordinate.clone().negate()
      plane.constant += upper
      this.local_planes.push(plane.normalize())
    }
    this.clippingPlanes = this.local_planes.map((plane) =>
      plane.clone().applyMatrix4(this.matrixWorld),
    )
  }

  private update_planes(): void {
    this.local_planes.forEach((plane, idx) =>
      this.clippingPlanes[idx].copy(plane).applyMatrix4(this.matrixWorld),
    )
  }

  override updateMatrixWorld(force?: boolean): void {
    super.updateMatrixWorld(force)
    this.update_planes()
  }

  override updateWorldMatrix(update_parents: boolean, update_children: boolean): void {
    super.updateWorldMatrix(update_parents, update_children)
    this.update_planes()
  }
}

// Collect once per raycast instead of walking ancestors for every intersection.
export function cutaway_planes(object: Object3D): Plane[] {
  const planes: Plane[] = []
  for (let parent = object.parent; parent; parent = parent.parent)
    if (parent instanceof StructureCutawayGroup && parent.enabled)
      planes.push(...parent.clippingPlanes)
  return planes
}

// A positive radius rejects only spheres wholly outside the retained region.
export function cutaway_excludes(
  planes: readonly Plane[],
  point: Vector3,
  radius = 0,
): boolean {
  for (const plane of planes) if (plane.distanceToPoint(point) < -radius) return true
  return false
}

// Three raycasts ignore GPU clipping. Filter actual surface hits before Threlte resolves
// the nearest object, so a hidden foreground atom/bond cannot intercept a visible one.
export function enable_cutaway_picking(
  mesh: Mesh,
  raycast_surface?: (raycaster: Raycaster, hits: Intersection[]) => void,
): void {
  const raycast = mesh.raycast.bind(mesh)
  const candidates: Intersection[] = []
  mesh.raycast = (raycaster, hits) => {
    mesh.updateWorldMatrix(true, false)
    const planes = cutaway_planes(mesh)
    if (planes.length && raycast_surface) raycast_surface(raycaster, candidates)
    else raycast(raycaster, candidates)
    for (const hit of candidates) if (!cutaway_excludes(planes, hit.point)) hits.push(hit)
    candidates.length = 0
  }
}

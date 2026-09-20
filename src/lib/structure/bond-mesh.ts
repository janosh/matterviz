import {
  attribute,
  cross,
  normalGeometry,
  positionGeometry,
  transformNormalToView,
  vec3,
} from 'three/tsl'
import {
  BufferGeometry,
  CylinderGeometry,
  type Intersection,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type Material,
  type Matrix4,
  type MeshBasicNodeMaterial,
  type Node,
  type Raycaster,
} from 'three/webgpu'
import {
  BondFrame,
  instance_count_for_order,
  prepare_bond_placements,
  type BondData,
  type BondPlacements,
} from './bond-rendering'
import { InstanceColors } from './instance-colors'
import type { BondPair } from './index'

// Center and displacement preserve short bonds far from the origin. Sending two rounded
// endpoints instead would lose their separation. Radius/offset encode multiple bond orders.
export class BondMesh extends Mesh<InstancedBufferGeometry> {
  centers: InstancedBufferAttribute
  deltas: InstancedBufferAttribute
  sizes: InstancedBufferAttribute
  colors_start: InstanceColors
  colors_end: InstanceColors
  readonly instanceColor = null
  override count = 0
  thickness = 1

  constructor(source = new BufferGeometry(), material?: Material, capacity = 0) {
    const geometry = new InstancedBufferGeometry()
    geometry.index = source.index
    geometry.attributes = { ...source.attributes }
    super(geometry, material)
    this.centers = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.deltas = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.sizes = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.colors_start = new InstanceColors(new Float32Array(capacity * 3), 3)
    this.colors_end = new InstanceColors(new Float32Array(capacity * 3), 3)
    geometry.setAttribute(`bondCenter`, this.centers)
    geometry.setAttribute(`bondDelta`, this.deltas)
    geometry.setAttribute(`bondSize`, this.sizes)
    geometry.setAttribute(`instanceColorStart`, this.colors_start)
    geometry.setAttribute(`instanceColorEnd`, this.colors_end)
    this.frustumCulled = false
    this.raycast = () => undefined // Editable bond picking uses the captured bond endpoints.
  }

  update(placements: BondPlacements): void {
    const count = placements.instance_count
    if (count > this.centers.count)
      throw new RangeError(
        `Bond capacity ${this.centers.count} cannot hold ${count} instances`,
      )
    this.centers.array.set(placements.centers)
    this.deltas.array.set(placements.deltas)
    this.sizes.array.set(placements.sizes)
    this.count = count
    this.geometry.instanceCount = count
    for (const buffer of [this.centers, this.deltas, this.sizes]) {
      buffer.clearUpdateRanges()
      buffer.addUpdateRange(0, count * buffer.itemSize)
      buffer.needsUpdate = true
    }
  }

  getMatrixAt(idx: number, target: Matrix4): void {
    const thickness = Math.fround(this.thickness)
    const radius = Math.fround(this.sizes.getX(idx) * thickness)
    const delta_x = this.deltas.getX(idx),
      delta_y = this.deltas.getY(idx),
      delta_z = this.deltas.getZ(idx)
    const height = Math.hypot(delta_x, delta_y, delta_z)
    const basis = this.sizes.getZ(idx)
    let right_x = 1,
      right_z = 0,
      up_x = 0,
      up_y = 0,
      up_z = delta_y < 0 ? -1 : 1
    if (basis === 2) {
      const transverse = Math.hypot(delta_x, delta_z)
      right_x = -delta_z / transverse
      right_z = delta_x / transverse
      up_x = (-delta_y / height) * right_z
      up_y = (delta_x * right_z - delta_z * right_x) / height
      up_z = (delta_y / height) * right_x
    }
    const offset = Math.fround(this.sizes.getY(idx) * thickness) * Math.sign(radius)
    target.set(
      right_x * radius,
      delta_x,
      up_x * radius,
      this.centers.getX(idx) + right_x * offset,
      0,
      delta_y,
      up_y * radius,
      this.centers.getY(idx),
      right_z * radius,
      delta_z,
      up_z * radius,
      this.centers.getZ(idx) + right_z * offset,
      0,
      0,
      0,
      1,
    )
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive)
    this.geometry = source.geometry.clone()
    this.centers = this.geometry.getAttribute(`bondCenter`) as InstancedBufferAttribute
    this.deltas = this.geometry.getAttribute(`bondDelta`) as InstancedBufferAttribute
    this.sizes = this.geometry.getAttribute(`bondSize`) as InstancedBufferAttribute
    this.colors_start = this.geometry.getAttribute(`instanceColorStart`) as InstanceColors
    this.colors_end = this.geometry.getAttribute(`instanceColorEnd`) as InstanceColors
    this.count = source.count
    this.thickness = source.thickness
    return this
  }

  // Mesh-owned buffers and history stay together across growth, copying and disposal.
  update_colors(
    bonds: BondData,
    placements: BondPlacements,
    site_colors: readonly string[],
    uniform_color: string | undefined,
  ): boolean {
    // Packed endpoints are unsigned indices. A uniform palette covering its highest index
    // makes every cylinder color independent of topology and bond order between frames.
    if (
      uniform_color !== undefined &&
      bonds instanceof BondFrame &&
      placements.max_site_idx < site_colors.length
    ) {
      const changed = this.colors_start.fill_color(uniform_color)
      return this.colors_end.fill_color(uniform_color) || changed
    }
    let instance_idx = 0
    for (let idx = 0; idx < bonds.length; idx++) {
      const site_idx_1 =
        bonds instanceof BondFrame ? bonds.columns.indices[idx * 2] : bonds[idx].site_idx_1
      const site_idx_2 =
        bonds instanceof BondFrame ? bonds.columns.indices[idx * 2 + 1] : bonds[idx].site_idx_2
      const color_start = site_colors[site_idx_1]
      const color_end = site_colors[site_idx_2]
      if (color_start === undefined || color_end === undefined)
        throw new RangeError(
          `Missing bond endpoint color for site indices ${site_idx_1}, ${site_idx_2}`,
        )
      const copies = instance_count_for_order(
        bonds instanceof BondFrame ? bonds.order(idx) : bonds[idx].bond_order,
      )
      for (let order_idx = 0; order_idx < copies; order_idx++, instance_idx++) {
        this.colors_start.write_color(instance_idx, color_start)
        this.colors_end.write_color(instance_idx, color_end)
      }
    }
    const changed = this.colors_start.flush(placements.instance_count)
    return this.colors_end.flush(placements.instance_count) || changed
  }

  dispose(): void {
    this.geometry.dispose()
  }
}

let bond_picker: { instances: BondMesh; candidate: Mesh } | undefined

// Enlarged edit targets must not resurrect a clipped bond. Raycast the actual rendered
// cylinders, including multiple-bond offsets/radii, whenever cutaways are active.
export function raycast_bond(
  target: Mesh,
  bond: BondPair,
  thickness: number,
  raycaster: Raycaster,
  hits: Intersection[],
): void {
  if (!target.parent) return
  if (!bond_picker) {
    const geometry = new CylinderGeometry(1, 1, 1, 8)
    bond_picker = {
      instances: new BondMesh(geometry, undefined, 3),
      candidate: new Mesh(geometry),
    }
  }
  const { instances, candidate } = bond_picker
  instances.update(prepare_bond_placements([bond]))
  instances.thickness = thickness
  candidate.material = target.material
  for (let idx = 0; idx < instances.count; idx++) {
    instances.getMatrixAt(idx, candidate.matrixWorld)
    candidate.matrixWorld.premultiply(target.parent.matrixWorld)
    const first_hit = hits.length
    candidate.raycast(raycaster, hits)
    for (let hit_idx = first_hit; hit_idx < hits.length; hit_idx++)
      hits[hit_idx].object = target
  }
}

export function set_bond_placement(
  material: MeshBasicNodeMaterial,
  thickness: Node<`float`>,
): void {
  const center = attribute<`vec3`>(`bondCenter`, `vec3`)
  const delta = attribute<`vec3`>(`bondDelta`, `vec3`)
  const size = attribute<`vec3`>(`bondSize`, `vec3`)
  const radius = size.x.mul(thickness)
  const offset = size.y.mul(thickness)
  const height = delta.length()
  const direction = height
    .greaterThanEqual(1e-10)
    .select(delta.div(height.max(1e-30)), vec3(0, 1, 0))
  const radial_length = direction.xz.length()
  const right = size.z
    .equal(2)
    .select(
      vec3(direction.z.negate(), 0, direction.x).div(radial_length.max(1e-30)),
      vec3(1, 0, 0),
    )
  const up = size.z
    .equal(2)
    .select(cross(right, direction), vec3(0, 0, delta.y.lessThan(0).select(-1, 1)))
  const lateral = positionGeometry.x.mul(radius).add(offset.mul(radius.sign()))
  material.positionNode = center
    .add(right.mul(lateral))
    .add(delta.mul(positionGeometry.y))
    .add(up.mul(positionGeometry.z.mul(radius)))
  const inverse_radius = radius.notEqual(0).select(radius.reciprocal(), 0)
  const inverse_height = height.greaterThanEqual(1e-10).select(height.reciprocal(), 0)
  const normal = right
    .mul(normalGeometry.x.mul(inverse_radius))
    .add(direction.mul(normalGeometry.y.mul(inverse_height)))
    .add(up.mul(normalGeometry.z.mul(inverse_radius)))
  material.normalNode = transformNormalToView(normal)
}

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
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type Material,
  type Matrix4,
  type MeshBasicNodeMaterial,
  type Node,
} from 'three/webgpu'
import {
  BondFrame,
  instance_count_for_order,
  type BondData,
  type BondPlacements,
} from './bond-rendering'
import { css_to_linear_rgb, write_linear_color_to_buffer } from '$lib/scene/colors'

// Center and displacement preserve short bonds far from the origin. Sending two rounded
// endpoints instead would lose their separation. Radius/offset encode multiple bond orders.
export class BondMesh extends Mesh<InstancedBufferGeometry> {
  centers: InstancedBufferAttribute
  deltas: InstancedBufferAttribute
  sizes: InstancedBufferAttribute
  colors_start: InstancedBufferAttribute
  colors_end: InstancedBufferAttribute
  private readonly colored_start: string[] = []
  private readonly colored_end: string[] = []
  private uniform_color: string | undefined
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
    this.colors_start = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.colors_end = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
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
    this.colors_start = this.geometry.getAttribute(
      `instanceColorStart`,
    ) as InstancedBufferAttribute
    this.colors_end = this.geometry.getAttribute(
      `instanceColorEnd`,
    ) as InstancedBufferAttribute
    this.colored_start.length = 0
    this.colored_end.length = 0
    this.uniform_color = undefined
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
    const colors_start = this.colors_start.array
    const colors_end = this.colors_end.array
    const capacity = this.centers.count
    const instance_count = placements.instance_count

    let first_changed_idx = instance_count
    let last_changed_idx = -1
    let instance_idx = 0
    // Packed endpoints are unsigned indices. A uniform palette covering its highest index
    // makes every cylinder color independent of topology and bond order between frames.
    if (
      uniform_color !== undefined &&
      bonds instanceof BondFrame &&
      placements.max_site_idx < site_colors.length
    ) {
      if (this.uniform_color !== uniform_color) {
        const color = css_to_linear_rgb(uniform_color)
        for (let idx = 0; idx < capacity; idx++) {
          colors_start.set(color, idx * 3)
          colors_end.set(color, idx * 3)
        }
        this.colored_start.length = capacity
        this.colored_end.length = capacity
        this.colored_start.fill(uniform_color)
        this.colored_end.fill(uniform_color)
        first_changed_idx = 0
        last_changed_idx = capacity - 1
      }
      this.uniform_color = uniform_color
    } else {
      this.uniform_color = undefined
      for (let idx = 0; idx < bonds.length; idx++) {
        const site_idx_1 =
          bonds instanceof BondFrame ? bonds.columns.indices[idx * 2] : bonds[idx].site_idx_1
        const site_idx_2 =
          bonds instanceof BondFrame
            ? bonds.columns.indices[idx * 2 + 1]
            : bonds[idx].site_idx_2
        const instance_color_start = site_colors[site_idx_1]
        const instance_color_end = site_colors[site_idx_2]
        if (instance_color_start === undefined || instance_color_end === undefined) {
          throw new RangeError(
            `Missing bond endpoint color for site indices ${site_idx_1}, ${site_idx_2}`,
          )
        }
        const bond_instance_count = instance_count_for_order(
          bonds instanceof BondFrame ? bonds.order(idx) : bonds[idx].bond_order,
        )
        for (let order_idx = 0; order_idx < bond_instance_count; order_idx++) {
          if (this.colored_start[instance_idx] !== instance_color_start) {
            write_linear_color_to_buffer(colors_start, instance_idx, instance_color_start)
            this.colored_start[instance_idx] = instance_color_start
            first_changed_idx = Math.min(first_changed_idx, instance_idx)
            last_changed_idx = instance_idx
          }
          if (this.colored_end[instance_idx] !== instance_color_end) {
            write_linear_color_to_buffer(colors_end, instance_idx, instance_color_end)
            this.colored_end[instance_idx] = instance_color_end
            first_changed_idx = Math.min(first_changed_idx, instance_idx)
            last_changed_idx = instance_idx
          }
          instance_idx += 1
        }
      }
      this.colored_start.length = instance_count
      this.colored_end.length = instance_count
    }

    if (last_changed_idx < 0) return false
    for (const buffer of [this.colors_start, this.colors_end]) {
      buffer.addUpdateRange(
        first_changed_idx * 3,
        (last_changed_idx - first_changed_idx + 1) * 3,
      )
      buffer.needsUpdate = true
    }
    return true
  }

  dispose(): void {
    this.geometry.dispose()
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

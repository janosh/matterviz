import {
  attribute,
  cross,
  normalGeometry,
  positionGeometry,
  transformNormalToView,
  uniform,
  vec3,
} from 'three/tsl'
import {
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Material,
  type Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  type Node,
  Quaternion,
  Vector3,
} from 'three/webgpu'
import type { ArrowPlacements } from './vectors'
import { write_linear_color_to_buffer } from '$lib/scene/colors'

// Both primitives share eight placement floats per arrow. Their dimensions are uniforms;
// the vertex shader derives each center and scale without per-frame CPU transforms.
export class ArrowMesh extends Mesh<InstancedBufferGeometry> {
  origins: InstancedBufferAttribute
  rotations: InstancedBufferAttribute
  lengths: InstancedBufferAttribute
  // `instanceColor` would enable Three's matrix-instancing color path on this custom mesh.
  colors: InstancedBufferAttribute
  override count = 0
  private readonly colored_css: string[] = []
  private uniform_color: string | undefined
  part = 0
  dimensions: [number, number, number] = [0, 0, 0]

  constructor(
    source = new BufferGeometry(),
    material?: Material,
    capacity = 0,
    shared?: Pick<ArrowMesh, 'origins' | 'rotations' | 'lengths' | 'colors'>,
  ) {
    const geometry = new InstancedBufferGeometry()
    geometry.index = source.index
    geometry.attributes = { ...source.attributes }
    geometry.type = source.type
    super(geometry, material)
    this.origins =
      shared?.origins ?? new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.rotations =
      shared?.rotations ?? new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    this.lengths =
      shared?.lengths ?? new InstancedBufferAttribute(new Float32Array(capacity), 1)
    this.colors =
      shared?.colors ?? new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    geometry.setAttribute(`arrowOrigin`, this.origins)
    geometry.setAttribute(`arrowRotation`, this.rotations)
    geometry.setAttribute(`arrowLength`, this.lengths)
    geometry.setAttribute(`arrowColor`, this.colors)
    this.frustumCulled = false
    this.raycast = () => undefined // Arrow overlays are display-only.
  }

  getMatrixAt(idx: number, target: Matrix4): void {
    const encoded_length = this.lengths.getX(idx)
    const length = Math.abs(encoded_length)
    const [shaft_size, head_size, head_length] = this.dimensions.map(Math.fround)
    const head_len = head_length < 0 ? length * -head_length : head_length
    const shaft_len = Math.max(0, length - head_len * 0.5)
    const rotation = new Quaternion().fromArray(this.rotations.array, idx * 4)
    const position = new Vector3().fromBufferAttribute(this.origins, idx)
    let radius = 0,
      extent = 0,
      offset = 0
    if (length > 0) {
      if (this.part === 0) {
        offset = shaft_len * 0.5
        if (encoded_length > 0) {
          radius = shaft_size < 0 ? shaft_len * -shaft_size : shaft_size
          extent = shaft_len
        }
      } else {
        offset = shaft_len + head_len * 0.5
        radius = head_len > 0 ? (head_size < 0 ? shaft_len * -head_size : head_size) : 0
        extent = head_len
      }
      position.add(new Vector3(0, offset, 0).applyQuaternion(rotation))
    }
    target.compose(position, rotation, new Vector3(radius, extent, radius))
  }

  override copy(source: this, recursive = true): this {
    super.copy(source, recursive)
    this.geometry = source.geometry.clone()
    this.origins = this.geometry.getAttribute(`arrowOrigin`) as InstancedBufferAttribute
    this.rotations = this.geometry.getAttribute(`arrowRotation`) as InstancedBufferAttribute
    this.lengths = this.geometry.getAttribute(`arrowLength`) as InstancedBufferAttribute
    this.colors = this.geometry.getAttribute(`arrowColor`) as InstancedBufferAttribute
    this.count = source.count
    this.colored_css.length = 0
    this.uniform_color = undefined
    this.part = source.part
    this.dimensions = [...source.dimensions]
    return this
  }

  upload(placements: ArrowPlacements): void {
    const { count, origins, rotations, lengths } = placements
    if (count > this.origins.count)
      throw new RangeError(
        `Arrow capacity ${this.origins.count} cannot hold ${count} instances`,
      )
    this.origins.array.set(origins)
    this.rotations.array.set(rotations)
    this.lengths.array.set(lengths)
    for (const buffer of [this.origins, this.rotations, this.lengths]) {
      buffer.clearUpdateRanges()
      buffer.addUpdateRange(0, count * buffer.itemSize)
      buffer.needsUpdate = true
    }
  }

  update_colors(css_colors: readonly string[] | string): boolean {
    const count = this.count
    if (typeof css_colors !== `string` && css_colors.length !== count)
      throw new RangeError(`Expected ${count} arrow colors, received ${css_colors.length}`)
    if (
      typeof css_colors === `string` &&
      css_colors === this.uniform_color &&
      count <= this.colored_css.length
    )
      return false
    this.uniform_color = typeof css_colors === `string` ? css_colors : undefined
    let first_change = count
    let last_change = -1
    for (let idx = 0; idx < count; idx++) {
      const color = typeof css_colors === `string` ? css_colors : css_colors[idx]
      if (color === this.colored_css[idx]) continue
      write_linear_color_to_buffer(this.colors.array, idx, color)
      this.colored_css[idx] = color
      first_change = Math.min(first_change, idx)
      last_change = idx
    }
    this.colored_css.length = count
    if (last_change < 0) return false
    // Preserve pending ranges when several updates happen before the next GPU upload.
    this.colors.addUpdateRange(first_change * 3, (last_change - first_change + 1) * 3)
    this.colors.needsUpdate = true
    return true
  }

  dispose(): void {
    this.geometry.dispose()
  }
}

export function arrow_material(part: number, dimensions = uniform(new Vector3())) {
  const material = new MeshStandardNodeMaterial()
  const origin = attribute<`vec3`>(`arrowOrigin`, `vec3`)
  const encoded_length = attribute<`float`>(`arrowLength`, `float`)
  const rotation = attribute<`vec4`>(`arrowRotation`, `vec4`)
  const length = encoded_length.abs()
  const valid = length.greaterThan(0)
  const head_len = dimensions.z
    .lessThan(0)
    .select(length.mul(dimensions.z.negate()), dimensions.z)
  const shaft_len = length.sub(head_len.mul(0.5)).max(0)
  const size = part === 0 ? dimensions.x : dimensions.y
  const radius = size.lessThan(0).select(shaft_len.mul(size.negate()), size)
  const visible =
    part === 0 ? encoded_length.greaterThan(0) : valid.and(head_len.greaterThan(0))
  const scale = vec3(
    visible.select(radius, 0),
    part === 0 ? visible.select(shaft_len, 0) : valid.select(head_len, 0),
    visible.select(radius, 0),
  )
  const offset = valid.select(
    part === 0 ? shaft_len.mul(0.5) : shaft_len.add(head_len.mul(0.5)),
    0,
  )
  const rotate = (vector: Node<`vec3`>) => {
    const product = cross(rotation.xyz, vector).add(vector.mul(rotation.w))
    return vector.add(cross(rotation.xyz, product).mul(2))
  }
  material.positionNode = rotate(positionGeometry.mul(scale).add(vec3(0, offset, 0))).add(
    origin,
  )
  const inverse_scale = scale.abs().greaterThan(0).select(scale.reciprocal(), vec3(0))
  material.normalNode = transformNormalToView(rotate(normalGeometry.mul(inverse_scale)))
  material.colorNode = attribute(`arrowColor`, `vec3`)
  return { material, dimensions }
}

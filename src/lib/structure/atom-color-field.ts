import type { Vec3 } from '$lib/math'
import { attribute, clamp, float, floor, mix, texture3D, uniform, vec4 } from 'three/tsl'
import {
  Color,
  Data3DTexture,
  DataUtils,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  type MeshStandardNodeMaterial,
  Vector3,
} from 'three/webgpu'

// Cell-major RGBA colors in linear RGB. Alpha blends atom colors or controls cloud
// density; zero leaves atoms visible wherever an analysis has no usable observations.
export interface AtomColorField {
  colors: Float32Array
  dims: Vec3
  cartesian_to_fractional: Matrix4
  pbc: readonly [boolean, boolean, boolean]
}

export class ColorFieldTexture extends Data3DTexture {
  private uploaded?: Float32Array

  constructor(private readonly sampling: `nearest` | `linear` = `nearest`) {
    super()
    this.type = sampling === `linear` ? HalfFloatType : FloatType
    if (sampling === `linear`) {
      this.minFilter = LinearFilter
      this.magFilter = LinearFilter
    }
  }

  update({ colors, dims }: AtomColorField): void {
    // Bin index = (a * nb + b) * nc + c, so texture x/y/z correspond to c/b/a.
    const [depth, height, width] = dims
    const image = this.image
    const resized = image.width !== width || image.height !== height || image.depth !== depth
    if (this.uploaded === colors && !resized) return
    // WebGPU textures cannot change extent; release the old allocation on grid changes.
    if (resized && image.data) this.dispose()
    let data: Float32Array | Uint16Array = colors
    if (this.sampling === `linear`) {
      data =
        image.data instanceof Uint16Array && image.data.length === colors.length
          ? image.data
          : new Uint16Array(colors.length)
      // Filter premultiplied colors to avoid dark fringes against unobserved bins.
      for (let offset = 0; offset < colors.length; offset += 4) {
        const density = colors[offset + 3]
        for (let channel = 0; channel < 3; channel++)
          data[offset + channel] = DataUtils.toHalfFloat(colors[offset + channel] * density)
        data[offset + 3] = DataUtils.toHalfFloat(density)
      }
    }
    this.image = { data, width, height, depth }
    this.needsUpdate = true
    this.uploaded = colors
  }
}

export class AtomFieldMaterial {
  readonly texture = new ColorFieldTexture()
  readonly transform = uniform(new Matrix4())
  readonly periodic = uniform(new Vector3())
  private readonly base_color = attribute<`vec3`>(`atomColor`, `vec3`)
  private readonly color_node

  constructor(
    private readonly material: MeshStandardNodeMaterial,
    field: AtomColorField,
  ) {
    const position = attribute<`vec4`>(`atomPositionRadius`, `vec4`).xyz
    const fractional = this.transform.mul(vec4(position, 1)).xyz
    const wrapped = fractional.sub(floor(fractional).mul(this.periodic))
    const inside = wrapped.greaterThanEqual(0).all().and(wrapped.lessThanEqual(1).all())
    const sample = texture3D(this.texture, clamp(wrapped.zyx, 0, 1)).level(float(0))
    this.color_node = mix(this.base_color, sample.rgb, inside.select(sample.a, 0))
    this.update(field)
  }

  update(field?: AtomColorField): void {
    const node = field ? this.color_node : this.base_color
    if (this.material.colorNode !== node) {
      this.material.colorNode = node
      this.material.needsUpdate = true
    }
    if (!field) return
    this.transform.value.copy(field.cartesian_to_fractional)
    this.periodic.value.set(...(field.pbc.map(Number) as Vec3))
    this.texture.update(field)
  }
}

// Partial-occupancy atoms use separate wedge meshes. Sampling their centers on the CPU
// keeps those uncommon meshes consistent without rebuilding the large instance buffers.
export function atom_field_color(field: AtomColorField, position: Vec3, base?: string): Color {
  const coords = new Vector3(...position).applyMatrix4(field.cartesian_to_fractional).toArray()
  let bin = 0
  for (let axis = 0; axis < 3; axis++) {
    let fraction = coords[axis]
    if (field.pbc[axis]) fraction -= Math.floor(fraction)
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return new Color(base)
    bin =
      bin * field.dims[axis] +
      Math.min(field.dims[axis] - 1, Math.floor(fraction * field.dims[axis]))
  }
  const offset = bin * 4
  return new Color(base).lerp(
    new Color().fromArray(field.colors, offset),
    field.colors[offset + 3],
  )
}

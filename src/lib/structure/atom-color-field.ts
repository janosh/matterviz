import { det_3x3, type Matrix3x3, type Vec3 } from '$lib/math'
import { css_to_linear_rgb } from '$lib/scene/colors'
import { attribute, clamp, float, floor, mix, texture3D, uniform, vec4 } from 'three/tsl'
import {
  Color,
  ClampToEdgeWrapping,
  Data3DTexture,
  DataUtils,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  RepeatWrapping,
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

// Cell-centered, C-ordered scalar samples in a periodic cell. A fixed reference keeps
// changes visible between updates; negative numerical ringing has zero display opacity.
export function density_color_field(
  values: readonly number[],
  dims: Vec3,
  lattice: Matrix3x3,
  reference_density: number,
  color: string,
): AtomColorField {
  if (
    dims.length !== 3 ||
    !dims.every((size) => Number.isInteger(size) && size > 0) ||
    values.length !== dims[0] * dims[1] * dims[2] ||
    !values.every(Number.isFinite) ||
    !Number.isFinite(reference_density) ||
    reference_density <= 0 ||
    !lattice.flat().every(Number.isFinite) ||
    Math.abs(det_3x3(lattice)) < 1e-12
  )
    throw new Error(`Invalid density cloud (${dims.join(`×`)}, ${values.length} values)`)
  const rgb = css_to_linear_rgb(color)
  const colors = new Float32Array(values.length * 4)
  for (const [idx, value] of values.entries()) {
    colors.set(rgb, idx * 4)
    colors[idx * 4 + 3] = Math.min(8, Math.max(0, value) / reference_density)
  }
  return {
    colors,
    dims,
    pbc: [true, true, true],
    cartesian_to_fractional: new Matrix4()
      .fromArray([...lattice[0], 0, ...lattice[1], 0, ...lattice[2], 0, 0, 0, 0, 1])
      .invert(),
  }
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

  update({ colors, dims, pbc }: AtomColorField): void {
    // Bin index = (a * nb + b) * nc + c, so texture x/y/z correspond to c/b/a.
    const [depth, height, width] = dims
    const image = this.image
    const resized = image.width !== width || image.height !== height || image.depth !== depth
    const [wrap_r, wrap_t, wrap_s] = pbc.map((periodic) =>
      periodic ? RepeatWrapping : ClampToEdgeWrapping,
    )
    const wrapping_changed =
      this.wrapS !== wrap_s || this.wrapT !== wrap_t || this.wrapR !== wrap_r
    this.wrapS = wrap_s
    this.wrapT = wrap_t
    this.wrapR = wrap_r
    if (this.uploaded === colors && !resized) {
      if (wrapping_changed) this.needsUpdate = true
      return
    }
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
const field_coords = new Vector3()
const field_color = new Color()
export function atom_field_bin(field: Omit<AtomColorField, `colors`>, position: Vec3): number {
  field_coords.fromArray(position).applyMatrix4(field.cartesian_to_fractional)
  let bin = 0
  for (let axis = 0; axis < 3; axis++) {
    let fraction = field_coords.getComponent(axis)
    if (field.pbc[axis]) fraction -= Math.floor(fraction)
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return -1
    bin =
      bin * field.dims[axis] +
      Math.min(field.dims[axis] - 1, Math.floor(fraction * field.dims[axis]))
  }
  return bin
}

export function atom_field_color(field: AtomColorField, position: Vec3, base?: string): Color {
  const bin = atom_field_bin(field, position)
  if (bin < 0) return new Color(base)
  const offset = bin * 4
  return new Color(base).lerp(
    field_color.fromArray(field.colors, offset),
    field.colors[offset + 3],
  )
}

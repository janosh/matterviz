// Inverse of three's AgX tone mapping (nodes/display/ToneMappingFunctions.js) as a TSL node:
// a surface emitting untone_agx(color) displays `color` after the renderer's frame-wide AgX
// pass, i.e. as if it were not tone mapped. WebGPURenderer tone-maps the whole frame in one
// output pass, so material.toneMapped = false cannot exempt a single mesh. Each AgX step is
// invertible: matrices, log2 encoding and the monotonic contrast polynomial (inverted by
// bisection: 16 steps put every display color within 6e-4 of its target in sRGB, under 1/255).
import { exp2, Fn, Loop, mat3, mix, step, uniform, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import type { Vec3 } from '#lib/math.js'

// The renderer's tone-mapping exposure as a uniform, so changing it never recompiles a shader
export const agx_exposure = uniform(1).onRenderUpdate(({ renderer }) => {
  if (!renderer) throw new Error(`agx_exposure updated outside a render`)
  return renderer.toneMappingExposure
})

// AgX's log2 encoding range in stops
export const [MIN_EV, MAX_EV] = [-12.47393, 4.026069]

// Inverses of AgX's LINEAR_REC2020_TO_LINEAR_SRGB, outset matrix and inset * sRGB-to-Rec.2020
// matrices, as columns like three's mat3(vec3, vec3, vec3)
type Columns = [Vec3, Vec3, Vec3]
export const UNTONE_MATRICES = {
  inv_rec2020_to_srgb: [
    [0.627409, 0.069125, 0.016423],
    [0.32926, 0.919549, 0.088048],
    [0.043272, 0.011321, 0.895617],
  ],
  inv_outset: [
    [0.899797, 0.111421, 0.111421],
    [0.0872, 0.875576, 0.0872],
    [0.013003, 0.013003, 0.801379],
  ],
  inv_inset_srgb_to_rec2020: [
    [2.114514, -0.370541, -0.165953],
    [-1.027466, 1.552986, -0.254686],
    [-0.087107, -0.182332, 1.420629],
  ],
} satisfies Record<string, Columns>
const [inv_rec2020_to_srgb, inv_outset, inv_inset_srgb_to_rec2020] = Object.values(
  UNTONE_MATRICES,
).map(([col_a, col_b, col_c]: Columns) => mat3(vec3(...col_a), vec3(...col_b), vec3(...col_c)))

// bisection steps inverting the contrast curve
export const UNTONE_STEPS = 16

// agxDefaultContrastApprox, increasing on [0, 1] from -0.00232 to 0.99858
const agx_contrast = (val: Node<`vec3`>): Node<`vec3`> => {
  const sq = val.mul(val)
  const quad = sq.mul(sq)
  return quad
    .mul(sq)
    .mul(15.5)
    .sub(quad.mul(val).mul(40.14))
    .add(quad.mul(31.96))
    .sub(sq.mul(val).mul(6.868))
    .add(sq.mul(0.4298))
    .add(val.mul(0.1191))
    .sub(0.00232)
}

// Linear scene radiance that AgX at `exposure` maps to the linear display color `display`
export const untone_agx = Fn(([display, exposure]: [Node<`vec3`>, Node<`float`>]) => {
  const encoded_power = inv_rec2020_to_srgb
    .mul(display.clamp(0, 1))
    .max(0)
    .pow(1 / 2.2)
  const contrast = inv_outset.mul(encoded_power).toVar()
  const low = vec3(0).toVar()
  const high = vec3(1).toVar()
  Loop(UNTONE_STEPS, () => {
    const mid = low.add(high).mul(0.5).toVar()
    // 1 where the curve at mid is still below the target, so the root lies above mid
    const below = step(agx_contrast(mid), contrast)
    low.assign(mix(low, mid, below))
    high.assign(mix(mid, high, below))
  })
  const stops = low
    .add(high)
    .mul(0.5)
    .mul(MAX_EV - MIN_EV)
    .add(MIN_EV)
  return inv_inset_srgb_to_rec2020.mul(exp2(stops)).div(exposure)
})

// Inverse of three's AgX tone mapping (nodes/display/ToneMappingFunctions.js) as a TSL node:
// a surface emitting untone_agx(color) displays `color` after the renderer's frame-wide AgX
// pass, i.e. as if it were not tone mapped. WebGPURenderer tone-maps the whole frame in one
// output pass, so material.toneMapped = false cannot exempt a single mesh. Each AgX step is
// invertible: matrices, log2 encoding and the monotonic contrast polynomial (inverted by a
// fitted guess and Newton steps, see UNTONE_GUESS).
import { exp2, Fn, Loop, mat3, uniform, vec3 } from 'three/tsl'
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

// Least-squares quartic fit (ascending powers) of the contrast curve's inverse on its range,
// then Newton steps, where 16 bisection steps took 2.5x the GPU time: the curve's residual is
// at most 7e-4 and the root off by up to 1.8e-3, a display error under 1/255. Plain Newton from
// the identity guess oscillates about the inflection.
export const UNTONE_GUESS = [0.09237584, 3.177989, -8.193203, 9.477408, -3.597172]
export const UNTONE_NEWTON_STEPS = 2

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
// agx_contrast's derivative: its coefficients are the contrast curve's times their powers
const agx_contrast_slope = (val: Node<`vec3`>): Node<`vec3`> => {
  const sq = val.mul(val)
  return sq
    .mul(sq)
    .mul(val)
    .mul(93)
    .sub(sq.mul(sq).mul(200.7))
    .add(sq.mul(val).mul(127.84))
    .sub(sq.mul(20.604))
    .add(val.mul(0.8596))
    .add(0.1191)
}

// Linear scene radiance that AgX at `exposure` maps to the linear display color `display`
export const untone_agx = Fn(([display, exposure]: [Node<`vec3`>, Node<`float`>]) => {
  const encoded_power = inv_rec2020_to_srgb
    .mul(display.clamp(0, 1))
    .max(0)
    .pow(1 / 2.2)
  const contrast = inv_outset.mul(encoded_power).toVar()
  const root = UNTONE_GUESS.reduceRight<Node<`vec3`>>(
    (acc, coef) => acc.mul(contrast).add(coef),
    vec3(0),
  )
    .clamp(0, 1)
    .toVar()
  Loop(UNTONE_NEWTON_STEPS, () => {
    const newton_step = agx_contrast(root).sub(contrast).div(agx_contrast_slope(root))
    root.assign(root.sub(newton_step).clamp(0, 1))
  })
  const stops = root.mul(MAX_EV - MIN_EV).add(MIN_EV)
  return inv_inset_srgb_to_rec2020.mul(exp2(stops)).div(exposure)
})

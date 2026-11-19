// untone_agx's constants and bisection, run in JS through a port of three's AgX
// (nodes/display/ToneMappingFunctions.js): AgX of the untoned color must give back the color
import { MAX_EV, MIN_EV, UNTONE_MATRICES, UNTONE_STEPS } from '#lib/scene/tone-mapping.js'
import type { Vec3 } from '#lib/math.js'
import { expect, test } from 'vite-plus/test'
import { make_rng } from '../numeric-helpers'

type Columns = readonly (readonly number[])[]
// mat3(vec3 columns) * vec
const mul = (columns: Columns, vec: Vec3): Vec3 =>
  [0, 1, 2].map((row) =>
    columns.reduce((sum, column, col) => sum + column[row] * vec[col], 0),
  ) as Vec3
const each = (vec: Vec3, fn: (val: number) => number): Vec3 => vec.map(fn) as Vec3
const clamp01 = (val: number) => Math.min(Math.max(val, 0), 1)
const contrast = (val: number) =>
  15.5 * val ** 6 -
  40.14 * val ** 5 +
  31.96 * val ** 4 -
  6.868 * val ** 3 +
  0.4298 * val ** 2 +
  0.1191 * val -
  0.00232
// three's agxToneMapping (r187)
const srgb_to_rec2020: Columns = [
  [0.6274, 0.0691, 0.0164],
  [0.3293, 0.9195, 0.088],
  [0.0433, 0.0113, 0.8956],
]
const rec2020_to_srgb: Columns = [
  [1.6605, -0.1246, -0.0182],
  [-0.5876, 1.1329, -0.1006],
  [-0.0728, -0.0083, 1.1187],
]
const inset: Columns = [
  [0.856627153315983, 0.137318972929847, 0.11189821299995],
  [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
  [0.0482516061458583, 0.101439036467562, 0.811302368396859],
]
const outset: Columns = [
  [1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
  [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
  [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405],
]
const agx = (rgb: Vec3, exposure: number): Vec3 => {
  let tone = mul(
    inset,
    mul(
      srgb_to_rec2020,
      each(rgb, (val) => val * exposure),
    ),
  )
  tone = each(tone, (val) =>
    clamp01((Math.log2(Math.max(val, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV)),
  )
  tone = each(mul(outset, each(tone, contrast)), (val) => Math.max(0, val) ** 2.2)
  return each(mul(rec2020_to_srgb, tone), clamp01)
}
// untone_agx in JS on the module's constants
const untone = (display: Vec3, exposure: number): Vec3 => {
  const { inv_rec2020_to_srgb, inv_outset, inv_inset_srgb_to_rec2020 } = UNTONE_MATRICES
  const power = each(
    mul(inv_rec2020_to_srgb, each(display, clamp01)),
    (val) => Math.max(val, 0) ** (1 / 2.2),
  )
  const stops = each(mul(inv_outset, power), (target) => {
    let [low, high] = [0, 1]
    for (let step = 0; step < UNTONE_STEPS; step++) {
      const mid = (low + high) / 2
      if (contrast(mid) <= target) low = mid
      else high = mid
    }
    return ((low + high) / 2) * (MAX_EV - MIN_EV) + MIN_EV
  })
  return each(
    mul(
      inv_inset_srgb_to_rec2020,
      each(stops, (stop) => 2 ** stop),
    ),
    (val) => val / exposure,
  )
}
const to_srgb = (val: number) =>
  val <= 0.0031308 ? 12.92 * val : 1.055 * val ** (1 / 2.4) - 0.055
const to_linear = (val: number) =>
  val <= 0.04045 ? val / 12.92 : ((val + 0.055) / 1.055) ** 2.4

test.each([1, 0.8, 1.5])(
  `agx(untone(color)) returns the color within 1/255 sRGB at exposure %s`,
  (exposure) => {
    const rng = make_rng(7)
    let max_error = 0
    for (let sample = 0; sample < 2000; sample++) {
      const srgb: Vec3 = [0, 1, 2].map(() => rng()) as Vec3
      const round_trip = agx(untone(each(srgb, to_linear), exposure), exposure)
      for (const [channel, val] of round_trip.entries())
        max_error = Math.max(max_error, Math.abs(to_srgb(val) - srgb[channel]))
    }
    expect(max_error).toBeLessThan(1 / 255)
  },
)

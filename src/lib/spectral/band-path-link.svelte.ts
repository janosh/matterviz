// Links a band plot to the band structure's k-path drawn in a Brillouin zone: hovering a band
// point marks its k-point and shades its path branch (e.g. Γ→X), hovering the k-path marks the
// q-point on the bands
import type { KPathData } from '#lib/brillouin/types.js'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import { is_finite_vec3 } from '#lib/math.js'
import type { BandPointMeta } from './helpers'
import { band_k_path, branch_qpoint_range, find_qpoint_at_rescaled_x } from './helpers'
import type { BaseBandStructure } from './types'

// The band and q-point a Bands point stands for, read from its metadata (null for points
// without band metadata, e.g. a caller's own series)
export const band_point_meta = (
  metadata: Record<string, unknown> | null | undefined,
): Pick<BandPointMeta, `band_idx` | `qpoint_idx` | `frac_coords`> | null => {
  const { band_idx, qpoint_idx, frac_coords } = metadata ?? {}
  if (typeof band_idx !== `number` || typeof qpoint_idx !== `number`) return null
  return {
    band_idx,
    qpoint_idx,
    frac_coords: is_finite_vec3(frac_coords) ? frac_coords : null,
  }
}

// The parts of a Bands on_point_hover event the link reads (a ScatterHandlerEvent fits)
export interface BandHover {
  x: number
  metadata?: Record<string, unknown> | null
}

export function create_band_path_link(inputs: {
  band_struct: () => BaseBandStructure | null | undefined // whose k-path the zone draws
  k_lattice: () => Matrix3x3 | undefined // reciprocal lattice incl. 2π, as the zone's
  // Bands' x_positions, needed only when Bands plots more structures than band_struct: their
  // points carry their own q-point indices, so they map onto band_struct's path by x
  x_positions?: () => Record<string, Vec2> | undefined
}) {
  const k_path = $derived.by((): KPathData | undefined => {
    const [band_struct, k_lattice] = [inputs.band_struct(), inputs.k_lattice()]
    return band_struct && k_lattice ? band_k_path(band_struct, k_lattice) : undefined
  })

  let band_hover = $state.raw<BandHover | null>(null)
  let path_qpoint = $state<number | null>(null)
  // q-point of band_struct under the hovered band point
  const band_qpoint = $derived.by((): number | null => {
    const band_struct = inputs.band_struct()
    if (!band_hover || !band_struct) return null
    const point = band_point_meta(band_hover.metadata)
    if (!point) return null
    // a point of band_struct itself names its q-point exactly
    const own_coords = band_struct.qpoints[point.qpoint_idx]?.frac_coords
    const is_own =
      own_coords && point.frac_coords?.every((coord, idx) => coord === own_coords[idx])
    if (is_own) return point.qpoint_idx
    const x_positions = inputs.x_positions?.()
    return x_positions && Object.keys(x_positions).length > 0
      ? find_qpoint_at_rescaled_x(band_struct, band_hover.x, x_positions)
      : null
  })
  // a band hover wins over a k-path hover
  const active_qpoint = $derived(band_qpoint ?? path_qpoint)
  const hovered_k_point = $derived(
    active_qpoint === null ? null : (k_path?.points[active_qpoint] ?? null),
  )
  const highlighted_qpoint_range = $derived.by((): Vec2 | null => {
    const band_struct = inputs.band_struct()
    return active_qpoint === null || !band_struct
      ? null
      : branch_qpoint_range(band_struct, active_qpoint)
  })

  return {
    get k_path(): KPathData | undefined {
      return k_path
    },
    get active_qpoint(): number | null {
      return active_qpoint
    },
    get hovered_k_point(): Vec3 | null {
      return hovered_k_point
    },
    get highlighted_qpoint_range(): Vec2 | null {
      return highlighted_qpoint_range
    },
    // Bands on_point_hover (null when the pointer leaves the bands)
    hover_band: (event: BandHover | null) => (band_hover = event),
    // BrillouinZone on_kpath_hover
    hover_path: (qpoint_idx: number | null) => (path_qpoint = qpoint_idx),
  }
}

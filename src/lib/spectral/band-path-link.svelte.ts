// Links a band plot to the band structure's k-path drawn in a Brillouin zone: hovering a band
// point marks its k-point and shades its path branch (e.g. Γ→X), hovering the k-path marks the
// q-point on the bands
import type { KPathData } from '#lib/brillouin/types'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math'
import { is_finite_vec3 } from '#lib/math'
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

// The q-point of `band_struct` a band hover stands for: a point of band_struct itself names it
// exactly, one of another structure plotted beside it maps onto band_struct's path by x
export function band_hover_qpoint(
  band_struct: BaseBandStructure,
  hover: BandHover,
  x_positions: Record<string, Vec2> | undefined,
): number | null {
  const point = band_point_meta(hover.metadata)
  if (!point) return null
  const own_coords = band_struct.qpoints[point.qpoint_idx]?.frac_coords
  const is_own =
    own_coords && point.frac_coords?.every((coord, idx) => coord === own_coords[idx])
  if (is_own) return point.qpoint_idx
  return x_positions && Object.keys(x_positions).length > 0
    ? find_qpoint_at_rescaled_x(band_struct, hover.x, x_positions)
    : null
}

interface BandPathLinkInputs {
  band_struct: () => BaseBandStructure | null | undefined // whose k-path the zone draws
  k_lattice: () => Matrix3x3 | undefined // reciprocal lattice incl. 2π, as the zone's
  // Bands' x_positions, needed only when Bands plots more structures than band_struct: their
  // points carry their own q-point indices, so they map onto band_struct's path by x
  x_positions?: () => Record<string, Vec2> | undefined
}

class BandPathLink {
  private band_hover = $state.raw<BandHover | null>(null)
  private path_qpoint = $state<number | null>(null)
  constructor(private readonly inputs: BandPathLinkInputs) {}

  readonly k_path = $derived.by((): KPathData | undefined => {
    const [band_struct, k_lattice] = [this.inputs.band_struct(), this.inputs.k_lattice()]
    return band_struct && k_lattice ? band_k_path(band_struct, k_lattice) : undefined
  })
  // q-point of band_struct under the hovered band point
  private readonly band_qpoint = $derived.by((): number | null => {
    const band_struct = this.inputs.band_struct()
    return this.band_hover && band_struct
      ? band_hover_qpoint(band_struct, this.band_hover, this.inputs.x_positions?.())
      : null
  })
  // a band hover wins over a k-path hover
  readonly active_qpoint = $derived(this.band_qpoint ?? this.path_qpoint)
  readonly hovered_k_point = $derived.by((): Vec3 | null =>
    this.active_qpoint === null ? null : (this.k_path?.points[this.active_qpoint] ?? null),
  )
  readonly highlighted_qpoint_range = $derived.by((): Vec2 | null => {
    const band_struct = this.inputs.band_struct()
    return this.active_qpoint === null || !band_struct
      ? null
      : branch_qpoint_range(band_struct, this.active_qpoint)
  })
  // Bands on_point_hover (null when the pointer leaves the bands)
  hover_band = (event: BandHover | null) => (this.band_hover = event)
  // BrillouinZone on_kpath_hover
  hover_path = (qpoint_idx: number | null) => (this.path_qpoint = qpoint_idx)
}

export const create_band_path_link = (inputs: BandPathLinkInputs): BandPathLink =>
  new BandPathLink(inputs)

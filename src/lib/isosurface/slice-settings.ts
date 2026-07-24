import type { D3InterpolateName } from '$lib/colors'
import type { Vec2, Vec3 } from '$lib/math'
import type { VolumeSliceMode } from './slice-rendering'

export type VolumeSlicePlaneMode = `hkl` | `cartesian`

/** User-configurable plane sampling and rendering options for a volumetric slice. */
export interface VolumeSliceSettings {
  plane_mode: VolumeSlicePlaneMode
  miller_indices: Vec3
  position: number
  cartesian_point?: Vec3
  cartesian_normal: Vec3
  cartesian_up: Vec3
  resolution: number
  render_mode: VolumeSliceMode
  colormap: D3InterpolateName
  contour_levels: number
  color_range?: Vec2
  symmetric: boolean | `auto`
}

export const DEFAULT_VOLUME_SLICE_SETTINGS: Readonly<VolumeSliceSettings> = {
  plane_mode: `hkl`,
  miller_indices: [0, 0, 1],
  position: 0.5,
  cartesian_normal: [0, 0, 1],
  cartesian_up: [1, 0, 0],
  resolution: 512,
  render_mode: `both`,
  colormap: `interpolateRdBu`,
  contour_levels: 10,
  symmetric: `auto`,
}

/** Return independent slice settings so nested vectors never leak across viewers. */
export function create_volume_slice_settings(
  overrides: Partial<VolumeSliceSettings> = {},
): VolumeSliceSettings {
  const {
    miller_indices = DEFAULT_VOLUME_SLICE_SETTINGS.miller_indices,
    cartesian_point,
    cartesian_normal = DEFAULT_VOLUME_SLICE_SETTINGS.cartesian_normal,
    cartesian_up = DEFAULT_VOLUME_SLICE_SETTINGS.cartesian_up,
    color_range,
    ...rest
  } = overrides
  return {
    ...DEFAULT_VOLUME_SLICE_SETTINGS,
    ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
    miller_indices: [...miller_indices] as Vec3,
    cartesian_point: cartesian_point ? ([...cartesian_point] as Vec3) : undefined,
    cartesian_normal: [...cartesian_normal] as Vec3,
    cartesian_up: [...cartesian_up] as Vec3,
    color_range: color_range ? ([...color_range] as Vec2) : undefined,
  }
}

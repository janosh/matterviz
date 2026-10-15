import type { Vec3 } from '#lib/math.js'
import type { ColorScale } from '#lib/plot/core/types.js'
import type { VolumeSliceMode } from './slice-rendering'

export type VolumeSlicePlaneMode = `hkl` | `cartesian`

// User-configurable plane sampling and rendering options for a volumetric slice.
export interface VolumeSliceSettings {
  plane_mode: VolumeSlicePlaneMode
  miller_indices: Vec3
  position: number
  cartesian_point?: Vec3
  cartesian_normal: Vec3
  cartesian_up: Vec3
  resolution: number
  render_mode: VolumeSliceMode
  color_scale: ColorScale // unset value_range ends fit the slice
  contour_levels: number
  symmetric: boolean | `auto`
  // Mark the slice plane in an accompanying 3D view (Structure's split layout)
  show_plane: boolean
}

const DEFAULT_VOLUME_SLICE_SETTINGS: Readonly<VolumeSliceSettings> = {
  plane_mode: `hkl`,
  miller_indices: [0, 0, 1],
  position: 0.5,
  cartesian_normal: [0, 0, 1],
  cartesian_up: [1, 0, 0],
  resolution: 1024,
  render_mode: `both`,
  color_scale: `interpolateRdBu`,
  contour_levels: 10,
  symmetric: `auto`,
  show_plane: true,
}

// Return independent slice settings so nested vectors never leak across viewers.
export function create_volume_slice_settings(
  overrides: Partial<VolumeSliceSettings> = {},
): VolumeSliceSettings {
  const {
    miller_indices = DEFAULT_VOLUME_SLICE_SETTINGS.miller_indices,
    cartesian_point,
    cartesian_normal = DEFAULT_VOLUME_SLICE_SETTINGS.cartesian_normal,
    cartesian_up = DEFAULT_VOLUME_SLICE_SETTINGS.cartesian_up,
    color_scale = DEFAULT_VOLUME_SLICE_SETTINGS.color_scale,
    ...rest
  } = overrides
  return {
    ...DEFAULT_VOLUME_SLICE_SETTINGS,
    ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
    miller_indices: [...miller_indices] as Vec3,
    cartesian_point: cartesian_point ? ([...cartesian_point] as Vec3) : undefined,
    cartesian_normal: [...cartesian_normal] as Vec3,
    cartesian_up: [...cartesian_up] as Vec3,
    color_scale:
      typeof color_scale === `string`
        ? color_scale
        : {
            ...color_scale,
            value_range: color_scale.value_range && [...color_scale.value_range],
          },
  }
}

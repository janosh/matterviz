// 3D plot types (scatter points, surfaces, axes, handlers) extending the 2D vocabulary.
// Imports the 2D core types from the barrel and is re-exported by it; nothing in core depends on
// these, so that re-export cycle is type-only (erased at build, hence harmless).

import type { Point3D, Vec2, Vec3 } from '$lib/math'
import type {
  AxisConfig,
  ControlsConfig,
  DataSeries,
  DisplayConfig,
  HandlerProps,
  Point,
  PointStyle,
  StyleOverrides,
} from '$lib/plot/core/types'

// 3D point extending base Point with z coordinate (prefixed to avoid conflict with convex-hull)
export interface ScatterPoint3D<Metadata = Record<string, unknown>> extends Point<Metadata> {
  z: number
}

// 3D data series extending DataSeries with z array
// Omit filtered_data since it uses 2D InternalPoint type, redeclare with 3D type
export interface DataSeries3D<Metadata = Record<string, unknown>> extends Omit<
  DataSeries<Metadata>,
  `y_axis` | `filtered_data`
> {
  z: readonly number[]
  filtered_data?: InternalPoint3D<Metadata>[]
}

// Internal 3D point for processing within ScatterPlot3D
export interface InternalPoint3D<
  Metadata = Record<string, unknown>,
> extends ScatterPoint3D<Metadata> {
  series_idx: number
  point_idx: number
  color_value?: number | null
  size_value?: number | null
  point_style?: PointStyle
}

// Surface types for 3D visualization
export type SurfaceType = `grid` | `parametric` | `triangulated`

// Configuration for 3D surfaces
export interface Surface3DConfig {
  id?: string | number
  type: SurfaceType
  // For grid surfaces: regular grid with z values
  x_range?: Vec2
  y_range?: Vec2
  resolution?: number | Vec2 // grid resolution (x, y)
  z_fn?: (x: number, y: number) => number
  // For parametric surfaces: u,v parameterization
  u_range?: Vec2
  v_range?: Vec2
  parametric_fn?: (u: number, v: number) => Point3D
  // For triangulated surfaces: explicit geometry (only x,y,z needed, not scatter-specific fields)
  points?: Point3D[]
  triangles?: Vec3[] // indices into points array
  // Appearance
  color?: string
  color_fn?: (x: number, y: number, z: number) => string
  opacity?: number
  wireframe?: boolean
  wireframe_color?: string
  wireframe_width?: number
  visible?: boolean
  // Double-sided rendering
  double_sided?: boolean
}

// Extended axis config for 3D (same as 2D but can add 3D-specific options)
export interface AxisConfig3D extends AxisConfig {
  // 3D-specific axis options can be added here
  show_plane?: boolean // Show grid plane for this axis
  plane_opacity?: number
}

// Display config extended for 3D
export interface DisplayConfig3D extends DisplayConfig {
  z_grid?: boolean
  z_zero_line?: boolean
  show_axes?: boolean
  show_axis_labels?: boolean
  show_bounding_box?: boolean
  show_grid?: boolean
  // Projection settings - render point shadows on background planes
  // Coordinate mapping: user X→Three.js X, user Y→Three.js Z, user Z→Three.js Y
  projections?: {
    xy?: boolean // Project onto XY plane (floor/ceiling) - fixes user Z
    xz?: boolean // Project onto XZ plane (back wall) - fixes user Y
    yz?: boolean // Project onto YZ plane (side wall) - fixes user X
  }
  projection_opacity?: number // 0-1, default 0.3
  projection_scale?: number // Relative to point size, default 0.5
}

// 3D scatter handler props
export interface Scatter3DHandlerProps<Metadata = Record<string, unknown>> extends Omit<
  HandlerProps<Metadata>,
  `x_axis` | `x2_axis` | `y_axis` | `y2_axis`
> {
  z: number
  x_axis: AxisConfig3D
  y_axis: AxisConfig3D
  z_axis: AxisConfig3D
  x_formatted: string
  y_formatted: string
  z_formatted: string
  color_value?: number | null
}

export type Scatter3DHandlerEvent<Metadata = Record<string, unknown>> =
  Scatter3DHandlerProps<Metadata> & {
    event?: MouseEvent
    point: InternalPoint3D<Metadata>
  }

// Camera projection types for 3D
export type CameraProjection3D = `perspective` | `orthographic`

// 3D plot config extending base
export interface PlotConfig3D {
  x_axis?: AxisConfig3D
  y_axis?: AxisConfig3D
  z_axis?: AxisConfig3D
  display?: DisplayConfig3D
}

// 3D style overrides
export interface StyleOverrides3D extends StyleOverrides {
  point?: StyleOverrides[`point`] & {
    sphere_segments?: number // Level of detail for sphere geometry
  }
}

// Controls config for 3D
export interface ControlsConfig3D extends ControlsConfig {
  show_camera_controls?: boolean
  show_surface_controls?: boolean
}

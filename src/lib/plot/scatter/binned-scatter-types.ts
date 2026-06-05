import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
import type { DenseInternalPoint } from '$lib/plot/scatter/adaptive-density'
import type ColorBar from '$lib/plot/core/components/ColorBar.svelte'
import type {
  LabelPlacementConfig,
  ScaleType,
  ScatterHandlerProps,
} from '$lib/plot/core/types'
import type { ComponentProps, Snippet } from 'svelte'

export type BinnedColorScaleConfig =
  | {
      type?: ScaleType
      scheme?: D3ColorSchemeName | D3InterpolateName
      value_range?: [number, number]
    }
  | D3InterpolateName

export type BinnedSizeScaleConfig = {
  type?: ScaleType
  radius_range?: [number, number]
  value_range?: [number, number]
  pick_radius?: number | `auto`
}

export type BinnedDensityConfig = {
  bin_px?: number
  color_scale?: BinnedColorScaleConfig
  color_bar?: ComponentProps<typeof ColorBar> | null
  auto_point_mode?: false | { max_points?: number; max_points_per_px?: number }
  bin_click?: `zoom` | `point` | `none`
}

export type BinnedRefLine = {
  x1: number
  y1: number
  x2: number
  y2: number
  color?: string
  dash?: string
  width?: number
}

export type BinnedOverlaysConfig = {
  ref_lines?: BinnedRefLine[]
}

export type BinnedPointBasePayload<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> = ScatterHandlerProps<Metadata> & {
  point: DenseInternalPoint<Metadata>
  color?: string
}

export type BinnedPointDataFn<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  PointData extends Record<string, unknown> = Record<string, unknown>,
> = (payload: BinnedPointBasePayload<Metadata>) => PointData | null | undefined

export type BinnedPointPayload<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  PointData extends Record<string, unknown> = Record<string, unknown>,
> = BinnedPointBasePayload<Metadata> & {
  point_data?: PointData
}

export type BinnedPointTooltipPayload<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  PointData extends Record<string, unknown> = Record<string, unknown>,
> = BinnedPointPayload<Metadata, PointData>

export type BinnedPointLabelPlacementConfig = Partial<LabelPlacementConfig>

export type BinnedPointLabelsConfig<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  PointData extends Record<string, unknown> = Record<string, unknown>,
> = {
  render?: Snippet<[BinnedPointPayload<Metadata, PointData>]>
  measure_text?: (payload: BinnedPointPayload<Metadata, PointData>) => string
  font_size?: string
  max_count?: number
  gap_px?: number
  placement?: BinnedPointLabelPlacementConfig
  leaders?: {
    min_length_px?: number
  }
}

import type { D3InterpolateName } from '$lib/colors'
import type { DenseInternalPoint } from '$lib/plot/scatter/adaptive-density'
import type ColorBar from '$lib/plot/core/components/ColorBar.svelte'
import type {
  ColorScaleConfig,
  LabelPlacementConfig,
  RefLine,
  ScatterHandlerProps,
  SizeScaleConfig,
} from '$lib/plot/core/types'
import { SCALE_DEFAULTS } from '$lib/plot/core/types'
import type { ComponentProps, Snippet } from 'svelte'

export type BinnedColorScaleConfig = ColorScaleConfig | D3InterpolateName

export type BinnedSizeScaleConfig = SizeScaleConfig & { pick_radius?: number | `auto` }

export const DEFAULT_BINNED_SIZE_SCALE: BinnedSizeScaleConfig = {
  type: `linear`,
  radius_range: SCALE_DEFAULTS.binned_radius,
  pick_radius: SCALE_DEFAULTS.binned_radius[1],
}

export type BinnedDensityConfig = {
  bin_px?: number
  color_scale?: BinnedColorScaleConfig
  color_bar?: ComponentProps<typeof ColorBar> | null
  auto_point_mode?: false | { max_points?: number; max_points_per_px?: number }
  bin_click?: `zoom` | `point` | `none`
}

// legacy explicit-endpoint form; prefer the declarative RefLine union (e.g.
// { type: `diagonal`, slope: 1, intercept: 0 }), which is resolved against the
// current axis ranges so lines span the full plot area and stay correct under zoom
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
  // RefLine entries render geometry + style only for now: annotation, legend and
  // interaction fields (label, on_click, ...) are ignored by BinnedScatterPlot
  ref_lines?: (BinnedRefLine | RefLine)[]
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

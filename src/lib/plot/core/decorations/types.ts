import type { Rect, Sides } from '#lib/plot/core/layout.js'
import type { LegendTrackSuggestionConfig } from './tracks'

export type DecorationKind = `legend` | `colorbar` | `free-annotation` | `reference-annotation`
export type DecorationSide = `top` | `right` | `bottom` | `left`
export type DecorationPoint = { x: number; y: number }
export type DecorationSize = { width: number; height: number }
// What a decoration must not cover: a point, or a rect (a bar, a bin) when it has a size
export type Obstacle = DecorationPoint & Partial<DecorationSize>
export type ReferenceAnnotationPosition = `start` | `center` | `end`
export type ReferenceAnnotationSide = `above` | `below` | `left` | `right`
export type ReferenceAnnotationTextAnchor = `start` | `middle` | `end`
export type ReferenceAnnotationBaseline = `auto` | `middle` | `hanging`

// Candidate geometry is complete and renderable. `rect` is the rotated axis-aligned footprint
// used for collision tests, while x/y remain the SVG text anchor and rotation pivot.
export type ReferenceAnnotationCandidate = {
  position: ReferenceAnnotationPosition
  side: ReferenceAnnotationSide
  x: number
  y: number
  text_anchor: ReferenceAnnotationTextAnchor
  dominant_baseline: ReferenceAnnotationBaseline
  rotation?: number
  rect: Rect
}

type DecorationItemBase = {
  id: string
  footprint: DecorationSize
  clearance?: number
}

export type LegendAutoTrackConfig = Omit<
  LegendTrackSuggestionConfig,
  `available_edge_length`
> & {
  // Omit this to use the decoration-independent base plot edge.
  available_edge_length?: number
}

export type LegendDecorationItem = DecorationItemBase & {
  kind: `legend`
  auto_tracks?: LegendAutoTrackConfig
  // A legend whose layout follows its placement (PlotLegend's `wrap` below the plot) is placed
  // inside as the column it takes there (capped at the plot height), sized for the right/below
  // choice by that column, and below by the row it wraps into; `footprint` (its rendered box)
  // places it on the right
  column_footprint?: DecorationSize
  strip_footprint?: DecorationSize
}

export type ColorbarDecorationItem = DecorationItemBase & {
  kind: `colorbar`
  horizontal?: boolean
}

export type FreeAnnotationDecorationItem = DecorationItemBase & {
  kind: `free-annotation`
}

export type ReferenceAnnotationDecorationItem = DecorationItemBase & {
  kind: `reference-annotation`
  candidates: readonly ReferenceAnnotationCandidate[]
  // Pinned annotations keep their sole explicit candidate even when it collides.
  pinned?: boolean
}

export type DecorationItem =
  | LegendDecorationItem
  | ColorbarDecorationItem
  | FreeAnnotationDecorationItem
  | ReferenceAnnotationDecorationItem

// Obstacles use normalized plot coordinates: x/y=0 is the plot's top-left and x/y=1 its
// bottom-right, so they follow the plot box as outside reservations shrink it.
export type DecorationScene = {
  width: number
  height: number
  base_pad: Required<Sides>
  // Bands between the data area and outside decorations, such as marginal distributions.
  reserved_pad?: Required<Sides>
  // What the axes alone need per side (tick labels, titles), before any caller padding.
  // Outside reservations stack on this rather than on base_pad, so a caller whose padding
  // already leaves room beyond the axis (a sibling panel's legend band) gets the decoration
  // in that room instead of on top of it. Defaults to base_pad.
  axis_pad?: Required<Sides>
  obstacles_norm: readonly Obstacle[]
  // Host-owned exclusions: pinned decorations (a dragged or styled legend, colorbar).
  exclusion_rects?: readonly Rect[]
  items: readonly DecorationItem[]
  gap?: number
}

export type DecorationPlacement = {
  id: string
  kind: DecorationKind
  footprint: DecorationSize
  x: number
  y: number
  location: `interior` | `outside`
  side: DecorationSide | null
  layout_tracks?: number
  reference_annotation?: ReferenceAnnotationCandidate
}

export type DecorationSolution = {
  base_pad: Required<Sides>
  pad: Required<Sides>
  plot_bounds: Rect
  placements: DecorationPlacement[]
}

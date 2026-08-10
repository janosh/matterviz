import type { Rect, Sides } from '$lib/plot/core/layout'
import type { LegendTrackSuggestionConfig } from './tracks'

export type DecorationKind = `legend` | `colorbar` | `free-annotation` | `reference-annotation`
type DecorationSide = `top` | `right` | `bottom` | `left`
export type DecorationPoint = { x: number; y: number }
export type DecorationSize = { width: number; height: number }
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
}

export type ColorbarDecorationItem = DecorationItemBase & {
  kind: `colorbar`
  horizontal?: boolean
}

type FreeAnnotationDecorationItem = DecorationItemBase & {
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
// bottom-right. Keeping them independent of padding prevents outside reservations from changing
// the crowding decision that created those reservations.
export type DecorationScene = {
  width: number
  height: number
  base_pad: Required<Sides>
  obstacles_norm: readonly DecorationPoint[]
  // Pixel obstacles are already expressed in the final SVG coordinate system.
  obstacles_px?: readonly DecorationPoint[]
  // Host-owned exclusions such as in-plot controls or previously reserved labels.
  exclusion_rects?: readonly Rect[]
  items: readonly DecorationItem[]
  gap?: number
  grid_resolution?: number
}

export type DecorationPlacement = {
  id: string
  kind: DecorationKind
  footprint: DecorationSize
  x: number
  y: number
  score: number | null
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

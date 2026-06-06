// === Sankey diagram types ===
// Public input/event types for the Sankey component; layout-result types
// (PositionedNode/PositionedLink) live in sankey.ts next to the layout math.

// Flow direction: 'horizontal' = columns left->right, 'vertical' = columns top->bottom
export type SankeyOrientation = `horizontal` | `vertical`
// Maps to d3-sankey alignment functions (sankeyLeft/Right/Center/Justify)
export type SankeyNodeAlign = `left` | `right` | `center` | `justify`
// How each link ribbon derives its color when no explicit link.color is set
export type SankeyLinkColorMode = `source` | `target` | `gradient` | `static`

export interface SankeyNode<Metadata = Record<string, unknown>> {
  id?: string | number // stable id (defaults to array index); referenced by links
  label?: string
  color?: string // defaults to cycled DEFAULT_SERIES_COLORS
  metadata?: Metadata
}

export interface SankeyLink<Metadata = Record<string, unknown>> {
  source: number | string // node id, or zero-based index into nodes
  target: number | string // node id, or zero-based index into nodes
  value: number // flow magnitude (controls ribbon thickness)
  color?: string // overrides link_color_mode for this link
  label?: string
  metadata?: Metadata
}

export interface SankeyData<Metadata = Record<string, unknown>> {
  nodes: SankeyNode<Metadata>[]
  links: SankeyLink<Metadata>[]
}

export interface SankeyNodeHandlerProps<Metadata = Record<string, unknown>> {
  type: `node`
  node_idx: number
  id: string | number
  label?: string
  value: number // sum of incoming/outgoing link values
  color: string
  metadata?: Metadata
}

export interface SankeyLinkHandlerProps<Metadata = Record<string, unknown>> {
  type: `link`
  link_idx: number
  source_idx: number
  target_idx: number
  source_label?: string
  target_label?: string
  value: number
  color: string
  metadata?: Metadata
}

export type SankeyHandlerProps<Metadata = Record<string, unknown>> =
  | SankeyNodeHandlerProps<Metadata>
  | SankeyLinkHandlerProps<Metadata>

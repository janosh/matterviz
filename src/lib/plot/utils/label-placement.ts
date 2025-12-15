import type { AxisConfig, DataSeries, XyObj } from '$lib/plot'
import type { LabelNode, LabelPlacementConfig } from '$lib/plot/types'
import { forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import type { ScaleContinuousNumeric, ScaleTime } from 'd3-scale'

type ScaleFn = ScaleContinuousNumeric<number, number> | ScaleTime<number, number>

export interface AnchorNode {
  id: string
  fx: number
  fy: number
  point_radius: number
}

function parse_font_size(size_str?: string): number {
  if (!size_str) return 12
  const match = size_str.match(/^(\d+(?:\.\d+)?)(px|em|rem)?$/)
  if (!match) return 12
  const value = parseFloat(match[1])
  return match[2] === `em` || match[2] === `rem` ? value * 16 : value
}

export function compute_label_positions(
  filtered_series: DataSeries[],
  config: LabelPlacementConfig & {
    max_labels?: number
    charge_strength?: number
    charge_distance_max?: number
  },
  scales: {
    x_scale_fn: ScaleFn
    y_scale_fn: ScaleFn
    y2_scale_fn: ScaleFn
    x_axis: AxisConfig
  },
  bounds: {
    width: number
    height: number
    pad: { t: number; b: number; l: number; r: number }
  },
): Record<string, XyObj> {
  const { width, height, pad } = bounds
  const { x_scale_fn, y_scale_fn, y2_scale_fn, x_axis } = scales

  const label_nodes: LabelNode[] = []
  const anchor_nodes: AnchorNode[] = []
  const links: { source: string; target: string }[] = []

  for (const series of filtered_series) {
    for (const pt of series.filtered_data ?? []) {
      if (!pt.point_label?.auto_placement || !pt.point_label.text) continue

      const ax = x_axis.format?.startsWith(`%`)
        ? x_scale_fn(new Date(pt.x))
        : x_scale_fn(pt.x)
      const ay = (series.y_axis === `y2` ? y2_scale_fn : y_scale_fn)(pt.y)
      const id = `${pt.series_idx}-${pt.point_idx}`
      const font_size = parse_font_size(pt.point_label.font_size)
      const w = pt.point_label.text.length * font_size * 0.6 + 10
      const h = font_size * 1.2
      const r = pt.point_style?.radius ?? 3

      label_nodes.push({
        id,
        anchor_x: ax,
        anchor_y: ay,
        point_node: pt,
        label_width: w,
        label_height: h,
        x: ax + (pt.point_label.offset?.x ?? 5),
        y: ay + (pt.point_label.offset?.y ?? r + h / 2 + 3),
      })
      anchor_nodes.push({ id: `anchor-${id}`, fx: ax, fy: ay, point_radius: r })
      links.push({ source: id, target: `anchor-${id}` })
    }
  }

  if (label_nodes.length === 0) return {}
  if (config.max_labels && label_nodes.length > config.max_labels) {
    return Object.fromEntries(
      label_nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
    )
  }

  const sim = forceSimulation([...label_nodes, ...anchor_nodes])
    .force(
      `link`,
      forceLink(links).id((d) => (d as { id: string }).id).distance(config.link_distance)
        .strength(config.link_strength),
    )
    .force(
      `collide`,
      forceCollide().radius((n) => {
        const l = n as LabelNode
        const a = n as AnchorNode
        return l.label_width
          ? Math.sqrt(l.label_width ** 2 + l.label_height ** 2) / 2 + 2
          : (a.point_radius ?? 0) + 2
      }).strength(config.collision_strength),
    )
    .force(
      `charge`,
      forceManyBody().strength((n) => {
        const a = n as AnchorNode
        return a.point_radius !== undefined && a.fx !== undefined
          ? -(config.charge_strength ?? 50)
          : 0
      }).distanceMax(config.charge_distance_max ?? 30),
    )

  sim.stop().tick(config.placement_ticks)

  const [min_dist, max_dist] = config.link_distance_range ?? [null, null]
  const result: Record<string, XyObj> = {}

  for (const node of label_nodes) {
    const node_x = node.x ?? 0
    const node_y = node.y ?? 0
    let x = Math.max(
      pad.l + node.label_width / 2,
      Math.min(width - pad.r - node.label_width / 2, node_x),
    )
    let y = Math.max(
      pad.t + node.label_height / 2,
      Math.min(height - pad.b - node.label_height / 2, node_y),
    )

    if (min_dist || max_dist) {
      const dx = x - node.anchor_x
      const dy = y - node.anchor_y
      const dist = Math.sqrt(dx ** 2 + dy ** 2)
      if (max_dist && dist > max_dist) {
        const s = max_dist / dist
        x = node.anchor_x + dx * s
        y = node.anchor_y + dy * s
      } else if (min_dist && dist > 0 && dist < min_dist) {
        const s = min_dist / dist
        x = node.anchor_x + dx * s
        y = node.anchor_y + dy * s
      }
    }
    result[node.id] = { x, y }
  }

  return result
}

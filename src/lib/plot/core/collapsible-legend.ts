import type { LegendConfig } from '$lib/plot/core/types'
import type { Attachment } from 'svelte/attachments'
import { SvelteSet } from 'svelte/reactivity'
import { dismiss_on_outside_press } from 'svelte-widgets/attachments'

export type CollapsibleLegend = {
  // Spread into a chart's LegendConfig: `legend={{ ...my_legend, ...collapsible.legend }}`
  legend: Required<Pick<LegendConfig, `collapsed_groups` | `on_group_toggle`>>
  collapsed_groups: SvelteSet<string>
  toggle_group: (group: string) => void
  // Collapse one group, or with no argument every group this helper has seen
  collapse: (group?: string) => void
  // Attach to the element wrapping the plot (and any controls that should count as outside)
  collapse_on_outside_click: Attachment<HTMLElement>
}

// Legend groups that expand/collapse on group-header click and re-collapse on a click
// anywhere outside the legend, e.g. a long per-model legend that should stay out of the
// way until opened. Pass the groups to start collapsed.
export const create_collapsible_legend = (
  initially_collapsed: Iterable<string> = [],
): CollapsibleLegend => {
  const collapsed_groups = new SvelteSet(initially_collapsed)
  // groups collapse() without argument re-collapses (non-reactive bookkeeping)
  const known_groups = new Set(collapsed_groups)
  const toggle_group = (group: string) => {
    known_groups.add(group)
    if (!collapsed_groups.delete(group)) collapsed_groups.add(group)
  }
  const collapse = (group?: string) => {
    if (group !== undefined) {
      known_groups.add(group)
      collapsed_groups.add(group)
    } else for (const known of known_groups) collapsed_groups.add(known)
  }
  // Only the legend counts as inside — a click on the plot or the controls above it
  // collapses too — so pass the surface as `inside` rather than attaching to `node` (which
  // click_outside would treat as inside). `scope` keeps a sibling figure's legend from
  // counting. `release` listens for click, not pointerdown, matching the legend's own
  // toggles, and the listener is capture-phase either way, so it still sees clicks whose
  // inner handlers stop propagation.
  const collapse_on_outside_click: Attachment<HTMLElement> = (node) =>
    dismiss_on_outside_press({
      inside: [`.legend`],
      scope: node,
      dismiss_on: `release`,
      callback: () => collapse(),
    })
  return {
    legend: { collapsed_groups, on_group_toggle: toggle_group },
    collapsed_groups,
    toggle_group,
    collapse,
    collapse_on_outside_click,
  }
}

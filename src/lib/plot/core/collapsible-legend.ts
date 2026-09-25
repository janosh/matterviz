import type { LegendConfig } from '$lib/plot/core/types'
import type { Attachment } from 'svelte/attachments'
import { SvelteSet } from 'svelte/reactivity'
import { dismiss_on_outside_press } from 'svelte-widgets/attachments'

export type CollapsibleLegend = {
  // Spread into a chart's LegendConfig: `legend={{ ...my_legend, ...collapsible.legend }}`
  legend: Required<Pick<LegendConfig, `collapsed_groups` | `group_click`>>
  collapsed_groups: SvelteSet<string>
  toggle_group: (group: string) => void
  // Collapse one group, or with no argument restore the initially collapsed groups
  collapse: (group?: string) => void
  // Attach to the element wrapping the plot (and any controls that should count as outside)
  collapse_on_outside_click: Attachment<HTMLElement>
}

// Legend groups that expand on header click and re-collapse on a click outside the legend,
// e.g. a long per-model legend that stays out of the way until opened. `group_click:
// 'collapse'` keeps the header an expand toggle, so opening a group never hides its series.
export const create_collapsible_legend = (
  initially_collapsed: Iterable<string> = [],
): CollapsibleLegend => {
  const initial_groups = [...initially_collapsed]
  const collapsed_groups = new SvelteSet(initial_groups)
  const toggle_group = (group: string) => {
    if (!collapsed_groups.delete(group)) collapsed_groups.add(group)
  }
  // Restores the initial groups rather than tracking toggles, since PlotLegend's header
  // edits collapsed_groups directly
  const collapse = (group?: string) => {
    for (const name of group === undefined ? initial_groups : [group])
      collapsed_groups.add(name)
  }
  // Only the legend counts as inside (clicks on the plot or its controls collapse too), and
  // `scope` keeps a sibling figure's legend from counting. `release` waits for click like the
  // legend's own toggles; the capture-phase listener still sees clicks that stop propagation.
  const collapse_on_outside_click: Attachment<HTMLElement> = (node) =>
    dismiss_on_outside_press({
      inside: [`.legend`],
      scope: node,
      dismiss_on: `release`,
      callback: () => collapse(),
    })
  return {
    legend: { collapsed_groups, group_click: `collapse` },
    collapsed_groups,
    toggle_group,
    collapse,
    collapse_on_outside_click,
  }
}

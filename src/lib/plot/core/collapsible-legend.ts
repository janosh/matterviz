import type { Attachment } from 'svelte/attachments'
import { SvelteSet } from 'svelte/reactivity'
import { dismiss_on_outside_press } from 'svelte-widgets/attachments'

export type CollapsibleLegend = ReturnType<typeof create_collapsible_legend>

// Legend groups that expand on header click and re-collapse on a click outside the legend.
// Spread `legend` into a chart's LegendConfig; `group_click: 'collapse'` keeps the header an
// expand toggle, so opening a group never hides its series.
export const create_collapsible_legend = (initially_collapsed: Iterable<string> = []) => {
  const initial_groups = [...initially_collapsed]
  const collapsed_groups = new SvelteSet(initial_groups)
  // Attach to the element wrapping the plot. Only the legend counts as inside, `scope` keeps a
  // sibling figure's legend from counting, and `release` waits for click like the legend's own
  // toggles. Restores the initial groups however the header or chevrons toggled them.
  const collapse_on_outside_click: Attachment<HTMLElement> = (node) =>
    dismiss_on_outside_press({
      inside: [`.legend`],
      scope: node,
      dismiss_on: `release`,
      callback: () => initial_groups.forEach((group) => collapsed_groups.add(group)),
    })
  return {
    legend: { collapsed_groups, group_click: `collapse` as const },
    collapsed_groups,
    collapse_on_outside_click,
  }
}

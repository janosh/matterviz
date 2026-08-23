<script lang="ts">
  import {
    ViewerPane,
    info_pane_icon,
    type PaneProps,
    type PaneToggleProps,
  } from '$lib/overlays'
  import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
  import { format_num } from '$lib/labels'
  import type { HTMLAttributes } from 'svelte/elements'
  import ConvexHullStats from './ConvexHullStats.svelte'
  import { visible_entries as filter_visible } from './helpers'
  import type { ConvexHullEntry, EntryCategoryConfig, PhaseStats } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  const usage_tips = [
    { label: `Single click`, value: `Select point`, key: `tip-click` },
    { label: `Double click`, value: `Copy info`, key: `tip-double-click` },
    { label: `Drag`, value: `Rotate view`, key: `tip-drag` },
    { label: `Scroll`, value: `Zoom in/out`, key: `tip-scroll` },
    { label: `Key r`, value: `Reset camera`, key: `tip-reset` },
    { label: `Key b`, value: `Toggle color mode`, key: `tip-color-mode` },
    { label: `Key s`, value: `Toggle stable points`, key: `tip-stable` },
    { label: `Key u`, value: `Toggle unstable points`, key: `tip-unstable` },
    { label: `Key l`, value: `Toggle labels`, key: `tip-labels` },
  ]

  let {
    phase_stats,
    stable_entries,
    unstable_entries,
    show_stable = true,
    show_unstable = true,
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = [],
    max_hull_dist_show_phases,
    max_hull_dist_show_labels,
    label_threshold,
    pane_open = $bindable(false),
    toggle_props = {},
    pane_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    phase_stats: PhaseStats | null
    stable_entries: ConvexHullEntry[]
    unstable_entries: ConvexHullEntry[]
    show_stable?: boolean
    show_unstable?: boolean
    entry_category?: EntryCategoryConfig | null
    hidden_categories?: string[]
    max_hull_dist_show_phases: number
    max_hull_dist_show_labels: number
    label_threshold: number
    pane_open?: boolean
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
  } = $props()

  // Show flags true: filter_visible only applies the category filter here
  const count_visible = (entries: ConvexHullEntry[], shown: boolean): number =>
    shown ? filter_visible(entries, true, true, entry_category, hidden_categories).length : 0

  let settings_rows = $derived([
    {
      label: `Visible stable`,
      value: `${count_visible(stable_entries, show_stable)} / ${stable_entries.length}`,
      key: `hull-visible-stable`,
    },
    {
      label: `Visible unstable`,
      value: `${count_visible(unstable_entries, show_unstable)} / ${unstable_entries.length}`,
      key: `hull-visible-unstable`,
    },
    {
      label: `Points threshold`,
      value: `${format_num(max_hull_dist_show_phases, `.3~f`)} eV/atom`,
      key: `hull-show-threshold`,
    },
    {
      label: `Label threshold`,
      value: `${format_num(max_hull_dist_show_labels, `.3~f`)} eV/atom`,
      key: `hull-label-threshold`,
    },
    {
      label: `Entry limit for labels`,
      value: `${label_threshold} entries`,
      key: `hull-entry-limit-labels`,
    },
  ])

  let info_cards = $derived([
    { title: `Visualization Settings`, rows: settings_rows },
    { title: `Usage Tips`, rows: usage_tips },
  ])

  const info_card_style = [
    `--info-card-padding: 3pt`,
    `--info-card-bg: var(--pane-bg, white)`,
    `--info-card-heading-gap: 6px`,
    `--info-row-padding: 1pt`,
    `--info-row-label-color: var(--text-color-muted, #666)`,
  ].join(`; `)
</script>

<ViewerPane
  bind:open={pane_open}
  pane_name="convex hull info"
  class_prefix="convex-hull-info"
  max_width="24em"
  {toggle_props}
  {pane_props}
  closed_icon={info_pane_icon}
  {...rest}
>
  <ConvexHullStats
    {phase_stats}
    {stable_entries}
    {unstable_entries}
    {show_stable}
    {show_unstable}
    {entry_category}
    {hidden_categories}
    style="padding: 3pt; background: var(--pane-bg); --hull-stats-table-height: 30rem"
  />

  <InfoPaneCards
    cards={info_cards}
    filter_placeholder="Filter hull info"
    empty_label="hull info"
    heading_level={5}
    style={info_card_style}
  />
</ViewerPane>

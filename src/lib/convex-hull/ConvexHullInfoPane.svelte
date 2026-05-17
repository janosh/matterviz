<script lang="ts">
  import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { format_num } from '$lib/labels'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import ConvexHullStats from './ConvexHullStats.svelte'
  import type { ConvexHullEntry, PhaseStats } from './types'

  type InfoRow = {
    label: string
    value: string
    key: string
  }

  const usage_tips: InfoRow[] = [
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
    max_hull_dist_show_phases,
    max_hull_dist_show_labels,
    label_threshold,
    pane_open = $bindable(false),
    toggle_props = {},
    pane_props = {},
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `onclose`> & {
    phase_stats: PhaseStats | null
    stable_entries: ConvexHullEntry[]
    unstable_entries: ConvexHullEntry[]
    max_hull_dist_show_phases: number
    max_hull_dist_show_labels: number
    label_threshold: number
    pane_open?: boolean
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
    pane_props?: ComponentProps<typeof DraggablePane>[`pane_props`]
  } = $props()

  const count_visible = (entries: ConvexHullEntry[]): number =>
    entries.reduce((count, entry) => count + Number(entry.visible), 0)

  let settings_rows = $derived<InfoRow[]>([
    {
      label: `Visible stable`,
      value: `${count_visible(stable_entries)} / ${stable_entries.length}`,
      key: `hull-visible-stable`,
    },
    {
      label: `Visible unstable`,
      value: `${count_visible(unstable_entries)} / ${unstable_entries.length}`,
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
    `--row-label-max: 1fr`,
    `--info-row-label-color: var(--text-color-muted, #666)`,
  ].join(`; `)
</script>

<DraggablePane
  bind:show={pane_open}
  max_width="24em"
  toggle_props={{
    title: pane_open ? `` : `Convex hull info`,
    class: `convex-hull-info-toggle`,
    ...toggle_props,
  }}
  open_icon="Cross"
  closed_icon="Info"
  pane_props={{
    ...pane_props,
    class: `convex-hull-info-pane ${pane_props?.class ?? ``}`,
  }}
  {...rest}
>
  <ConvexHullStats
    {phase_stats}
    {stable_entries}
    {unstable_entries}
    style="padding: 3pt; background: var(--pane-bg); --hull-stats-table-height: 30rem"
  />

  <InfoPaneCards
    cards={info_cards}
    filter_placeholder="Filter hull info"
    empty_label="hull info"
    heading_level={5}
    row_label_min="7em"
    style={info_card_style}
  />
</DraggablePane>

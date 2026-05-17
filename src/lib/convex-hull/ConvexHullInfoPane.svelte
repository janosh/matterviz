<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { format_num } from '$lib/labels'
  import { SvelteSet } from 'svelte/reactivity'
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

  let copied_items = new SvelteSet<string>()
  let info_filter = $state(``)
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

  let filtered_info_cards = $derived.by(() => {
    const filter = info_filter.trim().toLowerCase()
    if (!filter) return info_cards
    return info_cards
      .map((card) => ({
        ...card,
        rows: card.rows.filter(({ label, value }) =>
          `${card.title} ${label} ${value}`.toLowerCase().includes(filter)
        ),
      }))
      .filter(({ rows }) => rows.length > 0)
  })

  async function copy_row({ label, value, key }: InfoRow) {
    try {
      await navigator.clipboard.writeText(`${label}: ${value}`)
      copied_items.add(key)
      setTimeout(() => copied_items.delete(key), 1000)
    } catch (error) {
      console.error(`Failed to copy to clipboard:`, error)
    }
  }
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

  <input
    class="info-filter"
    type="search"
    bind:value={info_filter}
    placeholder="Filter hull info"
    aria-label="Filter hull info"
  />

  {#if filtered_info_cards.length === 0}
    <p class="empty-filter">No hull info matches "{info_filter}".</p>
  {:else}
    <div class="info-cards">
      {#each filtered_info_cards as card (card.title)}
        <section class="info-card">
          <h5>{card.title}</h5>
          {#each card.rows as row (row.key)}
            <div class="info-row" data-testid={row.key}>
              <span>{row.label}</span>
              <span>{row.value}</span>
              <button
                type="button"
                class="copy-button"
                title="Copy {row.label}"
                aria-label="Copy {row.label}: {row.value}"
                onclick={() => copy_row(row)}
              >
                {#if copied_items.has(row.key)}
                  <Icon icon="Check" />
                {:else}
                  <Icon icon="Copy" />
                {/if}
              </button>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  {/if}
</DraggablePane>

<style>
  .info-filter {
    box-sizing: border-box;
    width: 100%;
    margin: 5pt 0;
    padding: 4pt 6pt;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, var(--pane-bg, Canvas) 88%, currentColor);
    color: inherit;
  }
  .empty-filter {
    margin: 0.25em 0;
    opacity: 0.75;
  }
  .info-cards {
    display: grid;
    gap: 5pt;
  }
  .info-card {
    padding: 3pt;
    background: var(--pane-bg, white);
    border-left: 3px solid var(--accent-color, currentColor);
    border-radius: var(--border-radius, 3pt);
  }
  .info-card h5 {
    margin: 0 0 6px 0;
  }
  .info-row {
    display: grid;
    grid-template-columns: minmax(7em, 1fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: 5pt;
    padding: 1pt;
    line-height: 1.5;
  }
  .info-row span:first-child {
    color: var(--text-color-muted, #666);
  }
  .info-row span:nth-child(2) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .copy-button {
    display: inline-grid;
    place-items: center;
    width: 1.6em;
    height: 1.6em;
    padding: 0;
    border: 0;
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, currentColor 8%, transparent);
    color: inherit;
    cursor: pointer;
    opacity: 0.75;
  }
  .copy-button:hover,
  .copy-button:focus-visible {
    opacity: 1;
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  .copy-button :global(svg) {
    width: 0.9em;
    height: 0.9em;
  }
</style>

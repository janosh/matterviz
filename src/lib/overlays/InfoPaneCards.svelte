<script lang="ts">
  import { sanitize_html } from '$lib/sanitize'
  import type { HTMLAttributes } from 'svelte/elements'
  import { create_clipboard_feedback } from '$lib/overlays'
  import { Icon } from 'svelte-widgets'
  import { Search } from 'svelte-widgets/icons'
  import CopyButton from './CopyButton.svelte'

  type InfoPaneRow = {
    label: string
    value: string | number
    key?: string
    tooltip?: string
  }
  type InfoPaneCard = {
    title: string
    rows: InfoPaneRow[]
  }

  let {
    cards,
    filter_placeholder,
    empty_label,
    title,
    collapsible_filter,
    show_filter = true,
    show_copy = true,
    heading_level = 4,
    row_label_min = `5em`,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    cards: InfoPaneCard[]
    filter_placeholder?: string
    empty_label: string
    title?: string
    collapsible_filter?: boolean
    show_filter?: boolean
    show_copy?: boolean
    heading_level?: 4 | 5
    row_label_min?: string
  } = $props()

  let filter = $state(``)
  const { copied, copy } = create_clipboard_feedback()
  const row_key = (card_title: string, row: InfoPaneRow, row_idx: number): string =>
    row.key ?? `${card_title}:${row.label}:${row.value}:${row_idx}`

  let filtered_cards = $derived.by(() => {
    const normalized_filter = filter.trim().toLowerCase()
    if (!normalized_filter) return cards
    return cards
      .map((card) => ({
        ...card,
        rows: card.rows.filter(({ label, value }) =>
          `${card.title} ${label} ${value}`.toLowerCase().includes(normalized_filter),
        ),
      }))
      .filter(({ rows }) => rows.length > 0)
  })
  const copy_row = (card_title: string, row: InfoPaneRow, row_idx: number): Promise<boolean> =>
    copy(`${row.label}: ${row.value}`, row_key(card_title, row, row_idx))
  let filter_open = $state(false)
</script>

{#if title || (filter_placeholder && (show_filter || filter))}
  <header class:collapsible={Boolean(collapsible_filter)}>
    {#if title}<h4>{title}</h4>{/if}
    {#if filter_placeholder && (show_filter || filter)}
      {#if !collapsible_filter || filter_open || filter}
        <!-- svelte-ignore a11y_autofocus (focus follows an explicit search-button click) -->
        <input
          autofocus={collapsible_filter}
          class="info-filter"
          type="search"
          bind:value={filter}
          placeholder={filter_placeholder}
          aria-label={filter_placeholder}
          onblur={() => (filter_open = Boolean(filter))}
        />
      {:else}
        <button
          type="button"
          class="filter-toggle"
          title={filter_placeholder}
          aria-label={filter_placeholder}
          onclick={() => (filter_open = true)}
        >
          <Icon icon={Search} style="width: 1em; height: 1em" />
        </button>
      {/if}
    {/if}
  </header>
{/if}

{#if filtered_cards.length === 0}
  <p class="empty-filter">No {empty_label} matches "{filter}".</p>
{:else}
  <div {...rest} class={[`info-cards`, rest.class]} style:--row-label-min={row_label_min}>
    {#each filtered_cards as card (card.title)}
      <section class="info-card">
        <svelte:element this={`h${heading_level}`}>{card.title}</svelte:element>
        {#each card.rows as row, row_idx (row_key(card.title, row, row_idx))}
          <div class="info-row" data-testid={row.key}>
            <span>{@html sanitize_html(row.label)}</span>
            <span title={row.tooltip}>{@html sanitize_html(row.value)}</span>
            {#if show_copy}
              <CopyButton
                label="Copy {row.label}: {row.value}"
                title="Copy {row.label}"
                copied={copied.has(row_key(card.title, row, row_idx))}
                onclick={() => copy_row(card.title, row, row_idx)}
              />
            {/if}
          </div>
        {/each}
      </section>
    {/each}
  </div>
{/if}

<style>
  header {
    h4 {
      margin: 0;
    }
    &.collapsible {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 4pt;
      .info-filter {
        grid-column: 1 / -1;
      }
    }
  }
  .info-filter {
    box-sizing: border-box;
    width: 100%;
    margin-bottom: 5pt;
    padding: 4pt 6pt;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, var(--pane-bg, Canvas) 88%, currentColor);
    color: inherit;
  }
  .filter-toggle {
    display: grid;
    place-items: center;
    padding: 2pt;
    color: var(--text-color-muted, currentColor);
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
    padding: var(--info-card-padding, 5pt);
    border-left: var(--info-card-accent, 3px solid var(--accent-color, currentColor));
    border-radius: var(--border-radius, 3pt);
    background: var(--info-card-bg, color-mix(in srgb, currentColor 4%, transparent));
    :is(h4, h5) {
      margin: 0 0 var(--info-card-heading-gap, 3pt);
    }
  }
  .info-row {
    display: grid;
    grid-template-columns:
      minmax(var(--row-label-min), var(--row-label-max, 0.8fr)) minmax(0, 1fr)
      auto;
    align-items: center;
    gap: 5pt;
    padding: var(--info-row-padding, 1pt 0);
    line-height: 1.5;
    span:first-child {
      color: var(--info-row-label-color);
    }
    span:nth-child(2) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
</style>

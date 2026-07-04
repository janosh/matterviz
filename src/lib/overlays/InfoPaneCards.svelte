<script lang="ts">
  import { sanitize_html } from '$lib/sanitize'
  import type { HTMLAttributes } from 'svelte/elements'
  import { create_clipboard_feedback } from '$lib/overlays'
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
    show_filter = true,
    heading_level = 4,
    row_label_min = `5em`,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    cards: InfoPaneCard[]
    filter_placeholder: string
    empty_label: string
    show_filter?: boolean
    heading_level?: 4 | 5
    row_label_min?: string
  } = $props()

  let info_filter = $state(``)
  const { copied, copy } = create_clipboard_feedback()
  const row_key = (card_title: string, row: InfoPaneRow, row_idx: number): string =>
    row.key ?? `${card_title}:${row.label}:${row.value}:${row_idx}`

  let filtered_cards = $derived.by(() => {
    const filter = info_filter.trim().toLowerCase()
    if (!filter) return cards
    return cards
      .map((card) => ({
        ...card,
        rows: card.rows.filter(({ label, value }) =>
          `${card.title} ${label} ${value}`.toLowerCase().includes(filter),
        ),
      }))
      .filter(({ rows }) => rows.length > 0)
  })

  const copy_row = (card_title: string, row: InfoPaneRow, row_idx: number): Promise<void> =>
    copy(`${row.label}: ${row.value}`, row_key(card_title, row, row_idx))
</script>

{#if show_filter}
  <input
    class="info-filter"
    type="search"
    bind:value={info_filter}
    placeholder={filter_placeholder}
    aria-label={filter_placeholder}
  />
{/if}

{#if filtered_cards.length === 0}
  <p class="empty-filter">No {empty_label} matches "{info_filter}".</p>
{:else}
  <div {...rest} class={[`info-cards`, rest.class]} style:--row-label-min={row_label_min}>
    {#each filtered_cards as card (card.title)}
      <section class="info-card">
        <svelte:element this={`h${heading_level}`}>{card.title}</svelte:element>
        {#each card.rows as row, row_idx (row_key(card.title, row, row_idx))}
          <div class="info-row" data-testid={row.key}>
            <span>{@html sanitize_html(row.label)}</span>
            <span title={row.tooltip}>{@html sanitize_html(row.value)}</span>
            <CopyButton
              label="Copy {row.label}: {row.value}"
              title="Copy {row.label}"
              copied={copied.has(row_key(card.title, row, row_idx))}
              onclick={() => copy_row(card.title, row, row_idx)}
            />
          </div>
        {/each}
      </section>
    {/each}
  </div>
{/if}

<style>
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
    border-left: 3px solid var(--accent-color, currentColor);
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

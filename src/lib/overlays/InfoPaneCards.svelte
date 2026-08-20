<script lang="ts" generics="Card extends InfoPaneCard">
  // Filterable label/value cards for info panes (trajectory, convex hull, Brillouin zone,
  // structure sites). Long lists page through `page_size` cards at a time; hosts can decorate
  // cards via `card_attrs` and replace a row's value markup (e.g. with an input) via `row_value`.
  import {
    create_clipboard_feedback,
    type InfoPaneCard,
    type InfoPaneRow,
  } from '$lib/overlays'
  import { sanitize_html } from '$lib/sanitize'
  import type { Snippet } from 'svelte'
  import { Icon } from 'svelte-widgets'
  import { Search } from 'svelte-widgets/icons'
  import type { HTMLAttributes } from 'svelte/elements'
  import CopyButton from './CopyButton.svelte'

  let {
    cards,
    filter_placeholder,
    empty_label,
    title,
    collapsible_filter,
    show_filter = true,
    show_copy = true,
    heading_level = 4,
    page_size = Infinity,
    reveal_key = null,
    card_attrs,
    row_value,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    cards: Card[]
    filter_placeholder?: string
    empty_label: string
    title?: string
    collapsible_filter?: boolean
    show_filter?: boolean
    show_copy?: boolean
    heading_level?: 4 | 5
    page_size?: number // cards per page; pager controls appear once the filtered list exceeds it
    // key (or title) of a card to page to and scroll into view, e.g. a site selected elsewhere
    reveal_key?: string | null
    card_attrs?: (card: Card) => HTMLAttributes<HTMLElement>
    row_value?: Snippet<[InfoPaneRow, Card]>
  } = $props()

  let filter = $state(``)
  let filter_open = $state(false)
  let cards_el = $state<HTMLDivElement>()
  const { copied, copy } = create_clipboard_feedback()
  const row_key = (card: Card, row: InfoPaneRow, row_idx: number): string =>
    row.key ?? `${card.title}:${row.label}:${row.value}:${row_idx}`

  const filtered_cards = $derived.by(() => {
    const normalized_filter = filter.trim().toLowerCase()
    if (!normalized_filter) return cards
    return cards.flatMap((card) => {
      const rows = card.rows.filter(({ label, value }: InfoPaneRow) =>
        `${card.title} ${card.subtitle ?? ``} ${label} ${value}`
          .toLowerCase()
          .includes(normalized_filter),
      )
      return rows.length ? [{ ...card, rows }] : []
    })
  })
  // Requested page start, clamped so a shrinking list never leaves an empty page
  let page_start = $state(0)
  const last_page_start = $derived(Math.max(0, filtered_cards.length - page_size))
  const first_idx = $derived(Math.min(page_start, last_page_start))
  const page_end = $derived(Math.min(first_idx + page_size, filtered_cards.length))
  const paged_cards = $derived(
    filtered_cards.length > page_size
      ? filtered_cards.slice(first_idx, page_end)
      : filtered_cards,
  )
  // Jump to the page holding `reveal_key`, then scroll its card into view once rendered
  $effect(() => {
    if (reveal_key == null) return
    const idx = filtered_cards.findIndex((card) => (card.key ?? card.title) === reveal_key)
    if (idx === -1) return
    if (idx < first_idx || idx >= page_end) {
      page_start = Math.floor(idx / page_size) * page_size
      return // re-runs with the new page rendered
    }
    cards_el?.children[idx - first_idx]?.scrollIntoView({ block: `nearest` })
  })
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
          oninput={() => (page_start = 0)}
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
  {#if filtered_cards.length > page_size}
    <nav class="pager" aria-label="{empty_label} pages">
      <button
        type="button"
        disabled={first_idx === 0}
        onclick={() => (page_start = Math.max(0, first_idx - page_size))}
      >
        Previous
      </button>
      <span>{first_idx + 1}-{page_end} of {filtered_cards.length}</span>
      <button
        type="button"
        disabled={page_end >= filtered_cards.length}
        onclick={() => (page_start = Math.min(last_page_start, first_idx + page_size))}
      >
        Next
      </button>
    </nav>
  {/if}
  <div {...rest} bind:this={cards_el} class={[`info-cards`, rest.class]}>
    {#each paged_cards as card (card.key ?? card.title)}
      {@const attrs = card_attrs?.(card) ?? {}}
      <section {...attrs} class={[`info-card`, attrs.class]}>
        <svelte:element this={`h${heading_level}`}>
          {card.title}
          {#if card.subtitle}<span class="subtitle">{card.subtitle}</span>{/if}
        </svelte:element>
        {#each card.rows as row, row_idx (row_key(card, row, row_idx))}
          <div class="info-row" data-testid={row.key}>
            <span>{@html sanitize_html(row.label)}</span>
            {#if row_value}
              {@render row_value(row, card)}
            {:else}
              <span title={row.tooltip}>{@html sanitize_html(row.value)}</span>
            {/if}
            {#if show_copy}
              <CopyButton
                label="Copy {row.label}: {row.value}"
                title="Copy {row.label}"
                copied={copied.has(row_key(card, row, row_idx))}
                onclick={() => copy(`${row.label}: ${row.value}`, row_key(card, row, row_idx))}
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
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5pt;
    margin-bottom: 5pt;
    font-size: 0.9em;
  }
  .subtitle {
    margin-left: 0.5em;
    font-weight: normal;
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
    grid-template-columns: fit-content(40%) minmax(0, 1fr) auto;
    align-items: center;
    gap: 5pt;
    padding: var(--info-row-padding, 1pt 0);
    line-height: 1.5;
    span:first-child {
      color: var(--info-row-label-color);
      text-align: left;
    }
    span:nth-child(2) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
</style>

<script lang="ts">
  // Per-column filter for a HeatmapTable header: a funnel button opening a panel whose
  // controls depend on the column's data — a range for numbers, a checklist for few distinct
  // values, a substring box otherwise. The host owns `open` (only one header popover may be
  // open at a time) and persists the filter itself through `on_change`.
  import { format_num } from '$lib/labels'
  import type { ColumnFilter, Label, RowData } from '$lib/table'
  import { column_filter_panel, with_category_toggled, with_numeric_bound } from './data'
  import { strip_html } from '$lib/utils'
  import { Icon } from 'svelte-widgets'
  import { Filter } from 'svelte-widgets/icons'

  let {
    col,
    rows,
    row_key,
    is_numeric,
    filter,
    stats,
    open,
    on_toggle,
    on_change,
  }: {
    col: Label
    rows: RowData[]
    row_key: string
    is_numeric: boolean
    filter: ColumnFilter | undefined
    // Column extent shown as the range inputs' placeholders
    stats?: { min: number; max: number }
    open: boolean
    on_toggle: () => void
    on_change: (filter: ColumnFilter | undefined) => void
  } = $props()

  // Lazy: the distinct-value scan is O(rows) and only runs for the open panel
  let panel = $derived(open ? column_filter_panel(col, rows, row_key, is_numeric) : null)
  // Every event stops here so the sortable, draggable header underneath doesn't react
  const stop_event = (event: Event) => event.stopPropagation()
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="header-popover column-filter"
  onclick={stop_event}
  onkeydown={stop_event}
  onmousedown={stop_event}
  onpointerdown={stop_event}
>
  <button
    type="button"
    class={['column-filter-trigger', { active: Boolean(filter) }]}
    aria-label="Filter {strip_html(col.label)}"
    aria-expanded={open}
    onclick={on_toggle}
  >
    <Icon icon={Filter} />
  </button>
  {#if panel}
    <!-- svelte-ignore a11y_no_static_element_interactions (Escape closes the panel) -->
    <div
      class="column-filter-panel"
      onkeydown={(event) => {
        if (event.key === `Escape`) on_toggle()
      }}
    >
      {#if panel.kind === `numeric`}
        {@const range = filter?.kind === `numeric` ? filter : undefined}
        {#each [`min`, `max`] as const as bound (bound)}
          <label>
            {bound === `min` ? `Min` : `Max`}
            <input
              type="number"
              value={range?.[bound] ?? ``}
              placeholder={stats ? format_num(stats[bound], `.3~g`) : ``}
              oninput={(event) =>
                on_change(with_numeric_bound(filter, bound, event.currentTarget.value))}
            />
          </label>
        {/each}
      {:else if panel.kind === `category`}
        {@const selected = filter?.kind === `category` ? filter.values : null}
        {@const options = panel.options}
        <div class="column-filter-options">
          {#each options as option (option)}
            <label>
              <input
                type="checkbox"
                checked={selected === null || selected.includes(option)}
                onchange={() => on_change(with_category_toggled(filter, option, options))}
              />
              {option || `(blank)`}
            </label>
          {/each}
        </div>
      {:else}
        <input
          type="search"
          placeholder="Contains..."
          value={filter?.kind === `text` ? filter.text : ``}
          oninput={(event) => {
            const text = event.currentTarget.value
            on_change(text ? { kind: `text`, text } : undefined)
          }}
        />
      {/if}
      {#if filter}
        <button type="button" class="column-filter-clear" onclick={() => on_change(undefined)}>
          Clear filter
        </button>
      {/if}
    </div>
  {/if}
</span>

<style>
  /* wrapper, trigger and panel chrome come from HeatmapTable's .header-popover rules */
  .column-filter-trigger {
    opacity: 0.55;
    :global(svg) {
      width: 10px;
      height: 10px;
    }
    &:hover,
    &[aria-expanded='true'] {
      opacity: 1;
    }
    /* an active filter is easy to forget about, so it stays fully lit and accented */
    &.active {
      opacity: 1;
      color: var(--table-accent, var(--accent-color, #4a9eff));
    }
  }
  .column-filter-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 11em;
    padding: 6px;
    font-weight: normal;
    label {
      display: flex;
      align-items: center;
      gap: 4px;
      justify-content: space-between;
    }
    input[type='number'],
    input[type='search'] {
      width: 6em;
      min-width: 0;
      padding: 1px 3px;
    }
  }
  .column-filter-options {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 14em;
    overflow-y: auto;
    label {
      justify-content: flex-start;
    }
  }
  .column-filter-clear {
    padding: 2px 4px;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.2));
    border-radius: 3px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.9em;
  }
</style>

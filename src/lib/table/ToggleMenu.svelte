<script lang="ts">
  import { Icon } from 'svelte-widgets'
  import { Columns, Reset } from 'svelte-widgets/icons'
  import { portal, click_outside, tooltip } from 'svelte-widgets/attachments'
  import { sanitize_html } from '$lib/sanitize'
  import { get_column_id as col_id, type Label } from '$lib/table'
  import { strip_html } from '$lib/utils'
  import type { Snippet } from 'svelte'
  import { slide } from 'svelte/transition'

  // Hosts with external visibility state can keep the declared reset baseline separate.
  type ToggleColumn = Label & { default_visible?: boolean }

  let {
    columns = $bindable([]),
    column_panel_open = $bindable(false),
    collapsed_sections = $bindable<string[]>([]),
    on_toggle,
    trigger,
  }: {
    columns: ToggleColumn[]
    column_panel_open?: boolean
    collapsed_sections?: string[]
    // Every visibility change, resets included, for hosts that track it outside
    // `col.visible` (HeatmapTable keeps an id list)
    on_toggle?: (col: ToggleColumn, visible: boolean) => void
    // Replaces the default "Columns" button. The summary keeps owning the click.
    trigger?: Snippet<[{ open: boolean }]>
  } = $props()

  const default_visible = (col: ToggleColumn): boolean =>
    col.default_visible ?? col.visible !== false
  const toggle_menu_id = $props.id()
  const dropdown_selector = `[data-toggle-menu-id="${toggle_menu_id}"]`
  const COLUMN_FILTER_THRESHOLD = 20
  const MAX_MENU_COLUMNS = 3
  const MAX_MENU_ROWS = 10
  let column_filter = $state(``)
  let show_column_filter = $derived(columns.length > COLUMN_FILTER_THRESHOLD)
  let normalized_column_filter = $derived(
    show_column_filter ? column_filter.trim().toLowerCase() : ``,
  )
  const column_matches_filter = (col: Label): boolean =>
    !normalized_column_filter ||
    [col.key, strip_html(col.label), col.description, col.group]
      .filter(Boolean)
      .join(` `)
      .toLowerCase()
      .includes(normalized_column_filter)
  let filtered_columns = $derived(columns.filter(column_matches_filter))

  // Reset baseline: each column's default visibility, snapshotted when the column SET changes
  // (a new dataset) and held steady across this menu's own toggles. Sorted so a pure reorder
  // (a host rearranging its columns) is not mistaken for a new set, which would resnapshot
  // and silently drop the baseline. Our own writes record their signature first, so the
  // derived sees them as unchanged and keeps the snapshot.
  const default_signature = () =>
    columns
      .map((col) => `${col_id(col)}:${default_visible(col)}`)
      .toSorted()
      .join(`\0`)
  let snapshot = { signature: ``, defaults: {} as Record<string, boolean> }
  let default_visibility = $derived.by(() => {
    const signature = default_signature()
    if (signature !== snapshot.signature) {
      const defaults: Record<string, boolean> = {}
      for (const col of columns) defaults[col_id(col)] = default_visible(col)
      snapshot = { signature, defaults }
    }
    return snapshot.defaults
  })
  const keep_snapshot = () => (snapshot.signature = default_signature())

  // Check if a column's visibility differs from its default
  const is_changed = (col: Label) =>
    (col.visible !== false) !== (default_visibility[col_id(col)] ?? true)

  let has_any_changes = $derived(columns.some(is_changed))

  // Reset columns to default visibility
  function reset_columns(items: Label[]): void {
    const changed = items.filter(is_changed)
    // Read the baseline once: each write below dirties the derived, and re-reading it
    // mid-loop would resnapshot from the half-reset columns
    const defaults = default_visibility
    for (const col of changed) col.visible = defaults[col_id(col)] ?? true
    // Record our write before notifying a host that may feed new columns back in.
    keep_snapshot()
    columns = [...columns]
    for (const col of changed) on_toggle?.(col, col.visible !== false)
  }

  // Group columns by their group property
  let sections = $derived.by(() => {
    const grouped: Record<string, Label[]> = {}
    const ungrouped: Label[] = []

    for (const col of columns) {
      if (col.group) {
        grouped[col.group] ??= []
        grouped[col.group].push(col)
      } else {
        ungrouped.push(col)
      }
    }

    const result = Object.entries(grouped).map(([name, items]) => ({ name, items }))
    if (ungrouped.length > 0) result.push({ name: ``, items: ungrouped })
    return result
  })
  let filtered_sections = $derived(
    sections
      .map((section) => ({
        ...section,
        items: section.items.filter(column_matches_filter),
      }))
      .filter((section) => section.items.length > 0),
  )

  // Check if any column defines a group (to decide whether to show sections)
  let has_sections = $derived(columns.some((col) => col.group))

  function toggle_section(name: string) {
    collapsed_sections = collapsed_sections.includes(name)
      ? collapsed_sections.filter((section) => section !== name)
      : [...collapsed_sections, name]
  }

  function toggle_column_visibility(
    col: Label,
    event: Event & { currentTarget: HTMLInputElement },
  ) {
    col.visible = event.currentTarget.checked
    keep_snapshot()
    columns = [...columns] // trigger reactivity on parent binding
    on_toggle?.(col, event.currentTarget.checked)
  }

  // Prefer two tall columns, adding a third only when the item count would make them unwieldy
  const grid_template = (item_count: number): string => {
    const preferred = item_count <= 1 ? 1 : Math.max(2, Math.ceil(item_count / MAX_MENU_ROWS))
    return `repeat(${Math.min(MAX_MENU_COLUMNS, preferred)}, max-content)`
  }

  // Portal the dropdown to <body> so ancestor overflow/stacking contexts cannot clip it.
  const dropdown_target = typeof document === `undefined` ? undefined : document.body
  let details_el = $state<HTMLElement>()
  let dropdown_el = $state<HTMLElement>()
  const position_dropdown = (): void => {
    const summary_el = details_el?.querySelector(`summary`)
    if (!column_panel_open || !summary_el || !dropdown_el) return
    const trigger_rect = summary_el.getBoundingClientRect()
    const dropdown_rect = dropdown_el.getBoundingClientRect()
    const viewport_padding = 8
    const gap = 4
    const max_left = Math.max(
      viewport_padding,
      globalThis.innerWidth - dropdown_rect.width - viewport_padding,
    )
    const left = Math.min(
      Math.max(viewport_padding, trigger_rect.right - dropdown_rect.width),
      max_left,
    )
    const below = trigger_rect.bottom + gap
    const top =
      below + dropdown_rect.height <= globalThis.innerHeight - viewport_padding
        ? below
        : Math.max(viewport_padding, trigger_rect.top - dropdown_rect.height - gap)
    Object.assign(dropdown_el.style, {
      left: `${left}px`,
      right: `auto`,
      top: `${top}px`,
      visibility: `visible`,
    })
  }
  $effect(() => {
    if (!column_panel_open || !details_el || !dropdown_el) return
    // Re-run when section state changes while open
    void collapsed_sections
    void filtered_columns
    void filtered_sections
    const frame = requestAnimationFrame(position_dropdown)
    return () => cancelAnimationFrame(frame)
  })
</script>

{#snippet toggle_item(col: Label)}
  <label
    class={['toggle-label', { disabled: col.disabled }]}
    {@attach tooltip({ allow_html: true, content: sanitize_html(col.description ?? ``) })}
  >
    <input
      type="checkbox"
      checked={col.visible !== false}
      disabled={col.disabled}
      onchange={(event) => toggle_column_visibility(col, event)}
    />
    {@html sanitize_html(col.label)}
  </label>
{/snippet}

<svelte:window
  onkeydown={(event) => {
    if (event.key === `Escape` && column_panel_open) {
      column_panel_open = false
      event.preventDefault()
    }
  }}
/>

<details
  class="column-toggles"
  bind:this={details_el}
  open={column_panel_open}
  {@attach click_outside({
    callback: () => (column_panel_open = false),
    inside: [dropdown_selector],
  })}
>
  <summary
    class:custom={Boolean(trigger)}
    aria-expanded={column_panel_open}
    aria-label={trigger ? `Columns` : undefined}
    onclick={(event) => {
      event.preventDefault()
      column_panel_open = !column_panel_open
    }}
  >
    {#if trigger}
      {@render trigger({ open: column_panel_open })}
    {:else}
      Columns <Icon icon={Columns} />
    {/if}
    {#if has_any_changes}
      <button
        class="reset-btn"
        onclick={(event) => {
          event.stopPropagation()
          event.preventDefault()
          reset_columns(columns)
        }}
        type="button"
        aria-label="Reset all columns to defaults"
        {@attach tooltip()}
      >
        <Icon icon={Reset} width="12px" />
      </button>
    {/if}
  </summary>

  <div
    bind:this={dropdown_el}
    class={has_sections ? `sections-container` : `column-menu`}
    data-toggle-menu-id={toggle_menu_id}
    hidden={!column_panel_open}
    role="group"
    style:grid-template-columns={has_sections
      ? undefined
      : grid_template(filtered_columns.length)}
    {@attach portal(dropdown_target)}
  >
    {#if show_column_filter}
      <input
        aria-label="Filter columns"
        bind:value={column_filter}
        class="column-filter"
        placeholder="Filter columns…"
        type="search"
      />
    {/if}
    {#if has_sections}
      {#each filtered_sections as section (section.name)}
        {@const is_collapsed =
          !normalized_column_filter &&
          section.name !== `` &&
          collapsed_sections.includes(section.name)}
        <div class="section">
          {#if section.name}
            <div class="section-header-row">
              <button
                class="section-header"
                aria-expanded={!is_collapsed}
                onclick={() => toggle_section(section.name)}
                type="button"
              >
                <span class="collapse-icon">{is_collapsed ? `▶` : `▼`}</span>
                {section.name}
              </button>
              {#if section.items.some(is_changed)}
                <button
                  class="reset-btn"
                  onclick={() => reset_columns(section.items)}
                  type="button"
                  aria-label="Reset {section.name} to defaults"
                  {@attach tooltip()}
                >
                  <Icon icon={Reset} width="12px" />
                </button>
              {/if}
            </div>
          {/if}
          {#if !is_collapsed}
            <div
              class="section-items"
              style:grid-template-columns={grid_template(section.items.length)}
              transition:slide={{ duration: 200 }}
            >
              {#each section.items as col (col_id(col))}
                {@render toggle_item(col)}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {:else}
      {#each filtered_columns as col (col_id(col))}
        {@render toggle_item(col)}
      {/each}
    {/if}
    {#if filtered_columns.length === 0}
      <span class="no-matching-columns">No matching columns</span>
    {/if}
  </div>
</details>

<style>
  .column-toggles {
    position: relative;
    summary {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      &::-webkit-details-marker {
        display: none;
      }
      /* A custom trigger brings its own chrome. */
      &:where(:not(.custom)) {
        background: var(--tgl-btn-bg, var(--btn-bg));
        padding: 0 6pt;
        margin: 4pt 0;
        border-radius: var(--tgl-border-radius, 4pt);
        &:hover {
          background: var(--tgl-hover-bg, var(--nav-bg));
        }
      }
    }
  }
  /* Shared dropdown styling */
  .column-menu,
  .sections-container {
    font-size: var(--tgl-font-size, 1.1em);
    position: fixed;
    left: 0;
    top: 0;
    visibility: hidden;
    box-sizing: border-box;
    width: max-content;
    background: var(--tgl-dropdown-bg, var(--page-bg));
    border: 1px solid
      var(--tgl-dropdown-border, color-mix(in srgb, currentColor 10%, transparent));
    border-radius: var(--tgl-border-radius, 4pt);
    box-shadow: var(
      --tgl-dropdown-shadow,
      0 4px 12px color-mix(in srgb, currentColor 8%, transparent)
    );
    min-width: 150px;
    max-width: calc(100vw - 16px);
    max-height: var(--tgl-dropdown-max-height, min(70vh, 600px));
    overflow: auto;
    z-index: var(--tgl-dropdown-z-index, 10000);
  }
  .column-menu,
  .section-items {
    display: grid;
    column-gap: var(--tgl-column-gap, 8px);
  }
  .column-menu {
    padding: 3pt 5pt;
  }
  .sections-container {
    padding: 6pt 8pt;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .column-menu[hidden],
  .sections-container[hidden] {
    display: none;
  }
  .column-filter {
    position: sticky;
    z-index: 2;
    top: 0;
    grid-column: 1 / -1;
    box-sizing: border-box;
    width: 100%;
    height: 1.35rem;
    min-height: 0;
    margin: 0 0 4px;
    padding: 0 0.35rem;
    border: 1px solid
      var(--tgl-dropdown-border, color-mix(in srgb, currentColor 18%, transparent));
    border-radius: var(--tgl-border-radius, 4pt);
    outline: none;
    background: var(--tgl-dropdown-bg, var(--page-bg));
    color: inherit;
    font: inherit;
    font-size: 0.72rem;
    line-height: 1.2;
    &:focus {
      border-color: var(--active-color, #6ea8ff);
    }
  }
  .no-matching-columns {
    grid-column: 1 / -1;
    padding: 4px;
    color: color-mix(in srgb, currentColor 65%, transparent);
    font-size: 0.9em;
  }
  .reset-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2pt;
    border: none;
    border-radius: var(--tgl-border-radius, 3pt);
    background: transparent;
    cursor: pointer;
    color: inherit;
    opacity: 0.5;
    flex-shrink: 0;
    &:hover {
      background: color-mix(in srgb, currentColor 12%, transparent);
      opacity: 1;
    }
  }
  summary .reset-btn {
    margin-left: auto;
  }
  .section-header-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4pt;
    padding: 2pt 4pt;
    border-radius: var(--tgl-border-radius, 3pt);
    background: var(--tgl-section-header-bg, color-mix(in srgb, currentColor 5%, transparent));
    &:hover {
      background: var(
        --tgl-section-header-hover-bg,
        color-mix(in srgb, currentColor 12%, transparent)
      );
    }
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
    font-size: 0.9em;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    flex: 1;
    text-align: left;
    color: inherit;
  }
  .collapse-icon {
    font-size: 0.7em;
    width: 1em;
    flex-shrink: 0;
  }
  .toggle-label {
    display: inline-block;
    margin: 1px 2px;
    border-radius: 3px;
    line-height: 1.3em;
    height: 1.3em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    &:hover:not(.disabled) {
      background: var(--tgl-hover-bg, var(--nav-bg));
    }
    &.disabled {
      opacity: 0.5;
      cursor: not-allowed;
      input {
        cursor: not-allowed;
      }
    }
  }
  details :global(:is(sub, sup)) {
    transform: translate(-3pt, 6pt);
    font-size: 0.7em;
  }
</style>

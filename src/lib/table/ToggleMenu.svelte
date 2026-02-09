<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { Label } from '$lib/table'
  import { click_outside, tooltip } from 'svelte-multiselect/attachments'
  import { slide } from 'svelte/transition'

  let {
    columns = $bindable([]),
    column_panel_open = $bindable(false),
    n_columns,
    collapsed_sections = $bindable<string[]>([]),
    on_reset,
  }: {
    columns: Label[]
    column_panel_open?: boolean
    // Number of grid columns for toggle layout
    n_columns?: number
    collapsed_sections?: string[]
    // Called after reset with the section name (or undefined for global reset)
    on_reset?: (section?: string) => void
  } = $props()

  const col_id = (col: Label) => col.key ?? col.label

  // Snapshot default visibility when column set changes (new dataset).
  // Compare by column keys to avoid re-snapshotting on internal columns = [...columns] reactivity.
  // Intentionally non-reactive: mutated only inside snapshot_defaults() and compared manually.
  let prev_col_keys = ``
  let default_visibility: Record<string, boolean> = {}
  function snapshot_defaults() {
    default_visibility = {}
    for (const col of columns) {
      default_visibility[col_id(col)] = col.visible !== false
    }
    prev_col_keys = columns.map(col_id).join(`\0`)
  }
  snapshot_defaults()

  $effect(() => {
    const current_keys = columns.map(col_id).join(`\0`)
    if (current_keys !== prev_col_keys) {
      snapshot_defaults()
    }
  })

  // Check if a column's visibility differs from its default
  const is_changed = (col: Label) =>
    (col.visible !== false) !== (default_visibility[col_id(col)] ?? true)

  function section_has_changes(items: Label[]): boolean {
    return items.some(is_changed)
  }

  let has_any_changes = $derived(columns.some(is_changed))

  // Reset columns to default visibility
  function reset_columns(items: Label[]): void {
    for (const col of items) {
      col.visible = default_visibility[col_id(col)] ?? true
    }
    columns = [...columns]
  }

  function reset_all(): void {
    reset_columns(columns)
    on_reset?.()
  }

  function reset_section(section_name: string): void {
    const section = sections.find((sec) => sec.name === section_name)
    if (!section) return
    reset_columns(section.items)
    on_reset?.(section_name)
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

  // Check if any column defines a group (to decide whether to show sections)
  let has_sections = $derived(columns.some((col) => col.group))

  function toggle_section(name: string) {
    collapsed_sections = collapsed_sections.includes(name)
      ? collapsed_sections.filter((s) => s !== name)
      : [...collapsed_sections, name]
  }

  function toggle_column_visibility(col: Label, event: Event) {
    col.visible = (event.target as HTMLInputElement).checked
    columns = [...columns] // trigger reactivity on parent binding
  }

  // Grid template for section items
  let grid_template = $derived(
    n_columns
      ? `repeat(${n_columns}, max-content)`
      : `repeat(auto-fill, minmax(135px, 1fr))`,
  )

  // Reposition dropdown: left-aligned by default, switch to right if it overflows viewport
  let details_el: HTMLElement | undefined
  $effect(() => {
    if (!column_panel_open || !details_el) return
    // Re-run when section state changes while open
    void n_columns
    void collapsed_sections
    void sections
    const dropdown = details_el.querySelector<HTMLElement>(
      `.column-menu, .sections-container`,
    )
    if (!dropdown) return
    // Reset to left-aligned
    dropdown.style.left = `0`
    dropdown.style.right = `auto`
    requestAnimationFrame(() => {
      const rect = dropdown.getBoundingClientRect()
      if (rect.right > window.innerWidth) {
        dropdown.style.left = `auto`
        dropdown.style.right = `0`
      }
    })
  })
</script>

{#snippet toggle_item(col: Label)}
  <label
    class="toggle-label"
    class:disabled={col.disabled}
    {@attach tooltip({ content: col.description })}
  >
    <input
      type="checkbox"
      checked={col.visible !== false}
      disabled={col.disabled}
      onchange={(event) => toggle_column_visibility(col, event)}
    />
    {@html col.label}
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
  bind:open={column_panel_open}
  {@attach click_outside({ callback: () => (column_panel_open = false) })}
>
  <summary aria-expanded={column_panel_open}>
    Columns <Icon icon="Columns" />
  </summary>

  {#if has_sections}
    <div class="sections-container" role="group">
      {#if has_any_changes}
        <button
          class="reset-all-btn"
          onclick={reset_all}
          type="button"
          {@attach tooltip({ content: `Reset all columns to defaults` })}
        >
          <Icon icon="Reset" width="14px" />
          Reset all
        </button>
      {/if}
      {#each sections as section (section.name)}
        {@const is_collapsed = section.name !== `` &&
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
              {#if section_has_changes(section.items)}
                <button
                  class="reset-section-btn"
                  onclick={(event) => {
                    event.stopPropagation()
                    reset_section(section.name)
                  }}
                  type="button"
                  {@attach tooltip({ content: `Reset ${section.name} to defaults` })}
                >
                  <Icon icon="Reset" width="12px" />
                </button>
              {/if}
            </div>
          {/if}
          {#if !is_collapsed}
            <div
              class="section-items"
              style:grid-template-columns={grid_template}
              transition:slide={{ duration: 200 }}
            >
              {#each section.items as col, idx (col.key ?? col.label ?? idx)}
                {@render toggle_item(col)}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="column-menu" role="group" style:grid-template-columns={grid_template}>
      {#if has_any_changes}
        <button
          class="reset-all-btn"
          onclick={reset_all}
          type="button"
          {@attach tooltip({ content: `Reset all columns to defaults` })}
          style="grid-column: 1 / -1"
        >
          <Icon icon="Reset" width="14px" />
          Reset all
        </button>
      {/if}
      {#each columns as col, idx (col.key ?? col.label ?? idx)}
        {@render toggle_item(col)}
      {/each}
    </div>
  {/if}
</details>

<style>
  .column-toggles {
    position: relative;
    summary {
      background: var(--tgl-btn-bg, var(--btn-bg));
      padding: 0 6pt;
      margin: 4pt 0;
      border-radius: var(--tgl-border-radius, 4pt);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      &:hover {
        background: var(--tgl-hover-bg, var(--nav-bg));
      }
      &::-webkit-details-marker {
        display: none;
      }
    }
  }
  /* Shared dropdown styling */
  .column-menu,
  .sections-container {
    font-size: var(--tgl-font-size, 1.1em);
    position: absolute;
    left: 0;
    top: calc(100% + 1pt);
    background: var(--tgl-dropdown-bg, var(--page-bg));
    border: 1px solid
      var(--tgl-dropdown-border, color-mix(in srgb, currentColor 10%, transparent));
    border-radius: var(--tgl-border-radius, 4pt);
    box-shadow: var(
      --tgl-dropdown-shadow,
      0 4px 12px color-mix(in srgb, currentColor 8%, transparent)
    );
    min-width: 150px;
    max-height: var(--tgl-dropdown-max-height, min(70vh, 600px));
    overflow-y: auto;
    z-index: 1;
  }
  .column-menu {
    padding: 3pt 5pt;
    display: grid;
  }
  .sections-container {
    padding: 6pt 8pt;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .reset-all-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2pt 6pt;
    margin-bottom: 4pt;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: var(--tgl-border-radius, 3pt);
    background: color-mix(in srgb, currentColor 5%, transparent);
    cursor: pointer;
    font-size: 0.85em;
    color: inherit;
    opacity: 0.8;
    &:hover {
      background: color-mix(in srgb, currentColor 12%, transparent);
      opacity: 1;
    }
  }
  .section-header-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4pt;
  }
  .reset-section-btn {
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
  .section-header {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
    font-size: 0.9em;
    padding: 2pt 4pt;
    border: none;
    border-radius: var(--tgl-border-radius, 3pt);
    background: var(
      --tgl-section-header-bg,
      color-mix(in srgb, currentColor 5%, transparent)
    );
    cursor: pointer;
    flex: 1;
    text-align: left;
    color: inherit;
    &:hover {
      background: var(
        --tgl-section-header-hover-bg,
        color-mix(in srgb, currentColor 12%, transparent)
      );
    }
  }
  .collapse-icon {
    font-size: 0.7em;
    width: 1em;
    flex-shrink: 0;
  }
  .section-items {
    display: grid;
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

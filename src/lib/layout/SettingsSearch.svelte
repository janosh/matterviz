<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'

  let {
    query = $bindable(``),
    label = `Search settings`,
    placeholder = `Search settings`,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    query?: string
    label?: string
    placeholder?: string
    children: Snippet
  } = $props()

  const search_id = $props.id()
  const input_id = `settings-search-input-${search_id}`
  const status_id = `settings-search-status-${search_id}`
  let match_count = $state(0)
  let filtering = $derived(query.trim().length > 0)
  let no_matches = $derived(filtering && match_count === 0)

  // Rows opt into per-row reset with `data-key`, but a setting must not be unreachable by search
  // just because nothing resets it individually, so plain section rows count too.
  const row_selector = `[data-key], section.settings-section :is(label, .setting)`
  const search_hidden_attr = `data-search-hidden`

  const filter_settings = (root: HTMLElement): (() => void) => {
    // Keep search visibility separate from caller-owned `hidden` state.
    const opened_by_search = new SvelteSet<HTMLDetailsElement>()
    let refresh_queued = false
    let disposed = false

    const set_hidden = (element: HTMLElement, hide: boolean): void => {
      element.toggleAttribute(search_hidden_attr, hide)
    }

    const restore_visibility = (): void => {
      for (const element of root.querySelectorAll(`[${search_hidden_attr}]`)) {
        element.removeAttribute(search_hidden_attr)
      }
      // Groups the user had open are never recorded, so their state survives untouched
      for (const group of opened_by_search) group.open = false
      opened_by_search.clear()
    }

    const refresh = (): void => {
      if (disposed) return
      const normalized_query = query.trim().toLocaleLowerCase()
      if (!normalized_query) {
        restore_visibility()
        match_count = 0
        return
      }

      const matching_rows = new SvelteSet<HTMLElement>()
      const rows = [...root.querySelectorAll<HTMLElement>(row_selector)].filter(
        (row) =>
          row.hasAttribute(`data-key`) ||
          row.parentElement?.closest(`label, .setting`) === null,
      )
      for (const row of rows) {
        const searchable_text = [
          row.getAttribute(`data-label`),
          row.textContent,
          row.getAttribute(`data-description`),
        ]
          .filter((value): value is string => Boolean(value))
          .join(` `)
          .toLocaleLowerCase()
        const matches = searchable_text.includes(normalized_query)
        set_hidden(row, !matches)
        // A row the caller hid stays hidden, so it must not count as a match either
        if (matches && !row.hidden) matching_rows.add(row)
      }
      const matches = [...matching_rows]

      for (const section of root.querySelectorAll<HTMLElement>(`section.settings-section`)) {
        const section_matches = matches.some((row) => section.contains(row))
        set_hidden(section, !section_matches)
        const heading = section.previousElementSibling
        if (heading instanceof HTMLElement && heading.matches(`h4`)) {
          set_hidden(heading, !section_matches)
        }
      }

      for (const group of root.querySelectorAll<HTMLDetailsElement>(
        `details.settings-group`,
      )) {
        const group_matches = matches.some((row) => group.contains(row))
        set_hidden(group, !group_matches)
        if (group_matches && !group.open) {
          group.open = true
          opened_by_search.add(group)
        }
      }

      match_count = matching_rows.size
    }

    const schedule_refresh = (): void => {
      if (refresh_queued) return
      refresh_queued = true
      queueMicrotask(() => {
        refresh_queued = false
        refresh()
      })
    }

    const observer = new MutationObserver(schedule_refresh)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [`data-description`, `data-label`, `data-key`],
    })
    refresh()

    return () => {
      disposed = true
      observer.disconnect()
      restore_visibility()
      match_count = 0
    }
  }

  const handle_keydown = (event: KeyboardEvent): void => {
    if (event.key !== `Escape` || !query) return
    event.preventDefault()
    event.stopPropagation()
    query = ``
  }
</script>

<div {...rest} class={[`settings-search`, rest.class]} {@attach filter_settings}>
  <div class="search-field">
    <label for={input_id}>{label}</label>
    <input
      id={input_id}
      type="search"
      bind:value={query}
      {placeholder}
      onkeydown={handle_keydown}
      aria-describedby={no_matches ? status_id : undefined}
    />
    {#if query}
      <button
        type="button"
        class="clear-search"
        aria-label="Clear settings search"
        onclick={() => {
          query = ``
        }}>×</button
      >
    {/if}
  </div>
  {@render children()}
  {#if no_matches}
    <p id={status_id} class="no-matches" role="status">No settings match “{query.trim()}”.</p>
  {/if}
</div>

<style>
  .settings-search {
    display: contents;
  }
  .settings-search :global(:is([hidden], [data-search-hidden])) {
    display: none !important;
  }
  .search-field {
    position: relative;
    display: grid;
    gap: 2pt;
    margin-block-end: 4pt;
    label {
      font-size: 0.78em;
      font-weight: 600;
      color: var(--text-color-muted, #6b7280);
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 4pt 20pt 4pt 6pt;
      border: 1px solid var(--border-color, #d1d5db);
      border-radius: var(--border-radius, 3pt);
      background: var(--input-bg, transparent);
      color: inherit;
      font: inherit;
      &::-webkit-search-cancel-button {
        appearance: none;
      }
    }
  }
  .clear-search {
    position: absolute;
    right: 3pt;
    bottom: 3pt;
    display: grid;
    place-items: center;
    width: 18pt;
    height: 18pt;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-color-muted, #6b7280);
    font: inherit;
    cursor: pointer;
  }
  .no-matches {
    margin: 6pt 0;
    color: var(--text-color-muted, #6b7280);
    font-size: 0.85em;
    text-align: center;
  }
</style>

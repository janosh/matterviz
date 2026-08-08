<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import { Icon } from 'svelte-widgets'
  import { Search } from 'svelte-widgets/icons'

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
  const status_id = `settings-search-status-${search_id}`
  let search_open = $derived(Boolean(query))
  let search_input: HTMLInputElement | undefined = $state()
  let match_count = $state(0)
  let no_matches = $derived(query.trim().length > 0 && match_count === 0)

  // Rows opt into per-row reset with `data-key`, but a setting must not be unreachable by search
  // just because nothing resets it individually, so plain section rows count too.
  const row_selector = `[data-key], section.settings-section :is(label, .setting)`
  const search_hidden_attr = `data-search-hidden`
  let refresh_rows = $state<(() => void) | undefined>()

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

      const sections = [...root.querySelectorAll<HTMLElement>(`section.settings-section`)]
      const groups = [...root.querySelectorAll<HTMLDetailsElement>(`details.settings-group`)]
      // A row is reachable by its section/group title, but those headings also carry action
      // buttons ("Explain", "Reset"). Their labels are chrome, not settings text, and would
      // otherwise make a search for "reset" match every row in the section.
      const container_titles = new SvelteMap<HTMLElement, string>()
      const record_title = (container: HTMLElement, heading: Element | null): void => {
        if (!(heading instanceof HTMLElement)) return
        const copy = heading.cloneNode(true) as HTMLElement
        for (const chrome of copy.querySelectorAll(`button`)) chrome.remove()
        container_titles.set(container, copy.textContent ?? ``)
      }
      for (const section of sections) record_title(section, section.previousElementSibling)
      for (const group of groups) {
        record_title(group, group.querySelector(`:scope > summary`))
      }
      const row_contexts = [...root.querySelectorAll<HTMLElement>(row_selector)]
        .filter(
          (row) =>
            row.hasAttribute(`data-key`) ||
            row.parentElement?.closest(`label, .setting`) === null,
        )
        .map((row) => ({
          row,
          section: row.closest<HTMLElement>(`section.settings-section`),
          group: row.closest<HTMLDetailsElement>(`details.settings-group`),
        }))
      const directly_matched_rows = new SvelteSet<HTMLElement>()
      for (const { row, section, group } of row_contexts) {
        const searchable_text = [
          row.getAttribute(`data-label`),
          row.textContent,
          row.getAttribute(`data-description`),
          section && container_titles.get(section),
          group && container_titles.get(group),
        ]
          .filter((value): value is string => Boolean(value))
          .join(` `)
          .toLocaleLowerCase()
        if (searchable_text.includes(normalized_query)) directly_matched_rows.add(row)
      }
      const matched_containers = new SvelteSet<HTMLElement>()
      let matched_row_count = 0
      for (const { row, section, group } of row_contexts) {
        let ancestor = row.parentElement
        let ancestor_matches = false
        while (ancestor && ancestor !== root) {
          if (directly_matched_rows.has(ancestor)) {
            ancestor_matches = true
            break
          }
          ancestor = ancestor.parentElement
        }
        const is_match = directly_matched_rows.has(row) || ancestor_matches
        set_hidden(row, !is_match)
        // A row the caller hid stays hidden, so it must not count as a match either
        if (is_match && !row.hidden) {
          matched_row_count += 1
          if (section) matched_containers.add(section)
          if (group) matched_containers.add(group)
        }
      }

      for (const section of sections) {
        const section_matches = matched_containers.has(section)
        set_hidden(section, !section_matches)
        const heading = section.previousElementSibling
        if (heading instanceof HTMLElement && heading.matches(`h4`)) {
          set_hidden(heading, !section_matches)
        }
      }

      for (const group of groups) {
        const group_matches = matched_containers.has(group)
        set_hidden(group, !group_matches)
        if (group_matches && !group.open) {
          group.open = true
          opened_by_search.add(group)
        }
      }

      match_count = matched_row_count
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
    refresh_rows = schedule_refresh
    untrack(refresh)

    return () => {
      disposed = true
      observer.disconnect()
      if (refresh_rows === schedule_refresh) refresh_rows = undefined
      restore_visibility()
      match_count = 0
    }
  }

  $effect(() => {
    // Track the query here so filtering does not recreate the observer on every keystroke.
    void query
    refresh_rows?.()
  })

  const open_search = async (): Promise<void> => {
    search_open = true
    await tick()
    search_input?.focus()
  }

  const handle_keydown = (event: KeyboardEvent): void => {
    if (event.key !== `Escape`) return
    event.preventDefault()
    event.stopPropagation()
    query = ``
    search_open = false
  }
</script>

<div {...rest} class={[`settings-search`, rest.class]} {@attach filter_settings}>
  <div class:open={search_open} class="search-field">
    {#if search_open}
      <input
        bind:this={search_input}
        type="search"
        bind:value={query}
        {placeholder}
        aria-label={label}
        onkeydown={handle_keydown}
        onblur={() => {
          if (!query) search_open = false
        }}
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
    {:else}
      <button
        type="button"
        class="open-search"
        aria-label={label}
        title={label}
        onclick={open_search}
      >
        <Icon icon={Search} />
      </button>
    {/if}
  </div>
  {@render children()}
  {#if no_matches}
    <p id={status_id} class="no-matches" role="status">No settings match “{query.trim()}”.</p>
  {/if}
</div>

<style>
  .settings-search {
    position: relative;
    display: grid;
    gap: var(--pane-gap, 4pt);
  }
  .settings-search :global(:is([hidden], [data-search-hidden])) {
    display: none !important;
  }
  .search-field {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    justify-content: flex-end;
    z-index: 1;
    &.open {
      position: relative;
      inset: auto;
      width: 100%;
      margin-block-end: 4pt;
    }
    input {
      width: 100%;
      height: 1.8em;
      box-sizing: border-box;
      padding: 1pt 20pt 1pt 6pt;
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
  .open-search {
    display: grid;
    place-items: center;
    width: 1.8em;
    height: 1.8em;
    padding: 2pt;
    border: 0;
    border-radius: var(--border-radius, 3pt);
    background: transparent;
    color: var(--text-color-muted, #6b7280);
    cursor: pointer;
    &:hover {
      background: color-mix(in srgb, currentColor 8%, transparent);
      color: inherit;
    }
    :global(svg) {
      width: 1em;
      height: 1em;
    }
  }
  .clear-search {
    position: absolute;
    right: 3pt;
    bottom: 0;
    display: grid;
    place-items: center;
    width: 18pt;
    height: 1.8em;
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

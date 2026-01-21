<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import { setContext } from 'svelte'
  import { highlight_matches, tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import JsonNode from './JsonNode.svelte'
  import type { JsonTreeContext, JsonTreeProps } from './types'
  import { JSON_TREE_CONTEXT_KEY } from './types'
  import {
    collect_all_paths,
    find_matching_paths,
    get_ancestor_paths,
    parse_path,
    serialize_for_copy,
  } from './utils'

  // Constant set for arrow key detection (avoid allocating on every keydown)
  const ARROW_KEYS = new Set([`ArrowDown`, `ArrowUp`, `ArrowLeft`, `ArrowRight`])

  let {
    value,
    root_label,
    default_fold_level = 2,
    auto_fold_arrays = 10,
    auto_fold_objects = 20,
    collapsed_paths = $bindable(new SvelteSet<string>()),
    show_header = true,
    show_data_types = false,
    show_array_indices = true,
    sort_keys = false,
    max_string_length = 200,
    highlight_changes = true,
    onselect,
    oncopy,
    ...rest
  }: JsonTreeProps & Omit<HTMLAttributes<HTMLDivElement>, `onselect`> = $props()

  // Internal state
  let search_query = $state(``)
  let search_input_value = $state(``)
  let focused_path = $state<string | null>(null)
  // Use Set for O(1) lookup/add/delete instead of O(n) array operations
  let registered_paths_set = $state(new Set<string>())
  let registered_paths_list = $state<string[]>([]) // ordered list for keyboard nav
  let copy_feedback_path = $state<string | null>(null)
  let copy_feedback_error = $state(false)
  let copy_feedback_timeout: ReturnType<typeof setTimeout> | undefined
  // Track paths explicitly expanded (overrides auto-fold thresholds)
  let force_expanded = $state(new SvelteSet<string>())

  // Debounce search input
  let search_debounce_timeout: ReturnType<typeof setTimeout> | undefined

  function handle_search_input(event: Event) {
    const input = event.target as HTMLInputElement
    search_input_value = input.value

    if (search_debounce_timeout) clearTimeout(search_debounce_timeout)
    search_debounce_timeout = setTimeout(() => {
      search_query = search_input_value
      // Auto-expand to show matches after search updates
      // Using queueMicrotask to let derived values update first
      queueMicrotask(() => expand_to_matches())
    }, 150)
  }

  // Compute search matches
  let search_matches = $derived.by(() => {
    if (!search_query) return new SvelteSet<string>()
    return new SvelteSet(find_matching_paths(value, search_query, root_label ?? ``))
  })

  // Auto-expand ancestors of search matches when search query changes
  // This is called manually from the search input handler to avoid reactivity issues
  function expand_to_matches(): void {
    if (search_matches.size === 0) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local variable, not reactive state
    const paths_to_expand = new Set<string>()
    for (const match of search_matches) {
      for (const ancestor of get_ancestor_paths(match)) {
        paths_to_expand.add(ancestor)
      }
    }
    let changed = false
    for (const path_to_expand of paths_to_expand) {
      if (collapsed_paths.has(path_to_expand)) {
        collapsed_paths.delete(path_to_expand)
        changed = true
      }
    }
    if (changed) {
      collapsed_paths = new SvelteSet(collapsed_paths)
    }
  }

  // Previous values map for change detection
  const previous_values = new Map<string, unknown>()

  // Toggle collapse - tracks force_expanded to override auto-fold thresholds
  function toggle_collapse(path: string, is_currently_collapsed: boolean): void {
    if (is_currently_collapsed) {
      collapsed_paths.delete(path)
      force_expanded.add(path)
    } else {
      force_expanded.delete(path)
      collapsed_paths.add(path)
    }
    collapsed_paths = new SvelteSet(collapsed_paths)
    force_expanded = new SvelteSet(force_expanded)
  }

  function expand_all(): void {
    force_expanded = new SvelteSet(collect_all_paths(value, root_label ?? ``))
    collapsed_paths = new SvelteSet()
  }

  function collapse_all(): void {
    force_expanded = new SvelteSet()
    collapsed_paths = new SvelteSet(collect_all_paths(value, root_label ?? ``))
  }

  function collapse_to_level(level: number): void {
    const all_paths = collect_all_paths(value, root_label ?? ``)
    const new_collapsed = new SvelteSet<string>()
    const new_expanded = new SvelteSet<string>()

    for (const path of all_paths) {
      const segments = parse_path(path)
      const depth = root_label && segments[0] === root_label
        ? segments.length - 1
        : segments.length
      ;(depth >= level ? new_collapsed : new_expanded).add(path)
    }

    collapsed_paths = new_collapsed
    force_expanded = new_expanded
  }

  function set_focused(path: string | null): void {
    focused_path = path
    if (path) onselect?.(path, get_value_at_path(path))
  }

  async function copy_value(path: string, val: unknown): Promise<void> {
    const serialized = serialize_for_copy(val)
    try {
      await navigator.clipboard.writeText(serialized)
      copy_feedback_error = false
      oncopy?.(path, serialized)
    } catch {
      // Clipboard API failed - still show feedback but as error
      copy_feedback_error = true
    }
    // Show feedback regardless of success/failure
    copy_feedback_path = path
    if (copy_feedback_timeout) clearTimeout(copy_feedback_timeout)
    copy_feedback_timeout = setTimeout(() => {
      copy_feedback_path = null
    }, 1000)
  }

  function register_path(path: string): void {
    if (!registered_paths_set.has(path)) {
      registered_paths_set.add(path)
      registered_paths_list = [...registered_paths_list, path]
    }
  }

  function unregister_path(path: string): void {
    if (registered_paths_set.has(path)) {
      registered_paths_set.delete(path)
      registered_paths_list = registered_paths_list.filter((p) => p !== path)
    }
  }

  // Helper to get value at a path (for onselect callback)
  function get_value_at_path(path: string): unknown {
    if (!path || path === root_label) return value

    const segments = parse_path(path)
    let current: unknown = value
    const start_idx = segments[0] === root_label ? 1 : 0

    for (let idx = start_idx; idx < segments.length; idx++) {
      const segment = segments[idx]
      if (current === null || current === undefined) return undefined

      // Map/Set use numeric indexing
      if (current instanceof Map || current instanceof Set) {
        const index = typeof segment === `number` ? segment : Number(segment)
        if (Number.isNaN(index)) return undefined
        current = Array.from(current.values())[index]
      } else if (typeof current === `object`) {
        current = (current as Record<string | number, unknown>)[segment]
      } else {
        return undefined
      }
    }
    return current
  }

  // Create context
  const context: JsonTreeContext = {
    get settings() {
      return {
        default_fold_level,
        auto_fold_arrays,
        auto_fold_objects,
        show_data_types,
        show_array_indices,
        sort_keys,
        max_string_length,
        highlight_changes,
      }
    },
    get collapsed() {
      return collapsed_paths
    },
    get force_expanded() {
      return force_expanded
    },
    get search_query() {
      return search_query
    },
    get search_matches() {
      return search_matches
    },
    get focused_path() {
      return focused_path
    },
    previous_values,
    toggle_collapse,
    expand_all,
    collapse_all,
    collapse_to_level,
    set_focused,
    copy_value,
    register_path,
    unregister_path,
  }

  setContext(JSON_TREE_CONTEXT_KEY, context)

  // Keyboard navigation at tree level
  function handle_tree_keydown(event: KeyboardEvent) {
    if (!focused_path) {
      // Focus first node on any arrow key
      if (ARROW_KEYS.has(event.key)) {
        event.preventDefault()
        if (registered_paths_list.length > 0) {
          set_focused(registered_paths_list[0])
        }
      }
      return
    }

    const current_index = registered_paths_list.indexOf(focused_path)
    if (current_index === -1) return

    if (event.key === `ArrowDown`) {
      event.preventDefault()
      const next_index = Math.min(current_index + 1, registered_paths_list.length - 1)
      set_focused(registered_paths_list[next_index])
    } else if (event.key === `ArrowUp`) {
      event.preventDefault()
      const prev_index = Math.max(current_index - 1, 0)
      set_focused(registered_paths_list[prev_index])
    }
  }

  // Clear search
  function clear_search() {
    search_input_value = ``
    search_query = ``
  }
</script>

<div
  class="json-tree"
  role="tree"
  aria-label="JSON tree viewer"
  {...rest}
  onkeydown={handle_tree_keydown}
>
  {#if show_header}
    <header class="json-tree-header">
      <div class="search-wrapper">
        <Icon icon="Search" style="width: 14px; height: 14px; opacity: 0.6" />
        <input
          type="search"
          placeholder="Search keys and values..."
          value={search_input_value}
          oninput={handle_search_input}
          class="search-input"
        />
        {#if search_input_value}
          <button
            type="button"
            class="clear-search"
            onclick={clear_search}
            title="Clear search"
            {@attach tooltip()}
          >
            <Icon icon="Cross" style="width: 12px; height: 12px" />
          </button>
        {/if}
      </div>
      <div class="controls">
        <button type="button" onclick={expand_all} title="Expand all" {@attach tooltip()}>
          <Icon icon="Expand" style="width: 14px; height: 14px" />
        </button>
        <button
          type="button"
          onclick={collapse_all}
          title="Collapse all"
          {@attach tooltip()}
        >
          <Icon icon="Collapse" style="width: 14px; height: 14px" />
        </button>
        <button
          type="button"
          onclick={() => collapse_to_level(1)}
          title="Collapse to level 1"
          {@attach tooltip()}
        >
          1
        </button>
        <button
          type="button"
          onclick={() => collapse_to_level(2)}
          title="Collapse to level 2"
          {@attach tooltip()}
        >
          2
        </button>
        <button
          type="button"
          onclick={() => collapse_to_level(3)}
          title="Collapse to level 3"
          {@attach tooltip()}
        >
          3
        </button>
      </div>
      {#if search_query && search_matches.size > 0}
        <span class="match-count">{search_matches.size} match{
            search_matches.size === 1 ? `` : `es`
          }</span>
      {/if}
    </header>
  {/if}

  <div
    class="json-tree-content"
    {@attach highlight_matches({
      query: search_query,
      css_class: `json-tree-search-match`,
    })}
  >
    {#if copy_feedback_path !== null}
      <div class="copy-feedback" class:error={copy_feedback_error}>
        {copy_feedback_error ? `Copy failed` : `Copied!`}
      </div>
    {/if}
    <JsonNode node_key={root_label ?? null} {value} path={root_label ?? ``} depth={0} />
  </div>
</div>

<style>
  ::highlight(json-tree-search-match) {
    background: var(--jt-search-match-bg, light-dark(#fff59d, #614d00));
    color: inherit;
  }
  .json-tree {
    /* Color variables with light-dark() for automatic theme support */
    --jt-string: light-dark(#a31515, #ce9178);
    --jt-number: light-dark(#098658, #b5cea8);
    --jt-boolean: light-dark(#0000ff, #569cd6);
    --jt-null: light-dark(#808080, #808080);
    --jt-key: light-dark(#001080, #9cdcfe);
    --jt-punctuation: light-dark(#000000, #d4d4d4);
    --jt-arrow: light-dark(#6e6e6e, #858585);
    --jt-preview: light-dark(#808080, #808080);
    --jt-search-match-bg: light-dark(#fff59d, #614d00);
    --jt-change-flash: light-dark(#c8e6c9, #1b5e20);
    --jt-focus-bg: light-dark(#e3f2fd, #0d3a58);
    --jt-hover-bg: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.08));
    --jt-indent-guide: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1));
    --jt-header-bg: light-dark(rgba(0, 0, 0, 0.03), rgba(255, 255, 255, 0.05));
    --jt-header-border: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1));
    /* Layout variables */
    --jt-indent: 1.2em;
    --jt-line-height: 1.5;
    --jt-font-size: 13px;
    --jt-font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    font-family: var(--jt-font-family);
    font-size: var(--jt-font-size);
    line-height: var(--jt-line-height);
    position: relative;
    background: var(--jt-bg, transparent);
    border-radius: var(--jt-border-radius, 4px);
    overflow: hidden;
  }
  .json-tree-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--jt-header-bg);
    flex-wrap: wrap;
  }
  .search-wrapper {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 150px;
    max-width: 300px;
    background: var(--jt-search-bg, light-dark(white, rgba(0, 0, 0, 0.2)));
    border: 1px solid
      var(--jt-search-border, light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.15)));
    border-radius: 4px;
    padding: 2px 6px;
  }
  .search-input {
    flex: 1;
    border: none;
    background: transparent;
    font-size: 12px;
    padding: 2px;
    outline: none;
    color: inherit;
  }
  .search-input::placeholder {
    color: var(--jt-placeholder, light-dark(#999, #666));
  }
  .clear-search {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border: none;
    background: none;
    cursor: pointer;
    opacity: 0.6;
    border-radius: 2px;
  }
  .clear-search:hover {
    opacity: 1;
    background: var(--jt-hover-bg);
  }
  .controls {
    display: flex;
    gap: 2px;
  }
  .controls button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    padding: 2px 6px;
    border: 1px solid var(--jt-header-border);
    background: var(--jt-btn-bg, light-dark(white, rgba(255, 255, 255, 0.1)));
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    color: inherit;
    transition: background 0.15s;
  }
  .controls button:hover {
    background: var(
      --jt-btn-hover-bg,
      light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.15))
    );
  }
  .match-count {
    font-size: 11px;
    color: var(--jt-match-count-color, light-dark(#666, #aaa));
    white-space: nowrap;
  }
  .json-tree-content {
    padding: var(--jt-content-padding, 8px);
    overflow: auto;
    max-height: var(--jt-max-height, none);
  }
  .copy-feedback {
    position: absolute;
    top: 8px;
    right: 8px;
    background: var(--success-color, #10b981);
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    animation: fade-in-out 1s ease-out forwards;
    pointer-events: none;
    z-index: 10;
  }
  .copy-feedback.error {
    background: var(--error-color, #ef4444);
  }
  @keyframes fade-in-out {
    0% {
      opacity: 0;
      transform: translateY(-4px);
    }
    15% {
      opacity: 1;
      transform: translateY(0);
    }
    85% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
</style>

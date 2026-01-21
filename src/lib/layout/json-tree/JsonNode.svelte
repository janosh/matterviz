<script lang="ts">
  import { getContext, onMount } from 'svelte'
  import JsonNode from './JsonNode.svelte'
  import JsonValue from './JsonValue.svelte'
  import type { JsonTreeContext } from './types'
  import { JSON_TREE_CONTEXT_KEY } from './types'
  import {
    build_path,
    format_preview,
    get_child_count,
    get_value_type,
    is_expandable,
    matches_search,
  } from './utils'

  let {
    node_key = null,
    value,
    path,
    depth,
    is_last = true,
  }: {
    node_key?: string | number | null
    value: unknown
    path: string
    depth: number
    is_last?: boolean
  } = $props()

  const ctx = getContext<JsonTreeContext>(JSON_TREE_CONTEXT_KEY)

  // Circular reference detection (handled by parent via WeakSet)
  let is_circular = $state(false)

  onMount(() => {
    // Register this path with context for keyboard navigation
    if (ctx && path) {
      ctx.register_path(path)
      return () => ctx.unregister_path(path)
    }
  })

  // Determine value type
  let value_type = $derived(is_circular ? `circular` : get_value_type(value))

  // Check if this node is expandable
  let expandable = $derived(is_expandable(value) && !is_circular)

  // Get child count for preview
  let child_count = $derived(expandable ? get_child_count(value) : 0)

  // Determine if this node should be collapsed
  let is_collapsed = $derived.by(() => {
    if (!expandable) return false

    // Check if explicitly collapsed
    if (ctx?.collapsed.has(path)) return true

    // Check if explicitly expanded (not in collapsed set but within fold level)
    // If depth >= default_fold_level, default to collapsed
    const fold_level = ctx?.settings.default_fold_level ?? 2
    if (depth >= fold_level && !ctx?.collapsed.has(`!${path}`)) {
      // Use a marker to track explicitly expanded nodes
      return true
    }

    // Check auto-fold thresholds
    if (value_type === `array`) {
      const threshold = ctx?.settings.auto_fold_arrays ?? 10
      if (child_count > threshold) return true
    }
    if (value_type === `object`) {
      const threshold = ctx?.settings.auto_fold_objects ?? 20
      if (child_count > threshold) return true
    }

    return false
  })

  // Check if this node matches search
  let is_search_match = $derived(
    ctx?.search_query
      ? matches_search(path, node_key, value, ctx.search_query)
      : false,
  )

  // Note: Auto-expand for search matches is handled in JsonTree.svelte

  // Check if this node is focused
  let is_focused = $derived(ctx?.focused_path === path)

  // Toggle collapse state
  function toggle_collapse(event?: MouseEvent) {
    event?.stopPropagation()
    if (ctx && expandable) {
      ctx.toggle_collapse(path)
    }
  }

  // Focus this node
  function focus_node() {
    if (ctx) {
      ctx.set_focused(path)
    }
  }

  // Get children based on value type
  function get_children(): Array<{ key: string | number; value: unknown }> {
    if (!expandable) return []

    if (value_type === `array`) {
      return (value as unknown[]).map((val, idx) => ({ key: idx, value: val }))
    }

    if (value_type === `object`) {
      let keys = Object.keys(value as Record<string, unknown>)
      if (ctx?.settings.sort_keys) {
        keys = keys.sort()
      }
      return keys.map((key) => ({
        key,
        value: (value as Record<string, unknown>)[key],
      }))
    }

    if (value_type === `map`) {
      const map = value as Map<unknown, unknown>
      return Array.from(map.entries()).map(([key, val], idx) => ({
        key: idx,
        value: { key, value: val },
      }))
    }

    if (value_type === `set`) {
      return Array.from(value as Set<unknown>).map((val, idx) => ({
        key: idx,
        value: val,
      }))
    }

    return []
  }

  let children = $derived(get_children())

  // Get bracket characters based on type
  let open_bracket = $derived(value_type === `array` ? `[` : `{`)
  let close_bracket = $derived(value_type === `array` ? `]` : `}`)

  // Handle keyboard navigation
  function handle_keydown(event: KeyboardEvent) {
    if (!is_focused) return

    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      if (expandable) {
        toggle_collapse()
      }
    } else if (event.key === `ArrowRight`) {
      event.preventDefault()
      if (expandable && is_collapsed) {
        toggle_collapse()
      }
    } else if (event.key === `ArrowLeft`) {
      event.preventDefault()
      if (expandable && !is_collapsed) {
        toggle_collapse()
      }
    } else if (
      (event.key === `c` || event.key === `C`) && (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault()
      if (ctx) {
        ctx.copy_value(path, value)
      }
    }
  }

  // Element reference for focus management
  let node_element: HTMLDivElement | undefined = $state()

  $effect(() => {
    if (is_focused && node_element) {
      node_element.focus()
    }
  })
</script>

<div
  bind:this={node_element}
  class="json-node depth-{depth}"
  class:collapsed={is_collapsed}
  class:expandable
  class:focused={is_focused}
  class:search-match={is_search_match}
  role="treeitem"
  aria-expanded={expandable ? !is_collapsed : undefined}
  aria-selected={is_focused}
  tabindex={is_focused ? 0 : -1}
  onclick={focus_node}
  onkeydown={handle_keydown}
>
  <span class="node-content">
    {#if expandable}
      <button
        type="button"
        class="collapse-toggle"
        onclick={toggle_collapse}
        aria-label={is_collapsed ? `Expand` : `Collapse`}
      >
        <span class="arrow" class:collapsed={is_collapsed}>▼</span>
      </button>
    {:else}
      <span class="no-toggle"></span>
    {/if}

    {#if node_key !== null}
      <span
        class="node-key"
        class:array-index={typeof node_key === `number`}
        title="Click to copy key"
        onclick={(event) => {
          event.stopPropagation()
          navigator.clipboard.writeText(String(node_key))
        }}
        onkeydown={(event) => {
          if (event.key === `Enter`) navigator.clipboard.writeText(String(node_key))
        }}
        role="button"
        tabindex="-1"
      >
        {#if typeof node_key === `number` && ctx?.settings.show_array_indices}
          <span class="index">{node_key}</span>
        {:else if typeof node_key === `string`}
          "{node_key}"
        {/if}
      </span>
      <span class="colon">:</span>
    {/if}

    {#if expandable}
      <span class="bracket open">{open_bracket}</span>
      {#if is_collapsed}
        <span
          class="preview"
          onclick={toggle_collapse}
          onkeydown={(event) => {
            if (event.key === `Enter` || event.key === ` `) {
              event.preventDefault()
              toggle_collapse()
            }
          }}
          role="button"
          tabindex="-1"
        >
          {format_preview(value)}
        </span>
        <span class="bracket close">{close_bracket}</span>
      {/if}
    {:else}
      <JsonValue {value} {value_type} {path} {is_search_match} />
    {/if}
  </span>

  {#if !is_last && (!expandable || is_collapsed)}
    <span class="comma">,</span>
  {/if}

  {#if expandable && !is_collapsed}
    <div class="children" role="group">
      {#each children as child, idx (child.key)}
        <JsonNode
          node_key={child.key}
          value={child.value}
          path={build_path(path, child.key)}
          depth={depth + 1}
          is_last={idx === children.length - 1}
        />
      {/each}
    </div>
    <span class="bracket close">{close_bracket}</span>
    {#if !is_last}
      <span class="comma">,</span>
    {/if}
  {/if}
</div>

<style>
  .json-node {
    font-family: var(--jt-font-family, 'SF Mono', Monaco, 'Courier New', monospace);
    font-size: var(--jt-font-size, 13px);
    line-height: var(--jt-line-height, 1.5);
    outline: none;
  }
  .json-node:focus {
    outline: none;
  }
  .json-node.focused > .node-content {
    background: var(--jt-focus-bg, light-dark(#e3f2fd, #0d3a58));
    border-radius: 2px;
  }
  .json-node.search-match > .node-content {
    background: var(--jt-search-match-bg, light-dark(#fff59d, #614d00));
    border-radius: 2px;
  }
  .node-content {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
    padding: 1px 2px;
    border-radius: 2px;
  }
  .collapse-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1em;
    height: 1em;
    padding: 0;
    margin: 0;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--jt-arrow, light-dark(#6e6e6e, #858585));
    flex-shrink: 0;
  }
  .collapse-toggle:hover {
    color: var(--jt-arrow-hover, light-dark(#000, #fff));
  }
  .arrow {
    display: inline-block;
    font-size: 0.7em;
    transition: transform 0.15s ease;
  }
  .arrow.collapsed {
    transform: rotate(-90deg);
  }
  .no-toggle {
    display: inline-block;
    width: 1em;
    flex-shrink: 0;
  }
  .node-key {
    color: var(--jt-key, light-dark(#001080, #9cdcfe));
    cursor: pointer;
  }
  .node-key:hover {
    text-decoration: underline;
  }
  .node-key.array-index .index {
    color: var(--jt-index, light-dark(#098658, #b5cea8));
  }
  .colon {
    color: var(--jt-punctuation, light-dark(#000, #d4d4d4));
    margin-right: 4px;
  }
  .bracket {
    color: var(--jt-bracket, light-dark(#000, #d4d4d4));
  }
  .preview {
    color: var(--jt-preview, light-dark(#808080, #808080));
    font-style: italic;
    cursor: pointer;
    margin: 0 4px;
  }
  .preview:hover {
    text-decoration: underline;
  }
  .comma {
    color: var(--jt-punctuation, light-dark(#000, #d4d4d4));
  }
  .children {
    padding-left: var(--jt-indent, 1.2em);
    border-left: 1px solid
      var(--jt-indent-guide, light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1)));
    margin-left: 0.5em;
  }
</style>

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

  onMount(() => {
    // Register this path with context for keyboard navigation
    if (ctx && path) {
      ctx.register_path(path)
      return () => ctx.unregister_path(path)
    }
  })

  // Determine value type
  let value_type = $derived(get_value_type(value))

  // Check if this node is expandable
  let expandable = $derived(is_expandable(value))

  // Get child count for preview
  let child_count = $derived(expandable ? get_child_count(value) : 0)

  // Determine if this node should be collapsed
  let is_collapsed = $derived.by(() => {
    if (!expandable) return false

    // Check if explicitly collapsed
    if (ctx?.collapsed.has(path)) return true

    // Check if explicitly force-expanded (overrides auto-fold)
    if (ctx?.force_expanded.has(path)) return false

    // If depth >= default_fold_level, default to collapsed
    const fold_level = ctx?.settings.default_fold_level ?? 2
    if (depth >= fold_level) return true

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

  // Note: Search highlighting is handled by CSS Highlight API in JsonTree.svelte

  // Check if this node is focused
  let is_focused = $derived(ctx?.focused_path === path)

  // Check if this is the current search match being navigated
  let is_current_match = $derived(ctx?.current_match_path === path)

  // Toggle collapse state
  function toggle_collapse(event?: MouseEvent) {
    event?.stopPropagation()
    if (ctx && expandable) {
      ctx.toggle_collapse(path, is_collapsed)
    }
  }

  // Toggle collapse recursively on double-click
  function toggle_collapse_recursive(event: MouseEvent) {
    event.stopPropagation()
    if (ctx && expandable) {
      // If collapsed, expand all; if expanded, collapse all
      ctx.toggle_collapse_recursive(path, !is_collapsed)
    }
  }

  // Focus this node
  function focus_node() {
    ctx?.set_focused(path)
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
      ctx?.copy_value(path, value)
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
  class:current-match={is_current_match}
  data-path={path}
  role="treeitem"
  aria-expanded={expandable ? !is_collapsed : undefined}
  aria-selected={is_focused}
  tabindex={is_focused ? 0 : -1}
  onclick={focus_node}
  ondblclick={toggle_collapse_recursive}
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
      <button
        type="button"
        class="node-key"
        class:array-index={typeof node_key === `number`}
        title="Click to copy path: {path}"
        tabindex="-1"
        onclick={(event) => {
          event.stopPropagation()
          ctx?.copy_path(path)
        }}
      >
        {#if typeof node_key === `number` && ctx?.settings.show_array_indices}
          <span class="index">{node_key}</span>
        {:else if typeof node_key === `string`}
          "{node_key}"
        {/if}
      </button>
      <span class="colon">:</span>
    {/if}

    {#if expandable}
      <span class="bracket open">{open_bracket}</span>
      {#if is_collapsed}
        <button type="button" class="preview" tabindex="-1" onclick={toggle_collapse}>
          {format_preview(value)}
        </button>
        <span class="bracket close">{close_bracket}</span>
      {/if}
    {:else}
      <JsonValue {value} {value_type} {path} />
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
  .json-node.current-match > .node-content {
    background: var(--jt-current-match-bg, light-dark(#ffcc80, #8a5600));
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
    color: light-dark(#000, #fff);
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
    background: none;
    border: none;
    padding: 0;
    font: inherit;
  }
  .node-key:hover {
    text-decoration: underline;
  }
  .node-key.array-index .index {
    color: var(--jt-number, light-dark(#098658, #b5cea8));
  }
  .colon {
    color: var(--jt-punctuation, light-dark(#000, #d4d4d4));
    margin-right: 4px;
  }
  .bracket {
    color: var(--jt-punctuation, light-dark(#000, #d4d4d4));
  }
  .preview {
    color: var(--jt-preview, light-dark(#808080, #808080));
    font-style: italic;
    cursor: pointer;
    margin: 0 4px;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
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

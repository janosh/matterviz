<script lang="ts">
  import { getContext } from 'svelte'
  import type { JsonTreeContext, JsonValueType } from './types'
  import { JSON_TREE_CONTEXT_KEY } from './types'
  import { format_preview, values_equal } from './utils'

  let {
    value,
    value_type,
    path,
  }: {
    value: unknown
    value_type: JsonValueType
    path: string
  } = $props()

  const ctx = getContext<JsonTreeContext>(JSON_TREE_CONTEXT_KEY)

  // Track if value just changed for animation
  let just_changed = $state(false)
  let change_timeout: ReturnType<typeof setTimeout> | undefined

  // Expanded state for long strings
  let is_expanded = $state(false)

  // Extract max_string_length threshold for reuse
  let max_len = $derived(ctx?.settings.max_string_length ?? 200)
  let is_long_string = $derived(
    value_type === `string` && (value as string).length > max_len,
  )

  // Check for changes on mount and when value changes
  $effect(() => {
    if (!ctx?.settings.highlight_changes) return

    const prev = ctx.previous_values.get(path)
    if (prev !== undefined && !values_equal(prev, value)) {
      just_changed = true
      if (change_timeout) clearTimeout(change_timeout)
      change_timeout = setTimeout(() => {
        just_changed = false
      }, 1000)
    }
    ctx.previous_values.set(path, value)

    return () => {
      if (change_timeout) clearTimeout(change_timeout)
    }
  })

  // Handle click to copy
  async function handle_click(event: MouseEvent) {
    event.stopPropagation()
    if (ctx) {
      await ctx.copy_value(path, value)
    }
  }

  // Format display value - strings use custom truncation, others use format_preview
  let display_value = $derived.by(() => {
    if (value_type === `circular`) return `[Circular]`
    if (value_type === `string`) {
      const str = value as string
      return is_long_string && !is_expanded
        ? `"${str.slice(0, max_len)}..."`
        : `"${str}"`
    }
    return format_preview(value)
  })

  // Check if string is truncated
  let is_truncated = $derived(is_long_string && !is_expanded)

  // Toggle string expansion
  function toggle_expand(event: MouseEvent) {
    event.stopPropagation()
    is_expanded = !is_expanded
  }
</script>

<span
  class="json-value {value_type}"
  class:changed={just_changed}
  onclick={handle_click}
  onkeydown={(event) => {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      ctx?.copy_value(path, value)
    }
  }}
  role="button"
  tabindex="-1"
  title="Click to copy"
>
  {display_value}
  {#if is_truncated}
    <button
      type="button"
      class="expand-btn"
      onclick={toggle_expand}
      title="Show full string"
    >
      ...
    </button>
  {:else if is_long_string && is_expanded}
    <button
      type="button"
      class="expand-btn"
      onclick={toggle_expand}
      title="Collapse string"
    >
      ▲
    </button>
  {/if}
  {#if ctx?.settings.show_data_types && value_type !== `null` &&
      value_type !== `undefined`}
    <span class="type-annotation">{value_type}</span>
  {/if}
</span>

<style>
  .json-value {
    cursor: pointer;
    border-radius: 2px;
    transition: background-color 0.15s, color 0.15s;
  }
  .json-value:hover {
    background: var(
      --jt-hover-bg,
      light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.08))
    );
  }
  /* Type-specific colors */
  .json-value.string {
    color: var(--jt-string, light-dark(#a31515, #ce9178));
    word-break: break-word;
  }
  .json-value.number {
    color: var(--jt-number, light-dark(#098658, #b5cea8));
  }
  .json-value.boolean {
    color: var(--jt-boolean, light-dark(#0000ff, #569cd6));
  }
  .json-value.null,
  .json-value.undefined {
    color: var(--jt-null, light-dark(#808080, #808080));
    font-style: italic;
  }
  .json-value.date {
    color: var(--jt-date, light-dark(#098658, #dcdcaa));
  }
  .json-value.regexp {
    color: var(--jt-regexp, light-dark(#811f3f, #d16969));
  }
  .json-value.symbol {
    color: var(--jt-symbol, light-dark(#267f99, #4ec9b0));
  }
  .json-value.bigint {
    color: var(--jt-bigint, light-dark(#098658, #b5cea8));
  }
  .json-value.function {
    color: var(--jt-function, light-dark(#795e26, #dcdcaa));
    font-style: italic;
  }
  .json-value.error {
    color: var(--jt-error, light-dark(#a31515, #f48771));
  }
  .json-value.circular {
    color: var(--jt-circular, light-dark(#808080, #808080));
    font-style: italic;
  }
  /* Change animation */
  .json-value.changed {
    animation: value-change 1s ease-out;
  }
  @keyframes value-change {
    0% {
      background: var(--jt-change-flash, light-dark(#c8e6c9, #1b5e20));
    }
    100% {
      background: transparent;
    }
  }
  /* Expand/collapse button for long strings */
  .expand-btn {
    display: inline;
    background: none;
    border: none;
    color: var(--jt-expand-btn, light-dark(#0066cc, #4fc3f7));
    cursor: pointer;
    font-size: 0.85em;
    padding: 0 2px;
    margin-left: 2px;
  }
  .expand-btn:hover {
    text-decoration: underline;
  }
  /* Type annotation */
  .type-annotation {
    font-size: 0.7em;
    color: var(--jt-type-annotation, light-dark(#808080, #6a6a6a));
    margin-left: 4px;
    opacity: 0.7;
  }
</style>

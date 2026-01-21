<script lang="ts">
  import { getContext } from 'svelte'
  import type { JsonTreeContext, JsonValueType } from './types'
  import { JSON_TREE_CONTEXT_KEY } from './types'
  import { serialize_for_copy, values_equal } from './utils'

  let {
    value,
    value_type,
    path,
    is_search_match = false,
  }: {
    value: unknown
    value_type: JsonValueType
    path: string
    is_search_match?: boolean
  } = $props()

  const ctx = getContext<JsonTreeContext>(JSON_TREE_CONTEXT_KEY)

  // Track if value just changed for animation
  let just_changed = $state(false)
  let change_timeout: ReturnType<typeof setTimeout> | undefined

  // Expanded state for long strings
  let is_expanded = $state(false)

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

  // Format the display value based on type
  function get_display_value(): string {
    if (value_type === `null`) return `null`
    if (value_type === `undefined`) return `undefined`
    if (value_type === `boolean`) return String(value)
    if (value_type === `number`) {
      if (Number.isNaN(value as number)) return `NaN`
      if (value === Infinity) return `Infinity`
      if (value === -Infinity) return `-Infinity`
      return String(value)
    }
    if (value_type === `bigint`) return `${value}n`
    if (value_type === `symbol`) return (value as symbol).toString()
    if (value_type === `date`) return (value as Date).toISOString()
    if (value_type === `regexp`) return (value as RegExp).toString()
    if (value_type === `function`) {
      const fn = value as (...args: unknown[]) => unknown
      return `ƒ ${fn.name || `anonymous`}()`
    }
    if (value_type === `error`) {
      const err = value as Error
      return `${err.name}: ${err.message}`
    }
    if (value_type === `circular`) return `[Circular]`

    // String
    if (value_type === `string`) {
      const str = value as string
      const max_len = ctx?.settings.max_string_length ?? 200
      if (str.length > max_len && !is_expanded) {
        return `"${str.slice(0, max_len)}..."`
      }
      return `"${str}"`
    }

    return String(value)
  }

  let display_value = $derived(get_display_value())

  // Check if string is truncated
  let is_truncated = $derived(
    value_type === `string` &&
      (value as string).length > (ctx?.settings.max_string_length ?? 200) &&
      !is_expanded,
  )

  // Toggle string expansion
  function toggle_expand(event: MouseEvent) {
    event.stopPropagation()
    is_expanded = !is_expanded
  }

  // Copy the raw value
  async function copy_raw() {
    try {
      await navigator.clipboard.writeText(serialize_for_copy(value))
    } catch {
      // Clipboard API not available
    }
  }
</script>

<span
  class="json-value {value_type}"
  class:search-match={is_search_match}
  class:changed={just_changed}
  onclick={handle_click}
  onkeydown={(event) => {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      copy_raw()
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
  {:else if value_type === `string` && is_expanded &&
      (value as string).length > (ctx?.settings.max_string_length ?? 200)}
    <button
      type="button"
      class="expand-btn"
      onclick={toggle_expand}
      title="Collapse string"
    >
      ▲
    </button>
  {/if}
  {#if ctx?.settings.show_data_types && ![`null`, `undefined`].includes(value_type)}
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
  /* Search match highlight */
  .json-value.search-match {
    background: var(--jt-search-match-bg, light-dark(#fff59d, #614d00));
    border-radius: 2px;
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

<script lang="ts">
  import { getContext, tick } from 'svelte'
  import type { JsonTreeContext, JsonValueType } from './types'
  import { JSON_TREE_CONTEXT_KEY } from './types'
  import {
    format_preview,
    is_css_color,
    is_url,
    parse_edited_value,
    values_equal,
  } from './utils'

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

  // Trimmed string for URL/color detection (avoids using raw whitespace in href/style)
  let trimmed_str = $derived(value_type === `string` ? (value as string).trim() : ``)

  // Auto-detect URLs in string values
  let url_detected = $derived(value_type === `string` && is_url(trimmed_str))

  // Auto-detect CSS colors in string values
  let color_detected = $derived(
    value_type === `string` && is_css_color(trimmed_str) ? trimmed_str : null,
  )

  // Handle click to copy (delayed to avoid firing on double-click-to-edit)
  let click_timer: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => {
    if (click_timer) clearTimeout(click_timer)
  })

  async function handle_click(event: MouseEvent) {
    event.stopPropagation()
    if (!ctx) return
    // When editable, delay copy so double-click can cancel it
    if (ctx.settings.editable && ctx.onchange) {
      if (click_timer) clearTimeout(click_timer)
      const copy_pos = { clientX: event.clientX, clientY: event.clientY }
      click_timer = setTimeout(() => ctx.copy_value(path, value, copy_pos), 250)
    } else {
      await ctx.copy_value(path, value, event)
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

  // === Inline Editing ===
  let editing = $state(false)
  let edit_text = $state(``)
  let edit_input = $state<HTMLInputElement | null>(null)

  function start_edit(event: MouseEvent) {
    if (!ctx?.settings.editable || !ctx.onchange) return
    event.stopPropagation()
    // Cancel pending click-to-copy
    if (click_timer) clearTimeout(click_timer)
    // Pre-fill with raw value (strings without quotes)
    edit_text = value_type === `string` ? (value as string) : String(value)
    editing = true
    tick().then(() => edit_input?.select())
  }

  function commit_edit() {
    if (!editing) return
    editing = false
    const new_value = parse_edited_value(edit_text)
    if (!values_equal(new_value, value)) {
      ctx?.onchange?.(path, new_value, value)
    }
  }

  function handle_edit_keydown(event: KeyboardEvent) {
    if (event.key === `Enter`) {
      event.preventDefault()
      commit_edit()
    } else if (event.key === `Escape`) {
      event.preventDefault()
      editing = false
    }
  }
</script>

{#if editing}
  <!-- svelte-ignore a11y_autofocus -->
  <input
    bind:this={edit_input}
    type="text"
    class="edit-input {value_type}"
    bind:value={edit_text}
    onkeydown={handle_edit_keydown}
    onblur={commit_edit}
    style:width="{Math.max(edit_text.length + 2, 6)}ch"
    autofocus
  />
{:else}
  <span
    class="json-value {value_type}"
    class:changed={just_changed}
    class:editable={ctx?.settings.editable}
    onclick={handle_click}
    ondblclick={start_edit}
    oncontextmenu={(event) => {
      ctx?.show_context_menu(event, path, value, false, false)
    }}
    onkeydown={(event) => {
      if (event.key === `Enter` || event.key === ` `) {
        event.preventDefault()
        ctx?.copy_value(path, value)
      }
    }}
    role="button"
    tabindex="-1"
    title={ctx?.settings.editable ? `Click to copy · Double-click to edit` : `Click to copy`}
  >
    {#if color_detected}
      <span class="color-swatch" style:background={color_detected}></span>
    {/if}
    {#if url_detected}
      <a
        href={encodeURI(trimmed_str)}
        class="url-link"
        target="_blank"
        rel="noopener noreferrer"
        onclick={(event) => event.stopPropagation()}
        title="Open URL in new tab"
      >
        {display_value}
      </a>
    {:else}
      {display_value}
    {/if}
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
{/if}

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
  /* Type-specific colors (shared between display and edit input) */
  :is(.json-value, .edit-input).string {
    color: var(--jt-string, light-dark(#a31515, #ce9178));
  }
  .json-value.string {
    word-break: break-word;
  }
  :is(.json-value, .edit-input).number {
    color: var(--jt-number, light-dark(#098658, #b5cea8));
  }
  :is(.json-value, .edit-input).boolean {
    color: var(--jt-boolean, light-dark(#0000ff, #569cd6));
  }
  :is(.json-value, .edit-input).null {
    color: var(--jt-null, light-dark(#808080, #808080));
  }
  .json-value.null,
  .json-value.undefined {
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
  .url-link {
    color: var(--jt-url, light-dark(#0066cc, #4fc3f7));
    text-decoration: none;
  }
  .url-link:hover {
    text-decoration: underline;
  }
  .json-value.editable {
    cursor: default;
  }
  .edit-input {
    font: inherit;
    font-family: var(--jt-font-family, 'SF Mono', Monaco, 'Courier New', monospace);
    padding: 0 2px;
    border: 1px solid var(--jt-edit-border, light-dark(#4a90d9, #4a90d9));
    border-radius: 2px;
    background: var(--jt-edit-bg, light-dark(#fff, #1a1a2e));
    outline: none;
    min-width: 4ch;
  }
  .color-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.3));
    vertical-align: middle;
    margin-right: 4px;
  }
</style>

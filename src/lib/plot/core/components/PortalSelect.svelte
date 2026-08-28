<script module lang="ts">
  // Track active dropdown across all instances - only one can be open at a time
  let active_close_fn: (() => void) | null = null
</script>

<script lang="ts">
  import { sanitize_html } from '$lib/sanitize'
  import { is_modifier_chord } from 'svelte-widgets/utils'
  import { click_outside, float, portal } from 'svelte-widgets/attachments'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type Option = { key: string; label: string; unit?: string }

  let {
    options,
    selected_key = $bindable(),
    on_select,
    disabled = false,
    format_option = (opt: Option) => (opt.unit ? `${opt.label} (${opt.unit})` : opt.label),
    ...rest
  }: Omit<HTMLButtonAttributes, `onclick`> & {
    options: Option[]
    selected_key?: string
    on_select?: (key: string, prev_key?: string) => void | Promise<void>
    disabled?: boolean
    format_option?: (opt: Option) => string
  } = $props()

  let dropdown_open = $state(false)
  let trigger_el: HTMLButtonElement | undefined = $state()
  let dropdown_el: HTMLDivElement | undefined = $state()

  const selected_option = $derived(
    options.find((opt) => opt.key === selected_key) ?? options[0],
  )

  function open_dropdown() {
    if (!trigger_el || !options.length) return
    if (active_close_fn && active_close_fn !== close_dropdown) active_close_fn()
    dropdown_open = true
    active_close_fn = close_dropdown
  }

  function close_dropdown(return_focus = true) {
    if (active_close_fn === close_dropdown) active_close_fn = null
    dropdown_open = false
    if (return_focus) trigger_el?.focus()
  }

  async function select(key: string) {
    if (key !== selected_key) {
      const prev_key = selected_key
      selected_key = key // Optimistic update for responsive UI
      try {
        await on_select?.(key, prev_key)
      } catch {
        selected_key = prev_key // Roll back on error
      }
    }
    close_dropdown()
  }

  // Arrow/Enter stay on window (focus may be on the trigger, outside the portalled list).
  // Escape is handled by click_outside({ escape: true }) below — not duplicated here.
  function handle_keydown(evt: KeyboardEvent) {
    // Cmd/Ctrl+Arrow scrolls the page; the list only answers bare keys
    if (!dropdown_el || is_modifier_chord(evt)) return
    const buttons = [...dropdown_el.querySelectorAll(`button`)]
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const len = buttons.length

    if (evt.key === `ArrowDown`) {
      evt.preventDefault()
      buttons[(idx + 1) % len]?.focus()
    } else if (evt.key === `ArrowUp`) {
      evt.preventDefault()
      buttons[idx === -1 ? len - 1 : (idx - 1 + len) % len]?.focus()
    } else if (evt.key === `Enter` && idx !== -1) {
      evt.preventDefault()
      buttons[idx].click()
    }
  }

  // Close dropdown when disabled, options empty, or component unmounts
  $effect(() => {
    if ((disabled || !options.length) && dropdown_open) close_dropdown(false)
    return () => close_dropdown(false)
  })
</script>

<svelte:window onkeydown={dropdown_open ? handle_keydown : undefined} />

{#if selected_option}
  <button
    bind:this={trigger_el}
    type="button"
    onclick={() => (dropdown_open ? close_dropdown() : open_dropdown())}
    {disabled}
    aria-expanded={dropdown_open}
    aria-haspopup="listbox"
    {...rest}
    class={[`portal-select-trigger`, rest.class]}
  >
    {@html sanitize_html(format_option(selected_option))}
    <span class="arrow">▾</span>
  </button>
{/if}

{#if dropdown_open}
  <!-- portalled to <body> to escape the plot's overflow clipping, then parked under the
  trigger by `float`. Scoped CSS survives the move, so no inline styles are needed. -->
  <div
    bind:this={dropdown_el}
    class="portal-select-dropdown"
    role="listbox"
    {@attach portal(document.body)}
    {@attach float({
      anchor: trigger_el,
      placement: `bottom`,
      align: `center`,
      offset: 4,
      padding: 4,
      flip: [`bottom`, `top`],
    })}
    {@attach click_outside({
      inside: [trigger_el],
      escape: true,
      callback: (_node, _config, { via }) => close_dropdown(via === `escape`),
    })}
  >
    <ul>
      {#each options as opt (opt.key)}
        {@const is_selected = opt.key === selected_key}
        <li role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={is_selected}
            class:selected={is_selected}
            onclick={() => select(opt.key)}
            {@attach (node) => {
              if (is_selected) node.focus()
            }}
          >
            {@html sanitize_html(format_option(opt))}
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .portal-select-trigger {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3em;
    background: transparent;
    border: none;
    border-radius: 3px;
    padding: 2px 4px;
    font: inherit;
    /* hug the text: `font: inherit` pulls in the page's loose line-height, inflating the hover bg */
    line-height: 1.2;
    color: inherit;
    cursor: pointer;
  }
  .portal-select-trigger:hover {
    background-color: var(--portal-select-hover-bg, rgba(128, 128, 128, 0.15));
  }
  .portal-select-trigger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .arrow {
    font-size: 1.4em;
    /* keep the larger glyph from inflating the trigger height (and thus the hover bg) */
    line-height: 1;
    opacity: 0.8;
  }
  .portal-select-dropdown {
    z-index: 10000;
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      background: var(--dropdown-bg, white);
      border: 1px solid var(--dropdown-border, #ccc);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      min-width: max-content;
      max-height: 300px;
      overflow-y: auto;
      font-size: 14px;
    }
    li {
      margin: 0;
    }
    button {
      display: block;
      width: 100%;
      padding: var(--dropdown-padding-v, 3px) var(--dropdown-padding-h, 10px);
      border: none;
      background: transparent;
      font: inherit;
      color: var(--dropdown-color, black);
      text-align: left;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover:not(.selected) {
      background: rgba(128, 128, 128, 0.15);
    }
    button.selected {
      font-weight: 500;
      background: rgba(0, 100, 200, 0.15);
    }
  }
  :is(.portal-select-trigger, .portal-select-dropdown) :global(:is(sub, sup)) {
    font-size: 0.75em;
    line-height: 0;
    margin: 0 0 0 -0.25em;
    padding: 0;
    position: relative;
  }
  :is(.portal-select-trigger, .portal-select-dropdown) :global(sub) {
    top: 0.25em;
  }
  :is(.portal-select-trigger, .portal-select-dropdown) :global(sup) {
    top: -0.4em;
  }
</style>

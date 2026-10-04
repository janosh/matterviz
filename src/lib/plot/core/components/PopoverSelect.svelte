<script lang="ts">
  // Compact single-select: an inline trigger showing the selected option (HTML labels like
  // E<sub>form</sub> allowed, sanitized) that opens a native popover list. Controlled: it
  // reports picks through `on_select` and shows whatever `selected_key` the caller commits.
  // Plots use it for interactive axis labels and colorbar property pickers.
  import { anchored_popover } from '#lib/overlays/anchored-popover.js'
  import type { AxisOption as Option } from '#lib/plot/core/types.js'
  import { sanitize_html } from '#lib/sanitize.js'
  import { is_modifier_chord } from 'svelte-widgets/utils'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    options,
    selected_key,
    on_select,
    disabled = false,
    placeholder = `Select…`,
    format_option = (opt: Option) => (opt.unit ? `${opt.label} (${opt.unit})` : opt.label),
    ...rest
  }: Omit<HTMLButtonAttributes, `onclick`> & {
    options: readonly Option[]
    // Controlled selection: the caller commits a new key, including after async loading.
    selected_key?: string
    on_select?: (key: string) => void
    disabled?: boolean
    placeholder?: string
    format_option?: (opt: Option) => string
  } = $props()

  let dropdown_open = $state(false)
  let trigger_el: HTMLButtonElement | undefined = $state()
  let dropdown_el: HTMLDivElement | undefined = $state()

  const selected_option = $derived(options.find((opt) => opt.key === selected_key))

  function select(key: string) {
    dropdown_open = false
    trigger_el?.focus()
    if (key !== selected_key) on_select?.(key)
  }

  // Handle both the trigger and the list before a host widget stops key propagation. The
  // popover closes on Escape and outside presses (anchored_popover).
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

  $effect(() => {
    if (disabled || !options.length) dropdown_open = false
  })
</script>

{#if options.length}
  <button
    bind:this={trigger_el}
    type="button"
    onclick={() => (dropdown_open = !dropdown_open)}
    {disabled}
    aria-expanded={dropdown_open}
    aria-haspopup="listbox"
    {...rest}
    onkeydown={(evt) => {
      rest.onkeydown?.(evt)
      if (dropdown_open && !evt.defaultPrevented) handle_keydown(evt)
    }}
    class={[`popover-select-trigger`, rest.class]}
  >
    {@html sanitize_html(selected_option ? format_option(selected_option) : placeholder)}
    <span class="arrow">▾</span>
  </button>
{/if}

{#if dropdown_open}
  <div
    bind:this={dropdown_el}
    class="popover-select-dropdown"
    role="listbox"
    tabindex="-1"
    onkeydown={handle_keydown}
    {@attach anchored_popover({
      anchor: trigger_el,
      align: `center`,
      on_close: () => (dropdown_open = false),
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
  .popover-select-trigger {
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
  .popover-select-trigger:hover {
    background-color: var(--popover-select-hover-bg, rgba(128, 128, 128, 0.15));
  }
  .popover-select-trigger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .arrow {
    font-size: 1.4em;
    /* keep the larger glyph from inflating the trigger height (and thus the hover bg) */
    line-height: 0;
    opacity: 0.8;
  }
  .popover-select-dropdown {
    /* the list carries the chrome */
    padding: 0;
    border: 0;
    background: none;
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
      border-radius: 0;
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
  :is(.popover-select-trigger, .popover-select-dropdown) :global(:is(sub, sup)) {
    font-size: 0.75em;
    line-height: 0;
    margin: 0 0 0 -0.25em;
    padding: 0;
    position: relative;
  }
  :is(.popover-select-trigger, .popover-select-dropdown) :global(sub) {
    top: 0.25em;
  }
  :is(.popover-select-trigger, .popover-select-dropdown) :global(sup) {
    top: -0.4em;
  }
</style>

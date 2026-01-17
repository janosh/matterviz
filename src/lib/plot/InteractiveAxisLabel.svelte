<script module lang="ts">
  // Track active dropdown across all instances - only one can be open at a time
  let active_close_fn: (() => void) | null = null
</script>

<script lang="ts">
  import Spinner from '$lib/feedback/Spinner.svelte'
  import type { AxisOption } from './types'

  let {
    label = ``,
    options = undefined,
    selected_key = $bindable(),
    loading = $bindable(false),
    axis_type = `x`,
    color = $bindable(),
    on_select,
    class: class_name = ``,
    ...rest
  }: {
    label?: string
    options?: AxisOption[]
    selected_key?: string
    loading?: boolean
    axis_type?: `x` | `y` | `y2`
    color?: string | null
    on_select?: (key: string) => void
    class?: string
    [key: string]: unknown
  } = $props()

  let is_interactive = $derived(Boolean(options?.length))
  let dropdown_open = $state(false)
  let trigger_el: HTMLButtonElement | undefined = $state()
  let portal_el: HTMLDivElement | undefined

  const format_opt = (opt: { label: string; unit?: string }) =>
    opt.unit ? `${opt.label} (${opt.unit})` : opt.label

  const selected_option = $derived(
    options?.find((opt) => opt.key === selected_key) ?? options?.[0],
  )

  function update_position() {
    if (!trigger_el || !portal_el) return
    const rect = trigger_el.getBoundingClientRect()
    portal_el.style.top = `${rect.bottom + 4}px`
    portal_el.style.left = `${rect.left + rect.width / 2}px`
  }

  function open_dropdown() {
    if (!trigger_el || !options?.length) return
    if (active_close_fn && active_close_fn !== close_dropdown) active_close_fn()

    portal_el = document.createElement(`div`)
    portal_el.className = `axis-dropdown-portal`
    portal_el.setAttribute(`role`, `listbox`)

    const ul = document.createElement(`ul`)
    let selected_btn: HTMLButtonElement | undefined
    for (const opt of options) {
      const li = document.createElement(`li`)
      li.setAttribute(`role`, `presentation`)
      const btn = document.createElement(`button`)
      btn.type = `button`
      btn.setAttribute(`role`, `option`)
      btn.innerHTML = format_opt(opt)
      btn.onclick = () => select(opt.key)
      if (opt.key === selected_key) {
        btn.classList.add(`selected`)
        btn.setAttribute(`aria-selected`, `true`)
        selected_btn = btn
      }
      li.appendChild(btn)
      ul.appendChild(li)
    }

    portal_el.appendChild(ul)
    document.body.appendChild(portal_el)
    update_position()
    dropdown_open = true
    active_close_fn = close_dropdown
    window.addEventListener(`scroll`, update_position, true)
    window.addEventListener(`resize`, update_position)
    window.addEventListener(`keydown`, handle_keydown)
    selected_btn?.focus()
  }

  function close_dropdown(return_focus = true) {
    if (portal_el) {
      window.removeEventListener(`scroll`, update_position, true)
      window.removeEventListener(`resize`, update_position)
      window.removeEventListener(`keydown`, handle_keydown)
      portal_el.remove()
      portal_el = undefined
    }
    if (active_close_fn === close_dropdown) active_close_fn = null
    dropdown_open = false
    if (return_focus) trigger_el?.focus()
  }

  function select(key: string) {
    if (key !== selected_key) {
      selected_key = key
      on_select?.(key)
    }
    close_dropdown()
  }

  function handle_click_outside(evt: MouseEvent) {
    if (!dropdown_open) return
    const target = evt.target as Node
    if (!trigger_el?.contains(target) && !portal_el?.contains(target)) {
      close_dropdown()
    }
  }

  function handle_keydown(evt: KeyboardEvent) {
    if (!portal_el) return
    const buttons = [...portal_el.querySelectorAll(`button`)] as HTMLButtonElement[]
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)

    if (evt.key === `Escape`) {
      evt.preventDefault()
      close_dropdown()
    } else if (evt.key === `ArrowDown`) {
      evt.preventDefault()
      buttons[(idx + 1) % buttons.length]?.focus()
    } else if (evt.key === `ArrowUp`) {
      evt.preventDefault()
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus()
    } else if (evt.key === `Enter` && idx >= 0) {
      evt.preventDefault()
      buttons[idx].click()
    }
  }

  const stop = (evt: Event) => evt.stopPropagation()

  // Close dropdown when component becomes non-interactive or unmounts
  $effect(() => {
    if (!is_interactive && dropdown_open) close_dropdown(false)
    return () => close_dropdown(false)
  })
</script>

<svelte:window onclick={handle_click_outside} />

<div
  class="interactive-axis-label {axis_type} {class_name}"
  class:interactive={is_interactive}
  class:loading
  style:color
  onmousedown={stop}
  onmouseup={stop}
  onclick={stop}
  {...rest}
>
  {#if is_interactive && options && selected_option}
    <button
      bind:this={trigger_el}
      type="button"
      class="axis-trigger"
      onclick={() => (dropdown_open ? close_dropdown() : open_dropdown())}
      disabled={loading}
      aria-expanded={dropdown_open}
      aria-haspopup="listbox"
    >
      {@html format_opt(selected_option)}
      <span class="arrow">▾</span>
    </button>
    {#if loading}
      <Spinner
        style="--spinner-size: 0.9em; --spinner-border-width: 2px; --spinner-margin: 0 0 0 0.3em"
      />
    {/if}
  {:else}
    <span class="static-label">{@html label}</span>
  {/if}
</div>

<style>
  .interactive-axis-label {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
  .static-label {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2em;
  }
  .loading .axis-trigger {
    opacity: 0.7;
    pointer-events: none;
  }
  .axis-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    background: transparent;
    border: none;
    border-radius: 3px;
    padding: 2px 4px;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .axis-trigger:hover {
    background-color: var(--surface-bg-hover, rgba(128, 128, 128, 0.15));
  }
  .arrow {
    font-size: 0.7em;
    opacity: 0.6;
  }
  .interactive-axis-label :global(sub),
  .interactive-axis-label :global(sup) {
    font-size: 0.75em;
    line-height: 0;
  }
  .interactive-axis-label :global(sub) {
    vertical-align: sub;
  }
  .interactive-axis-label :global(sup) {
    vertical-align: super;
  }
  /* Portal dropdown styles (appended to document.body) */
  :global(.axis-dropdown-portal) {
    position: fixed;
    transform: translateX(-50%);
    z-index: 10000;
  }
  :global(.axis-dropdown-portal ul) {
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
  :global(.axis-dropdown-portal li) {
    margin: 0;
  }
  :global(.axis-dropdown-portal button) {
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
  :global(.axis-dropdown-portal button:hover) {
    background: rgba(128, 128, 128, 0.15);
  }
  :global(.axis-dropdown-portal button.selected) {
    font-weight: 500;
    background: rgba(0, 100, 200, 0.15);
  }
</style>

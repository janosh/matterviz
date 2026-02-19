<script module lang="ts">
  // Track active dropdown across all instances - only one can be open at a time
  let active_close_fn: (() => void) | null = null
</script>

<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type Option = { key: string; label: string; unit?: string }

  let {
    options,
    selected_key = $bindable(),
    on_select,
    disabled = false,
    format_option = (
      opt: Option,
    ) => (opt.unit ? `${opt.label} (${opt.unit})` : opt.label),
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
  let portal_el: HTMLDivElement | undefined

  const selected_option = $derived(
    options?.find((opt) => opt.key === selected_key) ?? options?.[0],
  )

  function update_position() {
    if (!trigger_el || !portal_el) return
    const rect = trigger_el.getBoundingClientRect()
    const dropdown_rect = portal_el.getBoundingClientRect()
    const gap = 4
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Vertical: prefer below, flip above if no room
    const below_y = rect.bottom + gap
    const above_y = rect.top - gap - dropdown_rect.height
    const fits_below = below_y + dropdown_rect.height <= vh
    portal_el.style.top = `${fits_below ? below_y : Math.max(gap, above_y)}px`

    // Horizontal: center, but clamp to viewport edges
    const center_x = rect.left + rect.width / 2
    const half_width = dropdown_rect.width / 2
    const min_x = half_width + gap
    const max_x = vw - half_width - gap
    portal_el.style.left = `${Math.max(min_x, Math.min(max_x, center_x))}px`
  }

  // Inline styles for portal elements (can't use scoped CSS for elements in document.body)
  const portal_styles = {
    container: `position: fixed; transform: translateX(-50%); z-index: 10000;`,
    ul:
      `margin: 0; padding: 0; list-style: none; background: var(--dropdown-bg, white); border: 1px solid var(--dropdown-border, #ccc); border-radius: 4px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); min-width: max-content; max-height: 300px; overflow-y: auto; font-size: 14px;`,
    li: `margin: 0;`,
    btn:
      `display: block; width: 100%; padding: var(--dropdown-padding-v, 3px) var(--dropdown-padding-h, 10px); border: none; background: transparent; font: inherit; color: var(--dropdown-color, black); text-align: left; cursor: pointer; white-space: nowrap;`,
    btn_selected: `font-weight: 500; background: rgba(0, 100, 200, 0.15);`,
  }

  function style_sub_sup(el: HTMLElement) {
    for (const sub of el.querySelectorAll(`sub`)) {
      ;(sub as HTMLElement).style.cssText =
        `font-size: 0.75em; line-height: 0; margin: 0; padding: 0; position: relative; top: 0.15em;`
    }
    for (const sup of el.querySelectorAll(`sup`)) {
      ;(sup as HTMLElement).style.cssText =
        `font-size: 0.75em; line-height: 0; margin: 0; padding: 0; position: relative; top: -0.4em;`
    }
  }

  function open_dropdown() {
    if (!trigger_el || !options?.length) return
    if (active_close_fn && active_close_fn !== close_dropdown) active_close_fn()

    portal_el = document.createElement(`div`)
    portal_el.className = `portal-select-dropdown`
    portal_el.style.cssText = portal_styles.container
    portal_el.setAttribute(`role`, `listbox`)

    const ul = document.createElement(`ul`)
    ul.style.cssText = portal_styles.ul
    let selected_btn: HTMLButtonElement | undefined
    for (const opt of options) {
      const li = document.createElement(`li`)
      li.style.cssText = portal_styles.li
      li.setAttribute(`role`, `presentation`)
      const btn = document.createElement(`button`)
      btn.type = `button`
      btn.style.cssText = portal_styles.btn
      btn.setAttribute(`role`, `option`)
      btn.innerHTML = format_option(opt)
      style_sub_sup(btn)
      btn.onclick = () => select(opt.key)
      btn.onmouseenter = () => {
        if (!btn.classList.contains(`selected`)) {
          btn.style.background = `rgba(128, 128, 128, 0.15)`
        }
      }
      btn.onmouseleave = () => {
        if (!btn.classList.contains(`selected`)) btn.style.background = `transparent`
      }
      if (opt.key === selected_key) {
        btn.classList.add(`selected`)
        btn.style.cssText = portal_styles.btn + portal_styles.btn_selected
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

  function handle_click_outside(evt: MouseEvent) {
    if (!dropdown_open) return
    const target = evt.target
    if (
      !(target instanceof Node) ||
      (!trigger_el?.contains(target) && !portal_el?.contains(target))
    ) {
      close_dropdown()
    }
  }

  function handle_keydown(evt: KeyboardEvent) {
    if (!portal_el) return
    const buttons = [...portal_el.querySelectorAll(`button`)] as HTMLButtonElement[]
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const len = buttons.length

    if (evt.key === `Escape`) {
      evt.preventDefault()
      close_dropdown()
    } else if (evt.key === `ArrowDown`) {
      evt.preventDefault()
      buttons[(idx + 1) % len]?.focus()
    } else if (evt.key === `ArrowUp`) {
      evt.preventDefault()
      buttons[idx < 0 ? len - 1 : (idx - 1 + len) % len]?.focus()
    } else if (evt.key === `Enter` && idx >= 0) {
      evt.preventDefault()
      buttons[idx].click()
    }
  }

  // Close dropdown when disabled, options empty, or component unmounts
  $effect(() => {
    if ((disabled || !options?.length) && dropdown_open) close_dropdown(false)
    return () => close_dropdown(false)
  })
</script>

<svelte:window onclick={handle_click_outside} />

{#if selected_option}
  <button
    bind:this={trigger_el}
    type="button"
    onclick={() => (dropdown_open ? close_dropdown() : open_dropdown())}
    {disabled}
    aria-expanded={dropdown_open}
    aria-haspopup="listbox"
    {...rest}
    class="portal-select-trigger {rest.class ?? ``}"
  >
    {@html format_option(selected_option)}
    <span class="arrow">▾</span>
  </button>
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
    opacity: 0.8;
  }
  .portal-select-trigger :global(:is(sub, sup)) {
    font-size: 0.75em;
    line-height: 0;
    margin: 0 0 0 -0.25em;
    padding: 0;
    position: relative;
  }
  .portal-select-trigger :global(sub) {
    top: 0.25em;
  }
  .portal-select-trigger :global(sup) {
    top: -0.4em;
  }
</style>

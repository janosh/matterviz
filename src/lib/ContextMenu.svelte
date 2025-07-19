<script lang="ts">
  import { Icon, type IconName } from '$lib'

  interface MenuOption {
    value: string
    icon?: string
    label?: string
    disabled?: boolean
  }

  interface Props {
    sections: Readonly<{ title: string; options: readonly MenuOption[] }[]>
    selected_values?: Record<string, string>
    on_select?: (section_title: string, option: MenuOption) => void
    position: { x: number; y: number }
    visible: boolean
    on_close?: () => void
    menu_element?: HTMLElement
    [key: string]: unknown
  }
  let {
    sections,
    selected_values = {},
    on_select,
    position,
    visible,
    on_close,
    menu_element = $bindable(),
    ...rest
  }: Props = $props()

  // Calculate smart position that keeps menu in viewport
  function get_smart_position() {
    if (!menu_element) return position
    const rect = menu_element.getBoundingClientRect()
    let { x, y } = position
    if (x + rect.width > window.innerWidth) x = position.x - rect.width
    if (y + rect.height > window.innerHeight) y = position.y - rect.height
    return { x: Math.max(0, x), y: Math.max(0, y) }
  }

  // Handle click outside to close
  function handle_click_outside(event: MouseEvent) {
    const target = event.target as Element
    if (visible) {
      const menu = target.closest(`.context-menu`)
      if (!menu) on_close?.()
    }
  }

  // Handle right-click outside to close
  function handle_right_click_outside(event: MouseEvent) {
    if (!visible) return
    const menu = (event.target as Element).closest(`.context-menu`)
    if (!menu) {
      event.preventDefault()
      on_close?.()
    }
  }

  // Handle keyboard shortcuts
  function handle_keydown(event: KeyboardEvent) {
    if (event.key === `Escape` && visible) on_close?.()
  }

  // Handle option selection
  function handle_option_click(section_title: string, option: MenuOption) {
    if (!option.disabled) on_select?.(section_title, option)
  }
</script>

<svelte:document
  onclick={handle_click_outside}
  oncontextmenu={handle_right_click_outside}
  onkeydown={handle_keydown}
/>

{#if visible}
  {@const { x, y } = get_smart_position()}
  {@const style = `position: absolute; left: ${x}px; top: ${y}px; ${rest.style ?? ``}`}
  <div class="context-menu" {...rest} {style} bind:this={menu_element}>
    {#each sections as { title, options } (title)}
      <div class="section">
        <div class="header">{title}</div>
        {#each options as option (option.value)}
          <button
            class:selected={selected_values[title] === option.value}
            class:disabled={option.disabled}
            onclick={() => handle_option_click(title, option)}
          >
            {#if option.icon}
              <Icon icon={option.icon as IconName} />
            {/if}
            <span>{option.label ?? option.value}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    background: var(--surface-bg);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius, 4px);
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.3), 0 4px 8px -2px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(4px);
    min-width: var(--context-menu-min-width, 160px);
    overflow: hidden;
  }
  .section {
    border-bottom: 1px solid var(--border-color);
  }
  .section:last-child {
    border-bottom: none;
  }
  .header {
    padding: 2px 4px;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-color-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: var(--surface-bg-hover);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    background: transparent;
    border: none;
    text-align: left;
    font-size: 0.75rem;
    color: var(--text-color);
    cursor: pointer;
    transition: background-color 0.2s ease;
    white-space: nowrap;
    overflow: hidden;
    border-radius: 0;
  }
  button:hover:not(.disabled) {
    background: var(--surface-bg-hover);
  }
  button.selected {
    background: var(--accent-color);
  }
  button.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

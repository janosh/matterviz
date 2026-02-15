<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { InfoTagSize, InfoTagVariant } from './index'

  let {
    label,
    value,
    copy_value,
    title,
    variant = `default`,
    size = `md`,
    removable = false,
    disabled = false,
    onclick,
    onremove,
    children,
    ...rest
  }: {
    label: string // Label text (supports HTML)
    value: string | number | undefined // Value to display (supports HTML)
    copy_value?: string | number // Value to copy to clipboard (defaults to value)
    title?: string // Tooltip text
    variant?: InfoTagVariant // Visual variant for semantic meaning
    size?: InfoTagSize // Size variant
    removable?: boolean // Show remove/close button
    disabled?: boolean // Disable interactions
    onclick?: (event: MouseEvent) => void // Custom click handler (overrides copy-to-clipboard default)
    onremove?: () => void // Callback when remove button is clicked
    children?: Snippet<[]> // Additional content to render inside the tag
  } & Omit<HTMLAttributes<HTMLSpanElement>, `onclick` | `onkeydown`> = $props()

  let just_copied = $state(false)

  async function copy_to_clipboard(): Promise<void> {
    const to_copy = copy_value ?? value
    if (to_copy === undefined) return
    await navigator.clipboard.writeText(String(to_copy))
    just_copied = true
    setTimeout(() => (just_copied = false), 1000)
  }

  function handle_click(event: MouseEvent): void {
    if (disabled) return
    if (onclick) onclick(event)
    else void copy_to_clipboard()
  }

  function handle_keydown(event: KeyboardEvent): void {
    if (disabled || (event.key !== `Enter` && event.key !== ` `)) return
    event.preventDefault()
    ;(event.currentTarget as HTMLElement)?.click()
  }

  function handle_remove(event: MouseEvent): void {
    event.stopPropagation()
    onremove?.()
  }
</script>

<span
  role="button"
  tabindex={disabled ? -1 : 0}
  onclick={handle_click}
  onkeydown={handle_keydown}
  {title}
  {@attach tooltip()}
  class="info-tag {variant} {size}"
  class:disabled
  aria-disabled={disabled}
  {...rest}
>
  {@html label}
  <em>{@html value}</em>
  {#if just_copied}
    <Icon
      icon="Check"
      style="color: var(--success-color, #10b981); width: 12px; height: 12px"
      class="copy-checkmark"
    />
  {/if}
  {#if removable && !disabled}
    <button type="button" onclick={handle_remove} aria-label="Remove">
      <Icon icon="Close" style="width: 10px; height: 10px" />
    </button>
  {/if}
  {@render children?.()}
</span>

<style>
  .info-tag {
    cursor: pointer;
    position: relative;
    transition: all 0.12s;
    border: 1px solid;
    white-space: nowrap;
    border-color: color-mix(in srgb, var(--tag-color) 25%, transparent);
    em {
      font-style: normal;
      font-weight: 600;
      color: var(--tag-color);
    }
    &:hover:not(.disabled) {
      background: color-mix(in srgb, var(--tag-color) 18%, transparent);
      border-color: color-mix(in srgb, var(--tag-color) 40%, transparent);
    }
    &.sm {
      font-size: 0.72em;
      padding: 0 5pt;
      border-radius: 4px;
    }
    &.md {
      font-size: 0.8em;
      padding: 1pt 6pt;
      border-radius: 5px;
    }
    &.lg {
      font-size: 0.9em;
      padding: 3pt 8pt;
      border-radius: 6px;
    }
    &.default {
      --tag-color: var(--highlight, #4db6ff);
    }
    &.success {
      --tag-color: var(--success-color, #10b981);
    }
    &.warning {
      --tag-color: var(--warning-color, #f59e0b);
    }
    &.error {
      --tag-color: var(--error-color, #ef4444);
    }
    &.info {
      --tag-color: var(--info-color, #3b82f6);
    }
    &.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    &:active:not(.disabled) {
      transform: scale(0.97);
    }
    :global(.copy-checkmark) {
      position: absolute;
      top: 50%;
      right: 3pt;
      transform: translateY(-50%);
      background: rgba(16, 185, 129, 0.9);
      border-radius: 50%;
      padding: 2pt;
      display: flex;
      animation: pop-in 0.15s ease-out;
    }
  }
  [aria-label='Remove'] {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(128, 128, 128, 0.1);
    border: none;
    cursor: pointer;
    padding: 2pt;
    margin-left: 2pt;
    border-radius: 50%;
    color: inherit;
    opacity: 0.5;
    &:hover {
      opacity: 1;
      background: rgba(239, 68, 68, 0.2);
      color: var(--error-color, #ef4444);
    }
  }
  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(-50%) scale(0.5);
    }
  }
</style>

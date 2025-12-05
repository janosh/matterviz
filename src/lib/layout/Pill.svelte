<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  export type PillVariant = `default` | `success` | `warning` | `error` | `info`
  export type PillSize = `sm` | `md` | `lg`

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
    value: string | number | undefined // Value to display (highlighted)
    copy_value?: string | number // Value to copy to clipboard (defaults to value)
    title?: string // Tooltip text
    variant?: PillVariant // Visual variant for semantic meaning
    size?: PillSize // Size variant
    removable?: boolean // Show remove/close button
    disabled?: boolean // Disable interactions
    onclick?: (event: MouseEvent) => void // Custom click handler (overrides copy-to-clipboard default)
    onremove?: () => void // Callback when remove button is clicked
    children?: Snippet<[]> // Additional content to render inside the pill
  } & Omit<HTMLAttributes<HTMLSpanElement>, `onclick` | `onkeydown`> = $props()

  let just_copied = $state(false)

  async function copy_to_clipboard(): Promise<void> {
    await navigator.clipboard.writeText(String(copy_value ?? value))
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

  function handle_remove(event: MouseEvent | KeyboardEvent): void {
    if (`key` in event && event.key !== `Enter` && event.key !== ` `) return
    event.preventDefault()
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
  class="pill {variant} {size}"
  class:disabled
  aria-disabled={disabled}
  {...rest}
>
  {@html label}
  <em>{value}</em>
  {#if just_copied}
    <Icon
      icon="Check"
      style="color: var(--success-color, #10b981); width: 12px; height: 12px"
      class="copy-checkmark"
    />
  {/if}
  {#if removable && !disabled}
    <button
      type="button"
      class="remove-btn"
      onclick={handle_remove}
      onkeydown={handle_remove}
      aria-label="Remove"
      tabindex={0}
    >
      <Icon icon="Close" style="width: 10px; height: 10px" />
    </button>
  {/if}
  {@render children?.()}
</span>

<style>
  .pill {
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.2s, background-color 0.15s;
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 2pt;
  }
  .pill em {
    font-style: normal;
    margin: 0 0 0 1pt;
  }
  /* Size variants */
  .pill.sm {
    font-size: var(--pill-font-size-sm, 0.7rem);
    padding: var(--pill-padding-sm, 0 3pt);
    border-radius: var(--pill-border-radius-sm, 6px);
  }
  .pill.md {
    font-size: var(--pill-font-size, 0.8rem);
    padding: var(--pill-padding, 1pt 4pt);
    border-radius: var(--pill-border-radius, 8px);
  }
  .pill.lg {
    font-size: var(--pill-font-size-lg, 0.95rem);
    padding: var(--pill-padding-lg, 2pt 6pt);
    border-radius: var(--pill-border-radius-lg, 10px);
  }
  /* Default variant */
  .pill.default {
    background-color: var(--pill-bg, rgba(128, 128, 128, 0.05));
    border: 1px solid var(--pill-border, rgba(128, 128, 128, 0.12));
  }
  .pill.default em {
    color: var(--highlight, #4db6ff);
  }
  .pill.default:hover:not(.disabled) {
    background-color: var(--pill-hover-bg, rgba(77, 182, 255, 0.1));
    border-color: var(--pill-hover-border, rgba(77, 182, 255, 0.25));
    transform: translateY(-1px);
  }
  /* Success variant */
  .pill.success {
    background-color: var(--pill-success-bg, rgba(16, 185, 129, 0.1));
    border: 1px solid var(--pill-success-border, rgba(16, 185, 129, 0.25));
  }
  .pill.success em {
    color: var(--success-color, #10b981);
  }
  .pill.success:hover:not(.disabled) {
    background-color: var(--pill-success-hover-bg, rgba(16, 185, 129, 0.2));
    border-color: var(--pill-success-hover-border, rgba(16, 185, 129, 0.4));
    transform: translateY(-1px);
  }
  /* Warning variant */
  .pill.warning {
    background-color: var(--pill-warning-bg, rgba(245, 158, 11, 0.1));
    border: 1px solid var(--pill-warning-border, rgba(245, 158, 11, 0.25));
  }
  .pill.warning em {
    color: var(--warning-color, #f59e0b);
  }
  .pill.warning:hover:not(.disabled) {
    background-color: var(--pill-warning-hover-bg, rgba(245, 158, 11, 0.2));
    border-color: var(--pill-warning-hover-border, rgba(245, 158, 11, 0.4));
    transform: translateY(-1px);
  }
  /* Error variant */
  .pill.error {
    background-color: var(--pill-error-bg, rgba(239, 68, 68, 0.1));
    border: 1px solid var(--pill-error-border, rgba(239, 68, 68, 0.25));
  }
  .pill.error em {
    color: var(--error-color, #ef4444);
  }
  .pill.error:hover:not(.disabled) {
    background-color: var(--pill-error-hover-bg, rgba(239, 68, 68, 0.2));
    border-color: var(--pill-error-hover-border, rgba(239, 68, 68, 0.4));
    transform: translateY(-1px);
  }
  /* Info variant */
  .pill.info {
    background-color: var(--pill-info-bg, rgba(59, 130, 246, 0.1));
    border: 1px solid var(--pill-info-border, rgba(59, 130, 246, 0.25));
  }
  .pill.info em {
    color: var(--info-color, #3b82f6);
  }
  .pill.info:hover:not(.disabled) {
    background-color: var(--pill-info-hover-bg, rgba(59, 130, 246, 0.2));
    border-color: var(--pill-info-hover-border, rgba(59, 130, 246, 0.4));
    transform: translateY(-1px);
  }
  /* Disabled state */
  .pill.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .pill:active:not(.disabled) {
    transform: translateY(0) scale(0.98);
  }
  .pill:focus-visible {
    outline: 2px solid var(--highlight, #4db6ff);
    outline-offset: 2px;
  }
  .pill :global(.copy-checkmark) {
    position: absolute;
    top: 50%;
    right: 3pt;
    transform: translateY(-50%);
    background: var(--surface-bg, var(--nav-bg, rgba(0, 0, 0, 0.3)));
    border-radius: 50%;
    padding: 3pt;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fade-in 0.1s ease-out;
  }
  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 1pt;
    margin-left: 2pt;
    border-radius: 50%;
    color: inherit;
    opacity: 0.6;
    transition: opacity 0.15s, background-color 0.15s;
  }
  .remove-btn:hover {
    opacity: 1;
    background-color: rgba(128, 128, 128, 0.3);
  }
  .remove-btn:focus-visible {
    outline: 2px solid var(--highlight, #4db6ff);
    outline-offset: 1px;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>

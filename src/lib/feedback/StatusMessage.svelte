<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  let { message = $bindable(), type = `info`, dismissible = false, ...rest }: {
    message?: string
    type?: `info` | `error` | `warning`
    dismissible?: boolean
  } & HTMLAttributes<HTMLDivElement> = $props()
</script>

{#if message}
  <div
    class="status-message {type}"
    role={type === `error` ? `alert` : `status`}
    aria-live={type === `error` ? `assertive` : `polite`}
    {...rest}
  >
    {message}
    {#if dismissible}
      <button onclick={() => (message = undefined)} aria-label="Dismiss message">
        ✕
      </button>
    {/if}
  </div>
{/if}

<style>
  .status-message {
    border-radius: var(--border-radius, 3pt);
    &.info {
      border: 2px dashed var(--text-color-muted, #ccc);
      background: transparent;
      color: var(--text-color-muted, #666);
      padding: 2em;
    }
    &.error {
      border: var(--error-border, 1px solid #ef4444);
      background: color-mix(in srgb, var(--error-color, #ef4444) 10%, transparent);
      color: var(--error-color, #ef4444);
      padding: 0.5em 1em;
    }
    &.warning {
      --status-message-border: 1px solid #fb8c00;
      background: #fff3e0;
      color: #e65100;
      padding: 0.5em;
    }
  }
  button {
    margin-left: 1em;
    padding: 0.2em 0.5em;
    background: var(--btn-bg, #ddd);
    border: 1px solid var(--border-color, #bbb);
    border-radius: var(--border-radius, 3pt);
    cursor: pointer;
    &:hover {
      background: var(--btn-bg-hover, #ccc);
    }
  }
</style>

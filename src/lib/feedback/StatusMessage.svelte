<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  let { message = $bindable(), type = `info`, dismissible = false, ...rest }: {
    message?: string
    type?: `info` | `error` | `warning`
    dismissible?: boolean
  } & HTMLAttributes<HTMLDivElement> = $props()
</script>

{#if message}
  <div class="status-message {type}" role="status" {...rest}>
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
    border: var(--status-message-border);
    &.info {
      --status-message-border: 2px dashed #ccc;
      background: transparent;
      color: #666;
      padding: 2em;
    }
    &.error {
      --status-message-border: 1px solid #e55;
      background: #fee;
      color: #c22;
      padding: 0.5em 1em;
    }
    &.warning {
      --status-message-border: 1px solid #f80;
      background: #fed;
      color: #e60;
      padding: 0.5em;
    }
  }
  button {
    margin-left: 1em;
    padding: 0.2em 0.5em;
    background: #ddd;
    border: 1px solid #bbb;
    border-radius: var(--border-radius, 3pt);
    cursor: pointer;
    &:hover {
      background: #ccc;
    }
  }
</style>

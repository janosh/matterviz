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
      <button onclick={() => (message = undefined)}>✕</button>
    {/if}
  </div>
{/if}

<style>
  .status-message {
    border-radius: var(--border-radius, 3pt);
    &.info {
      background: transparent;
      color: #666;
      border: 2px dashed #ccc;
      padding: 2em;
    }
    &.error {
      background: #fee;
      color: #c22;
      border: 1px solid #e55;
      padding: 0.5em 1em;
    }
    &.warning {
      background: #fed;
      color: #e60;
      border: 1px solid #f80;
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

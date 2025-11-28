<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    message = $bindable(),
    type = `info`,
    dismissible = false,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    message?: string
    type?: `info` | `error` | `warning`
    dismissible?: boolean
  } = $props()

  const styles = {
    info: {
      background: `transparent`,
      color: `#666`,
      border: `2px dashed #ccc`,
      padding: `2em`,
      textAlign: `center` as const,
    },
    error: {
      background: `#ffebee`,
      color: `#c62828`,
      border: `1px solid #ef5350`,
      padding: `0.5em`,
      textAlign: `left` as const,
    },
    warning: {
      background: `#fff3e0`,
      color: `#e65100`,
      border: `1px solid #fb8c00`,
      padding: `0.5em`,
      textAlign: `left` as const,
    },
  }
</script>

{#if message}
  <div
    class="message"
    role={type === `error` ? `alert` : `status`}
    aria-live={type === `error` ? `assertive` : `polite`}
    style:background={styles[type].background}
    style:color={styles[type].color}
    style:border={styles[type].border}
    style:padding={styles[type].padding}
    style:text-align={styles[type].textAlign}
    {...rest}
  >
    {message}
    {#if dismissible}
      <button
        type="button"
        aria-label="Dismiss message"
        onclick={() => (message = undefined)}
      >
        Dismiss
      </button>
    {/if}
  </div>
{/if}

<style>
  .message {
    margin-bottom: 0.5em;
    border-radius: var(--status-message-border-radius, var(--border-radius));
  }
  button {
    margin-left: 1em;
    padding: 0.25em 0.75em;
    background: #e0e0e0;
    border: 1px solid #ccc;
    border-radius: var(--status-message-button-border-radius, var(--border-radius));
    cursor: pointer;
  }
  button:hover {
    background: #d0d0d0;
  }
</style>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let { message, children, ...rest }: {
    // Simple text message to display. Ignored if children snippet is provided.
    message?: string
    // Custom content to render. Takes precedence over message prop.
    children?: Snippet
  } & HTMLAttributes<HTMLDivElement> = $props()
</script>

<div {...rest} class="empty-state {rest.class ?? ``}">
  {#if children}
    {@render children()}
  {:else if message}
    <span class="message">{message}</span>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: inherit;
    text-align: center;
    box-sizing: border-box;
  }
  .empty-state :global(.status-message) {
    --status-message-border: none; /* Remove inner border from StatusMessage */
  }
  .empty-state > :global(:is(p, h3, ul, strong)), .empty-state > .message {
    max-width: var(--empty-state-max-width, 500px);
  }
  .empty-state :global(p), .empty-state > .message {
    color: var(--text-color-muted);
    margin: 0;
  }
  .empty-state :global(h3) {
    margin: 0 0 0.5em;
  }
</style>

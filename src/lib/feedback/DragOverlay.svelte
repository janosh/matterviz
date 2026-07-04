<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    visible = false,
    message = `Drop file to load`,
    ...rest
  }: {
    visible?: boolean
    message?: string
  } & HTMLAttributes<HTMLDivElement> = $props()
</script>

{#if visible}
  <div {...rest} class={[`drag-overlay`, rest.class]}>
    <div class="drag-message">
      <Icon icon="Info" />
      <span>{message}</span>
    </div>
  </div>
{/if}

<style>
  .drag-overlay {
    position: absolute;
    inset: 0;
    background: rgba(25, 118, 210, 0.1);
    border: 2px dashed var(--accent-color, #1976d2);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .drag-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--accent-color, #1976d2);
    font-weight: 600;
    font-size: 1.1em;
  }
</style>

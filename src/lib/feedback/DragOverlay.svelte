<script lang="ts">
  import { Icon } from '$lib'

  let {
    visible = false,
    message = `Drop JSON file to load phase diagram data`,
  }: {
    visible?: boolean
    message?: string
  } = $props()
</script>

{#if visible}
  <div class="drag-overlay">
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

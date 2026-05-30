<script lang="ts">
  import Icon from '$lib/Icon.svelte'

  let {
    show_controls = false,
    on_reset,
    on_close,
  }: {
    show_controls?: boolean
    on_reset?: () => void
    on_close?: () => void
  } = $props()

  function handle_control_click(event: MouseEvent, callback: () => void): void {
    event.stopPropagation()
    callback()
  }
</script>

<div class="control-tab">
  <Icon
    icon="DragIndicator"
    class="drag-handle"
    style="width: 1em; height: 1em"
  />
  {#if show_controls}
    {#if on_reset}
      <button
        type="button"
        class="reset-button"
        onclick={(event) => handle_control_click(event, on_reset)}
        title="Reset pane position"
        aria-label="Reset pane position"
      >
        <Icon icon="Reset" style="width: 1em; height: 1em" />
      </button>
    {/if}
    {#if on_close}
      <button
        type="button"
        class="close-button"
        onclick={(event) => handle_control_click(event, on_close)}
        title="Close pane"
        aria-label="Close pane"
      >
        <Icon icon="Cross" style="width: 1em; height: 1em" />
      </button>
    {/if}
  {/if}
</div>

<style>
  .control-tab {
    position: absolute;
    top: 6px;
    right: -1px;
    transform: translateX(100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 3px 2px;
    background: var(--pane-bg, var(--page-bg, light-dark(white, black)));
    border: var(
      --pane-border,
      1px solid light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.15))
    );
    border-left: none;
    border-radius: 0 5px 5px 0;
    z-index: var(--pane-control-tab-z-index, var(--pane-control-buttons-z-index, 1));
  }
  .control-tab :global(.drag-handle) {
    width: 1.1em;
    height: 1.1em;
    cursor: grab;
    border-radius: 3px;
    padding: 1px;
    box-sizing: border-box;
    opacity: 0.5;
    pointer-events: auto;
  }
  .control-tab :global(.drag-handle:hover) {
    opacity: 0.8;
    background-color: color-mix(in srgb, currentColor 15%, transparent);
  }
  .control-tab :global(.drag-handle:active) {
    cursor: grabbing;
  }
  :where(.reset-button, .close-button) {
    background: none;
    border: none;
    padding: 1px;
    border-radius: 3px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.1em;
    height: 1.1em;
    opacity: 0.5;
  }
  :where(.reset-button:hover, .close-button:hover) {
    opacity: 0.8;
    background-color: color-mix(in srgb, currentColor 15%, transparent);
  }
</style>

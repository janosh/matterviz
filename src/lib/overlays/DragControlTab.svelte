<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { IconName } from '$lib/icons'

  let {
    show_controls = false,
    on_reset,
    on_close,
  }: {
    show_controls?: boolean
    on_reset?: () => void
    on_close?: () => void
  } = $props()
</script>

{#snippet control_button(
  callback: () => void,
  css_class: string,
  icon: IconName,
  label: string,
)}
  <button
    type="button"
    class={css_class}
    onclick={(event) => {
      event.stopPropagation()
      callback()
    }}
    title={label}
    aria-label={label}
  >
    <Icon {icon} style="width: 1em; height: 1em" />
  </button>
{/snippet}

<div class="control-tab">
  <Icon icon="DragIndicator" class="drag-handle" style="width: 1em; height: 1em" />
  {#if show_controls}
    {#if on_reset}
      {@render control_button(on_reset, `reset-button`, `Reset`, `Reset pane position`)}
    {/if}
    {#if on_close}
      {@render control_button(on_close, `close-button`, `Cross`, `Close pane`)}
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
    cursor: pointer;
  }
  :where(.reset-button:hover, .close-button:hover) {
    opacity: 0.8;
    background-color: color-mix(in srgb, currentColor 15%, transparent);
  }
</style>

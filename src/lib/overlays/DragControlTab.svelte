<script lang="ts">
  // Protruding grab handle for panes that are dragged via a `.drag-handle` selector.
  import { Icon } from 'svelte-widgets'
  import { DragIndicator } from 'svelte-widgets/icons'
</script>

<div class="control-tab">
  <Icon icon={DragIndicator} class="drag-handle" style="width: 1em; height: 1em" />
</div>

<style>
  .control-tab {
    position: absolute;
    top: 6px;
    right: -1px;
    transform: translateX(100%);
    display: flex;
    padding: 3px 2px;
    background: var(--pane-bg, var(--page-bg, light-dark(white, black)));
    border: var(
      --pane-border,
      1px solid light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.15))
    );
    border-left: none;
    border-radius: 0 5px 5px 0;
    z-index: var(--pane-control-tab-z-index, var(--pane-control-buttons-z-index, 1));
    :global(.drag-handle) {
      width: 1.1em;
      height: 1.1em;
      cursor: grab;
      border-radius: 3px;
      padding: 1px;
      box-sizing: border-box;
      opacity: 0.5;
      pointer-events: auto;
      &:hover {
        opacity: 0.8;
        background-color: color-mix(in srgb, currentColor 15%, transparent);
      }
      &:active {
        cursor: grabbing;
      }
    }
  }
</style>

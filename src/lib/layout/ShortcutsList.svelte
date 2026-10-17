<script lang="ts">
  import { host } from '#lib/host.js'
  import {
    format_shortcut_keys,
    SHORTCUTS,
    type ShortcutScope,
    shortcuts_for,
  } from '#lib/shortcuts.js'

  // Collapsed list of a viewer's keyboard shortcuts, generated from the SHORTCUTS registry and
  // rendered at the bottom of the viewer's info pane (or its settings pane if it has none)
  let { scopes }: { scopes: readonly ShortcutScope[] } = $props()

  const shortcuts = $derived(
    shortcuts_for(scopes).filter(
      (shortcut) => host.fullscreen || shortcut !== SHORTCUTS.fullscreen,
    ),
  )
</script>

<details class="shortcuts-list">
  <summary>Keyboard shortcuts</summary>
  <dl>
    {#each shortcuts as shortcut (shortcut)}
      <dt><kbd>{format_shortcut_keys(shortcut)}</kbd></dt>
      <dd>{shortcut.description}</dd>
    {/each}
  </dl>
</details>

<style>
  .shortcuts-list {
    font-size: 0.85em;
    margin-top: 6pt;
    summary {
      cursor: pointer;
      opacity: 0.8;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3pt 1em;
      margin: 4pt 0 0;
    }
    dt {
      text-align: right;
      white-space: nowrap;
    }
    dd {
      margin: 0;
    }
    kbd {
      font-family: monospace;
      padding: 0 3pt;
      border: 1px solid currentColor;
      border-radius: 3pt;
      opacity: 0.85;
    }
  }
</style>

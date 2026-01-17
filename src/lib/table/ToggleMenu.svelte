<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { Label } from '$lib/table'
  import { click_outside, tooltip } from 'svelte-multiselect/attachments'

  let { columns = $bindable([]), column_panel_open = $bindable(false) }: {
    columns: Label[]
    column_panel_open?: boolean
  } = $props()

  function toggle_column_visibility(idx: number, event: Event) {
    columns[idx].visible = (event.target as HTMLInputElement).checked
    columns = [...columns] // needed to trigger reactivity
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === `Escape` && column_panel_open) {
      column_panel_open = false
      event.preventDefault()
    }
  }}
/>

<details
  class="column-toggles"
  bind:open={column_panel_open}
  {@attach click_outside({ callback: () => (column_panel_open = false) })}
>
  <summary aria-expanded={column_panel_open}>
    Columns <Icon icon="Columns" />
  </summary>
  <div class="column-menu" role="menu">
    {#each columns as col, idx (col.key ?? col.label ?? idx)}
      <label
        class="toggle-label"
        title={col.description}
        {@attach tooltip()}
      >
        <input
          type="checkbox"
          checked={col.visible !== false}
          onchange={(event) => toggle_column_visibility(idx, event)}
        />
        {@html col.label}
      </label>
    {/each}
  </div>
</details>

<style>
  .column-toggles {
    position: relative;
  }
  .column-toggles summary {
    background: var(--btn-bg);
    padding: 0 6pt;
    margin: 4pt 0;
    border-radius: 4pt;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .column-toggles summary:hover {
    background: var(--nav-bg);
  }
  .column-toggles summary::-webkit-details-marker {
    display: none;
  }
  .column-menu {
    font-size: 1.1em;
    position: absolute;
    right: 0;
    top: calc(100% + 4pt);
    background: var(--page-bg);
    border: 1px solid var(--border);
    border-radius: 4pt;
    padding: 3pt 5pt;
    min-width: 150px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(135px, 1fr));
    z-index: 1; /* needed to ensure column toggle menu is above HeatmapTable header row */
  }
  .column-menu .toggle-label {
    display: inline-block;
    margin: 1px 2px;
    border-radius: 3px;
    line-height: 1.3em;
    height: 1.3em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .column-menu .toggle-label:hover {
    background: var(--nav-bg);
  }
  details :global(:is(sub, sup)) {
    transform: translate(-3pt, 6pt);
    font-size: 0.7em;
  }
</style>

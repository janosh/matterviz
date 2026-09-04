<script lang="ts">
  // Summary table plus provenance note under an analysis plot (MSD, VACF, RDF): one place
  // for the column headers, the compact styling, the faint note line each plot used to copy
  // and downloads of the curves and their analysis metadata
  import { download } from '$lib/io/fetch'
  import { columns_to_csv } from '$lib/trajectory/analysis'
  import type { Snippet } from 'svelte'

  let {
    headers,
    downloads = [],
    children,
    note,
  }: {
    headers: string[]
    // Build and serialize data only on click.
    downloads?: ({ label: string; filename: string } & (
      | { columns: () => Record<string, ArrayLike<number>> }
      | { json: () => unknown }
    ))[]
    // Table rows (<tr>…</tr>)
    children: Snippet
    // Provenance line rendered below the table
    note: Snippet
  } = $props()
</script>

<table class="analysis-summary">
  <thead>
    <tr>
      {#each headers as header (header)}
        <th>{header}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {@render children()}
  </tbody>
</table>
<p class="analysis-note">
  {@render note()}
  {#each downloads as item (item.label)}
    <button
      type="button"
      class="analysis-download"
      title="Download {item.label}"
      onclick={() =>
        `columns` in item
          ? download(columns_to_csv(item.columns()), item.filename, `text/csv`)
          : download(JSON.stringify(item.json(), null, 2), item.filename, `application/json`)}
    >
      ⬇ {item.label}
    </button>
  {/each}
</p>

<style>
  .analysis-summary {
    width: 100%;
    font-size: 0.85em;
    border-collapse: collapse;
    margin-top: 4pt;
    /* rows come from the caller's snippet, so their cells sit outside this component's scope */
    th,
    :global(td) {
      text-align: left;
      padding: 2pt 4pt;
      border-bottom: 1px solid var(--border-color, #8884);
    }
  }
  .analysis-note {
    font-size: 0.75em;
    opacity: 0.7;
    margin: 4pt 0 0;
  }
  .analysis-download {
    font-size: inherit;
    padding: 0 4pt;
    margin-left: 4pt;
    background: var(--surface-bg-hover, rgba(128, 128, 128, 0.2));
    border-radius: 3pt;
  }
</style>

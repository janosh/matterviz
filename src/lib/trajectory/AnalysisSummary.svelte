<script lang="ts">
  // Summary table plus provenance note under an analysis plot (MSD, VACF, RDF): one place
  // for the column headers, the compact styling, the faint note line each plot used to copy
  // and downloads of the curves and their analysis metadata
  import ExportDestination from '$lib/io/ExportDestination.svelte'
  import { FileExportState } from '$lib/io/file-export.svelte'
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
  const default_name = $derived(downloads[0]?.filename.replace(/\.[^.]+$/, ``) ?? `analysis`)
  const export_state = new FileExportState(() => default_name)
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
</p>
{#if downloads.length}
  <details>
    <summary>Export files</summary>
    <ExportDestination state={export_state} />
    {#each downloads as item (item.label)}
      <button
        type="button"
        class="analysis-download"
        title="Download {item.label}"
        disabled={export_state.busy || Boolean(export_state.filename_error)}
        onclick={() =>
          export_state.run(({ filename, save }) => {
            const suffix = item.filename.startsWith(`${default_name}.`)
              ? item.filename.slice(default_name.length)
              : `-${item.filename}`
            return `columns` in item
              ? save(columns_to_csv(item.columns()), `${filename}${suffix}`, `text/csv`)
              : save(
                  JSON.stringify(item.json(), null, 2),
                  `${filename}${suffix}`,
                  `application/json`,
                )
          })}
      >
        ⬇ {item.label}
      </button>
    {/each}
  </details>
{/if}

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

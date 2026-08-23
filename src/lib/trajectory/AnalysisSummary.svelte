<script lang="ts">
  // Summary table plus provenance note under an analysis plot (MSD, VACF): one place for
  // the column headers, the compact styling and the faint note line each plot used to copy
  import type { Snippet } from 'svelte'

  let {
    headers,
    children,
    note,
  }: {
    headers: string[]
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
</style>

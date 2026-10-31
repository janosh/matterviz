<script lang="ts">
  import TestSection from './TestSection.svelte'

  // Live readouts for Playwright: each key becomes the data-testid of its value
  let { values }: { values: Record<string, unknown> } = $props()
</script>

<TestSection title="Status">
  <dl>
    {#each Object.entries(values) as [key, value] (key)}
      <dt>{key}</dt>
      <dd data-testid={key}>{String(value)}</dd>
    {/each}
  </dl>
</TestSection>

<style>
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25em 1em;
    margin: 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere; /* long JSON readouts must not widen the page */
    font-family: monospace;
  }
</style>

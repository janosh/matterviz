<script lang="ts">
  // Collapsible prop reference for the current demo page's components, generated from the
  // `$props()` declarations by src/scripts/prop-docs.ts and loaded when first opened
  import { page } from '$app/state'
  import { page_components } from '#site/state.svelte.js'

  let open: Record<string, boolean> = $state({})
</script>

{#each page_components(page.route.id ?? ``) as name (name)}
  <details bind:open={open[name]}>
    <summary>Props of <code>{name}</code></summary>
    {#if open[name]}
      {#await import(`virtual:prop-docs`)}
        <p>Loading props...</p>
      {:then { default: docs }}
        <table>
          <thead>
            <tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr>
          </thead>
          <tbody>
            {#each docs[name] as { name: prop, type, default: fallback, description, bindable, required } (prop)}
              <tr>
                <td>
                  <code>{prop}</code>
                  {#if required}<small>required</small>{/if}
                  {#if bindable}<small>bindable</small>{/if}
                </td>
                <td>
                  {#if type}<code>{type}</code>{/if}
                </td>
                <td>
                  {#if fallback}<code>{fallback}</code>{/if}
                </td>
                <td>{description ?? ``}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:catch error}
        <p>Failed to load the props of {name}: {error}</p>
      {/await}
    {/if}
  </details>
{/each}

<style>
  details {
    margin-block: 2em;
  }
  summary {
    cursor: pointer;
    font-weight: bold;
  }
  td small {
    display: block;
    opacity: 0.7;
  }
</style>

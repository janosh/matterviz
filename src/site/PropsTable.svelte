<script lang="ts" module>
  import type { PropDoc } from '#root/src/scripts/prop-docs.ts'

  // One fetch per component for the page's lifetime, shared by the prefetch and the table
  const loads = new Map<string, Promise<PropDoc[]>>()
  const load_props = (name: string): Promise<PropDoc[]> => {
    let load = loads.get(name)
    if (!load) {
      load = import(`virtual:prop-docs`).then(async ({ default: loaders }) => {
        const loader = loaders[name]
        if (!loader) throw new Error(`No props extracted for ${name}`)
        return (await loader()).default
      })
      // a failure (e.g. an extraction error mid-edit on the dev server) is not cached: the
      // next open retries
      load.catch(() => loads.delete(name))
      loads.set(name, load)
    }
    return load
  }
</script>

<script lang="ts">
  // Collapsible prop reference for the current demo page's components, generated from the
  // `$props()` declarations by src/scripts/prop-docs.ts. Fetched once the browser idles after
  // the page loads, so opening a table finds its props ready instead of waiting on the fetch
  // (and on a dev server, the extraction).
  import { page } from '$app/state'
  import { page_components } from '#site/state.svelte.js'

  let open: Record<string, boolean> = $state({})
  let names = $derived(page_components(page.route.id ?? ``))
  $effect(() => {
    const pending = names // read here, so a new page's components prefetch too
    // a failed prefetch surfaces when the table is opened (the {:catch} below), not here
    const prefetch = () => pending.forEach((name) => load_props(name).catch(() => {}))
    if (`requestIdleCallback` in globalThis) requestIdleCallback(prefetch)
    else setTimeout(prefetch, 500) // Safari has no requestIdleCallback
  })
</script>

{#each names as name (name)}
  <details bind:open={open[name]}>
    <summary>Props of <code>{name}</code></summary>
    {#if open[name]}
      {#await load_props(name)}
        <p>Loading props...</p>
      {:then docs}
        <table>
          <thead>
            <tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr>
          </thead>
          <tbody>
            {#each docs as { name: prop, type, default: fallback, description, bindable, required } (prop)}
              <tr>
                <td>
                  <code>{prop}</code>
                  {#if required}<small>required</small>{/if}
                  {#if bindable}<small>bindable</small>{/if}
                </td>
                <td
                  >{#if type}<code>{type}</code>{/if}</td
                >
                <td
                  >{#if fallback}<code>{fallback}</code>{/if}</td
                >
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

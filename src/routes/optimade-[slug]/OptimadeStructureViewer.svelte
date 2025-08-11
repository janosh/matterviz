<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { Icon } from '$lib'
  import type { OptimadeProvider, OptimadeStructure } from '$lib/api/optimade'
  import {
    decode_structure_id,
    detect_provider_from_slug,
    encode_structure_id,
    fetch_optimade_providers,
    fetch_optimade_structure,
    fetch_suggested_structures,
  } from '$lib/api/optimade'
  import { Composition } from '$lib/composition'
  import { get_electro_neg_formula } from '$lib/composition/parse'
  import type { PymatgenStructure } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import { optimade_to_pymatgen } from '$lib/structure/parse'
  import { tooltip } from 'svelte-multiselect'

  let structure = $state<PymatgenStructure | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let available_providers = $state<OptimadeProvider[]>([])
  let selected_provider = $state(`mp`)
  let input_value = $state(``)
  let suggested_structures = $state<OptimadeStructure[]>([])
  let loading_suggestions = $state(false)

  $effect(() => {
    const decoded_slug = decode_structure_id(page.params.slug ?? ``)
    input_value = decoded_slug
    detect_provider_from_slug(decoded_slug).then((provider) => {
      if (provider) {
        selected_provider = provider
        input_value = decoded_slug.startsWith(`${provider}-`)
          ? decoded_slug
          : `${provider}-${decoded_slug}`
      }
    })
  })

  $effect(() => {
    fetch_optimade_providers().then((providers) => available_providers = providers)
  })

  let structure_id = $derived(input_value.trim())
  let provider_config = $derived(
    available_providers.find((p) => p.id === selected_provider),
  )
  let pretty_formula = $derived(structure ? get_electro_neg_formula(structure) : ``)

  $effect(() => {
    if (structure_id && selected_provider) load_structure_data()
  })
  $effect(() => {
    if (selected_provider) load_suggested_structures()
  })

  async function load_structure_data() {
    loading = true
    error = null
    try {
      const data = await fetch_optimade_structure(structure_id, selected_provider)
      structure = data ? optimade_to_pymatgen(data) : null
      if (!structure) {
        error = data
          ? `Failed to convert structure data`
          : `Structure ${structure_id} not found`
      }
    } catch (err) {
      error = `Failed to load structure data: ${err}`
    } finally {
      loading = false
    }
  }

  async function load_suggested_structures() {
    loading_suggestions = true
    try {
      suggested_structures = await fetch_suggested_structures(selected_provider, 12)
    } catch {
      suggested_structures = []
    } finally {
      loading_suggestions = false
    }
  }

  async function navigate_to_structure(id: string) {
    input_value = id
    goto(`/optimade-${encode_structure_id(id)}`)
  }
</script>

<h1 style="margin-top: 0">OPTIMADE Explorer</h1>

<div class="input-section">
  <input
    class="structure-input"
    placeholder="Enter structure ID"
    bind:value={input_value}
    onkeydown={async (event) => {
      if (event.key === `Enter`) await navigate_to_structure(structure_id)
    }}
  />
  <button
    class="fetch-button"
    onclick={() => navigate_to_structure(structure_id)}
    disabled={loading}
  >
    {loading ? `Loading...` : `Fetch`}
  </button>
</div>

<div class="main-layout full-bleed">
  <div class="providers-column">
    <h3>Providers</h3>
    <div class="providers-grid">
      {#each available_providers as { id, attributes } (id)}
        <div class:selected={id === selected_provider}>
          <button
            class="provider-select"
            {@attach tooltip({ content: attributes.name })}
            onclick={() => {
              selected_provider = id
              input_value = ``
            }}
          >
            <Icon icon="Database" /> {id}
          </button>
          <a
            href={attributes.base_url}
            title="API"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon icon="Link" />
          </a>
          <a
            href={attributes.homepage}
            title="Home"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon icon="Globe" />
          </a>
        </div>
      {/each}
    </div>
  </div>

  <div class="suggestions-column">
    {#if suggested_structures.length > 0}
      <h3>Suggested Structures</h3>
      {#if loading_suggestions}
        <p>Loading...</p>
      {:else}
        <div class="structure-suggestions">
          {#each suggested_structures as struct (struct.id)}
            {@const formula = get_electro_neg_formula(
          struct.attributes.chemical_formula_descriptive ?? ``,
        )}
            <button onclick={() => navigate_to_structure(struct.id)}>
              <div style="font-family: monospace">{struct.id}</div>
              {#if formula}
                <div style="font-weight: lighter">{@html formula}</div>
              {/if}
              {#if struct.attributes.chemical_formula_descriptive}
                <Composition
                  composition={struct.attributes.chemical_formula_descriptive}
                  mode="pie"
                  style="min-height: 80px; height: 80px; grid-row: 1/span 2; grid-column: 2"
                />
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <div class="structure-column">
    {#if error}
      <div class="error-message">
        <p>{error}</p>
      </div>
    {/if}

    {#if loading}
      <p>Loading structure from {provider_config?.attributes.name}...</p>
    {/if}

    {#if structure}
      <h2>
        {@html pretty_formula}
        {#if structure_id}
          <span class="structure-id">({structure_id})</span>
        {/if}
      </h2>
      <Structure {structure} style="height: 80vh; width: 100%" />
    {/if}
  </div>
</div>

<style>
  .input-section {
    display: flex;
    gap: 0.5em;
    margin-bottom: 1.5em;
    justify-content: center;
  }
  .structure-input {
    flex: 1;
    max-width: 400px;
    padding: 0.4em 0.6em;
    font-size: 0.95em;
    border-radius: 4pt;
    border: 1px solid var(--border-color);
    background: var(--surface-bg);
  }
  .fetch-button {
    padding: 0.4em 0.8em;
    font-size: 0.95em;
    border-radius: 4pt;
    border: 1px solid var(--border-color);
    background: var(--btn-bg);
    cursor: pointer;
  }
  .fetch-button:hover {
    background: var(--btn-hover-bg);
  }
  .main-layout {
    display: grid;
    grid-template-columns: minmax(250px, 280px) minmax(280px, 320px) 1fr;
    gap: clamp(1em, 2vw, 1.5em);
    height: calc(100vh - 180px);
  }
  .providers-column,
  .suggestions-column,
  .structure-column {
    overflow-y: auto;
  }
  .providers-column h3,
  .suggestions-column h3 {
    margin: 0 0 0.75em;
    font-size: 1.1em;
    position: sticky;
    top: 0;
    background: var(--bg-color);
    padding-bottom: 0.5em;
  }
  .providers-grid {
    display: flex;
    flex-direction: column;
    gap: 0.4em;
  }
  .providers-grid div {
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.3em 0.5em;
    border: 1px solid var(--border-color);
    border-radius: 4pt;
  }
  .providers-grid div:hover {
    background: var(--surface-bg-hover);
  }
  .providers-grid div.selected {
    border: 1px solid var(--accent-color);
    color: var(--accent-color);
  }
  .provider-select {
    display: flex;
    align-items: center;
    gap: 0.4em;
    cursor: pointer;
    background: none;
    font: inherit;
    flex: 1;
  }
  .providers-grid a {
    padding: 2pt;
    color: var(--text-color-muted);
    border-radius: 3pt;
    font-size: 0.8em;
  }
  .providers-grid a:hover {
    background: var(--surface-bg-hover);
  }
  .structure-suggestions {
    display: grid;
    gap: 0.5em;
  }
  .structure-suggestions button {
    display: grid;
    justify-content: space-between;
    gap: 0.75em;
    align-items: center;
    padding: 0.5em 0.75em;
    border: 1px solid var(--border-color);
    border-radius: 4pt;
    cursor: pointer;
    background: none;
    font: inherit;
    text-align: left;
  }
  .structure-suggestions button:hover {
    background: var(--surface-bg-hover);
  }
  .structure-column h2 {
    margin: 0 2pt 10pt;
    font-size: 1.5em;
  }
  .structure-id {
    font-weight: lighter;
    color: var(--text-color-muted);
  }
  .error-message {
    text-align: center;
    color: #ff6b6b;
    margin: 1em 0;
  }
  @media (max-width: 800px) {
    .main-layout {
      grid-template-columns: 1fr;
      height: auto;
    }
    .providers-column h3,
    .suggestions-column h3 {
      position: static;
    }
    .structure-suggestions {
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    }
  }
</style>

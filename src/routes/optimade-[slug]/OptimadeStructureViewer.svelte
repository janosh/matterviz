<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { Icon } from '$lib'
  import type { OptimadeProvider, OptimadeStructure } from '$lib/api/optimade'
  import {
    detect_provider_from_slug,
    fetch_optimade_providers,
    fetch_optimade_structure,
    fetch_suggested_structures,
  } from '$lib/api/optimade'
  import { Composition } from '$lib/composition'
  import { get_electro_neg_formula } from '$lib/composition/parse'
  import { optimade_to_pymatgen } from '$lib/io/parse'
  import type { PymatgenStructure } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import { tooltip } from 'svelte-multiselect'

  let structure = $state<PymatgenStructure | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let pretty_formula = $state<string>(``)
  let available_providers = $state<OptimadeProvider[]>([])
  let selected_provider = $state<string>(`mp`)
  let input_value = $state(``)
  let suggested_structures = $state<OptimadeStructure[]>([])
  let loading_suggestions = $state(false)

  // Set input_value and provider from page params on mount
  $effect(() => {
    if (page.params.slug) {
      const slug = page.params.slug
      input_value = slug
      detect_provider_from_slug(slug)
        .then((provider) => {
          if (provider) {
            selected_provider = provider
            // If the slug starts with the provider prefix, use the full slug as structure ID
            if (slug.startsWith(`${provider}-`)) {
              input_value = slug
            } else {
              input_value = `${provider}-${slug}`
            }
          }
        })
        .catch((err) => console.error(`Failed to detect provider:`, err))
    }
  })

  // Load providers on mount
  $effect(() => {
    load_providers()
  })

  async function load_providers() {
    try {
      const providers = await fetch_optimade_providers()
      available_providers = providers
    } catch (error) {
      console.error(`Failed to load providers:`, error)
      available_providers = []
    }
  }

  let structure_id = $derived(input_value.trim())
  let provider_config = $derived(
    available_providers.find((p) => p.id === selected_provider),
  )

  // Load initial data
  $effect(() => {
    if (structure_id && selected_provider) load_structure_data()
  })

  // Load suggested structures when provider changes
  $effect(() => {
    if (selected_provider) load_suggested_structures()
  })

  async function load_structure_data() {
    loading = true
    error = null

    try {
      const structure_data = await fetch_optimade_structure(
        structure_id,
        selected_provider,
      )

      if (structure_data) {
        structure = optimade_to_pymatgen(structure_data)
        if (structure) {
          pretty_formula = get_electro_neg_formula(structure)
        } else {
          error = `Failed to convert structure data`
        }
      } else {
        error = `Structure ${structure_id} not found`
      }
    } catch (err) {
      console.error(`Error loading structure:`, err)
      error = `Failed to load structure data from ${selected_provider}: ${err}`
    } finally {
      loading = false
    }
  }

  async function load_suggested_structures() {
    loading_suggestions = true
    try {
      suggested_structures = await fetch_suggested_structures(selected_provider, 12)
    } catch (err) {
      console.error(`Failed to load suggested structures:`, err)
      suggested_structures = []
    } finally {
      loading_suggestions = false
    }
  }

  async function navigate_to_structure(id: string) {
    input_value = id
    goto(`/optimade-${id}`)
    await load_structure_data()
  }
</script>

<h1>OPTIMADE Structure Explorer</h1>

<div style="display: flex; gap: 1em; justify-content: center">
  <input
    class="structure-input"
    placeholder="Enter OPTIMADE structure ID"
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
    {loading ? `Loading...` : `Fetch structure`}
  </button>
</div>

<div class="providers-grid">
  {#each available_providers as { id, attributes } (id)}
    <button
      class="provider-card"
      class:selected={id === selected_provider}
      {@attach tooltip({ content: attributes.name })}
      onclick={() => {
        selected_provider = id
        input_value = ``
        load_suggested_structures()
      }}
    >
      <a href={attributes.base_url} title="API Endpoint" class="provider-link">
        <Icon icon="Database" /> {id}
      </a>
      <a href={attributes.homepage} title="Homepage">
        <Icon icon="Link" />
      </a>
    </button>
  {/each}
</div>

{#if suggested_structures.length > 0}
  <div class="suggestions-section">
    <h3>Suggested Structures from {provider_config?.attributes.name}</h3>
    {#if loading_suggestions}
      <p>Loading suggestions...</p>
    {:else}
      <div class="suggestions-grid">
        {#each suggested_structures as structure (structure.id)}
          <button
            class="suggestion-card"
            onclick={() => navigate_to_structure(structure.id)}
          >
            <div style="flex: 1">
              <div class="suggestion-id">{structure.id}</div>
              {#if structure.attributes.chemical_formula_descriptive}
                <div class="suggestion-formula">
                  {@html get_electro_neg_formula(
              structure.attributes.chemical_formula_descriptive,
            )}
                </div>
              {/if}
            </div>
            {#if structure.attributes.chemical_formula_descriptive}
              <Composition
                composition={structure.attributes.chemical_formula_descriptive}
                mode="pie"
                style="height: 80px"
              />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if error}
  <div style="text-align: center; color: #ff6b6b; margin: 1em 0">
    <p>{error}</p>
  </div>
{/if}

{#if loading}
  <p>Loading structure data from {provider_config?.attributes.name}...</p>
{/if}

{#if structure}
  <h2>
    {@html pretty_formula}
    {#if structure_id}
      <span style="font-weight: lighter">({structure_id})</span>
    {/if}
  </h2>

  <Structure {structure} class="bleed-1400" style="height: auto" />
{/if}

<style>
  .providers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.5em;
    margin: 1em 0 2em;
  }
  .provider-card {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.5em;
    border: 1px solid var(--border-color);
    border-radius: 4pt;
    cursor: pointer;
    background: none;
    font: inherit;
  }
  .provider-card:hover {
    background: var(--surface-bg-hover);
  }
  .provider-card.selected {
    border-color: var(--accent-color);
  }
  .provider-card a {
    padding: 0 3pt;
    color: var(--text-color-muted);
    border-radius: 3pt;
  }
  .provider-card a:hover {
    background: var(--surface-bg-hover);
  }
  .structure-input, .fetch-button {
    font-size: 1.1em;
    border-radius: 4pt;
    border: 1px solid var(--border-color);
    color: var(--text-color);
  }
  .structure-input {
    padding: 0.5em 0.75em;
    background: var(--surface-bg);
  }
  .fetch-button {
    padding: 0.5em 1em;
    background: var(--btn-bg);
    cursor: pointer;
  }
  .fetch-button:hover {
    background: var(--btn-hover-bg);
  }
  .suggestions-section {
    margin: 2em 0;
  }
  .suggestions-section h3 {
    margin-bottom: 1em;
    color: var(--text-color);
  }
  .suggestions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 0.75em;
  }
  .suggestion-card {
    display: flex;
    gap: 1em;
    align-items: center;
    padding: 1em;
    border: 1px solid var(--border-color);
    border-radius: 6pt;
    cursor: pointer;
    background: none;
    font: inherit;
    text-align: left;
  }
  .suggestion-card:hover {
    background: var(--surface-bg-hover);
  }
  .suggestion-id {
    font-family: monospace;
    font-weight: 600;
    color: var(--text-color);
  }
  .suggestion-formula {
    color: var(--text-color);
    font-size: 0.9em;
  }
</style>

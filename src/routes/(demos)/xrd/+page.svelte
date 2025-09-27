<script lang="ts">
  import type { PymatgenStructure } from '$lib'
  import { get_electro_neg_formula } from '$lib/composition/parse'
  import { Structure } from '$lib/structure'
  import { XrdPlot } from '$lib/xrd'
  import type { XrdPattern as CalcXrdPattern } from '$lib/xrd/calc'
  import { compute_xrd_pattern } from '$lib/xrd/calc'
  import { structures } from '$site/structures'
  import { SvelteMap } from 'svelte/reactivity'

  // Cache computed XRD patterns to avoid recomputation when navigating structures
  const xrd_cache = new SvelteMap<string, CalcXrdPattern>()

  // On-the-fly computed patterns
  const compute_ids = structures.map((s) => s.id)
  let compute_id = $state<string>(compute_ids[0] || ``)
  const computed_struct = $derived<PymatgenStructure | null>(
    structures.find((s) => s.id === compute_id) ?? null,
  )
  let compute_error = $state<string | null>(null)
  let computed_pattern = $state<CalcXrdPattern | null>(null)
  $effect(() => {
    const struct = computed_struct
    if (!struct) {
      computed_pattern = null
      return
    }
    try {
      compute_error = null
      // Use cache if available, compute and store otherwise
      const cached = xrd_cache.get(struct.id || ``)
      if (cached) computed_pattern = cached
      else {
        const result = compute_xrd_pattern(struct)
        xrd_cache.set(struct.id || ``, result)
        computed_pattern = result
      }
    } catch (exc) {
      compute_error = exc instanceof Error ? exc.message : String(exc)
      computed_pattern = null
    }
  })

  // Precomputed carousel removed; computing on the fly below

  function formula_for(id: string): string {
    const struct = structures.find((s) => s.id === id)
    if (!struct) return ``
    try {
      return get_electro_neg_formula(struct, false)
    } catch {
      return ``
    }
  }

  // No precomputed carousel
</script>

<h1>XRD Patterns</h1>

<div class="bleed-1400">
  <section>
    <nav>
      {#each structures as struct (struct.id || ``)}
        <button
          class:selected={struct.id === compute_id}
          onclick={() => (compute_id = struct.id || ``)}
          title={struct.id || ``}
        >
          <span class="id">{struct.id || ``}</span>
          <span class="formula">{@html formula_for(struct.id || ``)}</span>
        </button>
      {/each}
    </nav>

    <div>
      <div>
        <XrdPlot
          patterns={computed_pattern
          ? [{ label: compute_id, pattern: computed_pattern }]
          : []}
          annotate_peaks={3}
          hkl_format="compact"
          padding={{ t: 10, b: 40, l: 50, r: 10 }}
          style="height: 600px"
        />
        {#if compute_error}
          <p>Compute error: {compute_error}</p>
        {/if}
      </div>
      <div>
        {#if computed_struct}
          <Structure structure={computed_struct} style="height: 600px" />
        {/if}
      </div>
    </div>
  </section>
</div>

<style>
  .bleed-1400 {
    display: grid;
    gap: 1em;
  }
  .bleed-1400 > section {
    display: grid;
    gap: 1em;
  }
  .bleed-1400 > section > nav {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .bleed-1400 > section > nav button {
    flex: 0 0 auto;
    display: grid;
    gap: 4px;
    grid-template-columns: auto 1fr;
    align-items: center;
    padding: 6px 8px;
    border: 1px solid var(--text-color-muted);
    background: var(--bg-color);
    cursor: pointer;
    text-align: left;
  }
  .bleed-1400 > section > nav button.selected {
    outline: 2px solid var(--accent-color, #4e79a7);
  }
  .bleed-1400 > section > nav .id {
    font-family: monospace;
    font-weight: 600;
  }
  .bleed-1400 > section > nav .formula {
    color: var(--text-color-muted);
    font-size: 0.9em;
  }
  .bleed-1400 > section > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1em;
  }
</style>

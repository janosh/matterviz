<script lang="ts">
  import type { PhaseData } from '$lib/convex-hull'
  import { Spinner } from 'svelte-widgets'
  import { SynthesisPlanner } from '$lib/synthesis-planning'
  import type { SynthesisConditions, SynthesisPlan } from '$lib/synthesis-planning'
  import { to_error } from '$lib/utils'
  import { synthesis_demo_systems } from '$site/synthesis-planning'

  let selected_id = $state(synthesis_demo_systems[0]?.id ?? ``)
  const selected = $derived(
    synthesis_demo_systems.find((system) => system.id === selected_id) ??
      synthesis_demo_systems[0],
  )
  let entries = $state<PhaseData[]>([])
  let target = $state(``)
  let conditions = $state<SynthesisConditions>({ temperature: 0, open_species: [] })
  let plan = $state<SynthesisPlan | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)

  $effect(() => {
    const system = selected
    if (!system) return
    loading = true
    error = null
    system
      .load()
      .then((loaded) => {
        if (selected?.id !== system.id) return
        entries = loaded
        target = system.target
        conditions = { ...system.conditions }
      })
      .catch((err) => (error = to_error(err).message))
      .finally(() => (loading = false))
  })
</script>

<h1>Synthesis Planner</h1>

<p>
  Rank solid-state synthesis routes to a target phase from simulated convex-hull data. Every
  precursor set is balanced (with optional gas release or uptake from the atmosphere), scored
  by how cleanly the target out-competes the other phases that can form from the same mixture
  (driving forces, inverse hull energy and pairwise interfaces after
  <a href="https://doi.org/10.1038/s44160-024-00502-y" target="_blank" rel="noreferrer"
    >Chen et al., Nat. Synth. 2024</a
  >), and turned into a bench recipe. The same <code>plan_synthesis()</code> function ships as
  an LLM tool definition (<code>SYNTHESIS_PLANNER_TOOL</code>); <em>Copy summary</em> shows what
  an agent sees.
</p>

<label>
  Chemical system
  <select bind:value={selected_id}>
    {#each synthesis_demo_systems as system (system.id)}
      <option value={system.id}>{system.label}</option>
    {/each}
  </select>
</label>
{#if selected?.description}<p class="description">{selected.description}</p>{/if}

{#if error}
  <p class="error">{error}</p>
{:else if loading && entries.length === 0}
  <Spinner text="Loading {selected?.label}…" />
{:else}
  <div class="bleed-1400">
    <SynthesisPlanner {entries} bind:target bind:conditions bind:plan two_step={false} />
  </div>
{/if}

<details>
  <summary>How the ranking works</summary>
  <ul>
    <li>
      <strong>Reaction energy</strong> per atom of target at the chosen temperature: solids
      keep their 0 K computed energies, open gases get μ(T, p) = H<sub>f</sub> − T·S + kT
      ln(p/p°), so carbonate decomposition and O<sub>2</sub> release turn on with temperature.
      The
      <em>onset</em> is where a gas-releasing reaction becomes downhill.
    </li>
    <li>
      <strong>Competing phases</strong>: every near-hull phase that the same precursor mixture
      can form, with its driving force per atom of reacting mixture (pymatgen
      InterfacialReactivity convention). The <em>selectivity margin</em> is the target's driving
      force minus the strongest competitor's; negative means the target forms first.
    </li>
    <li>
      <strong>Inverse hull energy</strong>: how far the target sits below the hull of all other
      reachable phases at its own composition; larger means intermediates are less likely to
      persist.
    </li>
    <li>
      <strong>Practicality</strong> from a library of commercial precursors (hygroscopic, air-sensitive,
      hazards, decomposition and melting points) that also feeds the heating window of the recipe.
    </li>
  </ul>
</details>

<style>
  label {
    display: flex;
    gap: 0.5em;
    align-items: center;
    margin-bottom: 0.5em;
  }
  .description {
    margin: 0 0 1em;
    color: var(--text-color-muted, #888);
  }
  .error {
    color: var(--error-color, #d62728);
  }
  details {
    margin-top: 2em;
  }
</style>

<script lang="ts">
  import type { PhaseData } from '#lib/convex-hull/index'
  import Spinner from 'svelte-widgets/Spinner.svelte'
  import FilePicker from '#lib/FilePicker.svelte'
  import { SynthesisPlanner } from '#lib/synthesis-planning/index'
  import type { SynthesisConditions } from '#lib/synthesis-planning/index'
  import { to_error } from 'svelte-widgets/utils'
  import { synthesis_demo_systems } from '#site/synthesis-planning/index'
  import { latest_load, url_selection } from '#site/state.svelte'

  const labels = Object.fromEntries(synthesis_demo_systems.map(({ id, label }) => [id, label]))
  const selected_id = url_selection(`system`, Object.keys(labels))
  const selected = $derived(synthesis_demo_systems.find(({ id }) => id === selected_id.value))
  let entries = $state<PhaseData[]>([])
  let target = $state(``)
  let conditions = $state<SynthesisConditions>({ temperature: 0, open_species: [] })
  let loading = $state(false)
  let error = $state<string | null>(null)

  // A system switched away from must not report its error or end the newer load's spinner
  const loads = latest_load()
  $effect(() => {
    const system = selected
    if (!system) return
    const is_current = loads.start()
    loading = true
    error = null
    system
      .load()
      .then((loaded) => {
        if (!is_current()) return
        entries = loaded
        target = system.target
        conditions = { ...system.conditions }
      })
      .catch((err) => {
        if (is_current()) error = to_error(err).message
      })
      .finally(() => {
        if (is_current()) loading = false
      })
  })
</script>

<h1 id="synthesis-planner">Synthesis Planner</h1>

<p>
  Shortlist precursor routes, compare their tradeoffs, and explore how temperature and gas
  pressure change their thermodynamic selectivity. Build experiment cards with calculated
  quantities for every firing and record your own protocol choices. The ranking uses driving
  forces, inverse hull energy and pairwise interfaces after
  <a href="https://doi.org/10.1038/s44160-024-00502-y" target="_blank" rel="noreferrer"
    >Chen et al., Nat. Synth. 2024</a
  >. Copy a card or the complete plan to preserve the calculations and experimental
  assumptions.
</p>

<FilePicker
  {...selected_id.picker(`system`, (id) => labels[id])}
  style="margin-bottom: 0.5em"
/>
{#if selected?.description}<p class="description">{selected.description}</p>{/if}

{#if error}
  <p class="error">{error}</p>
{:else if loading && entries.length === 0}
  <Spinner text="Loading {selected?.label}…" />
{:else}
  <div class="bleed-1400">
    <SynthesisPlanner {entries} bind:target bind:conditions />
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
      <em>downhill window</em> is the temperature range where a gas-exchanging reaction is downhill:
      above a lower bound when it releases gas, below an upper bound when it takes gas up. It is
      not a recommended firing temperature.
    </li>
    <li>
      <strong>Competing phases</strong>: every near-hull phase that the same precursor mixture
      can form, with its driving force per atom of reacting mixture (pymatgen
      InterfacialReactivity convention). The <em>selectivity margin</em> is the target's driving
      force minus the strongest competitor's; negative means the target is thermodynamically favored.
    </li>
    <li>
      <strong>Inverse hull energy</strong>: how far the target sits below the hull of all other
      reachable phases at its own composition; larger means intermediates are less likely to
      persist.
    </li>
    <li>
      <strong>Practicality</strong> from a library of commercial precursors (hygroscopic, air-sensitive,
      hazards, decomposition and melting points). These unreferenced notes are separated from calculated
      quantities and user-supplied experimental choices.
    </li>
  </ul>
</details>

<style>
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

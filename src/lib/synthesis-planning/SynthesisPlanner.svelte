<script lang="ts">
  // Interactive synthesis planner: pick a target and firing conditions, browse ranked precursor
  // routes, inspect each route's competing phases, reaction slice and bench recipe. The plan
  // itself comes from `plan_synthesis`, the same pure function agents call.
  import { create_flash } from '$lib/effects.svelte'
  import { ConvexHull, DEFAULT_GAS_PRESSURES, GAS_SPECIES } from '$lib/convex-hull'
  import type { GasSpecies, PhaseData } from '$lib/convex-hull'
  import { format_num, plural } from '$lib/labels'
  import { ToolbarMenu } from '$lib/overlays'
  import { sanitize_formula } from '$lib/sanitize'
  import { format_plan_text } from './agent'
  import { format_equation_html, format_mev } from './format'
  import { prepare_phase_set, resolve_phase } from './phases'
  import { plan_synthesis_async } from './plan-synthesis-async.svelte'
  import { build_route_recipe } from './recipe'
  import RouteComparison from './RouteComparison.svelte'
  import OpportunityMap from './OpportunityMap.svelte'
  import ReactionSlicePlot from './ReactionSlicePlot.svelte'
  import RecipeCard from './RecipeCard.svelte'
  import RouteTable from './RouteTable.svelte'
  import { DEFAULT_SCORE_WEIGHTS } from './scoring'
  import type {
    PrecursorPoolOptions,
    RecipeAssumptions,
    ScoreWeights,
    SynthesisConditions,
    SynthesisPlan,
    SynthesisPlanProgress,
    SynthesisRoute,
  } from './types'
  import { onDestroy, untrack } from 'svelte'

  let {
    entries = [],
    target = $bindable(``),
    conditions = $bindable({ temperature: 0, open_species: [], partial_pressures: {} }),
    precursors = $bindable({}),
    max_precursors = $bindable(2),
    two_step = $bindable(false),
    target_mass_g = $bindable(1),
    weights = $bindable({ ...DEFAULT_SCORE_WEIGHTS }),
    max_routes = 50,
    selected_route_id = $bindable(null),
    shortlist_ids = $bindable([]),
    plan = $bindable(null),
    planning = $bindable(false),
    progress = $bindable(null),
    show_hull = true,
    show_opportunity_map = true,
    show_controls = true,
    ...rest
  }: {
    entries?: PhaseData[]
    // Target formula or entry id; defaults to the most stable multi-element phase
    target?: string
    conditions?: SynthesisConditions
    precursors?: PrecursorPoolOptions
    max_precursors?: number
    two_step?: boolean
    target_mass_g?: number
    weights?: ScoreWeights
    max_routes?: number
    selected_route_id?: string | null
    shortlist_ids?: string[]
    // Bindable output: the full plan for the current inputs
    plan?: SynthesisPlan | null
    // Bindable async state for host applications embedding the planner
    planning?: boolean
    progress?: SynthesisPlanProgress | null
    show_hull?: boolean
    show_opportunity_map?: boolean
    show_controls?: boolean
    [key: string]: unknown
  } = $props()

  // Target choices: every non-gas multi-element formula, stable phases first
  const phase_set = $derived(entries.length ? prepare_phase_set(entries) : null)
  const target_options = $derived(
    (phase_set?.phases ?? [])
      .filter((phase) => !phase.is_gas && Object.keys(phase.composition).length > 1)
      .toSorted(
        (phase_a, phase_b) =>
          phase_a.e_above_hull_0K - phase_b.e_above_hull_0K ||
          Object.keys(phase_b.composition).length - Object.keys(phase_a.composition).length ||
          phase_a.formula.localeCompare(phase_b.formula),
      ),
  )
  const explicit_target = $derived(
    phase_set && target && !target_options.some((phase) => phase.formula === target)
      ? resolve_phase(phase_set, target)
      : null,
  )
  $effect(() => {
    if (!target && target_options.length) target = target_options[0].formula
  })

  let worker_plan = $state<SynthesisPlan | null>(plan)
  let planned_entries: PhaseData[] | undefined
  let planned_target = ``
  let hull_open = $state(false)
  let map_routes = $state.raw<SynthesisRoute[]>([])
  let map_entries: PhaseData[] | undefined
  let map_target = ``
  let shortlist_target = $state(``)
  let experiment_choices = $state<
    Record<string, Partial<Record<`final` | `intermediate`, RecipeAssumptions>>>
  >({})
  let planning_error = $state<string | null>(null)
  let active_controller: AbortController | undefined
  const target_mass_error = $derived(
    typeof target_mass_g !== `number` || !Number.isFinite(target_mass_g) || target_mass_g <= 0
      ? `plan_synthesis: target_mass_g must be a finite number > 0, got ${String(target_mass_g)}`
      : null,
  )
  const computed_plan = $derived.by(() => {
    if (!worker_plan || target_mass_error) return null
    return {
      ...worker_plan,
      routes: worker_plan.routes.map((route) => {
        const scaled =
          target_mass_g === route.recipe.target_mass_g
            ? route
            : { ...route, ...build_route_recipe(route, target_mass_g) }
        const choices = experiment_choices[route.id]
        if (!choices) return scaled
        return {
          ...scaled,
          recipe: choices.final
            ? { ...scaled.recipe, assumptions: choices.final }
            : scaled.recipe,
          intermediate_step:
            scaled.intermediate_step && choices.intermediate
              ? {
                  ...scaled.intermediate_step,
                  recipe: {
                    ...scaled.intermediate_step.recipe,
                    assumptions: choices.intermediate,
                  },
                }
              : scaled.intermediate_step,
        }
      }),
    }
  })
  const error = $derived(target_mass_error ?? planning_error)
  $effect(() => {
    plan = computed_plan
  })
  $effect(() => {
    const request = {
      entries,
      target,
      conditions,
      precursors,
      max_precursors,
      two_step,
      scoring: weights,
      max_routes,
      keep_route_ids: untrack(() => shortlist_ids),
    }
    if (!entries.length || !target) {
      worker_plan = null
      planning = false
      progress = null
      planning_error = null
      return
    }
    const controller = new AbortController()
    active_controller = controller
    if (planned_entries !== entries || planned_target !== target) worker_plan = null
    planned_entries = entries
    planned_target = target
    planning = true
    progress = { stage: `preparing`, current: 0, total: 1 }
    planning_error = null
    void plan_synthesis_async(request, {
      signal: controller.signal,
      on_progress: (update) => {
        if (!controller.signal.aborted) progress = update
      },
    })
      .then((result) => {
        if (controller.signal.aborted) return
        worker_plan = result
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          planning_error = err instanceof Error ? err.message : String(err)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          planning = false
          progress = null
        }
      })
    return () => controller.abort()
  })
  onDestroy(() => {
    active_controller?.abort()
    plan_synthesis_async.release()
  })
  const routes = $derived(computed_plan?.routes ?? [])
  $effect(() => {
    const current_routes = routes
    const ids = shortlist_ids
    if (map_entries !== entries || map_target !== target) map_routes = []
    map_entries = entries
    map_target = target
    // Preserve reaction definitions when changing conditions removes an uphill route from results.
    map_routes = untrack(() =>
      ids.flatMap(
        (id) =>
          current_routes.find((route) => route.id === id) ??
          map_routes.find((route) => route.id === id) ??
          [],
      ),
    )
  })
  $effect(() => {
    if (computed_plan && computed_plan.target.id !== shortlist_target) {
      if (shortlist_target || !shortlist_ids.length)
        shortlist_ids = routes.slice(0, 2).map(({ id }) => id)
      shortlist_target = computed_plan.target.id
    }
  })
  const hull_entries = $derived.by((): PhaseData[] => {
    if (!hull_open || !worker_plan) return []
    const originals = new Map(entries.map((entry) => [entry.entry_id, entry]))
    return worker_plan.phases.map((phase) => ({
      ...originals.get(phase.id),
      entry_id: phase.id,
      composition: phase.composition,
      reduced_formula: phase.formula,
      energy: phase.energy_per_atom * phase.n_atoms_per_fu,
      energy_per_atom: phase.energy_per_atom,
      e_form_per_atom: phase.energy_per_atom,
      exclude_from_hull: false,
      e_above_hull: undefined,
      is_stable: undefined,
      temperatures: undefined,
      free_energies: undefined,
    }))
  })
  const selected_route = $derived<SynthesisRoute | null>(
    routes.find((route) => route.id === selected_route_id) ?? routes[0] ?? null,
  )
  $effect(() => {
    if (!planning && selected_route && selected_route.id !== selected_route_id)
      selected_route_id = selected_route.id
  })

  // Temperature slider commits on release so the plan isn't recomputed on every pixel
  let temperature_draft = $state(0)
  $effect(() => {
    temperature_draft = conditions.temperature ?? 0
  })
  const toggle_gas = (gas: GasSpecies): void => {
    const current = conditions.open_species ?? []
    conditions = {
      ...conditions,
      open_species: current.includes(gas)
        ? current.filter((item) => item !== gas)
        : [...current, gas],
    }
  }
  const set_pressure = (gas: GasSpecies, value: number): void => {
    conditions = {
      ...conditions,
      partial_pressures: { ...conditions.partial_pressures, [gas]: value },
    }
  }

  // Hull highlights: the selected route's precursors, target and competitors
  const n_elements = $derived(computed_plan?.elements.length ?? 0)
  const highlighted_entries = $derived(
    selected_route
      ? [
          ...selected_route.reaction.reactants.map(({ phase }) => phase.id),
          selected_route.reaction.products[0].phase.id,
          ...selected_route.selectivity.competitors.slice(0, 5).map((comp) => comp.phase.id),
        ].filter((id) => !id.startsWith(`gas:`) && !id.startsWith(`ref:`))
      : [],
  )

  let atmosphere_open = $state(false)
  let options_open = $state(false)
  const atmosphere_summary = $derived.by(() => {
    const gases = conditions.open_species ?? []
    if (gases.length === 0) return `closed`
    return gases
      .map((gas) => {
        const pressure = conditions.partial_pressures?.[gas] ?? DEFAULT_GAS_PRESSURES[gas]
        return `${sanitize_formula(gas)} ${format_num(pressure, `.2~`)} bar`
      })
      .join(`, `)
  })
  const progress_text = $derived.by(() => {
    if (!progress) return `Planning synthesis routes…`
    const stage = progress.stage.replaceAll(`_`, ` `)
    return progress.total > 1 ? `${stage}: ${progress.current}/${progress.total}` : `${stage}…`
  })

  const score_tooltip = $derived(
    Object.entries(selected_route?.score_breakdown ?? {})
      .map(([key, value]) => `${key}: ${format_num(value, `.2~f`)}`)
      .join(`\n`),
  )
  const metrics = $derived.by((): [string, string][] => {
    if (!selected_route) return []
    const { reaction, selectivity, thermodynamics, score } = selected_route
    return [
      [
        `ΔE`,
        `${format_mev(reaction.energy_per_atom)} (${format_num(reaction.energy_per_fu, `.2f`)} eV/fu)`,
      ],
      [`Driving force`, `${format_mev(reaction.driving_force)} of mixture`],
      [`Inverse hull`, format_mev(selectivity.inverse_hull_energy)],
      [`Selectivity margin`, format_mev(selectivity.selectivity_margin)],
      [`Net gas exchange`, thermodynamics.atmosphere],
      ...(thermodynamics.onset_temperature
        ? [[`Favorable above`, `${thermodynamics.onset_temperature} K`] as [string, string]]
        : []),
      [`Score`, format_num(score, `.2f`)],
    ]
  })

  const copied = create_flash<`text` | `json` | null>(null, 1500)
  async function copy(kind: `text` | `json`): Promise<void> {
    if (!computed_plan) return
    const content =
      kind === `text`
        ? format_plan_text(computed_plan, 10)
        : JSON.stringify(computed_plan, null, 2)
    await navigator.clipboard.writeText(content)
    copied.show(kind)
  }
</script>

<div {...rest} class={[`synthesis-planner`, rest.class]}>
  {#if show_controls}
    <section class="controls">
      <label>
        Target
        <select bind:value={target}>
          {#if explicit_target}
            <option value={target}>{explicit_target.formula} ({explicit_target.id})</option>
          {/if}
          {#each target_options as phase (phase.id)}
            <option value={phase.formula}>{phase.formula}</option>
          {/each}
        </select>
      </label>
      <label title="Firing temperature; only gas chemical potentials change with T">
        T = {temperature_draft} K
        <input
          type="range"
          min="0"
          max="2000"
          step="25"
          bind:value={temperature_draft}
          onchange={() => (conditions = { ...conditions, temperature: temperature_draft })}
        />
      </label>
      <ToolbarMenu
        bind:open={atmosphere_open}
        label="Gases the reaction may release or take up, with partial pressures in bar"
        button_class="menu-toggle"
        menu_class="planner-menu"
      >
        {#snippet button()}
          <span>Atmosphere: {@html atmosphere_summary} ▾</span>
        {/snippet}
        {#each GAS_SPECIES as gas (gas)}
          {@const open = conditions.open_species?.includes(gas) ?? false}
          <label class="menu-row">
            <input type="checkbox" checked={open} onchange={() => toggle_gas(gas)} />
            <span class="formula">{@html sanitize_formula(gas)}</span>
            {#if open}
              <input
                type="number"
                min="1e-12"
                step="any"
                value={conditions.partial_pressures?.[gas] ?? DEFAULT_GAS_PRESSURES[gas]}
                onchange={(event) => set_pressure(gas, Number(event.currentTarget.value))}
                title="{gas} partial pressure (bar)"
              /> bar
            {/if}
          </label>
        {/each}
      </ToolbarMenu>
      <ToolbarMenu
        bind:open={options_open}
        label="Precursor pool and search options"
        button_class="menu-toggle"
        menu_class="planner-menu"
      >
        {#snippet button()}
          <span>Options ▾</span>
        {/snippet}
        <label class="menu-row" title="Largest precursor set per firing">
          Max precursors
          <input type="number" min="1" max="4" bind:value={max_precursors} />
        </label>
        <label class="menu-row" title="Also search routes via an intermediate phase">
          <input type="checkbox" bind:checked={two_step} /> Two-step routes
        </label>
        <label class="menu-row" title="Only commercial precursors from the built-in library">
          <input
            type="checkbox"
            checked={precursors.only_common ??
              computed_plan?.precursor_pool.every((phase) => phase.common_name) ??
              true}
            onchange={(event) =>
              (precursors = { ...precursors, only_common: event.currentTarget.checked })}
          /> Common precursors only
        </label>
        <label
          class="menu-row"
          title="Max 0 K hull distance for a phase to count as a precursor (eV/atom)"
        >
          <span>Max E<sub>hull</sub></span>
          <input
            type="number"
            min="0"
            max="0.5"
            step="0.01"
            value={precursors.max_e_above_hull ?? 0.03}
            onchange={(event) =>
              (precursors = {
                ...precursors,
                max_e_above_hull: Number(event.currentTarget.value),
              })}
          /> eV/atom
        </label>
      </ToolbarMenu>
      <span class="copy">
        <button
          type="button"
          onclick={() => copy(`text`)}
          disabled={!computed_plan}
          title="Copy the agent-style text summary"
        >
          {copied.value === `text` ? `Copied` : `Copy summary`}
        </button>
        <button
          type="button"
          onclick={() => copy(`json`)}
          disabled={!computed_plan}
          title="Copy the full plan as JSON"
        >
          {copied.value === `json` ? `Copied` : `Copy JSON`}
        </button>
      </span>
    </section>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if planning}
    <p class="progress" role="status">{progress_text}</p>
  {/if}
  {#if computed_plan && !error}
    <p class="summary">
      <strong>{@html sanitize_formula(computed_plan.target.formula)}</strong>
      in {computed_plan.chemical_system} at {computed_plan.conditions.temperature} K
      {#if computed_plan.target_stability.is_stable}(on the hull){:else}
        <span class="warn">
          ({format_mev(computed_plan.target_stability.e_above_hull)} above hull → {computed_plan.target_stability.decomposition
            .map(({ phase }) => phase.formula)
            .join(` + `)})
        </span>
      {/if}:
      {plural(routes.length, `route`)} from {computed_plan.n_candidates} precursor sets, pool of
      {computed_plan.precursor_pool.length}
      ({computed_plan.precursor_pool.map((phase) => phase.formula).join(`, `)}).
    </p>
    {#each computed_plan.warnings as warning (warning)}
      <p class="warn">{warning}</p>
    {/each}

    <div class="main">
      <RouteComparison {routes} bind:shortlist_ids bind:selected_route_id />
      {#if show_opportunity_map}
        <OpportunityMap
          {entries}
          target={computed_plan.target.id}
          routes={map_routes}
          conditions={{ ...computed_plan.conditions, gas_provider: conditions.gas_provider }}
          selected_route_id={selected_route_id ?? undefined}
          onconditionschange={(next_conditions, route_id) => {
            planning = true
            conditions = next_conditions
            if (route_id) selected_route_id = route_id
          }}
        />
      {/if}
      <details class="all-routes">
        <summary>Browse all {routes.length} ranked routes</summary>
        <RouteTable {routes} bind:selected_route_id />
      </details>
      {#if selected_route}
        {@const { reaction, selectivity } = selected_route}
        {@const route_id = selected_route.id}
        <section class="detail">
          <h3 class="equation">
            {#if selected_route.intermediate_step}
              <small
                >step 1: {@html format_equation_html(
                  selected_route.intermediate_step.reaction.equation,
                )}</small
              ><br />
            {/if}
            {@html format_equation_html(reaction.equation)}
          </h3>
          <div class="detail-left">
            <dl class="metrics">
              {#each metrics as [label, value] (label)}
                <dt>{label}</dt>
                <dd
                  class:bad={label === `Selectivity margin` &&
                    selectivity.selectivity_margin > 0}
                  title={label === `Score` ? score_tooltip : undefined}
                >
                  {value}
                </dd>
              {/each}
            </dl>
            <ul class="rationale">
              {#each selected_route.rationale as reason (reason)}<li>{reason}</li>{/each}
            </ul>
            <ReactionSlicePlot route={selected_route} />
            {#if show_hull && n_elements >= 2 && n_elements <= 4}
              <details bind:open={hull_open} class="system-hull">
                <summary>Explore the chemical-system hull</summary>
                {#if hull_open}
                  <ConvexHull
                    entries={hull_entries}
                    {highlighted_entries}
                    show_unstable_labels={false}
                    style="flex: 1; min-height: 520px"
                  />
                {/if}
              </details>
            {/if}
          </div>
          <div class="detail-right">
            {#if selectivity.interfaces.length > 1}
              <h4>Pairwise interfaces</h4>
              <ul class="interfaces">
                {#each selectivity.interfaces as iface (iface.precursors
                  .map((phase) => phase.id)
                  .join(`|`))}
                  <li class:good={iface.forms_target} class:bad={!iface.forms_target}>
                    {@html sanitize_formula(iface.precursors[0].formula)} | {@html sanitize_formula(
                      iface.precursors[1].formula,
                    )}
                    → {@html sanitize_formula(
                      iface.first_product?.phase.formula ?? `no reaction`,
                    )}
                    {#if iface.first_product}({format_mev(
                        iface.first_product.driving_force,
                      )}){/if}
                  </li>
                {/each}
              </ul>
            {/if}

            <RecipeCard
              route={selected_route}
              bind:target_mass_g
              onassumptionschange={(step, assumptions) => {
                experiment_choices[route_id] = {
                  ...experiment_choices[route_id],
                  [step]: assumptions,
                }
              }}
            />
          </div>
        </section>
      {/if}
    </div>
  {:else if !planning && !error}
    <p class="empty">Provide thermodynamic entries and a target to plan a synthesis.</p>
  {/if}
</div>

<style>
  .synthesis-planner {
    display: grid;
    gap: 0.8em;
    min-width: 0;
    max-width: 100%;
  }
  .synthesis-planner > * {
    min-width: 0;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6em 1.2em;
    align-items: center;
  }
  .controls label {
    display: flex;
    align-items: center;
    gap: 0.4em;
  }
  .controls input[type='number'] {
    width: 5em;
  }
  .controls input[type='range'] {
    width: 10em;
  }
  .controls :global(.menu-toggle) {
    padding: 0.25em 0.6em;
    border: 1px solid var(--border-color, #ddd);
    border-radius: var(--border-radius, 4px);
    background: var(--btn-bg, transparent);
    color: inherit;
  }
  .controls :global(.planner-menu) {
    padding: 2px 4px;
    gap: 0;
    left: 0;
    right: auto;
  }
  .menu-row {
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 1px 4px;
    line-height: 1.3;
    white-space: nowrap;
  }
  .menu-row .formula {
    min-width: 2.6em;
  }
  .menu-row input[type='number'] {
    width: 5.5em;
    margin-left: auto;
    padding: 0 3px;
  }
  .copy {
    margin-left: auto;
    display: flex;
    gap: 0.4em;
  }
  .summary,
  .warn,
  .error,
  .progress,
  .empty {
    margin: 0;
  }
  .warn {
    color: var(--warning-color, #b8860b);
    font-size: 0.9em;
  }
  .error {
    color: var(--error-color, #d62728);
  }
  .main {
    display: grid;
    gap: 1em;
  }
  summary {
    cursor: pointer;
    font-weight: 500;
    padding: 0.4em 0;
  }
  .system-hull[open] {
    display: flex;
    flex-direction: column;
    flex: 1;
  }
  .detail {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.7em 1.5em;
    padding: 0.8em;
    border: 1px solid var(--border-color, #ddd);
    border-radius: var(--border-radius, 4px);
    background: var(--surface-bg, transparent);
  }
  .detail .equation {
    grid-column: 1 / -1;
  }
  .detail-left,
  .detail-right {
    display: grid;
    gap: 0.7em;
    align-content: start;
    min-width: 0;
  }
  .detail-left {
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 900px) {
    .detail {
      grid-template-columns: 1fr;
    }
  }
  .detail h3,
  .detail h4 {
    margin: 0;
  }
  .detail h3 small {
    font-weight: normal;
    color: var(--text-color-muted, #888);
  }
  .metrics {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.15em 0.8em;
    margin: 0;
    font-size: 0.9em;
  }
  .metrics dt {
    color: var(--text-color-muted, #888);
  }
  .metrics dd {
    margin: 0;
  }
  .good {
    color: var(--success-color, #2e8b57);
  }
  .bad {
    color: var(--error-color, #d62728);
  }
  .rationale,
  .interfaces {
    margin: 0;
    padding-left: 1.2em;
    font-size: 0.9em;
  }
</style>

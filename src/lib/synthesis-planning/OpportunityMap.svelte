<script lang="ts">
  import type { GasSpecies, PhaseData } from '$lib/convex-hull/types'
  import { DEFAULT_GAS_PRESSURES } from '$lib/convex-hull/types'
  import { format_num } from '$lib/labels'
  import { compute_opportunity_map_async } from './opportunity-map-async.svelte'
  import type { OpportunityCell, OpportunityRequest } from './opportunity-map'
  import type { SynthesisConditions, SynthesisRoute } from './types'

  interface Props {
    entries: PhaseData[]
    target: string
    routes: SynthesisRoute[]
    conditions: SynthesisConditions
    selected_route_id?: string
    onconditionschange: (conditions: SynthesisConditions, route_id?: string) => void
  }
  let { entries, target, routes, conditions, selected_route_id, onconditionschange }: Props =
    $props()
  let gas = $state<GasSpecies>(`O2`)
  let metric = $state(`selectivity`)
  let min_temperature = $state(300)
  let max_temperature = $state(1900)
  let min_log_pressure = $state(-8)
  let max_log_pressure = $state(0)
  let cells = $state<OpportunityCell[]>([])
  let pending = $state(false)
  let error = $state(``)
  const palette = [`#4e79a7`, `#e69f00`, `#9c6ade`, `#009e73`]
  const scan_gas = $derived(
    conditions.open_species?.includes(gas) ? gas : conditions.open_species?.[0],
  )
  const active_route_id = $derived(
    routes.some(({ id }) => id === selected_route_id) ? selected_route_id : routes[0]?.id,
  )
  const range = (min: number, max: number) =>
    Array.from({ length: 9 }, (_, idx) => min + ((max - min) * idx) / 8)
  const temperatures = $derived(range(min_temperature, max_temperature))
  const log_pressures = $derived(range(min_log_pressure, max_log_pressure))
  const custom_provider = $derived(conditions.gas_provider)
  const fixed_pressures = $derived(
    Object.fromEntries(
      Object.entries(conditions.partial_pressures ?? {}).filter(
        ([species]) => species !== scan_gas,
      ),
    ),
  )
  // The scanned temperature and gas pressure are intentionally excluded: picking a cell
  // updates the planner without invalidating the sweep that produced it.
  const request_json = $derived(
    JSON.stringify({
      target,
      routes: routes.map(({ id, reaction }) => ({
        id,
        precursor_ids: reaction.reactants
          .filter(({ phase }) => !phase.is_gas)
          .map(({ phase }) => phase.id),
      })),
      conditions: {
        open_species: conditions.open_species,
        partial_pressures: fixed_pressures,
      },
      gas: scan_gas,
      temperatures,
      log_pressures,
    }),
  )
  $effect(() => {
    // Pass phase data unchanged: JSON would turn invalid NaN energies into usable nulls.
    const request: OpportunityRequest = { ...JSON.parse(request_json), entries }
    if (!request.gas || !request.routes.length || custom_provider) {
      cells = []
      pending = false
      return
    }
    const controller = new AbortController()
    cells = []
    error = ``
    pending = true
    if (min_temperature >= max_temperature || min_log_pressure >= max_log_pressure) {
      error = `Each minimum must be smaller than its maximum.`
      pending = false
      return
    }
    compute_opportunity_map_async(request, undefined, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) cells = result
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          error = cause instanceof Error ? cause.message : String(cause)
      })
      .finally(() => {
        if (!controller.signal.aborted) pending = false
      })
    return () => {
      controller.abort()
      compute_opportunity_map_async.release()
    }
  })
  const best_route = (cell: OpportunityCell) =>
    cell.routes
      .filter(({ driving_force }) => driving_force < 0)
      .reduce<OpportunityCell[`routes`][number] | undefined>(
        (best, route) =>
          !best || route.selectivity_margin < best.selectivity_margin ? route : best,
        undefined,
      )
  const shown_route = (cell: OpportunityCell) =>
    metric === `preferred`
      ? best_route(cell)
      : cell.routes.find(({ id }) => id === active_route_id)
  const cell_color = (cell: OpportunityCell): string => {
    if (metric === `stability`)
      return `hsl(215 65% ${92 - 55 * Math.min(1, cell.e_above_hull / 0.3)}%)`
    const route = shown_route(cell)
    if (!route) return `#aaa`
    if (metric === `preferred`) return palette[routes.findIndex(({ id }) => id === route.id)]
    const margin = route.selectivity_margin
    return `hsl(${margin < 0 ? 150 : 8} 55% ${90 - 40 * Math.min(1, Math.abs(margin) / 0.3)}%)`
  }
  const cell_label = (cell: OpportunityCell): string => {
    const route = shown_route(cell)
    return `${format_num(cell.temperature, `.0f`)} K; ${scan_gas} ${format_num(cell.pressure, `.2g`)} bar; target ${format_num(cell.e_above_hull * 1000, `.1f`)} meV/atom above hull${route ? `; route ${routes.findIndex(({ id }) => id === route.id) + 1}: driving force ${format_num(route.driving_force * 1000, `.1f`)}, selectivity ${format_num(route.selectivity_margin * 1000, `.1f`)} meV/atom` : `; no downhill shortlisted route`}`
  }
  function apply_cell(cell: OpportunityCell) {
    if (!scan_gas) return
    onconditionschange(
      {
        ...conditions,
        temperature: cell.temperature,
        partial_pressures: { ...conditions.partial_pressures, [scan_gas]: cell.pressure },
      },
      metric === `preferred` ? best_route(cell)?.id : undefined,
    )
  }
</script>

<section class="opportunity-map" aria-label="Temperature–atmosphere opportunity map">
  <h3>Temperature–atmosphere opportunity map</h3>
  <p>
    Explore a fixed shortlist, then select a cell to apply its conditions everywhere. Solids
    retain their 0 K energies; only gas chemical potentials vary with temperature and partial
    pressure. This is a thermodynamic screening map, not a kinetic synthesis window.
  </p>
  {#if !scan_gas}
    <p>Enable an open gas to explore temperature and atmosphere dependence.</p>
  {:else if conditions.gas_provider}
    <p>
      The interactive sweep requires the built-in gas model; custom providers can be evaluated
      with the analysis API.
    </p>
  {:else if !routes.length}
    <p>Shortlist at least one route to explore its operating conditions.</p>
  {:else}
    <div class="map-controls">
      <label
        >Gas <select
          value={scan_gas}
          onchange={(event) => (gas = event.currentTarget.value as GasSpecies)}
          >{#each conditions.open_species ?? [] as species}<option value={species}
              >{species}</option
            >{/each}</select
        ></label
      >
      <label
        >Color <select
          value={metric}
          onchange={(event) => (metric = event.currentTarget.value)}
          ><option value="selectivity">Shortlist route selectivity</option><option
            value="preferred">Best shortlist selectivity</option
          ><option value="stability">Target above hull</option></select
        ></label
      >
      <label
        >Temperature (K) <input
          aria-label="Minimum map temperature"
          type="number"
          min="0"
          max="2000"
          bind:value={min_temperature}
        />–<input
          aria-label="Maximum map temperature"
          type="number"
          min="0"
          max="2000"
          bind:value={max_temperature}
        /></label
      >
      <label
        >log₁₀ pressure (bar) <input
          aria-label="Minimum map log pressure"
          type="number"
          min="-12"
          max="2"
          bind:value={min_log_pressure}
        />–<input
          aria-label="Maximum map log pressure"
          type="number"
          min="-12"
          max="2"
          bind:value={max_log_pressure}
        /></label
      >
    </div>
    {#if routes.some(({ kind }) => kind === `two_step`)}<p>
        Two-step routes show the final firing; first-stage feasibility must be checked
        separately.
      </p>{/if}
    {#if pending}<p role="status">Computing 81 conditions…</p>{:else if error}<p role="alert">
        {error}
      </p>{:else if cells.length}
      <div class="map-grid" aria-label="Conditions grid">
        <span>K / log₁₀ bar</span>
        {#each log_pressures as pressure}<span>{format_num(pressure, `.1~f`)}</span>{/each}
        {#each temperatures as temperature, row_idx}
          <span>{format_num(temperature, `.0f`)}</span>
          {#each cells.slice(row_idx * 9, (row_idx + 1) * 9) as cell}
            <button
              type="button"
              style:background={cell_color(cell)}
              title={cell_label(cell)}
              aria-label={cell_label(cell)}
              aria-pressed={cell.temperature === conditions.temperature &&
                Math.abs(
                  Math.log10(
                    conditions.partial_pressures?.[scan_gas] ??
                      DEFAULT_GAS_PRESSURES[scan_gas],
                  ) - Math.log10(cell.pressure),
                ) < 1e-9}
              onclick={() => apply_cell(cell)}
              >{metric === `preferred`
                ? best_route(cell)
                  ? routes.findIndex(({ id }) => id === best_route(cell)?.id) + 1
                  : `–`
                : ``}</button
            >
          {/each}
        {/each}
      </div>
      {#if metric === `selectivity`}<p>
          Selectivity shown for: {routes.find(({ id }) => id === active_route_id)?.reaction
            .equation}
        </p>{/if}
      <p>
        {metric === `stability`
          ? `Darker blue = further above the hull (0–300 meV/atom).`
          : metric === `preferred`
            ? `Numbers identify shortlisted routes with the lowest selectivity margin among downhill reactions; this is not the weighted overall ranking. Gray = none downhill.`
            : `Green = target favored over competing products; red = competitors favored or reaction uphill. Darker = larger margin (0–300 meV/atom).`}
      </p>
      {#if metric === `preferred`}<ol>
          {#each routes as route, idx}<li style:border-color={palette[idx]}>
              {route.reaction.equation}
            </li>{/each}
        </ol>{/if}
      <p>
        Hover or focus a cell for energies. Selectivity compares energy per reacting-mixture
        atom; hull distance is per target atom. Other gas pressures remain fixed.
      </p>
    {/if}
  {/if}
</section>

<style>
  .opportunity-map {
    padding: 1em;
    border: 1px solid var(--border-color, #8885);
    border-radius: 6px;
  }
  h3 {
    margin: 0;
  }
  p {
    font-size: 0.85em;
  }
  .map-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7em;
    align-items: center;
    label {
      display: flex;
      align-items: center;
      gap: 0.3em;
    }
    input {
      width: 5.5em;
    }
  }
  .map-grid {
    display: grid;
    grid-template-columns: 6em repeat(9, minmax(0, 1fr));
    gap: 3px;
    margin-top: 1em;
    span {
      font-size: 0.75em;
      align-self: center;
      text-align: center;
    }
    button {
      min-width: 0;
      min-height: 28px;
      border: 1px solid #8885;
      border-radius: 2px;
      color: #111;
      padding: 0;
      &:hover,
      &:focus-visible,
      &[aria-pressed='true'] {
        outline: 2px solid var(--text-color, #222);
        outline-offset: 1px;
        z-index: 1;
      }
    }
  }
  li {
    border-left: 1em solid;
    padding-left: 0.5em;
    font-size: 0.85em;
  }
</style>

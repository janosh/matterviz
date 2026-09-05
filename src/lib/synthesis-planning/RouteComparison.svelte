<script lang="ts">
  import { format_num } from '$lib/labels'
  import { format_equation_html } from './format'
  import { assess_practicality } from './scoring'
  import type { ScoreWeights, SynthesisRoute, SynthesisStep } from './types'

  let {
    routes,
    shortlist_ids = $bindable([]),
    selected_route_id = $bindable(null),
  }: {
    routes: SynthesisRoute[]
    shortlist_ids?: string[]
    selected_route_id?: string | null
  } = $props()

  const hint_id = $props.id()
  const compared = $derived(
    routes.filter((route) => shortlist_ids.includes(route.id)).slice(0, 4),
  )
  const leader = $derived(
    compared.reduce<SynthesisRoute | undefined>(
      (best, route) => (!best || route.score > best.score ? route : best),
      undefined,
    ),
  )
  const score_terms: Record<keyof ScoreWeights, string> = {
    selectivity: `Selectivity`,
    inverse_hull: `Inverse hull`,
    driving_force: `Driving force`,
    competition: `Competition`,
    practicality: `Practicality`,
    simplicity: `Simplicity`,
  }
  const number = (value: number) => format_num(value, `.2~f`)
  const step_adjustment = (route: SynthesisRoute) =>
    route.score - Object.values(route.score_breakdown).reduce((sum, value) => sum + value, 0)
  const step_metrics = [
    {
      label: `Reaction energy (meV/atom of product)`,
      hint: `At the modeled conditions`,
      value: ({ reaction }: SynthesisStep) =>
        `${number(reaction.energy_per_atom * 1000)} — ${reaction.energy_per_atom < 0 ? `downhill` : reaction.energy_per_atom > 0 ? `uphill` : `thermoneutral`}`,
    },
    {
      label: `Selectivity margin (meV/atom of mixture)`,
      hint: `Lower favors the target`,
      value: (step: SynthesisStep) => number(step.selectivity.selectivity_margin * 1000),
    },
    {
      label: `More favorable competitors`,
      value: (step: SynthesisStep) =>
        [
          String(step.selectivity.n_more_favorable),
          ...step.selectivity.competitors
            .filter((competitor) => competitor.more_favorable_than_target)
            .map(
              ({ phase, driving_force }) =>
                `${phase.formula}: ${number(driving_force * 1000)} meV/atom of mixture`,
            ),
        ].join(`\n`),
    },
    {
      label: `Handling`,
      value: (step: SynthesisStep | SynthesisRoute) =>
        (`practicality` in step
          ? step.practicality
          : assess_practicality(step.reaction)
        ).notes.join(`\n`) || `No handling notes in the available data.`,
    },
    {
      label: `Net gas exchange`,
      value: (step: SynthesisStep) => step.thermodynamics.atmosphere,
    },
    {
      label: `Model conditions`,
      value: ({ thermodynamics }: SynthesisStep) =>
        [
          `${thermodynamics.temperature} K`,
          ...Object.entries(thermodynamics.partial_pressures).map(
            ([gas, pressure]) => `${gas}: ${pressure} bar`,
          ),
        ].join(`; `),
    },
    {
      label: `Thermodynamic onset`,
      hint: `Not a firing temperature`,
      value: (step: SynthesisStep) =>
        step.thermodynamics.onset_temperature === null
          ? `No onset available`
          : `${step.thermodynamics.onset_temperature} K`,
    },
  ]
  const metrics: { label: string; hint?: string; value: (route: SynthesisRoute) => string }[] =
    [
      ...step_metrics.map(({ value, ...metric }) => ({
        ...metric,
        value: (route: SynthesisRoute) =>
          route.intermediate_step
            ? `Step 1: ${value(route.intermediate_step)}\nStep 2: ${value(route)}`
            : value(route),
      })),
      {
        label: `Firings`,
        value: (route: SynthesisRoute) =>
          route.kind === `two_step`
            ? `2 — score contributions below describe the final reaction; the adjustment accounts for the first firing.`
            : `1`,
      },
      ...Object.entries(score_terms).map(([key, label]) => ({
        label: `${label} contribution`,
        value: (route: SynthesisRoute) =>
          format_num(route.score_breakdown[key as keyof ScoreWeights], `+.2f`),
      })),
      {
        label: `Multi-step adjustment`,
        hint: `Bottleneck step and additional-firing weight`,
        value: (route: SynthesisRoute) => format_num(step_adjustment(route), `+.2f`),
      },
    ]
  const tradeoff = (route: SynthesisRoute): string => {
    if (!leader || route.score === leader.score)
      return compared.filter((candidate) => candidate.score === route.score).length > 1
        ? `Tied for highest score in this shortlist under the current weights.`
        : `Highest score in this shortlist under the current weights.`
    const differences = Object.entries(score_terms)
      .map(([key, label]) => ({
        label,
        value:
          route.score_breakdown[key as keyof ScoreWeights] -
          leader.score_breakdown[key as keyof ScoreWeights],
      }))
      .concat({
        label: `Multi-step adjustment`,
        value: step_adjustment(route) - step_adjustment(leader),
      })
      .toSorted((left, right) => right.value - left.value)
    const advantage = differences.find(({ value }) => value > 0)
    const disadvantage = differences.toReversed().find(({ value }) => value < 0)
    return [
      `Compared with the shortlist leader:`,
      advantage
        ? `${advantage.label} adds ${number(advantage.value)} to the weighted score.`
        : `No scoring term improves.`,
      disadvantage
        ? `${disadvantage.label} subtracts ${number(-disadvantage.value)} from the weighted score.`
        : `No scoring term loses points.`,
    ].join(` `)
  }
</script>

<section class="route-comparison" aria-label="Route comparison">
  <header>
    <h3>Compare routes ({compared.length}/4)</h3>
    <label>
      Add route
      <select
        aria-describedby={hint_id}
        disabled={compared.length === 4}
        onchange={(event) => {
          const route_id = event.currentTarget.value
          if (route_id && compared.length < 4)
            shortlist_ids = [...compared.map(({ id }) => id), route_id]
          event.currentTarget.value = ``
        }}
      >
        <option value="">Choose a route…</option>
        {#each routes as route, idx (route.id)}
          {#if !compared.some(({ id }) => id === route.id)}
            <option value={route.id}
              >#{idx + 1}: {route.intermediate_step
                ? `${route.intermediate_step.reaction.equation}; then `
                : ``}{route.reaction.equation}</option
            >
          {/if}
        {/each}
      </select>
    </label>
  </header>
  <p id={hint_id}>
    {compared.length === 4
      ? `Remove a route to add another.`
      : `Shortlist 2–4 routes to compare their tradeoffs.`} Viewing a route keeps your shortlist.
  </p>
  {#if compared.length}
    <div class="comparison-scroll">
      <table>
        <thead
          ><tr
            ><th scope="col">Criterion</th>
            {#each compared as route (route.id)}
              <th scope="col">
                {#if route.intermediate_step}
                  <div>
                    Step 1: {@html format_equation_html(
                      route.intermediate_step.reaction.equation,
                    )}
                  </div>
                {/if}
                <div>
                  {route.intermediate_step ? `Step 2: ` : ``}{@html format_equation_html(
                    route.reaction.equation,
                  )}
                </div>
                <button
                  type="button"
                  aria-pressed={selected_route_id === route.id}
                  onclick={() => (selected_route_id = route.id)}>View route</button
                >
                <button
                  type="button"
                  aria-label={`Remove ${route.reaction.equation} from comparison`}
                  onclick={() =>
                    (shortlist_ids = compared
                      .filter(({ id }) => id !== route.id)
                      .map(({ id }) => id))}>Remove</button
                >
              </th>
            {/each}
          </tr></thead
        >
        <tbody>
          <tr
            ><th scope="row">Weighted score</th>{#each compared as route (route.id)}<td
                ><strong>{number(route.score)}</strong>
                <p>{tradeoff(route)}</p></td
              >{/each}</tr
          >
          {#each metrics as { label, hint, value } (label)}
            <tr
              ><th scope="row"
                >{label}{#if hint}<small>{hint}</small>{/if}</th
              >
              {#each compared as route (route.id)}<td>{value(route)}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p>
      Contributions already include the current weights; higher is better. Scores rank
      thermodynamic and handling criteria, not experimental success probabilities.
    </p>
  {/if}
</section>

<style>
  .route-comparison {
    min-width: 0;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 0.5em;
    padding: 1em;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1em;
    flex-wrap: wrap;
  }
  h3,
  p {
    margin: 0.4em 0;
  }
  label {
    display: flex;
    gap: 0.5em;
    align-items: center;
    min-width: 0;
  }
  select {
    min-width: 0;
    max-width: 30em;
  }
  .comparison-scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9em;
  }
  th,
  td {
    text-align: left;
    vertical-align: top;
    white-space: pre-line;
    padding: 0.6em;
    border-bottom: 1px solid var(--border-color, #ddd);
    min-width: 12em;
  }
  th:first-child {
    min-width: 10em;
  }
  th button {
    margin-top: 0.5em;
  }
  th button[aria-pressed='true'] {
    outline: 2px solid var(--accent-color, #4a9eff);
  }
  small {
    display: block;
    font-weight: normal;
  }
</style>

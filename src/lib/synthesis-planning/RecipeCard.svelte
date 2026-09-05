<script lang="ts">
  import { create_flash } from '$lib/effects.svelte'
  import { format_num } from '$lib/labels'
  import { sanitize_formula } from '$lib/sanitize'
  import { format_equation_html } from './format'
  import {
    build_route_recipe,
    format_recipe_text,
    RECIPE_ASSUMPTION_LABELS,
    RECIPE_ROLE_LABELS,
  } from './recipe'
  import type { RecipeAssumptions, SynthesisRoute } from './types'

  let {
    route,
    target_mass_g = $bindable(1),
    onassumptionschange,
    ...rest
  }: {
    route: SynthesisRoute
    target_mass_g?: number
    onassumptionschange: (
      step: `final` | `intermediate`,
      assumptions: RecipeAssumptions,
    ) => void
    [key: string]: unknown
  } = $props()

  const scaled_route = $derived(
    target_mass_g === route.recipe.target_mass_g
      ? route
      : { ...route, ...build_route_recipe(route, target_mass_g) },
  )
  const steps = $derived(
    scaled_route.intermediate_step
      ? [scaled_route.intermediate_step, scaled_route]
      : [scaled_route],
  )
  const assumption_fields = Object.entries(RECIPE_ASSUMPTION_LABELS) as [
    keyof RecipeAssumptions,
    string,
  ][]
  const copied = create_flash(false, 1500)
  let mass_error = $state(false)
  async function copy_recipe(): Promise<void> {
    await navigator.clipboard.writeText(format_recipe_text(scaled_route))
    copied.show(true)
  }
</script>

<section {...rest} class={[`recipe-card`, rest.class]}>
  <header>
    <h4>Experiment card</h4>
    <label>
      for
      <input
        aria-label="Target mass (g)"
        type="number"
        min="0"
        step="any"
        value={target_mass_g}
        oninput={(event) => {
          const mass = event.currentTarget.valueAsNumber
          mass_error = !Number.isFinite(mass) || mass <= 0
          if (!mass_error) target_mass_g = mass
        }}
      />
      <span>g {@html sanitize_formula(route.reaction.products[0].phase.formula)}</span>
    </label>
    <button type="button" onclick={copy_recipe} title="Copy experiment card as text">
      {copied.value ? `Copied` : `Copy`}
    </button>
  </header>
  {#if mass_error}<p role="alert">Enter a target mass greater than zero.</p>{/if}
  <p>
    Calculated quantities assume pure precursors and complete conversion. Thermodynamic
    favorability does not establish a firing schedule.
  </p>
  {#each steps as step, step_idx (step.reaction.equation)}
    <section class="recipe-step">
      <h5>Step {step_idx + 1}: {@html format_equation_html(step.reaction.equation)}</h5>
      {#if steps.length > 1 && step_idx === 0}
        <p>
          Prepare {format_num(step.recipe.target_mass_g, `.4~f`)} g of intermediate for step 2. Confirm
          its identity and recovered mass before transfer.
        </p>
      {/if}
      <div style="overflow-x: auto">
        <table>
          <thead>
            <tr
              ><th>Role</th><th>Phase</th><th>Mass (g)</th><th>Amount (mmol)</th><th>wt%</th
              ></tr
            >
          </thead>
          <tbody>
            {#each step.recipe.items as item (`${item.role}-${item.phase.id}`)}
              <tr class={item.role}>
                <td>{RECIPE_ROLE_LABELS[item.role]}</td>
                <td>
                  {@html sanitize_formula(item.phase.formula)}
                  {#if item.phase.common_name}<small>{item.phase.common_name}</small>{/if}
                </td>
                <td>{format_num(item.mass_g, `.4~f`)}</td>
                <td>{format_num(item.moles * 1000, `.3~f`)}</td>
                <td
                  >{item.mass_fraction === undefined
                    ? ``
                    : format_num(100 * item.mass_fraction, `.1f`)}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p>
        Model conditions: {step.thermodynamics.temperature} K; {Object.entries(
          step.thermodynamics.partial_pressures,
        )
          .map(([gas, pressure]) => `${gas}: ${pressure} bar`)
          .join(`, `) || `closed system`}.
      </p>
      <p>
        Modeled ΔG: <strong>{format_num(step.reaction.energy_per_atom, `.3~f`)} eV/atom</strong
        >. Gas exchange: {step.thermodynamics.atmosphere}.
      </p>
      <p>
        Thermodynamic onset: {step.thermodynamics.onset_temperature === null
          ? `not identified`
          : `${step.thermodynamics.onset_temperature} K`}. Competing phases: {step.selectivity.competitors
          .slice(0, 3)
          .map(({ phase }) => phase.formula)
          .join(`, `) || `none identified`}.
      </p>
      <details>
        <summary>Library guidance — unreferenced, verify before use</summary>
        {#if step.recipe.guidance.length}
          <ul>
            {#each step.recipe.guidance as note (note)}<li>{note}</li>{/each}
          </ul>
        {:else}<p>No precursor guidance available.</p>{/if}
        <p>
          No referenced experimental protocol is supplied. Record your source or rationale
          below.
        </p>
      </details>
      <fieldset>
        <legend>Experimental assumptions — your choices, not model predictions</legend>
        {#each assumption_fields as [field, label] (field)}
          <label
            >{label}
            <input
              value={step.recipe.assumptions[field]}
              placeholder="Undecided"
              oninput={(event) =>
                onassumptionschange(
                  step_idx === 0 && route.intermediate_step ? `intermediate` : `final`,
                  { ...step.recipe.assumptions, [field]: event.currentTarget.value },
                )}
            />
          </label>
        {/each}
      </fieldset>
      <strong>Checkpoints</strong>
      <ul>
        {#each step.recipe.checkpoints as checkpoint (checkpoint)}<li>{checkpoint}</li>{/each}
      </ul>
    </section>
  {/each}
</section>

<style>
  .recipe-card,
  .recipe-step {
    display: grid;
    gap: 0.6em;
    min-width: 0;
  }
  .recipe-card {
    font-size: 0.9em;
  }
  .recipe-step + .recipe-step {
    border-top: 1px solid var(--border-color, #ddd);
    padding-top: 1em;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.8em;
    flex-wrap: wrap;
  }
  h4,
  h5,
  p {
    margin: 0;
  }
  header label {
    display: flex;
    align-items: center;
    gap: 0.3em;
  }
  header input {
    width: 5em;
  }
  header button {
    margin-left: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 0.2em 0.5em;
    border-bottom: 1px solid var(--border-color, #ddd);
  }
  td:nth-child(n + 3),
  th:nth-child(n + 3) {
    text-align: right;
  }
  td small {
    display: block;
    color: var(--text-color-muted, #888);
  }
  tr.target {
    font-weight: 600;
  }
  tr.byproduct,
  tr.atmosphere {
    color: var(--text-color-muted, #888);
  }
  summary {
    cursor: pointer;
  }
  fieldset {
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10em, 1fr));
    gap: 0.6em;
    border: 1px solid var(--border-color, #ddd);
  }
  fieldset label {
    display: grid;
    gap: 0.2em;
  }
  fieldset input {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  ul {
    margin: 0;
    padding-left: 1.4em;
  }
</style>

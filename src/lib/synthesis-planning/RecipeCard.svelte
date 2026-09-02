<script lang="ts">
  // Bench quantities and heating schedule for one route, scaled to a target mass
  import { create_flash } from '$lib/effects.svelte'
  import { format_num } from '$lib/labels'
  import { sanitize_formula } from '$lib/sanitize'
  import { build_recipe } from './recipe'
  import type { SynthesisRoute } from './types'

  let {
    route,
    target_mass_g = $bindable(1),
    ...rest
  }: {
    route: SynthesisRoute
    target_mass_g?: number
    [key: string]: unknown
  } = $props()

  const recipe = $derived(
    target_mass_g === route.recipe.target_mass_g
      ? route.recipe
      : build_recipe(route.reaction, route.thermodynamics, target_mass_g),
  )
  const ROLE_LABELS = {
    precursor: `Precursor`,
    atmosphere: `From atmosphere`,
    target: `Target`,
    byproduct: `Byproduct`,
  }
  const window_text = $derived.by(() => {
    const { min_K, max_K } = recipe.temperature_window
    if (min_K === null && max_K === null) return `no guidance from the data`
    if (min_K !== null && max_K !== null)
      return `${min_K}–${max_K} K (${min_K - 273}–${max_K - 273} °C)`
    if (min_K !== null) return `≥ ${min_K} K (${min_K - 273} °C)`
    return `≤ ${max_K} K`
  })

  const copied = create_flash(false, 1500)
  async function copy_recipe(): Promise<void> {
    const lines = [
      route.reaction.equation,
      ...recipe.items.map(
        (item) =>
          `${ROLE_LABELS[item.role]}: ${item.phase.formula} ${format_num(item.mass_g, `.4~f`)} g (${format_num(item.moles * 1000, `.3~f`)} mmol)`,
      ),
      `Temperature window: ${window_text}`,
      ...recipe.temperature_window.basis.map((basis) => `  - ${basis}`),
      ...recipe.procedure.map((step, idx) => `${idx + 1}. ${step}`),
    ]
    await navigator.clipboard.writeText(lines.join(`\n`))
    copied.show(true)
  }
</script>

<section {...rest} class={[`recipe-card`, rest.class]}>
  <header>
    <h4>Recipe</h4>
    <label>
      for
      <input type="number" min="0.001" step="0.1" bind:value={target_mass_g} />
      <span>g {@html sanitize_formula(route.reaction.products[0].phase.formula)}</span>
    </label>
    <button type="button" onclick={copy_recipe} title="Copy recipe as text">
      {copied.value ? `Copied` : `Copy`}
    </button>
  </header>
  <table>
    <thead>
      <tr><th>Role</th><th>Phase</th><th>Mass (g)</th><th>Amount (mmol)</th><th>wt%</th></tr>
    </thead>
    <tbody>
      {#each recipe.items as item (`${item.role}-${item.phase.id}`)}
        <tr class={item.role}>
          <td>{ROLE_LABELS[item.role]}</td>
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
  {#if Math.abs(recipe.mass_loss_percent) > 0.05}
    <p>
      Expected mass {recipe.mass_loss_percent > 0 ? `loss` : `gain`} on firing:
      <strong>{format_num(Math.abs(recipe.mass_loss_percent), `.1f`)}%</strong>
    </p>
  {/if}
  <div>
    Temperature window: <strong>{window_text}</strong>
    {#if recipe.temperature_window.basis.length}
      <details>
        <summary>basis</summary>
        <ul>
          {#each recipe.temperature_window.basis as basis (basis)}<li>{basis}</li>{/each}
        </ul>
      </details>
    {/if}
  </div>
  <ol>
    {#each recipe.procedure as step (step)}<li>{step}</li>{/each}
  </ol>
</section>

<style>
  .recipe-card {
    display: grid;
    gap: 0.6em;
    font-size: 0.9em;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.8em;
    flex-wrap: wrap;
  }
  header h4 {
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
  p {
    margin: 0;
  }
  details {
    display: inline;
  }
  details summary {
    display: inline;
    cursor: pointer;
    color: var(--text-color-muted, #888);
  }
  ul,
  ol {
    margin: 0;
    padding-left: 1.4em;
  }
  ol li {
    margin-bottom: 0.25em;
  }
</style>

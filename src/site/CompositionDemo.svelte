<script lang="ts">
  import { sanitize_html } from '#lib/sanitize.js'
  import { to_error } from 'svelte-widgets/utils'
  import type { CompositionType } from 'matterviz'
  import {
    Composition,
    get_electro_neg_formula,
    parse_composition,
  } from 'matterviz/composition'

  let { show_grid = false, show_interactive = false } = $props()

  let formula = $state(``)
  // Typing passes through invalid input (`{Fe: 2`, `Xy`): keep the last valid charts, show why
  let parsed = $state<{ composition: CompositionType; error: string | null }>({
    composition: {},
    error: null,
  })
  const set_formula = (value: string): void => {
    formula = value
    try {
      parsed = { composition: parse_composition(value), error: null }
    } catch (error) {
      parsed.error = to_error(error).message
    }
  }
  set_formula(`LiFePO4`)

  const compositions: [string, string | CompositionType][] = [
    [`Uranium`, `U`],
    [`Water`, `H2O`],
    [`Iron Oxide`, `Fe2O3`],
    [`Table Salt`, `NaCl`],
    [`Quartz`, `SiO2`],
    [`Limestone`, `CaCO3`],
    [`Ammonia`, `NH3`],
    [`Methane`, `CH4`],
    [`Ethanol`, `C2H6O`],
    [`Glucose`, `C6H12O6`],
    [`Caffeine`, `C8H10N4O2`],
    [`Steel`, { Fe: 98, C: 2 }],
    [`Bronze`, { Cu: 88, Sn: 12 }],
    [`Stainless Steel`, { Fe: 70, Cr: 18, Ni: 8, Mn: 2, Si: 1, C: 1 }],
    [`Lithium Phosphate`, { Li: 1, P: 1, O: 4 }],
    [`Aluminum Oxide`, `Al2O3`],
    [`Silicon Carbide`, `SiC`],
    [`Cantor Alloy`, { Co: 20, Cr: 20, Fe: 20, Mn: 20, Ni: 20 }],
    [`Refractory HEA`, { Ti: 20, Zr: 20, Nb: 20, Mo: 20, V: 20 }],
  ]
  const interactive_charts = [
    [`Pie Chart`, `pie`, `Vesta`, {}],
    [`Bubble Chart`, `bubble`, `Jmol`, {}],
    [`Donut Chart`, `pie`, `Pastel`, { inner_radius: 40 }],
    [`Percentages`, `pie`, `Muted`, { show_percentages: true }],
  ] as const
</script>

{#if show_grid}
  {#each [`pie`, `bubble`, `bar`] as const as mode (mode)}
    <h2 id="as-{mode}-chart">As {mode} chart</h2>
    <div class="composition-grid bleed-1400">
      {#each compositions as [name, composition] (name)}
        <div class="composition-card">
          <h3>{name}</h3>
          <div class="card-formula">
            {@html sanitize_html(get_electro_neg_formula(composition))}
          </div>
          <Composition {composition} {mode} />
        </div>
      {/each}
    </div>
  {/each}
{/if}

{#if show_interactive}
  <label>
    Enter a chemical formula (e.g. Fe2O3, H2O, ...) or a composition object (e.g. {`{Li: 1, Fe: 1, P: 1, O: 4}`}):
    <input
      bind:value={() => formula, set_formula}
      placeholder={`e.g. Fe2O3, H2O, or {Fe: 2, O: 3}`}
      aria-invalid={Boolean(parsed.error)}
      style="display: block; margin: 1em auto; padding: 2pt 6pt; font-size: 1.2em"
    />
  </label>
  {#if parsed.error}
    <p role="alert" style="text-align: center; color: var(--error-color)">{parsed.error}</p>
  {/if}
  <div class="composition-grid">
    {#each interactive_charts as [name, mode, color_scheme, props] (name)}
      <div class="composition-card">
        <h3>{name}</h3>
        <Composition composition={parsed.composition} {mode} {color_scheme} {...props} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .composition-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
    gap: 0.75rem;
    margin-block: 1rem;
    text-align: center;
    text-wrap: balance;
  }
  .composition-card {
    display: grid;
    grid-template-rows: subgrid;
    grid-row: span 3;
    align-items: center;
    gap: 1pt;
    padding: 4pt 9pt;
    background: var(--surface-bg);
    border-radius: var(--border-radius);
  }
  .composition-card h3 {
    margin: 0 0 4pt;
  }
  .card-formula {
    font-size: 0.75rem;
    color: var(--text-color-muted);
    font-weight: 450;
  }
</style>

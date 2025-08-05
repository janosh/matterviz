<script lang="ts">
  import type { CompositionType } from 'matterviz'
  import {
    Composition,
    get_electro_neg_formula,
    parse_composition,
  } from 'matterviz/composition'

  let { show_grid = false, show_interactive = false } = $props()

  let formula = $state(`LiFePO4`)
  let parsed_composition: CompositionType = $derived(parse_composition(formula))

  const compositions = [ // Example compositions
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
    [`Steel`, JSON.stringify({ Fe: 98, C: 2 })],
    [`Bronze`, JSON.stringify({ Cu: 88, Sn: 12 })],
    [
      `Stainless Steel`,
      JSON.stringify({ Fe: 70, Cr: 18, Ni: 8, Mn: 2, Si: 1, C: 1 }),
    ],
    [`Lithium Phosphate`, JSON.stringify({ Li: 1, P: 1, O: 4 })],
    [`Aluminum Oxide`, `Al2O3`],
    [`Silicon Carbide`, `SiC`],
    [`Cantor Alloy`, JSON.stringify({ Co: 20, Cr: 20, Fe: 20, Mn: 20, Ni: 20 })],
    [`Refractory HEA`, JSON.stringify({ Ti: 20, Zr: 20, Nb: 20, Mo: 20, V: 20 })],
  ]

  // Function to get formula display text
  function get_formula_display(formula: string): string {
    const parsed = formula.startsWith(`{`) ? JSON.parse(formula) : formula
    return get_electro_neg_formula(parsed)
  }
</script>

{#if show_grid}
  {#each [`pie`, `bubble`, `bar`] as const as mode (mode)}
    <h2>As {mode} chart</h2>
    <div class="composition-grid">
      {#each compositions as [name, formula] (formula)}
        <div class="composition-card">
          <h4>{name}</h4>
          <div class="card-formula">{@html get_formula_display(formula)}</div>
          <Composition composition={formula} {mode} />
        </div>
      {/each}
    </div>
  {/each}
{/if}

{#if show_interactive}
  <label>
    Enter a chemical formula (e.g. Fe2O3, H2O, ...) or a composition object (e.g. {
      `{Li: 1, Fe: 1, P: 1, O: 4}`
    }):
    <input
      bind:value={formula}
      placeholder={`e.g., Fe2O3, H2O, or {Fe: 2, O: 3}`}
      style="display: block; margin: 1em auto; padding: 2pt 6pt; font-size: 1.2em"
    />
  </label>
  <div class="composition-grid">
    {#each [
      [`Pie Chart`, `pie`, `Vesta`],
      [`Bubble Chart`, `bubble`, `Jmol`],
      [`Donut Chart`, `pie`, `Pastel`, { inner_radius: 40 }],
      [`Percentages`, `pie`, `Muted`],
    ] as const as
      [name, mode, color_scheme, props = {}]
      (name)
    }
      <div class="composition-card">
        <h4>{name}</h4>
        <Composition composition={parsed_composition} {mode} {color_scheme} {...props} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .composition-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
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
    background: var(--card-bg, rgba(255, 255, 255, 0.05));
    border-radius: var(--border-radius, 4px);
    border: 1px solid var(--card-border, rgba(255, 255, 255, 0.1));
  }
  .composition-card h4 {
    margin: 0 0 4pt;
  }
  .card-formula {
    font-size: 0.75rem;
    color: var(--text-color-muted);
    font-weight: lighter;
  }
</style>

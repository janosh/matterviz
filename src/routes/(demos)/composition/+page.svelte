<script lang="ts">
  import type { Composition as CompositionType } from '$lib'
  import {
    BubbleChart,
    Composition,
    get_electro_neg_formula,
    PieChart,
  } from '$lib/composition'

  let input = $state(`LiFePO4`)

  // Example compositions to showcase in grid
  const compositions = [
    { name: `Water`, input: `H2O` },
    { name: `Iron Oxide`, input: `Fe2O3` },
    { name: `Salt`, input: `NaCl` },
    { name: `Quartz`, input: `SiO2` },
    { name: `Limestone`, input: `CaCO3` },
    { name: `Ammonia`, input: `NH3` },
    { name: `Methane`, input: `CH4` },
    { name: `Ethanol`, input: `C2H6O` },
    { name: `Glucose`, input: `C6H12O6` },
    { name: `Caffeine`, input: `C8H10N4O2` },
    { name: `Steel`, input: JSON.stringify({ Fe: 98, C: 2 }) },
    { name: `Bronze`, input: JSON.stringify({ Cu: 88, Sn: 12 }) },
    {
      name: `Stainless Steel`,
      input: JSON.stringify({ Fe: 70, Cr: 18, Ni: 8, Mn: 2, Si: 1, C: 1 }),
    },
    { name: `Lithium Phosphate`, input: JSON.stringify({ Li: 1, P: 1, O: 4 }) },
    { name: `Aluminum Oxide`, input: `Al2O3` },
    { name: `Silicon Carbide`, input: `SiC` },
    {
      name: `Cantor Alloy`,
      input: JSON.stringify({ Co: 20, Cr: 20, Fe: 20, Mn: 20, Ni: 20 }),
    },
    {
      name: `Refractory HEA`,
      input: JSON.stringify({ Ti: 20, Zr: 20, Nb: 20, Mo: 20, V: 20 }),
    },
  ]

  let parsed_composition: CompositionType = $state({})

  // Function to get formula display text
  function get_formula_display(input: string): string {
    try {
      if (input.startsWith(`{`)) {
        // It's a JSON object, parse it and convert to formula
        const composition = JSON.parse(input) as CompositionType
        return get_electro_neg_formula(composition)
      } else {
        // It's already a formula string, just return it formatted
        return get_electro_neg_formula(input)
      }
    } catch (error) {
      console.warn(`Could not parse composition input:`, error)
      return input // fallback to original input
    }
  }
</script>

<svelte:head>
  <title>Composition Visualization Demo</title>
</svelte:head>

<div class="demo-container">
  <h1>Chemical Composition Visualization</h1>
  <p>Interactive visualizations for chemical compositions using SVG charts.</p>

  <section class="grid-section">
    <h2>Composition Gallery</h2>

    {#each [`pie`, `bubble`, `bar`] as const as mode (mode)}
      <h3 style="margin: 1em 0 -1ex;">As {mode} chart</h3>
      <div class="compositions-grid">
        {#each compositions as comp (comp.name)}
          <div class="composition-card">
            <h4 class="card-title">{comp.name}</h4>
            <div class="card-formula">{@html get_formula_display(comp.input)}</div>
            <Composition input={comp.input} {mode} />
          </div>
        {/each}
      </div>
    {/each}
  </section>

  <section class="comparison-section">
    <h2>Different Chart Types</h2>
    <label>
      Try your own. Enter a chemical formula or composition object:
      <input
        type="text"
        bind:value={input}
        placeholder={`e.g., Fe2O3, H2O, or {Fe: 2, O: 3}`}
        class="formula-input"
      />
    </label>
    <div class="chart-types-grid">
      <div class="chart-demo">
        <h3>Pie Chart</h3>
        <Composition
          {input}
          composition={parsed_composition}
          size={150}
          color_scheme="Vesta"
          show_labels={true}
          show_amounts={true}
          on_composition_change={(comp: CompositionType) => (parsed_composition = comp)}
        />
      </div>

      <div class="chart-demo">
        <h3>Bubble Chart</h3>
        <BubbleChart
          composition={parsed_composition}
          size={150}
          color_scheme="Jmol"
          show_labels={true}
        />
      </div>

      <div class="chart-demo">
        <h3>Donut Chart</h3>
        <PieChart
          composition={parsed_composition}
          size={150}
          inner_radius={30}
          color_scheme="Pastel"
          show_labels={true}
          show_amounts={true}
        />
      </div>

      <div class="chart-demo">
        <h3>Percentages</h3>
        <PieChart
          composition={parsed_composition}
          size={150}
          color_scheme="Muted"
          show_labels={true}
          show_percentages={true}
          show_amounts={false}
        />
      </div>
    </div>
  </section>
</div>

<style>
  .demo-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2em;
    font-family: var(--font-system, system-ui);
  }
  .grid-section {
    margin: 2em 0;
  }
  .formula-input {
    padding: 2pt 5pt;
    font-size: 1em;
    border: none;
    border-radius: 4px;
  }
  .compositions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    grid-template-rows: auto auto 1fr;
    gap: 0.75rem;
    margin-top: 1rem;
  }
  .composition-card {
    display: grid;
    grid-template-rows: subgrid;
    grid-row: span 3;
    align-items: center;
    gap: 1pt;
    padding: 0.75rem;
    background: var(--card-bg, rgba(255, 255, 255, 0.05));
    border-radius: 8px;
    border: 1px solid var(--card-border, rgba(255, 255, 255, 0.1));
  }
  .card-title {
    text-align: center;
    margin: 0;
    word-wrap: break-word;
  }
  .card-formula {
    font-size: 0.75rem;
    color: var(--text-muted, #aaa);
    font-weight: lighter;
    text-align: center;
  }
  .comparison-section {
    margin: 2em 0;
    text-align: center;
  }
  .chart-types-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }
  .chart-demo {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--card-bg, rgba(255, 255, 255, 0.05));
    border-radius: 8px;
    border: 1px solid var(--card-border, rgba(255, 255, 255, 0.1));
  }
  p {
    color: var(--text-muted, #aaa);
    margin: 0.5rem 0;
  }
</style>

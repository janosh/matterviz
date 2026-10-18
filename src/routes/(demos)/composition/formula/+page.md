# Chemical Formula

Render chemical formulas with colored element symbols, subscripted amounts, superscripted oxidation states, and configurable element ordering.

All formula inputs go through one parser (`parse_formula`, `parse_formula_with_oxidation`, `parse_composition` in `matterviz/composition`). It accepts nested parentheses and brackets with multipliers (`K4[Fe(CN)6]`, `((CH3)3C)2O`), hydrates and adducts joined by `·`, `⋅` or `*` with a leading coefficient (`CuSO4·5H2O`), fractional amounts (`Li0.5Na0.5Cl`, `Fe.5`), charges as `^2+`, `^+2`, `[2-]` or a bare `^+`/`^-` placed before or after the count (`Fe^3+2O^2-3`), Unicode subscripts and superscripts (`Fe₂O₃`, `Fe³⁺`) and arbitrary whitespace. Anything else (lowercase symbols, unknown elements, unbalanced or empty parentheses, a bare `+` without `^` or `[]`) throws an error naming the offending token and its position. Mixed-valence formulas such as `Fe^2+Fe^3+2O4` keep one entry per (element, oxidation state) pair.

## Basic Usage

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'
</script>

<div class="demo-controls" style="font-size: 1.5em">
  <Formula formula="H2O" />
  <Formula formula="CO2" />
  <Formula formula="NaCl" />
  <Formula formula="Ca(OH)2" />
  <Formula formula="H2SO4" />
  <Formula formula="C6H12O6" />
</div>

<p>With oxidation states (use <code>^2+</code> or <code>[2+]</code> syntax):</p>

<div class="demo-controls" style="font-size: 1.5em">
  <Formula formula="Fe^2+O" />
  <Formula formula="Fe[3+]2O[2-]3" />
  <Formula formula="Na^+Cl^-" />
  <Formula formula="Ca^2+Cl^-2" />
  <Formula formula="SO4^2-" />
</div>
```

## Element Ordering & Color Schemes

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'

  let formula = $state(`C6H12O6N2Fe2`)
  let ordering = $state(`original`)
  let color_scheme = $state(`Vesta`)
</script>

<div class="demo-controls">
  <label>Formula: <input type="text" bind:value={formula} style="width: 250px" /></label>
  <label>
    Color Scheme:
    <select bind:value={color_scheme}>
      <option value="Vesta">Vesta</option>
      <option value="Jmol">Jmol</option>
      <option value="Alloy">Alloy</option>
      <option value="Pastel">Pastel</option>
      <option value="Muted">Muted</option>
      <option value="Dark Mode">Dark Mode</option>
    </select>
  </label>
</div>

<div class="demo-controls">
  <strong>Ordering:</strong>
  <label><input type="radio" bind:group={ordering} value="original" /> Original</label>
  <label><input type="radio" bind:group={ordering} value="alphabetical" /> Alphabetical</label>
  <label
    ><input type="radio" bind:group={ordering} value="electronegativity" />
    Electronegativity</label
  >
  <label><input type="radio" bind:group={ordering} value="hill" /> Hill Notation</label>
</div>

<div class="card">
  <Formula {formula} {ordering} {color_scheme} />
</div>

<style>
  .card {
    font-size: 2.5em;
    padding: 1em;
    background: var(--surface-bg);
    border-radius: 8px;
  }
</style>
```

## Interactive Click Handlers

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'

  let clicked_element = $state(null)
  let click_count = $state(0)

  function handle_click(element) {
    clicked_element = element
    click_count++
  }
</script>

<div class="demo-controls" style="font-size: 1.8em">
  <Formula formula="H2O" on_click={handle_click} />
  <Formula formula="Fe[3+]2O[2-]3" on_click={handle_click} />
  <Formula formula="Ca(OH)2" on_click={handle_click} />
  <Formula formula="H2SO4" on_click={handle_click} />
</div>

<div class="card">
  {#if clicked_element}
    <strong>Last clicked:</strong> {clicked_element} (Total: {click_count})
  {:else}
    <em>Click any element symbol above...</em>
  {/if}
</div>

<style>
  .card {
    padding: 1em;
    background: rgba(0, 150, 255, 0.1);
    border: 1px solid rgba(0, 150, 255, 0.3);
    border-radius: 8px;
  }
</style>
```

## Tooltip Positioning

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'

  let tooltip_side = $state(`bottom`)
  let tooltip_offset = $state(5)
</script>

<div class="demo-controls">
  <strong>Side:</strong>
  <label><input type="radio" bind:group={tooltip_side} value="top" /> Top</label>
  <label><input type="radio" bind:group={tooltip_side} value="bottom" /> Bottom</label>
  <label><input type="radio" bind:group={tooltip_side} value="left" /> Left</label>
  <label><input type="radio" bind:group={tooltip_side} value="right" /> Right</label>
  <label>
    <strong>Offset:</strong>
    <input type="range" bind:value={tooltip_offset} min="0" max="30" step="5" />
    {tooltip_offset}px
  </label>
</div>

<div class="card">
  <Formula formula="Fe[3+]2O[2-]3" {tooltip_side} {tooltip_offset} style="font-size: 2em" />
</div>

<style>
  .card {
    padding: 3em;
    background: var(--surface-bg);
    border-radius: 8px;
    text-align: center;
  }
</style>
```

## As Different HTML Elements

Use the `as` prop to render formulas as headings, inline text, etc.:

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'
</script>

<Formula as="h1" formula="H2O" style="margin: 0.5em 0" />
<Formula as="h2" formula="CO2" style="margin: 0.5em 0" />

<p style="font-size: 1.1em">
  Inline formulas work too:
  <Formula as="span" formula="NaCl" />
  and
  <Formula as="strong" formula="H2SO4" />
  in regular text.
</p>
```

## Structured Input & Amount Formatting

Use `OxiComposition` objects and customize number formatting:

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'

  const iron_oxide = {
    Fe: { amount: 2, oxidation_state: 3 },
    O: { amount: 3, oxidation_state: -2 },
  }

  let amount_format = $state(`.3~s`)
</script>

<div class="demo-controls" style="gap: 2em">
  <span>
    From object:
    <Formula formula={iron_oxide} ordering="alphabetical" style="font-size: 2em" />
  </span>
  <label>
    Amount Format:
    <select bind:value={amount_format}>
      <option value=".3~s">Compact (default)</option>
      <option value=".2f">2 decimals</option>
      <option value=".0f">Integer</option>
      <option value=".1f">1 decimal</option>
    </select>
    <Formula formula="H2.567O1.234C0.891" {amount_format} style="font-size: 1.5em" />
  </label>
</div>
```

## Real-World Compounds

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'

  const categories = {
    'Battery Materials': [
      { name: `LiFePO₄ (LFP)`, formula: `LiFePO4` },
      { name: `LiCoO₂ (LCO)`, formula: `LiCoO2` },
      { name: `NMC 111`, formula: `LiNi0.33Mn0.33Co0.33O2` },
    ],
    Minerals: [
      { name: `Quartz`, formula: `SiO2` },
      { name: `Magnetite`, formula: `Fe3O4` },
      { name: `Calcite`, formula: `CaCO3` },
    ],
    Organic: [
      { name: `Glucose`, formula: `C6H12O6` },
      { name: `Caffeine`, formula: `C8H10N4O2` },
      { name: `Ethanol`, formula: `C2H6O` },
    ],
  }
</script>

{#each Object.entries(categories) as [category, compounds] (category)}
  <h3 style="margin: 1.5em 0 0.5em; font-size: 1.1em">{category}</h3>
  <div class="grid">
    {#each compounds as { name, formula } (formula)}
      <div>
        <Formula
          {formula}
          ordering={category === 'Organic' ? 'hill' : 'electronegativity'}
          style="font-size: 1.3em"
        />
        <small>{name}</small>
      </div>
    {/each}
  </div>
{/each}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1em;
    > div {
      display: flex;
      flex-direction: column;
      gap: 0.4em;
      padding: 0.8em;
      border: 1px solid var(--border-color);
      border-radius: 6px;
    }
    small {
      color: var(--text-color-muted);
    }
  }
</style>
```

## Interactive Builder

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'

  let next_id = 2
  let elements = $state([
    { id: 0, symbol: `Fe`, amount: 2, oxidation: 3 },
    { id: 1, symbol: `O`, amount: 3, oxidation: -2 },
  ])

  const formula_obj = $derived.by(() => {
    const obj = {}
    for (const { symbol, amount, oxidation } of elements) {
      obj[symbol] = { amount, oxidation_state: oxidation }
    }
    return obj
  })
</script>

<button
  onclick={() =>
    (elements = [...elements, { id: next_id++, symbol: `H`, amount: 1, oxidation: 0 }])}
>
  Add Element
</button>

{#each elements as element (element.id)}
  <div class="row">
    <input type="text" bind:value={element.symbol} style="width: 50px" placeholder="El" />
    <input
      type="number"
      bind:value={element.amount}
      step="0.1"
      style="width: 70px"
      placeholder="Amt"
    />
    <input type="number" bind:value={element.oxidation} style="width: 60px" placeholder="Ox" />
    <button
      onclick={() => (elements = elements.filter((element_2) => element_2.id !== element.id))}
    >
      ×
    </button>
  </div>
{/each}

<div class="card">
  <Formula formula={formula_obj} />
</div>

<style>
  .row {
    display: flex;
    gap: 0.8em;
    align-items: center;
    margin-top: 0.5em;
  }
  .card {
    padding: 1.5em;
    background: var(--surface-bg);
    border-radius: 8px;
    font-size: 2.5em;
    margin-top: 0.4em;
  }
</style>
```

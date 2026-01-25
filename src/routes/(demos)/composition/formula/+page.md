# Chemical Formula

Render chemical formulas with colored element symbols, subscripted amounts, superscripted oxidation states, and configurable element ordering.

## Basic Usage

Simple formulas with subscripted amounts and oxidation states:

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'
</script>

<div style="display: flex; gap: 2em; flex-wrap: wrap; font-size: 1.5em">
  <Formula formula="H2O" />
  <Formula formula="CO2" />
  <Formula formula="NaCl" />
  <Formula formula="Ca(OH)2" />
  <Formula formula="H2SO4" />
  <Formula formula="C6H12O6" />
</div>

<div style="margin-top: 1.5em; font-size: 1.4em">
  With oxidation states (use <code>^2+</code> or <code>[2+]</code> syntax):
</div>

<div style="display: flex; gap: 2em; flex-wrap: wrap; font-size: 1.5em; margin-top: 1em">
  <Formula formula="Fe^2+O" />
  <Formula formula="Fe[3+]2O[2-]3" />
  <Formula formula="Na^+Cl^-" />
  <Formula formula="Ca^2+Cl^-2" />
  <Formula formula="SO4^2-" />
</div>
```

## Element Ordering & Color Schemes

Control element ordering and apply different color schemes:

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'

  let formula = $state(`C6H12O6N2Fe2`)
  let ordering = $state(`original`)
  let color_scheme = $state(`Vesta`)
</script>

<label>
  Formula:
  <input type="text" bind:value={formula} style="width: 250px; margin-left: 1em" />
</label>

<div style="display: flex; gap: 1em; flex-wrap: wrap; margin: 1em 0">
  <strong>Ordering:</strong>
  <label><input type="radio" bind:group={ordering} value="original" /> Original</label>
  <label><input type="radio" bind:group={ordering} value="alphabetical" />
    Alphabetical</label>
  <label><input type="radio" bind:group={ordering} value="electronegativity" />
    Electronegativity</label>
  <label><input type="radio" bind:group={ordering} value="hill" /> Hill Notation</label>
</div>

<div style="display: flex; gap: 1em; align-items: center; margin-bottom: 1em">
  <strong>Color Scheme:</strong>
  <select bind:value={color_scheme}>
    <option value="Vesta">Vesta</option>
    <option value="Jmol">Jmol</option>
    <option value="Alloy">Alloy</option>
    <option value="Pastel">Pastel</option>
    <option value="Muted">Muted</option>
    <option value="Dark Mode">Dark Mode</option>
  </select>
</div>

<div
  style="font-size: 2.5em; padding: 1em; background: rgba(255, 255, 255, 0.03); border-radius: 8px"
>
  <Formula {formula} {ordering} {color_scheme} />
</div>
```

## Interactive Click Handlers

Click element symbols to trigger custom actions:

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

<div
  style="display: flex; gap: 2em; flex-wrap: wrap; font-size: 1.8em; margin-bottom: 1em"
>
  <Formula formula="H2O" on_click={handle_click} />
  <Formula formula="Fe[3+]2O[2-]3" on_click={handle_click} />
  <Formula formula="Ca(OH)2" on_click={handle_click} />
  <Formula formula="H2SO4" on_click={handle_click} />
</div>

<div
  style="padding: 1em; background: rgba(0, 150, 255, 0.1); border-radius: 8px; border: 1px solid rgba(0, 150, 255, 0.3)"
>
  {#if clicked_element}
    <strong>Last clicked:</strong> {clicked_element} (Total: {click_count})
  {:else}
    <em>Click any element symbol above...</em>
  {/if}
</div>
```

## Tooltip Positioning

Control tooltip placement and distance from elements:

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'

  let tooltip_side = $state(`bottom`)
  let tooltip_offset = $state(5)
</script>

<div style="display: flex; gap: 1.5em; align-items: center; margin-bottom: 1em">
  <div>
    <strong>Side:</strong>
    <label><input type="radio" bind:group={tooltip_side} value="top" /> Top</label>
    <label><input type="radio" bind:group={tooltip_side} value="bottom" /> Bottom</label>
    <label><input type="radio" bind:group={tooltip_side} value="left" /> Left</label>
    <label><input type="radio" bind:group={tooltip_side} value="right" /> Right</label>
  </div>

  <div style="display: flex; gap: 0.5em; align-items: center">
    <strong>Offset:</strong>
    <input
      type="range"
      bind:value={tooltip_offset}
      min="0"
      max="30"
      step="5"
      style="width: 100px"
    />
    <span>{tooltip_offset}px</span>
  </div>
</div>

<div
  style="padding: 3em; background: rgba(255, 255, 255, 0.03); border-radius: 8px; text-align: center"
>
  <div style="font-size: 2em; display: inline-block">
    <Formula formula="Fe[3+]2O[2-]3" {tooltip_side} {tooltip_offset} />
  </div>
</div>
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

<div style="display: flex; gap: 2em; align-items: center">
  <div>
    <div style="font-size: 0.9em; color: var(--text-color-muted); margin-bottom: 0.3em">
      From object:
    </div>
    <div style="font-size: 2em">
      <Formula formula={iron_oxide} ordering="alphabetical" />
    </div>
  </div>

  <div style="flex: 1">
    <label>
      Amount Format:
      <select bind:value={amount_format} style="margin-left: 0.5em">
        <option value=".3~s">Compact (default)</option>
        <option value=".2f">2 decimals</option>
        <option value=".0f">Integer</option>
        <option value=".1f">1 decimal</option>
      </select>
    </label>
    <div style="font-size: 1.5em; margin-top: 0.5em">
      <Formula formula="H2.567O1.234C0.891" {amount_format} />
    </div>
  </div>
</div>
```

## Real-World Compounds

Battery materials, minerals, and organic compounds:

```svelte example
<script lang="ts">
  import { Formula } from 'matterviz'

  const categories = {
    'Battery Materials': [
      { name: `LiFePO₄ (LFP)`, formula: `LiFePO4` },
      { name: `LiCoO₂ (LCO)`, formula: `LiCoO2` },
      { name: `NMC 111`, formula: `LiNi0.33Mn0.33Co0.33O2` },
    ],
    'Minerals': [
      { name: `Quartz`, formula: `SiO2` },
      { name: `Magnetite`, formula: `Fe3O4` },
      { name: `Calcite`, formula: `CaCO3` },
    ],
    'Organic': [
      { name: `Glucose`, formula: `C6H12O6` },
      { name: `Caffeine`, formula: `C8H10N4O2` },
      { name: `Ethanol`, formula: `C2H6O` },
    ],
  }
</script>

{#each Object.entries(categories) as [category, compounds] (category)}
  <h3 style="margin: 1.5em 0 0.5em; font-size: 1.1em">{category}</h3>
  <div
    style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1em"
  >
    {#each compounds as { name, formula } (formula)}
      <div
        style="padding: 0.8em; border: 1px solid var(--border-color, #ddd); border-radius: 6px"
      >
        <div style="font-size: 1.3em; margin-bottom: 0.4em">
          <Formula
            {formula}
            ordering={category === 'Organic' ? 'hill' : 'electronegativity'}
          />
        </div>
        <div style="font-size: 0.85em; color: var(--text-color-muted)">{name}</div>
      </div>
    {/each}
  </div>
{/each}
```

## Interactive Builder

Build formulas dynamically with live preview:

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

<div style="margin-bottom: 1em">
  <button
    onclick={() => (elements = [...elements, {
      id: next_id++,
      symbol: `H`,
      amount: 1,
      oxidation: 0,
    }])}
  >
    Add Element
  </button>
</div>

{#each elements as element (element.id)}
  <div style="display: flex; gap: 0.8em; align-items: center; margin-bottom: 0.5em">
    <input type="text" bind:value={element.symbol} style="width: 50px" placeholder="El" />
    <input
      type="number"
      bind:value={element.amount}
      step="0.1"
      style="width: 70px"
      placeholder="Amt"
    />
    <input
      type="number"
      bind:value={element.oxidation}
      style="width: 60px"
      placeholder="Ox"
    />
    <button onclick={() => (elements = elements.filter((el) => el.id !== element.id))}>
      ×
    </button>
  </div>
{/each}

<div
  style="padding: 1.5em; background: rgba(255, 255, 255, 0.05); border-radius: 8px; font-size: 2.5em; margin-top: 1em"
>
  <Formula formula={formula_obj} />
</div>
```

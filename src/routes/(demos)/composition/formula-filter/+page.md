# FormulaFilter

An interactive search filter for chemical formulas. The search mode is automatically inferred from input format:

- **Comma-separated** (Li,Fe,O) → has these elements
- **Dash-separated** (Li-Fe-O) → chemical system (only these elements)
- **Formula** (LiFePO4) → exact match

## Interactive Demo

```svelte example
<script lang="ts">
  import {
    Formula,
    FormulaFilter,
    get_alphabetical_formula,
  } from 'matterviz/composition'

  // Seed history so the dropdown is visible on focus
  const history_key = `formula-filter-demo`
  if (typeof localStorage !== `undefined` && !localStorage.getItem(history_key)) {
    localStorage.setItem(
      history_key,
      JSON.stringify([`Fe,O`, `Li-Fe-O`, `Fe2O3`, `Co,Ni`]),
    )
  }

  let value = $state(`Li,Fe`)
  let mode = $state(`elements`)

  // Generate compounds programmatically
  const els = `Li Na K Mg Ca Fe Co Ni Cu Zn Mn Ti Al`.split(` `)
  const materials = []
  // Unaries (elemental forms)
  for (const el of els) materials.push({ [el]: 1 }, { [el]: 2 })
  // Binaries (oxides and sulfides)
  for (const el of els) {
    for (const amt of [1, 2]) {
      materials.push({ [el]: amt, O: 2 }, { [el]: amt, O: 3 }, { [el]: amt, S: 2 })
    }
  }
  // Ternaries (mixed metal oxides)
  for (let idx = 0; idx < els.length - 1; idx++) {
    for (let jdx = idx + 1; jdx < els.length; jdx++) {
      materials.push({ [els[idx]]: 1, [els[jdx]]: 1, O: 3 })
    }
  }

  // Use library function for proper formula formatting (handles count=1 correctly)
  const to_str = (comp) => get_alphabetical_formula(comp, true, ``)

  const filtered = $derived.by(() => {
    if (!value) return materials.slice(0, 60)
    if (mode === `exact`) {
      // Exact formula match - compare stringified compositions
      const target = value.toLowerCase()
      return materials.filter((comp) => to_str(comp).toLowerCase() === target)
    }
    const query_els = value.split(/[,\-]/).map((s) => s.trim()).filter(Boolean)
    if (mode === `chemsys`) {
      // Chemical system: only these elements, no others
      return materials.filter((comp) => {
        const comp_els = Object.keys(comp)
        return query_els.every((el) => el in comp) &&
          comp_els.every((el) => query_els.includes(el))
      })
    }
    // Contains elements mode
    return materials.filter((comp) => query_els.every((el) => el in comp))
  })
</script>

<FormulaFilter bind:value bind:search_mode={mode} {history_key} />

<div style="margin-top: 1em">
  <strong style="font-size: 0.85em; opacity: 0.7">{filtered.length} of {
      materials.length
    }:</strong>
  <div style="display: flex; flex-wrap: wrap; gap: 6pt; margin-top: 6pt">
    {#each filtered.slice(0, 40) as comp (to_str(comp))}
      <span
        style="padding: 3pt 6pt; background: rgba(77, 182, 255, 0.1); border-radius: 4px"
      >
        <Formula formula={to_str(comp)} />
      </span>
    {:else}
      <span style="opacity: 0.5">No matches</span>
    {/each}
    {#if filtered.length > 40}<span style="opacity: 0.5"
      >+{filtered.length - 40} more</span>{/if}
  </div>
</div>
```

Try these examples:

- `Li,Fe` → materials containing Li and Fe
- `Li-Fe-O` → materials with only Li, Fe, O (chemical system)
- `LiFeO3` → exact formula match
- `Li` → unary element match

## Include/Exclude Filters

```svelte example
<script lang="ts">
  import {
    Formula,
    FormulaFilter,
    get_alphabetical_formula,
  } from 'matterviz/composition'

  let include = $state(`Li`), exclude = $state(``)

  const els = [`Li`, `Na`, `Mg`, `Ca`, `Fe`, `Co`, `Ni`, `Cu`, `Zn`, `Mn`, `Ti`, `Al`]
  const materials = []
  for (const el of els) {
    materials.push({ [el]: 1, O: 2 }, { [el]: 2, O: 3 }, { [el]: 1, S: 2 })
  }
  for (let idx = 0; idx < 8; idx++) {
    for (let jdx = idx + 1; jdx < 10; jdx++) {
      materials.push({ [els[idx]]: 1, [els[jdx]]: 1, O: 3 })
    }
  }

  const to_str = (comp) => get_alphabetical_formula(comp, true, ``)
  const results = $derived.by(() => {
    let mats = materials
    if (include) {
      mats = mats.filter((c) => include.split(`,`).every((el) => el.trim() in c))
    }
    if (exclude) {
      mats = mats.filter((c) => !exclude.split(`,`).some((el) => el.trim() in c))
    }
    return mats
  })
</script>

<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1em; margin-bottom: 1em">
  <FormulaFilter bind:value={include} history_key="formula-filter-include" />
  <FormulaFilter
    bind:value={exclude}
    history_key="formula-filter-exclude"
    style="--filter-bg: rgba(239, 68, 68, 0.05)"
  />
</div>

<div style="display: flex; flex-wrap: wrap; gap: 6pt">
  {#each results.slice(0, 30) as comp (to_str(comp))}
    <span
      style="padding: 3pt 6pt; background: rgba(16, 185, 129, 0.15); border-radius: 4px"
    >
      <Formula formula={to_str(comp)} />
    </span>
  {:else}<span style="opacity: 0.5">No matches</span>{/each}
  {#if results.length > 30}<span style="opacity: 0.5"
    >+{results.length - 30} more</span>{/if}
</div>
<div style="margin-top: 6pt; font-size: 0.8em; opacity: 0.6">
  {results.length} of {materials.length}
</div>
```

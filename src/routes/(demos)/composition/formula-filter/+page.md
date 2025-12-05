# FormulaFilter

An interactive search filter for chemical formulas with three search modes, keyboard navigation, and built-in examples.

## Interactive Demo

Try all features: search modes, examples dropdown, clear button, and callbacks:

```svelte example
<script>
  import { FormulaFilter } from 'matterviz'

  let value = $state(`Li,Fe`)
  let mode = $state(`elements`)
  let events = $state([])

  function log_event(type, detail) {
    events = [...events.slice(-3), `${type}: ${detail}`]
  }

  const mock_materials = [
    `LiFePO4`,
    `LiCoO2`,
    `LiMn2O4`,
    `NaFePO4`,
    `LiNiO2`,
    `Fe2O3`,
    `TiO2`,
    `Al2O3`,
    `SiO2`,
    `LiTiO2`,
  ]

  const filtered = $derived.by(() => {
    if (!value) return mock_materials
    const elements = value.split(/[,\-]/).map((el) => el.trim())
    if (mode === `exact`) {
      return mock_materials.filter((m) => m.toLowerCase() === value.toLowerCase())
    }
    return mock_materials.filter((m) => elements.every((el) => m.includes(el)))
  })
</script>

<div style="display: grid; gap: 1.5em">
  <FormulaFilter
    bind:value
    bind:search_mode={mode}
    onchange={(v, m) => log_event(`change`, `"${v}" (${m})`)}
    onclear={() => log_event(`clear`, `filter reset`)}
  />

  <div style="display: flex; gap: 1em; flex-wrap: wrap">
    <div style="flex: 1; min-width: 200px">
      <strong style="font-size: 0.85em; opacity: 0.7"
      >Matching ({filtered.length}):</strong>
      <div style="display: flex; flex-wrap: wrap; gap: 6pt; margin-top: 6pt">
        {#each filtered as mat}
          <code
            style="padding: 4pt 8pt; background: rgba(77, 182, 255, 0.1); border-radius: 4px; font-size: 0.85em"
          >{mat}</code>
        {:else}
          <span style="opacity: 0.5">No matches</span>
        {/each}
      </div>
    </div>
    <div style="min-width: 180px">
      <strong style="font-size: 0.85em; opacity: 0.7">Events:</strong>
      <div style="font-family: monospace; font-size: 0.8em; margin-top: 6pt">
        {#each events as evt}<div>{evt}</div>{:else}<div style="opacity: 0.4">
            No events yet
          </div>{/each}
      </div>
    </div>
  </div>
</div>
```

## Configuration Options

Customize label, hide optional elements, or disable the filter:

```svelte example
<script>
  import { FormulaFilter } from 'matterviz'

  let v1 = $state(`Si,O`)
  let v2 = $state(`LiFePO4`)
  let v3 = $state(`Na-Fe-P-O`)
  let disabled = $state(false)
</script>

<label style="display: flex; gap: 0.5em; margin-bottom: 1em; font-size: 0.9em">
  <input type="checkbox" bind:checked={disabled} /> Disable all filters
</label>

<div style="display: flex; flex-direction: column; gap: 1em">
  <FormulaFilter
    bind:value={v1}
    label="Custom Label"
    title="With custom tooltip"
    {disabled}
  />

  <FormulaFilter
    bind:value={v2}
    label="Exact Only"
    search_mode="exact"
    show_mode_selector={false}
    show_examples={false}
    {disabled}
  />

  <FormulaFilter
    bind:value={v3}
    label="Minimal"
    search_mode="chemsys"
    show_mode_selector={false}
    show_clear_button={false}
    show_examples={false}
    {disabled}
  />
</div>
```

## Multiple Filters

Combine filters for include/exclude logic:

```svelte example
<script>
  import { FormulaFilter } from 'matterviz'

  let include = $state(`Li`)
  let exclude = $state(``)

  const all_materials = [
    `LiFePO4`,
    `LiCoO2`,
    `Fe2O3`,
    `TiO2`,
    `LiMn2O4`,
    `NaFePO4`,
    `LiNiO2`,
    `Al2O3`,
  ]

  const results = $derived.by(() => {
    let mats = all_materials
    if (include) {
      const els = include.split(`,`).map((e) => e.trim())
      mats = mats.filter((m) => els.every((el) => m.includes(el)))
    }
    if (exclude) {
      const els = exclude.split(`,`).map((e) => e.trim())
      mats = mats.filter((m) => !els.some((el) => m.includes(el)))
    }
    return mats
  })
</script>

<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1em; margin-bottom: 1em">
  <FormulaFilter
    bind:value={include}
    label="Include"
    search_mode="elements"
    show_mode_selector={false}
  />
  <FormulaFilter
    bind:value={exclude}
    label="Exclude"
    search_mode="elements"
    show_mode_selector={false}
    style="--filter-border: rgba(239, 68, 68, 0.2); --highlight: #ef4444"
  />
</div>

<div style="display: flex; flex-wrap: wrap; gap: 6pt">
  {#each results as mat}
    <code
      style="padding: 4pt 8pt; background: rgba(16, 185, 129, 0.15); border-radius: 4px"
    >{mat}</code>
  {:else}
    <span style="opacity: 0.5">No matches</span>
  {/each}
</div>
<div style="margin-top: 6pt; font-size: 0.8em; opacity: 0.6">
  {results.length} of {all_materials.length} materials
</div>
```

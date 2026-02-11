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
  import { tooltip } from 'svelte-multiselect'

  // Seed history so the dropdown is visible on focus
  const history_key = `formula-filter-demo`
  const has_local_storage_api = typeof localStorage !== `undefined` &&
    typeof localStorage.getItem === `function` &&
    typeof localStorage.setItem === `function`
  if (has_local_storage_api && !localStorage.getItem(history_key)) {
    const history = JSON.stringify([`Fe,O`, `Li-Fe-O`, `Fe2O3`, `Co,Ni`])
    localStorage.setItem(history_key, history)
  }

  let value = $state(`Li,Fe`)
  let mode = $state(`elements`)
  let mode_locked = $state(false)
  let normalize_exact = $state(true)
  let validation_state = $state(`valid`)
  let validation_message = $state(``)
  let parse_preview = $state(``)

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
  const quick_examples = [
    `Li,Fe`,
    `+Li,-O`,
    `Fe:1-2,Ni:>=1`,
    `Li-Fe-O`,
    `NaCl`,
  ]
  const quick_btn_style =
    `font-family: monospace; font-size: 0.8em; border: 1px solid rgba(128,128,128,0.25); border-radius: 4px; padding: 2pt 6pt; background: rgba(77,182,255,0.08); cursor: pointer`

  type DemoToken = {
    operator: `include` | `exclude`
    element: string
    constraint: string | null
  }

  const parse_tokens = (query, query_mode): DemoToken[] => {
    if (!query || query_mode === `exact`) return []
    const normalized_query = query_mode === `chemsys`
      ? query.replaceAll(`,`, `-`)
      : query
    const split_tokens = query_mode === `chemsys`
      // Keep range constraints like Fe:1-2 intact while splitting separators.
      ? normalized_query.split(/-(?!\d)/)
      : normalized_query.split(`,`)
    return split_tokens
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        const operator = token.startsWith(`-`) || token.startsWith(`!`)
          ? `exclude`
          : `include`
        const unsigned = /^[+\-!]/.test(token) ? token.slice(1) : token
        const [element, constraint] = unsigned.split(`:`)
        return { operator, element, constraint: constraint || null }
      })
  }

  const satisfies_constraint = (count, constraint) => {
    if (!constraint) return true
    if (/^\d+$/.test(constraint)) return count === Number(constraint)
    if (/^\d+-\d+$/.test(constraint)) {
      const [min_str, max_str] = constraint.split(`-`)
      return count >= Number(min_str) && count <= Number(max_str)
    }
    if (/^>=\d+$/.test(constraint)) return count >= Number(constraint.slice(2))
    if (/^<=\d+$/.test(constraint)) return count <= Number(constraint.slice(2))
    if (/^>\d+$/.test(constraint)) return count > Number(constraint.slice(1))
    if (/^<\d+$/.test(constraint)) return count < Number(constraint.slice(1))
    return true
  }

  const filtered = $derived.by(() => {
    if (!value) return materials.slice(0, 60)
    if (mode === `exact`) {
      // Exact formula match - compare stringified compositions
      const target = value.toLowerCase()
      return materials.filter((comp) => to_str(comp).toLowerCase() === target)
    }
    const tokens = parse_tokens(value, mode)
    return materials.filter((comp) => {
      const matches_tokens = tokens.every((tok) => {
        if (tok.element === `*`) return true
        const count = comp[tok.element] ?? 0
        if (tok.operator === `exclude`) return count === 0
        return count > 0 && satisfies_constraint(count, tok.constraint)
      })
      if (!matches_tokens) return false
      if (mode !== `chemsys`) return true

      // Chemsys means "only these elements", even when token constraints are present.
      const has_wildcard = tokens.some((tok) => tok.element === `*`)
      if (has_wildcard) return true

      const included_elements = tokens
        .filter((tok) => tok.operator === `include`)
        .map((tok) => tok.element)
      const included_set = new Set(included_elements)
      const comp_elements = Object.keys(comp)
      return included_elements.every((elem) => elem in comp) &&
        comp_elements.every((elem) => included_set.has(elem))
    })
  })
</script>

<FormulaFilter
  bind:value
  bind:search_mode={mode}
  bind:mode_locked
  {history_key}
  {normalize_exact}
  onparse={(parsed) => {
    parse_preview = JSON.stringify(parsed, null, 2)
  }}
  on_validation={(validation) => {
    validation_state = validation.state
    validation_message = validation.message || ``
  }}
  validate={(_value, _mode, parsed) => {
    if (parsed.tokens.length > 5) {
      return {
        state: `warning`,
        message: `Large query (${parsed.tokens.length} tokens)`,
      }
    }
    return null
  }}
/>

<div>
  <label
    title="Lock search mode to prevent auto-inference while typing"
    {@attach tooltip()}
  >
    <input type="checkbox" bind:checked={mode_locked} />
    lock mode
  </label>
  <label
    title="Canonicalize exact formulas (e.g. NaCl -> ClNa) on submit"
    {@attach tooltip()}
  >
    <input type="checkbox" bind:checked={normalize_exact} />
    normalize exact formulas
  </label>
  <span title="Live validation state from FormulaFilter" {@attach tooltip()}>status: {
      validation_state
    }</span>
  {#if validation_message}
    <span>{validation_message}</span>
  {/if}
</div>

<div style="display: flex; flex-wrap: wrap; gap: 5pt; margin-top: 8pt">
  {#each quick_examples as example}
    <button
      type="button"
      onclick={() => (value = example)}
      style={quick_btn_style}
    >
      {example}
    </button>
  {/each}
</div>

{#if parse_preview}
  <pre
    style="margin-top: 8pt; max-height: 180px; overflow: auto; padding: 6pt 8pt; border-radius: 6px; background: rgba(128, 128, 128, 0.08); font-size: 0.72em"
  >{parse_preview}</pre>
{/if}

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
- `+Li,-O` → include Li and exclude O in one query
- `Fe:1-2,Ni:>=1` → tokenized constraints for advanced filtering UIs
- `Li-Fe-O` → materials with only Li, Fe, O (chemical system)
- `LiFeO3` → exact formula match
- `Li` → unary element match

Additional features in `FormulaFilter`:

- exact-mode canonicalization (`NaCl` normalizes to `ClNa` by default)
- optional mode lock (`bind:mode_locked`) to prevent automatic mode inference
- validation hooks (`validate`, `on_validation`) and structured parsing callbacks (`onparse`)
- searchable, pinnable, clearable history entries
- token chips for include/exclude and wildcard expressions
- quick example pills and live parse/validation preview are wired above

## Include/Exclude Filters

```svelte example
<script lang="ts">
  import {
    Formula,
    FormulaFilter,
    get_alphabetical_formula,
  } from 'matterviz/composition'

  let include = $state(`+Li,-O`)
  let exclude = $state(``)
  const advanced_example = `Fe:1-2,Ni:>=1`
  const quick_btn_style =
    `font-family: monospace; font-size: 0.78em; border: 1px solid rgba(128,128,128,0.25); border-radius: 4px; padding: 2pt 6pt; background: rgba(77,182,255,0.08); cursor: pointer`

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
  const strip_prefix = (token) => /^[+\-!]/.test(token) ? token.slice(1) : token
  const split_csv_tokens = (query) =>
    query
      .split(`,`)
      .map((token) => token.trim())
      .filter(Boolean)
  const parse_tokens = (query) =>
    split_csv_tokens(query).map((token) => {
      const unsigned = strip_prefix(token)
      const [element, constraint] = unsigned.split(`:`)
      return { token, element, constraint: constraint || null }
    })
  const parse_include_tokens = (query) =>
    parse_tokens(query).map(({ token, element, constraint }) => {
      const operator = token.startsWith(`-`) || token.startsWith(`!`)
        ? `exclude`
        : `include`
      return { operator, element, constraint: constraint || null }
    })
  const parse_exclude_tokens = (query) =>
    parse_tokens(query).map(({ element }) => element)
  const satisfies_constraint = (count, constraint) => {
    if (!constraint) return true
    if (/^\d+$/.test(constraint)) return count === Number(constraint)
    if (/^\d+-\d+$/.test(constraint)) {
      const [min_str, max_str] = constraint.split(`-`)
      return count >= Number(min_str) && count <= Number(max_str)
    }
    if (/^>=\d+$/.test(constraint)) return count >= Number(constraint.slice(2))
    if (/^<=\d+$/.test(constraint)) return count <= Number(constraint.slice(2))
    if (/^>\d+$/.test(constraint)) return count > Number(constraint.slice(1))
    if (/^<\d+$/.test(constraint)) return count < Number(constraint.slice(1))
    return true
  }
  const results = $derived.by(() => {
    let mats = materials
    if (include) {
      const tokens = parse_include_tokens(include)
      mats = mats.filter((comp) =>
        tokens.every((token) => {
          if (token.element === `*`) return true
          const count = comp[token.element] ?? 0
          if (token.operator === `exclude`) return count === 0
          return count > 0 && satisfies_constraint(count, token.constraint)
        })
      )
    }
    if (exclude) {
      const excluded_elements = parse_exclude_tokens(exclude)
      mats = mats.filter((comp) =>
        !excluded_elements.some((element) => element in comp)
      )
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

<div style="display: flex; flex-wrap: wrap; gap: 6pt; margin-bottom: 8pt">
  <button
    type="button"
    onclick={() => (include = `+Li,-O`)}
    style={quick_btn_style}
  >
    +Li,-O
  </button>
  <button
    type="button"
    onclick={() => (include = advanced_example)}
    style={quick_btn_style}
  >
    {advanced_example}
  </button>
  <span style="font-size: 0.78em; opacity: 0.7"
  >Try removing chips directly in the include filter.</span>
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
